import { VisaType } from '../../src/config/rules';
import { setup, t } from '../support/harness';

/**
 * Acceptance criteria: Advisor breaks (stretch).
 * The groups below are the criteria, word for word, from
 * docs/ACCEPTANCE_CRITERIA_AND_TEST_SCENARIOS.md.
 *
 * More edge cases for the break arithmetic are in
 * unit/availability/slot-calculator.spec.ts.
 */
describe('Advisor breaks (stretch)', () => {
  describe('An advisor gets a 5 minute break after a type A appointment', () => {
    it('starts the next slot at 09:35 after a 09:00-09:30 appointment', async () => {
      const { service, slotStarts } = setup();
      await service.request({ candidateName: 'A', visaType: VisaType.A, advisorId: 'sofia' });
      expect(await slotStarts('sofia', VisaType.A)).toEqual(['09:35', '10:05']);
      expect(await slotStarts('sofia', VisaType.B)).toEqual(['09:35']);
    });
  });

  describe('An advisor gets a 10 minute break after a type B appointment', () => {
    it('starts the next slot at 10:10 after a 09:00-10:00 appointment', async () => {
      const { service, slotStarts } = setup();
      await service.request({ candidateName: 'B', visaType: VisaType.B, advisorId: 'sofia' });
      expect(await slotStarts('sofia', VisaType.A)).toEqual(['10:10']);
      expect(await slotStarts('sofia', VisaType.B)).toEqual([]);
    });
  });

  describe("No slot is offered that would start during an advisor's break", () => {
    it('carries the break into the next window', async () => {
      const { service, slotStarts } = setup();
      await service.request({ candidateName: 'A', visaType: VisaType.A, advisorId: 'rajan' }); // 09:00-09:30
      // Rajan's second window opens at 09:33, but his break runs to 09:35.
      expect(await slotStarts('rajan', VisaType.A)).toEqual(['09:35', '10:05', '10:35']);
    });
  });

  describe('No slot is offered that would leave the advisor without a break before their next appointment', () => {
    it('drops the slot just before an appointment, because its break would not fit', async () => {
      const { service, slotStarts } = setup();
      await service.request({ candidateName: 'A', visaType: VisaType.A, advisorId: 'sofia', slotStart: t('09:30') });
      // 09:00-09:30 would need a break until 09:35, which runs into the 09:30 appointment.
      expect(await slotStarts('sofia', VisaType.A)).toEqual(['10:05']);
    });
  });

  describe("One advisor's bookings do not affect another advisor's slots", () => {
    it("leaves Rajan's slots unchanged when Sofia is booked", async () => {
      const { service, slotStarts } = setup();
      const before = await slotStarts('rajan', VisaType.A);
      await service.request({ candidateName: 'B', visaType: VisaType.B, advisorId: 'sofia' });
      expect(await slotStarts('rajan', VisaType.A)).toEqual(before);
    });
  });
});
