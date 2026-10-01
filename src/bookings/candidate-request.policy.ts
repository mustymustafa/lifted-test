import { Injectable } from '@nestjs/common';
import { Clock } from '../common/clock';
import { DomainError } from '../common/errors';
import { MAX_ACTIVE_REQUESTS_PER_CANDIDATE } from '../config/rules';
import { WaitlistStatus } from '../waitlist/waitlist.model';
import { WaitlistRepository } from '../waitlist/waitlist.repository';
import { blocksAvailability, candidateKey } from './booking.model';
import { BookingRepository } from './booking.repository';

export interface ActiveRequest {
  kind: 'BOOKING' | 'WAITLIST_ENTRY';
  id: string;
  status: string;
}

/**
 * A candidate may have one active request at a time.
 *
 * Without this, a candidate could send the same booking request repeatedly
 * and be given a different slot each time, until one person had the whole
 * calendar on hold. A request is active while it is a booking that still
 * takes up a slot (offered, on hold or confirmed) or a place on the waitlist.
 * It stops counting once it is cancelled or expires.
 */
@Injectable()
export class CandidateRequestPolicy {
  constructor(
    private readonly bookings: BookingRepository,
    private readonly waitlist: WaitlistRepository,
    private readonly clock: Clock,
  ) {}

  async activeRequests(candidateName: string): Promise<ActiveRequest[]> {
    const key = candidateKey(candidateName);
    const now = this.clock.now();
    const bookings = (await this.bookings.findAll())
      .filter((b) => candidateKey(b.candidateName) === key && blocksAvailability(b, now))
      .map((b): ActiveRequest => ({ kind: 'BOOKING', id: b.id, status: b.status }));
    // An entry that has been offered a slot is already counted through its booking.
    const places = (await this.waitlist.findAll())
      .filter((e) => candidateKey(e.candidateName) === key && e.status === WaitlistStatus.WAITING)
      .map((e): ActiveRequest => ({ kind: 'WAITLIST_ENTRY', id: e.id, status: e.status }));
    return [...bookings, ...places];
  }

  /** Throws if the candidate already has an active request. The caller must hold the mutex. */
  async assertCanRequest(candidateName: string): Promise<void> {
    const active = await this.activeRequests(candidateName);
    if (active.length < MAX_ACTIVE_REQUESTS_PER_CANDIDATE) return;

    const [existing] = active;
    const what =
      existing.kind === 'BOOKING' ? `a booking that is ${existing.status}` : 'a place on the waitlist';
    throw new DomainError(
      'ACTIVE_REQUEST_EXISTS',
      `${candidateName} already has an active request (${what}). ` +
        'A new request can be made once it is cancelled or expires.',
      { existingRequest: existing },
    );
  }
}
