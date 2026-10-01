import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { Clock } from '../../src/common/clock';
import { AppConfig } from '../../src/config/config';
import { FakeClock, MINUTE } from '../support/fake-clock';

/**
 * The API over HTTP, against the real seed file. The business rules are
 * covered in test/acceptance; these tests are about what only a real request
 * can show: the GraphQL schema, input validation, error codes as a client sees
 * them, nested fields, and requests genuinely arriving together.
 */
describe('API over HTTP (e2e)', () => {
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

  type Result = { data?: any; errors?: { message: string; extensions: { code: string; issues?: any[]; existingRequest?: any } }[] };
  const gql = async (query: string, variables: Record<string, unknown> = {}) =>
    (await request(app.getHttpServer()).post('/graphql').send({ query, variables })).body as Result;
  const codeOf = (res: Result) => res.errors?.[0].extensions.code;

  const SLOTS = `query ($filter: AvailabilityFilterInput) {
    availableSlots(filter: $filter) { advisor { id name } visaType start end }
  }`;
  const REQUEST = `mutation ($input: RequestBookingInput!) {
    requestBooking(input: $input) { id candidateName visaType status start end expiresAt advisor { id name } }
  }`;
  const CONFIRM = `mutation ($input: ConfirmBookingInput!) { confirmBooking(input: $input) { id status confirmedAt } }`;
  const CANCEL = `mutation ($input: CancelBookingInput!) { cancelBooking(input: $input) { id status cancelledAt } }`;
  const BOOKINGS = `query ($filter: BookingsFilterInput, $first: Int, $after: ID) {
    bookings(filter: $filter, first: $first, after: $after) {
      totalCount nextCursor items { id candidateName status advisor { name } }
    }
  }`;
  const slots = async (filter: Record<string, unknown> = {}) => (await gql(SLOTS, { filter })).data.availableSlots;
  const SOFIA_MON_0900 = { advisorId: 'ia-001', slotStart: '2025-03-10T09:00:00.000Z' };

  describe('availableSlots', () => {
    it('derives every slot from the seed file', async () => {
      // Counted by hand from the seed: windows under 30 minutes (Sofia 11 March, Rajan 18 March) give nothing.
      expect(await slots({ visaType: 'A' })).toHaveLength(44);
      expect(await slots({ visaType: 'B' })).toHaveLength(17);
      expect(await slots()).toHaveLength(61);
    });

    it('returns the earliest slot first, with its advisor attached', async () => {
      const [first] = await slots({ visaType: 'A' });
      expect(first).toEqual({
        advisor: { id: 'ia-001', name: 'Sofia Andersson' },
        visaType: 'A',
        start: '2025-03-10T09:00:00.000Z',
        end: '2025-03-10T09:30:00.000Z',
      });
    });

    it('applies the advisor and date filters sent in the request', async () => {
      const result = await slots({ visaType: 'A', advisorId: 'ia-002', from: '2025-03-10T00:00:00Z', to: '2025-03-11T00:00:00Z' });
      expect(result.map((s: any) => s.start.slice(11, 16))).toEqual(['09:00', '09:33', '10:03', '10:33']);
    });

    it('reports an unknown advisor, and a date range the wrong way round, with a stable error code', async () => {
      expect(codeOf(await gql(SLOTS, { filter: { advisorId: 'ia-999' } }))).toBe('ADVISOR_NOT_FOUND');

      const backwards = await gql(SLOTS, { filter: { from: '2025-03-12T00:00:00Z', to: '2025-03-11T00:00:00Z' } });
      expect(backwards.errors?.[0].extensions).toMatchObject({ code: 'BAD_USER_INPUT', issues: [{ path: 'from' }] });
    });
  });

  describe('requestBooking', () => {
    it('holds the earliest slot for ten minutes, with the name trimmed', async () => {
      const res = await gql(REQUEST, { input: { candidateName: '  Amina Yusuf ', visaType: 'B' } });
      expect(res.errors).toBeUndefined();
      expect(res.data.requestBooking).toMatchObject({
        candidateName: 'Amina Yusuf',
        status: 'HELD',
        start: '2025-03-10T09:00:00.000Z',
        end: '2025-03-10T10:00:00.000Z',
        expiresAt: new Date(clock.now().getTime() + 10 * MINUTE).toISOString(),
        advisor: { id: 'ia-001', name: 'Sofia Andersson' },
      });
    });

    it.each([
      ['a blank name', { candidateName: '   ', visaType: 'A' }],
      ['a visa type that does not exist', { candidateName: 'Amina', visaType: 'C' }],
    ])('refuses %s', async (_label, input) => {
      const res = await gql(REQUEST, { input });
      expect(codeOf(res)).toBe('BAD_USER_INPUT');
    });

    it('names the field that failed validation', async () => {
      const res = await gql(REQUEST, { input: { candidateName: '   ', visaType: 'A' } });
      expect(res.errors?.[0].extensions.issues).toMatchObject([{ path: 'candidateName' }]);
    });

    it('gives exactly one winner when 20 requests for one slot arrive at the same moment', async () => {
      const results = await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          gql(REQUEST, { input: { candidateName: `Candidate ${i}`, visaType: 'A', ...SOFIA_MON_0900 } }),
        ),
      );
      expect(results.filter((r) => r.data?.requestBooking)).toHaveLength(1);
      expect(results.filter((r) => codeOf(r) === 'SLOT_UNAVAILABLE')).toHaveLength(19);
    });
  });

  describe('confirmBooking', () => {
    const hold = async () =>
      (await gql(REQUEST, { input: { candidateName: 'Amina', visaType: 'A', ...SOFIA_MON_0900 } })).data.requestBooking;

    it('confirms within the ten minutes, and says when', async () => {
      const booking = await hold();
      clock.advance(9 * MINUTE);
      const res = await gql(CONFIRM, { input: { bookingId: booking.id, advisorId: 'ia-001' } });
      expect(res.data.confirmBooking).toEqual({ id: booking.id, status: 'CONFIRMED', confirmedAt: clock.now().toISOString() });
    });

    it('refuses after the hold has expired, and offers the slot again', async () => {
      const booking = await hold();
      clock.advance(10 * MINUTE);

      expect(codeOf(await gql(CONFIRM, { input: { bookingId: booking.id, advisorId: 'ia-001' } }))).toBe('HOLD_EXPIRED');

      const [first] = await slots({ visaType: 'A', advisorId: 'ia-001' });
      expect(first.start).toBe(SOFIA_MON_0900.slotStart);
    });
  });

  describe('bookings', () => {
    beforeEach(async () => {
      await gql(REQUEST, { input: { candidateName: 'Lapsed', visaType: 'A', ...SOFIA_MON_0900 } });
      clock.advance(10 * MINUTE);
      const kept = await gql(REQUEST, { input: { candidateName: 'Confirmed', visaType: 'B', advisorId: 'ia-002' } });
      await gql(CONFIRM, { input: { bookingId: kept.data.requestBooking.id, advisorId: 'ia-002' } });
      await gql(REQUEST, { input: { candidateName: 'Held', visaType: 'A', advisorId: 'ia-001' } });
    });

    it('returns every booking with its status and its advisor', async () => {
      const { bookings } = (await gql(BOOKINGS)).data;
      expect(bookings.totalCount).toBe(3);
      expect(bookings.items.map((b: any) => [b.candidateName, b.status, b.advisor.name])).toEqual([
        ['Lapsed', 'EXPIRED', 'Sofia Andersson'],
        ['Held', 'HELD', 'Sofia Andersson'],
        ['Confirmed', 'CONFIRMED', 'Rajan Patel'],
      ]);
    });

    it('pages with a cursor', async () => {
      const first = (await gql(BOOKINGS, { first: 2 })).data.bookings;
      expect(first.items).toHaveLength(2);
      expect(first.nextCursor).toBe(first.items[1].id);

      const second = (await gql(BOOKINGS, { first: 2, after: first.nextCursor })).data.bookings;
      expect(second.items.map((b: any) => b.candidateName)).toEqual(['Confirmed']);
      expect(second.nextCursor).toBeNull();
    });

    it('refuses a page size outside 1 to 100', async () => {
      for (const first of [0, 101]) expect(codeOf(await gql(BOOKINGS, { first }))).toBe('BAD_USER_INPUT');
    });
  });

  describe('waitlist', () => {
    const JOIN = `mutation ($input: JoinWaitlistInput!) {
      joinWaitlist(input: $input) { id candidateName visaType status joinedAt offer { id } }
    }`;
    const ENTRY = `query ($id: ID!) { waitlistEntry(id: $id) { status offer { id status start expiresAt advisor { id } } } }`;
    const ACCEPT = `mutation ($input: AcceptOfferInput!) { acceptOffer(input: $input) { id status expiresAt } }`;
    const LEAVE = `mutation ($input: LeaveWaitlistInput!) { leaveWaitlist(input: $input) { id status } }`;
    const BOOKING = `query ($id: ID!) { booking(id: $id) { id status candidateName } }`;
    const WAITLIST = `query { waitlist { candidateName status } }`;

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

    it('runs the whole path: join, cancellation, offer, accept, advisor confirms', async () => {
      const [firstBooking] = await fillAllTypeB();

      const joined = await gql(JOIN, { input: { candidateName: ' Wanda ', visaType: 'B' } });
      expect(joined.data.joinWaitlist).toMatchObject({ candidateName: 'Wanda', status: 'WAITING', offer: null });
      const entryId = joined.data.joinWaitlist.id;

      expect((await gql(CANCEL, { input: { bookingId: firstBooking } })).data.cancelBooking.status).toBe('CANCELLED');

      const entry = (await gql(ENTRY, { id: entryId })).data.waitlistEntry;
      expect(entry).toMatchObject({
        status: 'OFFERED',
        offer: { status: 'OFFERED', start: '2025-03-10T09:00:00.000Z' },
      });

      clock.advance(5 * MINUTE);
      const accepted = await gql(ACCEPT, { input: { waitlistEntryId: entryId } });
      expect(accepted.data.acceptOffer).toMatchObject({ id: entry.offer.id, status: 'HELD' });

      const confirmed = await gql(CONFIRM, { input: { bookingId: entry.offer.id, advisorId: entry.offer.advisor.id } });
      expect(confirmed.data.confirmBooking.status).toBe('CONFIRMED');
      expect((await gql(BOOKING, { id: entry.offer.id })).data.booking).toMatchObject({ status: 'CONFIRMED', candidateName: 'Wanda' });
    });

    it('lets a candidate decline an offer, which passes it to the next in the queue', async () => {
      const [firstBooking] = await fillAllTypeB();
      const first = (await gql(JOIN, { input: { candidateName: 'First', visaType: 'B' } })).data.joinWaitlist;
      clock.advance(MINUTE);
      await gql(JOIN, { input: { candidateName: 'Second', visaType: 'B' } });
      await gql(CANCEL, { input: { bookingId: firstBooking } }); // offered to First

      const left = await gql(LEAVE, { input: { waitlistEntryId: first.id } });
      expect(left.data.leaveWaitlist).toEqual({ id: first.id, status: 'CANCELLED' });

      expect((await gql(WAITLIST)).data.waitlist).toEqual([
        { candidateName: 'First', status: 'CANCELLED' },
        { candidateName: 'Second', status: 'OFFERED' },
      ]);
    });

    it('returns null for a booking or waitlist entry that does not exist', async () => {
      expect((await gql(BOOKING, { id: 'missing' })).data.booking).toBeNull();
      expect((await gql(ENTRY, { id: 'missing' })).data.waitlistEntry).toBeNull();
    });
  });

  // Edge case found by manual testing in Postman: sending the same booking
  // request over and over put a new slot on hold every time.
  describe('one active request per candidate', () => {
    const requestAs = (name: string) =>
      gql(`mutation ($name: String!) { requestBooking(input: { candidateName: $name, visaType: A }) { id status } }`, { name });

    it('refuses the same request sent again, and says which booking is in the way', async () => {
      const first = (await requestAs('Amina Yusuf')).data.requestBooking;

      const again = await requestAs('Amina Yusuf');

      expect(codeOf(again)).toBe('ACTIVE_REQUEST_EXISTS');
      expect(again.errors?.[0].message).toContain('Amina Yusuf already has an active request');
      expect(again.errors?.[0].extensions.existingRequest).toEqual({ kind: 'BOOKING', id: first.id, status: 'HELD' });
    });

    it('holds one slot, not ten, when the same request is sent ten times', async () => {
      for (let i = 0; i < 10; i++) await requestAs('Amina Yusuf');
      expect(await slots({ visaType: 'A' })).toHaveLength(43);
      expect((await gql('{ bookings { totalCount } }')).data.bookings.totalCount).toBe(1);
    });
  });
});
