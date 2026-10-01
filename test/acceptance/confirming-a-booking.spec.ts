import { BookingStatus } from '../../src/bookings/booking.model';
import { VisaType } from '../../src/config/rules';
import { MINUTE } from '../support/fake-clock';
import { setup } from '../support/harness';

/**
 * Acceptance criteria: Confirming a booking.
 * The groups below are the criteria, word for word, from
 * docs/ACCEPTANCE_CRITERIA_AND_TEST_SCENARIOS.md.
 */
describe('Confirming a booking', () => {
  describe('The assigned advisor can confirm a booking that is on hold', () => {
    it('confirms the booking and records when', async () => {
      const { service, clock } = setup();
      const held = await service.request({ candidateName: 'Amina', visaType: VisaType.A, advisorId: 'sofia' });
      clock.advance(4 * MINUTE);

      const confirmed = await service.confirm(held.id, 'sofia');

      expect(confirmed).toMatchObject({ status: BookingStatus.CONFIRMED, confirmedAt: clock.now() });
    });
  });

  describe('The advisor must confirm within 10 minutes of the request', () => {
    it('accepts a confirmation one millisecond before the hold expires', async () => {
      const { service, clock } = setup();
      const held = await service.request({ candidateName: 'Amina', visaType: VisaType.A });
      clock.advance(10 * MINUTE - 1);
      await expect(service.confirm(held.id, held.advisorId)).resolves.toMatchObject({
        status: BookingStatus.CONFIRMED,
      });
    });
  });

  describe('Once confirmed, the slot is permanently removed from availability', () => {
    it('keeps the slot out of the pool a day later', async () => {
      const { service, clock, slotStarts } = setup();
      const held = await service.request({ candidateName: 'B', visaType: VisaType.B, advisorId: 'sofia' });
      await service.confirm(held.id, 'sofia');
      clock.advance(24 * 60 * MINUTE);

      expect(await slotStarts('sofia', VisaType.B)).toEqual([]);
      expect(await slotStarts('sofia', VisaType.A)).toEqual(['10:10']);
    });
  });

  describe('A booking cannot be confirmed after its hold has expired', () => {
    it('refuses at exactly ten minutes and marks the booking expired', async () => {
      const { service, clock, bookingRepo } = setup();
      const held = await service.request({ candidateName: 'Amina', visaType: VisaType.A });
      clock.advance(10 * MINUTE);

      await expect(service.confirm(held.id, held.advisorId)).rejects.toMatchObject({ code: 'HOLD_EXPIRED' });
      expect((await bookingRepo.findById(held.id))?.status).toBe(BookingStatus.EXPIRED);
    });
  });

  describe('Only the advisor the booking is assigned to can confirm it', () => {
    it('refuses a different advisor', async () => {
      const { service } = setup();
      const held = await service.request({ candidateName: 'Amina', visaType: VisaType.A, advisorId: 'sofia' });
      await expect(service.confirm(held.id, 'rajan')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
  });

  describe('A booking cannot be confirmed twice', () => {
    it('refuses a second confirmation', async () => {
      const { service } = setup();
      const held = await service.request({ candidateName: 'Amina', visaType: VisaType.A });
      await service.confirm(held.id, held.advisorId);
      await expect(service.confirm(held.id, held.advisorId)).rejects.toMatchObject({ code: 'INVALID_STATE' });
    });

    it('refuses a booking that was cancelled, or does not exist', async () => {
      const { service } = setup();
      const held = await service.request({ candidateName: 'A', visaType: VisaType.A, advisorId: 'sofia' });
      await service.cancel(held.id);
      await expect(service.confirm(held.id, 'sofia')).rejects.toMatchObject({ code: 'INVALID_STATE' });
      await expect(service.confirm('missing', 'sofia')).rejects.toMatchObject({ code: 'BOOKING_NOT_FOUND' });
    });
  });
});
