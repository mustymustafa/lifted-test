import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { Clock } from '../../src/common/clock';
import { AppConfig } from '../../src/common/config';
import { FakeClock, MINUTE } from '../support/fake-clock';

/**
 * Full stack over HTTP against the real seed file: GraphQL schema, zod
 * validation, error mapping, services and the in-memory store.
 */
describe('Booking API (e2e)', () => {
  let app: INestApplication;
  let clock: FakeClock;

  beforeEach(async () => {
    clock = new FakeClock();
    const config: AppConfig = { port: 0, holdMs: 10 * MINUTE, sweepIntervalMs: 0, seedPath: 'data/seed.json' };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(Clock)
      .useValue(clock)
      .overrideProvider(AppConfig)
      .useValue(config)
      .compile();
    app = moduleRef.createNestApplication();
    await app.listen(0); // listen once so parallel requests share one server
  });

  afterEach(async () => {
    await app.close();
  });

  async function gql(query: string, variables: Record<string, unknown> = {}) {
    const res = await request(app.getHttpServer()).post('/graphql').send({ query, variables });
    return res.body as { data?: any; errors?: { message: string; extensions: { code: string; issues?: any[] } }[] };
  }

  const SLOTS = `query ($filter: AvailabilityFilterInput) {
    availableSlots(filter: $filter) { advisor { id name } visaType start end }
  }`;
  const REQUEST = `mutation ($input: RequestBookingInput!) {
    requestBooking(input: $input) { id candidateName visaType status start end expiresAt advisor { id name } }
  }`;
  const CONFIRM = `mutation ($input: ConfirmBookingInput!) {
    confirmBooking(input: $input) { id status confirmedAt }
  }`;
  const BOOKINGS = `query ($filter: BookingsFilterInput, $first: Int, $after: ID) {
    bookings(filter: $filter, first: $first, after: $after) {
      totalCount nextCursor items { id candidateName status advisor { name } }
    }
  }`;

  const slots = async (filter: Record<string, unknown> = {}) => (await gql(SLOTS, { filter })).data.availableSlots;
  const SOFIA_MON_0900 = { advisorId: 'ia-001', slotStart: '2025-03-10T09:00:00.000Z' };

  describe('availableSlots', () => {
    it('derives every slot from the seed windows', async () => {
      // Hand-counted from the seed: windows under 30 min (Sofia 11th, Rajan 18th) give nothing.
      expect(await slots({ visaType: 'A' })).toHaveLength(44);
      expect(await slots({ visaType: 'B' })).toHaveLength(17);
      expect(await slots()).toHaveLength(61);
    });

    it('returns the earliest slot first with the advisor attached', async () => {
      const [first] = await slots({ visaType: 'A' });
      expect(first).toEqual({
        advisor: { id: 'ia-001', name: 'Sofia Andersson' },
        visaType: 'A',
        start: '2025-03-10T09:00:00.000Z',
        end: '2025-03-10T09:30:00.000Z',
      });
    });

    it('filters by advisor and date range', async () => {
      const result = await slots({
        visaType: 'A',
        advisorId: 'ia-002',
        from: '2025-03-10T00:00:00Z',
        to: '2025-03-11T00:00:00Z',
      });
      expect(result.map((s: any) => s.start.slice(11, 16))).toEqual(['09:00', '09:33', '10:03', '10:33']);
    });

    it('excludes held slots and the break after them', async () => {
      await gql(REQUEST, { input: { candidateName: 'Amina', visaType: 'B', ...SOFIA_MON_0900 } });
      const result = await slots({ advisorId: 'ia-001', to: '2025-03-11T00:00:00Z' });
      expect(result.map((s: any) => `${s.visaType}@${s.start.slice(11, 16)}`)).toEqual(['A@10:10']);
    });

    it('rejects an unknown advisor', async () => {
      const res = await gql(SLOTS, { filter: { advisorId: 'ia-999' } });
      expect(res.errors?.[0].extensions.code).toBe('ADVISOR_NOT_FOUND');
    });

    it('rejects a range where from is after to', async () => {
      const res = await gql(SLOTS, { filter: { from: '2025-03-12T00:00:00Z', to: '2025-03-11T00:00:00Z' } });
      expect(res.errors?.[0].extensions).toMatchObject({ code: 'BAD_USER_INPUT', issues: [{ path: 'from' }] });
    });
  });

  describe('requestBooking', () => {
    it('holds the earliest slot for ten minutes', async () => {
      const res = await gql(REQUEST, { input: { candidateName: '  Amina Yusuf ', visaType: 'B' } });
      expect(res.errors).toBeUndefined();
      expect(res.data.requestBooking).toMatchObject({
        candidateName: 'Amina Yusuf',
        visaType: 'B',
        status: 'HELD',
        start: '2025-03-10T09:00:00.000Z',
        end: '2025-03-10T10:00:00.000Z',
        expiresAt: new Date(clock.now().getTime() + 10 * MINUTE).toISOString(),
        advisor: { id: 'ia-001', name: 'Sofia Andersson' },
      });
    });

    it.each([
      ['a blank name', { candidateName: '   ', visaType: 'A' }, 'candidateName'],
      ['a name over 120 characters', { candidateName: 'x'.repeat(121), visaType: 'A' }, 'candidateName'],
    ])('rejects %s', async (_name, input, path) => {
      const res = await gql(REQUEST, { input });
      expect(res.errors?.[0].extensions).toMatchObject({ code: 'BAD_USER_INPUT', issues: [{ path }] });
    });

    it('rejects an unknown visa type at the schema level', async () => {
      const res = await gql(REQUEST, { input: { candidateName: 'Amina', visaType: 'C' } });
      expect(res.errors?.[0].extensions.code).toBe('BAD_USER_INPUT');
      expect(res.data).toBeUndefined();
    });

    it('rejects a slot that is already held', async () => {
      await gql(REQUEST, { input: { candidateName: 'First', visaType: 'A', ...SOFIA_MON_0900 } });
      const res = await gql(REQUEST, { input: { candidateName: 'Second', visaType: 'A', ...SOFIA_MON_0900 } });
      expect(res.errors?.[0].extensions.code).toBe('SLOT_UNAVAILABLE');
    });

    it('gives exactly one winner when 20 requests race for one slot', async () => {
      const results = await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          gql(REQUEST, { input: { candidateName: `Candidate ${i}`, visaType: 'A', ...SOFIA_MON_0900 } }),
        ),
      );
      expect(results.filter((r) => r.data?.requestBooking)).toHaveLength(1);
      const failures = results.filter((r) => r.errors);
      expect(failures).toHaveLength(19);
      expect(failures.every((r) => r.errors![0].extensions.code === 'SLOT_UNAVAILABLE')).toBe(true);
    });

    it('hands out distinct slots when 20 requests race with no preference', async () => {
      const results = await Promise.all(
        Array.from({ length: 20 }, (_, i) => gql(REQUEST, { input: { candidateName: `Candidate ${i}`, visaType: 'A' } })),
      );
      const keys = results.map((r) => `${r.data.requestBooking.advisor.id}@${r.data.requestBooking.start}`);
      expect(new Set(keys).size).toBe(20);
    });

    it('reports NO_SLOT_AVAILABLE once everything is taken', async () => {
      for (let i = 0; i < 17; i++) {
        const res = await gql(REQUEST, { input: { candidateName: `Candidate ${i}`, visaType: 'B' } });
        if (res.errors) break;
      }
      expect(await slots({ visaType: 'B' })).toHaveLength(0);
      const res = await gql(REQUEST, { input: { candidateName: 'Too late', visaType: 'B' } });
      expect(res.errors?.[0].extensions.code).toBe('NO_SLOT_AVAILABLE');
    });
  });

  describe('confirmBooking', () => {
    const hold = async () =>
      (await gql(REQUEST, { input: { candidateName: 'Amina', visaType: 'A', ...SOFIA_MON_0900 } })).data.requestBooking;

    it('confirms within the window', async () => {
      const booking = await hold();
      clock.advance(9 * MINUTE);
      const res = await gql(CONFIRM, { input: { bookingId: booking.id, advisorId: 'ia-001' } });
      expect(res.data.confirmBooking).toEqual({
        id: booking.id,
        status: 'CONFIRMED',
        confirmedAt: clock.now().toISOString(),
      });
    });

    it('keeps a confirmed slot out of availability after the hold window has passed', async () => {
      const booking = await hold();
      await gql(CONFIRM, { input: { bookingId: booking.id, advisorId: 'ia-001' } });
      clock.advance(60 * MINUTE);
      const starts = (await slots({ visaType: 'A', advisorId: 'ia-001' })).map((s: any) => s.start);
      expect(starts).not.toContain(SOFIA_MON_0900.slotStart);
      expect(starts[0]).toBe('2025-03-10T09:35:00.000Z');
    });

    it('rejects a confirmation after the hold has lapsed and releases the slot', async () => {
      const booking = await hold();
      clock.advance(10 * MINUTE);

      const res = await gql(CONFIRM, { input: { bookingId: booking.id, advisorId: 'ia-001' } });
      expect(res.errors?.[0].extensions.code).toBe('HOLD_EXPIRED');

      const [first] = await slots({ visaType: 'A', advisorId: 'ia-001' });
      expect(first.start).toBe(SOFIA_MON_0900.slotStart);
    });

    it('rejects a different advisor', async () => {
      const booking = await hold();
      const res = await gql(CONFIRM, { input: { bookingId: booking.id, advisorId: 'ia-002' } });
      expect(res.errors?.[0].extensions.code).toBe('FORBIDDEN');
    });

    it('rejects an unknown booking', async () => {
      const res = await gql(CONFIRM, { input: { bookingId: 'missing', advisorId: 'ia-001' } });
      expect(res.errors?.[0].extensions.code).toBe('BOOKING_NOT_FOUND');
    });

    it('rejects confirming twice', async () => {
      const booking = await hold();
      const input = { bookingId: booking.id, advisorId: 'ia-001' };
      await gql(CONFIRM, { input });
      const res = await gql(CONFIRM, { input });
      expect(res.errors?.[0].extensions.code).toBe('INVALID_STATE');
    });
  });

  describe('bookings', () => {
    beforeEach(async () => {
      const first = await gql(REQUEST, { input: { candidateName: 'Lapsed', visaType: 'A', ...SOFIA_MON_0900 } });
      expect(first.errors).toBeUndefined();
      clock.advance(10 * MINUTE);
      const kept = await gql(REQUEST, { input: { candidateName: 'Confirmed', visaType: 'B', advisorId: 'ia-002' } });
      await gql(CONFIRM, { input: { bookingId: kept.data.requestBooking.id, advisorId: 'ia-002' } });
      await gql(REQUEST, { input: { candidateName: 'Held', visaType: 'A', advisorId: 'ia-001' } });
    });

    it('returns all bookings with their current status', async () => {
      const { bookings } = (await gql(BOOKINGS)).data;
      expect(bookings.totalCount).toBe(3);
      expect(bookings.items.map((b: any) => [b.candidateName, b.status, b.advisor.name])).toEqual([
        ['Lapsed', 'EXPIRED', 'Sofia Andersson'],
        ['Held', 'HELD', 'Sofia Andersson'],
        ['Confirmed', 'CONFIRMED', 'Rajan Patel'],
      ]);
    });

    it('filters by status and advisor', async () => {
      const byStatus = (await gql(BOOKINGS, { filter: { status: 'CONFIRMED' } })).data.bookings;
      expect(byStatus.items.map((b: any) => b.candidateName)).toEqual(['Confirmed']);

      const byAdvisor = (await gql(BOOKINGS, { filter: { advisorId: 'ia-001' } })).data.bookings;
      expect(byAdvisor.items.map((b: any) => b.candidateName)).toEqual(['Lapsed', 'Held']);
    });

    it('pages with a cursor', async () => {
      const first = (await gql(BOOKINGS, { first: 2 })).data.bookings;
      expect(first.items).toHaveLength(2);
      expect(first.nextCursor).toBe(first.items[1].id);

      const second = (await gql(BOOKINGS, { first: 2, after: first.nextCursor })).data.bookings;
      expect(second.items.map((b: any) => b.candidateName)).toEqual(['Confirmed']);
      expect(second.nextCursor).toBeNull();
    });

    it('rejects a page size outside 1 to 100', async () => {
      for (const first of [0, 101]) {
        const res = await gql(BOOKINGS, { first });
        expect(res.errors?.[0].extensions.code).toBe('BAD_USER_INPUT');
      }
    });
  });

  describe('waitlist', () => {
    const JOIN = `mutation ($input: JoinWaitlistInput!) {
      joinWaitlist(input: $input) { id candidateName visaType status joinedAt offer { id } }
    }`;
    const ENTRY = `query ($id: ID!) {
      waitlistEntry(id: $id) { status offer { id status start expiresAt advisor { id } } }
    }`;
    const ACCEPT = `mutation ($input: AcceptOfferInput!) { acceptOffer(input: $input) { id status expiresAt } }`;
    const CANCEL = `mutation ($input: CancelBookingInput!) { cancelBooking(input: $input) { id status cancelledAt } }`;
    const BOOKING = `query ($id: ID!) { booking(id: $id) { id status candidateName } }`;
    const WAITLIST = `query ($status: WaitlistStatus) { waitlist(status: $status) { candidateName status } }`;

    /** Books and confirms every type B slot, so nothing lapses when the clock moves. */
    async function fillAllTypeB(): Promise<string[]> {
      const ids: string[] = [];
      for (;;) {
        const res = await gql(REQUEST, { input: { candidateName: `Filler ${ids.length}`, visaType: 'B' } });
        if (res.errors) break;
        const { id, advisor } = res.data.requestBooking;
        await gql(CONFIRM, { input: { bookingId: id, advisorId: advisor.id } });
        ids.push(id);
      }
      return ids;
    }

    it('refuses to join while a slot is available', async () => {
      const res = await gql(JOIN, { input: { candidateName: 'Wanda', visaType: 'B' } });
      expect(res.errors?.[0].extensions.code).toBe('SLOTS_AVAILABLE');
    });

    it('runs the full path: join, cancellation, offer, accept, advisor confirms', async () => {
      const [firstBooking] = await fillAllTypeB();

      const joined = await gql(JOIN, { input: { candidateName: ' Wanda ', visaType: 'B' } });
      expect(joined.data.joinWaitlist).toMatchObject({ candidateName: 'Wanda', status: 'WAITING', offer: null });
      const entryId = joined.data.joinWaitlist.id;

      const cancelled = await gql(CANCEL, { input: { bookingId: firstBooking } });
      expect(cancelled.data.cancelBooking.status).toBe('CANCELLED');

      const entry = (await gql(ENTRY, { id: entryId })).data.waitlistEntry;
      expect(entry).toMatchObject({
        status: 'OFFERED',
        offer: {
          status: 'OFFERED',
          start: '2025-03-10T09:00:00.000Z',
          expiresAt: new Date(clock.now().getTime() + 10 * MINUTE).toISOString(),
        },
      });

      // A walk-in cannot take the offered slot.
      const walkIn = await gql(REQUEST, { input: { candidateName: 'Walk-in', visaType: 'B' } });
      expect(walkIn.errors?.[0].extensions.code).toBe('NO_SLOT_AVAILABLE');

      clock.advance(5 * MINUTE);
      const accepted = await gql(ACCEPT, { input: { waitlistEntryId: entryId } });
      expect(accepted.data.acceptOffer).toMatchObject({ id: entry.offer.id, status: 'HELD' });

      const confirmed = await gql(CONFIRM, {
        input: { bookingId: entry.offer.id, advisorId: entry.offer.advisor.id },
      });
      expect(confirmed.data.confirmBooking.status).toBe('CONFIRMED');
      expect((await gql(BOOKING, { id: entry.offer.id })).data.booking).toMatchObject({
        status: 'CONFIRMED',
        candidateName: 'Wanda',
      });
    });

    it('passes a missed offer to the next candidate', async () => {
      const [firstBooking] = await fillAllTypeB();
      const first = (await gql(JOIN, { input: { candidateName: 'First', visaType: 'B' } })).data.joinWaitlist;
      clock.advance(MINUTE);
      await gql(JOIN, { input: { candidateName: 'Second', visaType: 'B' } });
      await gql(CANCEL, { input: { bookingId: firstBooking } });

      clock.advance(10 * MINUTE);
      const late = await gql(ACCEPT, { input: { waitlistEntryId: first.id } });
      expect(late.errors?.[0].extensions.code).toBe('OFFER_EXPIRED');

      expect((await gql(WAITLIST)).data.waitlist).toEqual([
        { candidateName: 'First', status: 'EXPIRED' },
        { candidateName: 'Second', status: 'OFFERED' },
      ]);
      expect((await gql(WAITLIST, { status: 'OFFERED' })).data.waitlist).toHaveLength(1);
    });

    it('returns null for an unknown booking or waitlist entry', async () => {
      expect((await gql(BOOKING, { id: 'missing' })).data.booking).toBeNull();
      expect((await gql(ENTRY, { id: 'missing' })).data.waitlistEntry).toBeNull();
    });

    it('rejects cancelling an unknown booking and accepting an unknown entry', async () => {
      const cancel = await gql(CANCEL, { input: { bookingId: 'missing' } });
      expect(cancel.errors?.[0].extensions.code).toBe('BOOKING_NOT_FOUND');
      const accept = await gql(ACCEPT, { input: { waitlistEntryId: 'missing' } });
      expect(accept.errors?.[0].extensions.code).toBe('WAITLIST_ENTRY_NOT_FOUND');
    });
  });
});
