export enum VisaType {
  A = 'A',
  B = 'B',
}

export interface VisaRule {
  label: string;
  durationMs: number;
  /** Advisor break required after a call of this type. */
  breakMs: number;
}

const MINUTE = 60_000;

export const VISA_RULES: Record<VisaType, VisaRule> = {
  [VisaType.A]: { label: 'Skilled Worker', durationMs: 30 * MINUTE, breakMs: 5 * MINUTE },
  [VisaType.B]: { label: 'Family / Dependent', durationMs: 60 * MINUTE, breakMs: 10 * MINUTE },
};
