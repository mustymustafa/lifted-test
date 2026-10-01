import { VISA_RULES, VisaType } from '../config/rules';
import { Interval } from '../availability/slot-calculator';

export enum BookingStatus {
  /** Offered to a waitlisted candidate, who has not accepted yet. */
  OFFERED = 'OFFERED',
  /** On hold while the advisor confirms. */
  HELD = 'HELD',
  CONFIRMED = 'CONFIRMED',
  EXPIRED = 'EXPIRED',
  CANCELLED = 'CANCELLED',
}

export interface Booking {
  id: string;
  candidateName: string;
  visaType: VisaType;
  advisorId: string;
  start: Date;
  end: Date;
  status: BookingStatus;
  createdAt: Date;
  /** When the hold (or waitlist offer) lapses if nobody acts on it. */
  expiresAt: Date;
  confirmedAt?: Date;
  cancelledAt?: Date;
}

const isTimeLimited = (status: BookingStatus): boolean =>
  status === BookingStatus.HELD || status === BookingStatus.OFFERED;

/** True for a hold or a waitlist offer whose time has run out. */
export function isHoldExpired(booking: Booking, now: Date): boolean {
  return isTimeLimited(booking.status) && booking.expiresAt.getTime() <= now.getTime();
}

/**
 * Does this booking still take its slot out of the pool? Decided from the
 * clock, not just the stored status, so a hold stops blocking the moment it
 * lapses even if the sweeper has not run yet.
 */
export function blocksAvailability(booking: Booking, now: Date): boolean {
  if (booking.status === BookingStatus.CONFIRMED) return true;
  return isTimeLimited(booking.status) && !isHoldExpired(booking, now);
}

/**
 * How the API tells that two requests come from the same candidate. There is
 * no login, so the name is all there is: compared ignoring case and extra
 * spaces. The README covers the limits of this.
 */
export function candidateKey(name: string): string {
  return name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** The time an advisor is unavailable because of a booking: the call plus the break after it. */
export function blockedRange(booking: Booking): Interval {
  return {
    start: booking.start.getTime(),
    end: booking.end.getTime() + VISA_RULES[booking.visaType].breakMs,
  };
}
