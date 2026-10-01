import {
  DEFAULT_HOLD_MINUTES,
  MINUTE,
  VISA_RULES,
  VisaType,
} from '../../src/scheduling/domain/rules';

/**
 * Pins the values from the brief. The other tests state expected times as
 * literals on purpose, so a change to a rule fails loudly here and there
 * rather than passing silently.
 */
describe('business rules', () => {
  it('match the brief', () => {
    expect(VISA_RULES[VisaType.A]).toMatchObject({ label: 'Skilled Worker', durationMinutes: 30, breakMinutes: 5 });
    expect(VISA_RULES[VisaType.B]).toMatchObject({ label: 'Family / Dependent', durationMinutes: 60, breakMinutes: 10 });
    expect(DEFAULT_HOLD_MINUTES).toBe(10);
  });

  it('has a rule for every visa type, with milliseconds derived from minutes', () => {
    for (const type of Object.values(VisaType)) {
      const rule = VISA_RULES[type];
      expect(rule.durationMs).toBe(rule.durationMinutes * MINUTE);
      expect(rule.breakMs).toBe(rule.breakMinutes * MINUTE);
      expect(rule.durationMinutes).toBeGreaterThan(0);
    }
  });
});
