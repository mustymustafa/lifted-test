import { VISA_RULES, VisaType } from './visa-type';
import { Interval } from './slot-calculator';

export enum BookingStatus {
  HELD = 'HELD',
  CONFIRMED = 'CONFIRMED',
  EXPIRED = 'EXPIRED',
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
  /** When the hold lapses if the advisor has not confirmed. */
  expiresAt: Date;
  confirmedAt?: Date;
}

export function isHoldExpired(booking: Booking, now: Date): boolean {
  return booking.status === BookingStatus.HELD && booking.expiresAt.getTime() <= now.getTime();
}

/**
 * Does this booking still take its slot out of the pool? Decided from the
 * clock, not just the stored status, so a hold stops blocking the moment it
 * lapses even if the sweeper has not run yet.
 */
export function blocksAvailability(booking: Booking, now: Date): boolean {
  if (booking.status === BookingStatus.CONFIRMED) return true;
  return booking.status === BookingStatus.HELD && !isHoldExpired(booking, now);
}

/** The time an advisor is unavailable because of a booking: the call plus the break after it. */
export function blockedRange(booking: Booking): Interval {
  return {
    start: booking.start.getTime(),
    end: booking.end.getTime() + VISA_RULES[booking.visaType].breakMs,
  };
}
