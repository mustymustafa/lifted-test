export interface AvailabilityWindow {
  start: Date;
  end: Date;
}

export interface Advisor {
  id: string;
  name: string;
  /** Sorted by start, never overlapping (enforced when the seed is loaded). */
  windows: AvailabilityWindow[];
}
