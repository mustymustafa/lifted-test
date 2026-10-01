import { VisaType } from './visa-type';

export enum WaitlistStatus {
  WAITING = 'WAITING',
  /** A freed slot has been offered; the candidate has 10 minutes to accept. */
  OFFERED = 'OFFERED',
  ACCEPTED = 'ACCEPTED',
  /** The candidate did not accept in time and has left the queue. */
  EXPIRED = 'EXPIRED',
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
