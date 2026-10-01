import { RequestBookingSchema } from '../../src/bookings/booking.dto';
import { BookingStatus } from '../../src/bookings/booking.model';
import { VisaType } from '../../src/config/rules';
import { MINUTE } from '../support/fake-clock';
import { setup, SOFIA, t } from '../support/harness';

const ACTIVE = { code: 'ACTIVE_REQUEST_EXISTS' };
const amina = { candidateName: 'Amina Yusuf', visaType: VisaType.A };

/**
 * Acceptance criteria: Requesting a booking.
 * The groups below are the criteria, word for word, from
 * docs/ACCEPTANCE_CRITERIA_AND_TEST_SCENARIOS.md.
 */
describe('Requesting a booking', () => {
  describe('A candidate can request a booking by giving their name and visa type', () => {
    it('assigns the earliest free slot across advisors', async () => {
      const { service } = setup();
      const booking = await service.request({ candidateName: 'Amina', visaType: VisaType.A });
      expect(booking).toMatchObject({
        candidateName: 'Amina',
        advisorId: 'rajan', // both advisors start at 09:00; ties break on advisor id
        start: t('09:00'),
        end: t('09:30'),
      });
    });

    it('honours a requested advisor and start time', async () => {
      const { service } = setup();
      const booking = await service.request({
        candidateName: 'Amina',
        visaType: VisaType.A,
        advisorId: 'sofia',
        slotStart: t('09:30'),
      });
      expect(booking).toMatchObject({ advisorId: 'sofia', start: t('09:30') });
    });
  });

  describe('A Skilled Worker (type A) appointment is 30 minutes; a Family / Dependent (type B) appointment is 60', () => {
    it('sets the length from the visa type', async () => {
      const { service } = setup();
      const a = await service.request({ candidateName: 'A', visaType: VisaType.A, advisorId: 'sofia' });
      const b = await service.request({ candidateName: 'B', visaType: VisaType.B, advisorId: 'rajan' });
      expect(a.end.getTime() - a.start.getTime()).toBe(30 * MINUTE);
      expect(b.end.getTime() - b.start.getTime()).toBe(60 * MINUTE);
    });
  });

  describe('The slot is put on hold for 10 minutes as soon as the request is made', () => {
    it('creates the booking as HELD, expiring exactly ten minutes later', async () => {
      const { service, clock } = setup();
      const booking = await service.request(amina);
      expect(booking.status).toBe(BookingStatus.HELD);
      expect(booking.expiresAt.getTime() - clock.now().getTime()).toBe(10 * MINUTE);
    });
  });

  describe('While a slot is on hold, no other candidate can request or book it', () => {
    it('refuses a second candidate asking for the held slot', async () => {
      const { service } = setup();
      const wanted = { visaType: VisaType.A, advisorId: 'sofia', slotStart: t('09:00') };
      await service.request({ candidateName: 'First', ...wanted });
      await expect(service.request({ candidateName: 'Second', ...wanted })).rejects.toMatchObject({
        code: 'SLOT_UNAVAILABLE',
      });
    });
  });

  describe('If two candidates ask for the same slot at the same time, only one gets it', () => {
    it('gives exactly one winner when 25 candidates race for one slot', async () => {
      const { service } = setup();
      const wanted = { visaType: VisaType.A, advisorId: 'sofia', slotStart: t('09:00') };
      const results = await Promise.allSettled(
        Array.from({ length: 25 }, (_, i) => service.request({ candidateName: `C${i}`, ...wanted })),
      );

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      expect(rejected).toHaveLength(24);
      expect(rejected.every((r) => r.reason.code === 'SLOT_UNAVAILABLE')).toBe(true);
    });

    it('never double-books when 25 candidates race for any slot', async () => {
      const { service } = setup();
      const results = await Promise.allSettled(
        Array.from({ length: 25 }, (_, i) => service.request({ candidateName: `C${i}`, visaType: VisaType.A })),
      );
      const held = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));

      // Sofia fits 3 back-to-back type A calls, Rajan 1 + 3 (breaks included).
      expect(held.length).toBeGreaterThan(0);
      expect(held.length).toBeLessThan(25);
      for (const a of held) {
        for (const b of held) {
          if (a === b || a.advisorId !== b.advisorId) continue;
          const aBlockedUntil = a.end.getTime() + 5 * MINUTE;
          const overlap = a.start < b.end && b.start.getTime() < aBlockedUntil;
          expect(overlap).toBe(false);
        }
      }
    });
  });

  describe('The booking is assigned to an advisor, who receives the request to confirm', () => {
    it('lets the advisor list the requests waiting for them', async () => {
      const { service } = setup();
      const mine = await service.request({ candidateName: 'For Sofia', visaType: VisaType.A, advisorId: 'sofia' });
      await service.request({ candidateName: 'For Rajan', visaType: VisaType.A, advisorId: 'rajan' });

      const waiting = await service.list({ advisorId: 'sofia', status: BookingStatus.HELD });

      expect(waiting.items.map((b) => b.id)).toEqual([mine.id]);
    });

    it.todo('notifies the advisor of the request (not built: see "Taking it to production" in the README)');
  });

  describe('If the advisor does not confirm within 10 minutes, the slot is released automatically', () => {
    it('lets another candidate take the slot once the hold has expired', async () => {
      const { service, clock } = setup();
      const wanted = { visaType: VisaType.A, advisorId: 'sofia', slotStart: t('09:00') };
      const first = await service.request({ candidateName: 'First', ...wanted });
      clock.advance(10 * MINUTE);

      const second = await service.request({ candidateName: 'Second', ...wanted });

      expect(second.status).toBe(BookingStatus.HELD);
      expect(second.id).not.toBe(first.id);
    });

    it('marks only the expired holds as EXPIRED, leaving confirmed and fresh ones alone', async () => {
      const { service, clock, bookingRepo } = setup();
      const lapsed = await service.request({ candidateName: 'Lapsed', visaType: VisaType.A, advisorId: 'sofia' });
      const confirmed = await service.request({ candidateName: 'Confirmed', visaType: VisaType.A, advisorId: 'rajan' });
      await service.confirm(confirmed.id, 'rajan');
      clock.advance(6 * MINUTE);
      const fresh = await service.request({ candidateName: 'Fresh', visaType: VisaType.A, advisorId: 'sofia' });
      clock.advance(4 * MINUTE);

      expect(await service.settle()).toEqual({ expired: 1, offered: 0 });
      expect(await service.settle()).toEqual({ expired: 0, offered: 0 });

      const status = async (id: string) => (await bookingRepo.findById(id))?.status;
      expect(await status(lapsed.id)).toBe(BookingStatus.EXPIRED);
      expect(await status(confirmed.id)).toBe(BookingStatus.CONFIRMED);
      expect(await status(fresh.id)).toBe(BookingStatus.HELD);
    });
  });

  describe('A request without a name, or with an unknown visa type, is refused', () => {
    // The same schema guards the API; e2e/api.e2e.spec.ts checks the error a client sees.
    it.each([
      ['a blank name', { candidateName: '   ', visaType: 'A' }],
      ['no name at all', { visaType: 'A' }],
      ['a name over 120 characters', { candidateName: 'x'.repeat(121), visaType: 'A' }],
      ['an unknown visa type', { candidateName: 'Amina', visaType: 'C' }],
    ])('refuses %s', (_label, input) => {
      expect(RequestBookingSchema.safeParse(input).success).toBe(false);
    });

    it('accepts a name and a valid visa type, trimming the name', () => {
      const parsed = RequestBookingSchema.parse({ candidateName: '  Amina Yusuf ', visaType: 'B' });
      expect(parsed).toMatchObject({ candidateName: 'Amina Yusuf', visaType: 'B' });
    });
  });

  describe('If no slot is available, the candidate is told so', () => {
    it('says nothing is available when every slot for the visa type is taken', async () => {
      const { service } = setup([SOFIA]);
      await service.request({ candidateName: 'One', visaType: VisaType.B }); // 09:00-10:00, blocked to 10:10
      await expect(service.request({ candidateName: 'Two', visaType: VisaType.B })).rejects.toMatchObject({
        code: 'NO_SLOT_AVAILABLE',
      });
    });

    it('says the slot is unavailable when the start time asked for is not one on offer', async () => {
      const { service } = setup();
      await expect(
        service.request({ candidateName: 'Amina', visaType: VisaType.A, advisorId: 'sofia', slotStart: t('09:10') }),
      ).rejects.toMatchObject({ code: 'SLOT_UNAVAILABLE' });
    });

    it('says so when the advisor asked for does not exist', async () => {
      const { service } = setup();
      await expect(
        service.request({ candidateName: 'Amina', visaType: VisaType.A, advisorId: 'nobody' }),
      ).rejects.toMatchObject({ code: 'ADVISOR_NOT_FOUND' });
    });
  });

  // Edge case found by manual testing: sending the same booking request
  // repeatedly used to put a different slot on hold each time.
  describe('A candidate can only have one active request at a time', () => {
    it('refuses a second request while the first is on hold, and holds only one slot', async () => {
      const { service, bookingRepo } = setup();
      await service.request(amina);
      await expect(service.request(amina)).rejects.toMatchObject(ACTIVE);
      expect(await bookingRepo.findAll()).toHaveLength(1);
    });

    it('refuses even when asking for a different visa type, advisor or slot', async () => {
      const { service } = setup();
      await service.request(amina);
      await expect(
        service.request({ candidateName: 'Amina Yusuf', visaType: VisaType.B, advisorId: 'rajan' }),
      ).rejects.toMatchObject(ACTIVE);
    });

    it.each(['amina yusuf', 'AMINA YUSUF', '  Amina   Yusuf  ', 'Amina\tYusuf'])(
      'treats %j as the same candidate',
      async (candidateName) => {
        const { service } = setup();
        await service.request(amina);
        await expect(service.request({ candidateName, visaType: VisaType.A })).rejects.toMatchObject(ACTIVE);
      },
    );

    it('does not affect a different candidate', async () => {
      const { service } = setup();
      await service.request(amina);
      await expect(service.request({ candidateName: 'Amina Yusufzai', visaType: VisaType.A })).resolves.toMatchObject({
        status: BookingStatus.HELD,
      });
    });

    it('gives one booking when the same candidate sends 25 requests at once', async () => {
      const { service, bookingRepo } = setup();
      const results = await Promise.allSettled(Array.from({ length: 25 }, () => service.request(amina)));

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      expect(rejected.every((r) => r.reason.code === 'ACTIVE_REQUEST_EXISTS')).toBe(true);
      expect(await bookingRepo.findAll()).toHaveLength(1);
    });
  });

  describe('A second request from the same candidate is refused, and they are told which request is in the way', () => {
    it('names the booking that is in the way, with its status', async () => {
      const { service } = setup();
      const first = await service.request(amina);

      await expect(service.request(amina)).rejects.toMatchObject({
        ...ACTIVE,
        details: { existingRequest: { kind: 'BOOKING', id: first.id, status: BookingStatus.HELD } },
      });

      await service.confirm(first.id, first.advisorId);
      await expect(service.request(amina)).rejects.toMatchObject({
        details: { existingRequest: { id: first.id, status: BookingStatus.CONFIRMED } },
      });
    });
  });

  describe('A candidate can request again once their earlier request is cancelled, or is rejected because the advisor did not confirm in time', () => {
    it('allows a new request after the first is cancelled', async () => {
      const { service } = setup();
      const first = await service.request(amina);
      await service.cancel(first.id);
      await expect(service.request(amina)).resolves.toMatchObject({ status: BookingStatus.HELD });
    });

    it('allows a new request after a confirmed booking is cancelled', async () => {
      const { service } = setup();
      const first = await service.request(amina);
      await service.confirm(first.id, first.advisorId);
      await service.cancel(first.id);
      await expect(service.request(amina)).resolves.toMatchObject({ status: BookingStatus.HELD });
    });

    it('still refuses one millisecond before the hold expires', async () => {
      const { service, clock } = setup();
      await service.request(amina);
      clock.advance(10 * MINUTE - 1);
      await expect(service.request(amina)).rejects.toMatchObject(ACTIVE);
    });

    it('allows a new request once the advisor has not confirmed in time and the hold has expired', async () => {
      const { service, clock } = setup();
      const first = await service.request(amina);
      clock.advance(10 * MINUTE);

      const second = await service.request(amina);

      expect(second.status).toBe(BookingStatus.HELD);
      expect((await service.get(first.id))?.status).toBe(BookingStatus.EXPIRED);
    });
  });

  describe('A candidate can cancel their booking', () => {
    it('cancels a booking that is on hold', async () => {
      const { service } = setup();
      const held = await service.request({ candidateName: 'A', visaType: VisaType.A });
      await expect(service.cancel(held.id)).resolves.toMatchObject({ status: BookingStatus.CANCELLED });
    });

    it('cancels a confirmed booking and returns the slot to the pool', async () => {
      const { service, clock, slotStarts } = setup();
      const held = await service.request({ candidateName: 'B', visaType: VisaType.B, advisorId: 'sofia' });
      await service.confirm(held.id, 'sofia');
      expect(await slotStarts('sofia', VisaType.B)).toEqual([]);

      const cancelled = await service.cancel(held.id);

      expect(cancelled).toMatchObject({ status: BookingStatus.CANCELLED, cancelledAt: clock.now() });
      expect(await slotStarts('sofia', VisaType.B)).toEqual(['09:00']);
    });

    it('refuses cancelling twice, an expired booking, or an unknown one', async () => {
      const { service, clock } = setup();
      const first = await service.request({ candidateName: 'A', visaType: VisaType.A });
      await service.cancel(first.id);
      await expect(service.cancel(first.id)).rejects.toMatchObject({ code: 'INVALID_STATE' });

      const second = await service.request({ candidateName: 'B', visaType: VisaType.A });
      clock.advance(10 * MINUTE);
      await expect(service.cancel(second.id)).rejects.toMatchObject({ code: 'INVALID_STATE' });

      await expect(service.cancel('missing')).rejects.toMatchObject({ code: 'BOOKING_NOT_FOUND' });
    });
  });
});
