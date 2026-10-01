/**
 * Business rules: the single place to change visa types, appointment lengths,
 * breaks, hold times and input limits. Nothing else in the codebase hardcodes
 * these values; GraphQL descriptions and config defaults are derived from here.
 */

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;

export enum VisaType {
  A = 'A',
  B = 'B',
}

export interface VisaRule {
  label: string;
  durationMinutes: number;
  /** Advisor break required after a call of this type. */
  breakMinutes: number;
  durationMs: number;
  breakMs: number;
}

const visaRule = (label: string, durationMinutes: number, breakMinutes: number): VisaRule => ({
  label,
  durationMinutes,
  breakMinutes,
  durationMs: durationMinutes * MINUTE,
  breakMs: breakMinutes * MINUTE,
});

/** To add a visa type: add it to the enum above and give it a rule here. */
export const VISA_RULES: Record<VisaType, VisaRule> = {
  [VisaType.A]: visaRule('Skilled Worker', 30, 5),
  [VisaType.B]: visaRule('Family / Dependent', 60, 10),
};

/** How long a hold or a waitlist offer lasts. Overridable with HOLD_MINUTES. */
export const DEFAULT_HOLD_MINUTES = 10;

/** How often the sweeper runs. Overridable with SWEEP_INTERVAL_SECONDS. */
export const DEFAULT_SWEEP_INTERVAL_SECONDS = 5;

export const CANDIDATE_NAME_MAX_LENGTH = 120;

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;
