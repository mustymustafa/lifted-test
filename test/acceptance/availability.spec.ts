import { BookingStatus } from '../../src/bookings/booking.model';
import { VisaType } from '../../src/config/rules';
import { MINUTE } from '../support/fake-clock';
import { setup, SOFIA, t } from '../support/harness';

/**
 * Acceptance criteria: Availability.
 * The groups below are the criteria, word for word, from
 * docs/ACCEPTANCE_CRITERIA_AND_TEST_SCENARIOS.md.
 *
 * The arithmetic behind slots has its own edge-case tests in
 * unit/availability/slot-calculator.spec.ts, and the counts for the real seed
 * file are checked in e2e/api.e2e.spec.ts.
 */
describe('Availability', () => {
  describe('A candidate can see all the slots they can book', () => {
    it('returns slots for every visa type, earliest first', async () => {
      const { availability } = setup([SOFIA]);
      const slots = await availability.findSlots();
      expect(slots.map((s) => `${s.visaType}@${s.start.toISOString().slice(11, 16)}`)).toEqual([
        'A@09:00',
        'B@09:00',
        'A@09:30',
        'A@10:00',
      ]);
    });
  });

  describe("Slots come from each advisor's availability windows", () => {
    it('slices a window into back-to-back slots of the appointment length', async () => {
      const { slotStarts } = setup();
      // Sofia: one window, 09:00-10:50.
      expect(await slotStarts('sofia', VisaType.A)).toEqual(['09:00', '09:30', '10:00']);
    });
  });

  describe('A slot is only shown if the whole appointment fits inside one window', () => {
    it('drops the time left over at the end of a window', async () => {
      const { slotStarts } = setup();
      // 110 minutes fits one 60 minute appointment; the remaining 50 are not offered.
      expect(await slotStarts('sofia', VisaType.B)).toEqual(['09:00']);
    });

    it('does not let a slot span the gap between two windows', async () => {
      const { slotStarts } = setup();
      // Rajan: 09:00-09:30 and 09:33-11:30.
      expect(await slotStarts('rajan', VisaType.A)).toEqual(['09:00', '09:33', '10:03', '10:33']);
      expect(await slotStarts('rajan', VisaType.B)).toEqual(['09:33']);
    });
  });

  describe('A slot that is on hold is not shown', () => {
    it('removes the slot as soon as it is requested', async () => {
      const { service, slotStarts } = setup();
      await service.request({ candidateName: 'B', visaType: VisaType.B, advisorId: 'sofia' });
      expect(await slotStarts('sofia', VisaType.B)).toEqual([]);
    });
  });

  describe('A slot that is confirmed is not shown', () => {
    it('keeps the slot off the list after confirmation', async () => {
      const { service, slotStarts } = setup();
      const held = await service.request({ candidateName: 'B', visaType: VisaType.B, advisorId: 'sofia' });
      const confirmed = await service.confirm(held.id, 'sofia');
      expect(confirmed.status).toBe(BookingStatus.CONFIRMED);
      expect(await slotStarts('sofia', VisaType.B)).toEqual([]);
    });
  });

  describe('When a hold expires, the slot is shown again', () => {
    it('shows the slot again at ten minutes, without the background sweep running', async () => {
      const { service, clock, slotStarts } = setup();
      await service.request({ candidateName: 'B', visaType: VisaType.B, advisorId: 'sofia' });
      clock.advance(10 * MINUTE);
      expect(await slotStarts('sofia', VisaType.B)).toEqual(['09:00']);
    });

    it('keeps the slot hidden until the last millisecond of the hold', async () => {
      const { service, clock, slotStarts } = setup();
      await service.request({ candidateName: 'B', visaType: VisaType.B, advisorId: 'sofia' });
      clock.advance(10 * MINUTE - 1);
      expect(await slotStarts('sofia', VisaType.B)).toEqual([]);
    });
  });

  describe('(Stretch) Slots can be filtered by visa type, advisor and date', () => {
    it('filters by visa type and time range', async () => {
      const { availability } = setup();
      const slots = await availability.findSlots({ visaType: VisaType.A, from: t('09:30'), to: t('10:05') });
      expect(slots.map((s) => [s.advisor.id, s.start])).toEqual([
        ['sofia', t('09:30')],
        ['rajan', t('09:33')],
      ]);
    });

    it('filters by advisor', async () => {
      const { availability } = setup();
      const slots = await availability.findSlots({ advisorId: 'rajan' });
      expect(slots.length).toBeGreaterThan(0);
      expect(slots.every((s) => s.advisor.id === 'rajan')).toBe(true);
    });

    it('refuses an advisor that does not exist', async () => {
      const { availability } = setup();
      await expect(availability.findSlots({ advisorId: 'nobody' })).rejects.toMatchObject({ code: 'ADVISOR_NOT_FOUND' });
    });
  });
});
