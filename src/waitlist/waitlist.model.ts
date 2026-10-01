import { VisaType } from '../config/rules';

export enum WaitlistStatus {
  WAITING = 'WAITING',
  /** A freed slot has been offered; the candidate has a limited time to accept. */
  OFFERED = 'OFFERED',
  ACCEPTED = 'ACCEPTED',
  /** The candidate did not accept in time and has left the queue. */
  EXPIRED = 'EXPIRED',
  /** The candidate gave up their place, or declined an offer. */
  CANCELLED = 'CANCELLED',
}

export interface WaitlistEntry {
  id: string;
  candidateName: string;
  visaType: VisaType;
  /** Empty means any advisor will do. */
  advisorId?: string;
  status: WaitlistStatus;
  joinedAt: Date;
  /** The offered booking, once there is one. */
  bookingId?: string;
}
