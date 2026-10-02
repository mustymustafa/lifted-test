import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Clock } from '../common/clock';
import { AppConfig } from '../config/config';
import { DomainError } from '../common/errors';
import { Mutex } from '../common/mutex';
import { Booking, BookingStatus } from '../bookings/booking.model';
import { VisaType } from '../config/rules';
import { WaitlistEntry, WaitlistStatus } from './waitlist.model';
import { BookingRepository } from '../bookings/booking.repository';
import { CandidateRequestPolicy } from '../bookings/candidate-request.policy';
import { WaitlistRepository } from './waitlist.repository';
import { AvailabilityService } from '../availability/availability.service';
import { SettlementService } from './settlement.service';

export interface JoinWaitlistCommand {
  candidateName: string;
  visaType: VisaType;
  /** Omit to accept any advisor. */
  advisorId?: string;
}

@Injectable()
export class WaitlistService {
  constructor(
    private readonly waitlist: WaitlistRepository,
    private readonly bookings: BookingRepository,
    private readonly availability: AvailabilityService,
    private readonly settlement: SettlementService,
    private readonly policy: CandidateRequestPolicy,
    private readonly clock: Clock,
    private readonly config: AppConfig,
    private readonly mutex: Mutex,
  ) {}

  /** Joins the back of the queue. Only allowed when there is nothing to book right now. */
  join(command: JoinWaitlistCommand): Promise<WaitlistEntry> {
    return this.mutex.runExclusive(async () => {
      await this.settlement.settle();
      await this.policy.assertCanRequest(command.candidateName);
      const slots = await this.availability.findSlots({
        visaType: command.visaType,
        advisorId: command.advisorId,
      });
      if (slots.length > 0) {
        throw new DomainError('SLOTS_AVAILABLE', 'A slot is available now; request a booking instead');
      }

      const entry: WaitlistEntry = {
        id: randomUUID(),
        candidateName: command.candidateName,
        visaType: command.visaType,
        advisorId: command.advisorId,
        status: WaitlistStatus.WAITING,
        joinedAt: this.clock.now(),
      };
      await this.waitlist.save(entry);
      return entry;
    });
  }

  /**
   * The candidate accepts an offered slot. It becomes a normal held booking,
   * and the advisor gets a fresh hold period to confirm it.
   */
  acceptOffer(entryId: string): Promise<Booking> {
    return this.mutex.runExclusive(async () => {
      await this.settlement.settle();
      const entry = await this.waitlist.findById(entryId);
      if (!entry) throw new DomainError('WAITLIST_ENTRY_NOT_FOUND', `Waitlist entry ${entryId} does not exist`);
      if (entry.status === WaitlistStatus.EXPIRED) {
        throw new DomainError('OFFER_EXPIRED', 'The offer was not accepted in time');
      }
      const offer = entry.bookingId ? await this.bookings.findById(entry.bookingId) : undefined;
      if (entry.status !== WaitlistStatus.OFFERED || !offer) {
        throw new DomainError('INVALID_STATE', `Waitlist entry is ${entry.status}, not OFFERED`);
      }

      const now = this.clock.now();
      const held: Booking = {
        ...offer,
        status: BookingStatus.HELD,
        expiresAt: new Date(now.getTime() + this.config.holdMs),
      };
      await this.bookings.save(held);
      await this.waitlist.save({ ...entry, status: WaitlistStatus.ACCEPTED });
      return held;
    });
  }

  /**
   * The candidate gives up their place, or declines an offer. A declined slot
   * goes to the next candidate in the queue. Like cancelling a booking, this
   * is what lets them make a new request.
   */
  leave(entryId: string): Promise<WaitlistEntry> {
    return this.mutex.runExclusive(async () => {
      await this.settlement.settle();
      const entry = await this.waitlist.findById(entryId);
      if (!entry) throw new DomainError('WAITLIST_ENTRY_NOT_FOUND', `Waitlist entry ${entryId} does not exist`);
      if (entry.status !== WaitlistStatus.WAITING && entry.status !== WaitlistStatus.OFFERED) {
        throw new DomainError('INVALID_STATE', `Waitlist entry is ${entry.status} and cannot be cancelled`);
      }

      const left: WaitlistEntry = { ...entry, status: WaitlistStatus.CANCELLED };
      await this.waitlist.save(left);

      const offer = entry.bookingId ? await this.bookings.findById(entry.bookingId) : undefined;
      if (entry.status === WaitlistStatus.OFFERED && offer) {
        await this.bookings.save({ ...offer, status: BookingStatus.CANCELLED, cancelledAt: this.clock.now() });
        await this.settlement.settle([offer.advisorId]);
      }
      return left;
    });
  }

  /** Entries in the order they joined. */
  async list(status?: WaitlistStatus): Promise<WaitlistEntry[]> {
    await this.mutex.runExclusive(() => this.settlement.settle());
    return this.waitlist.find(status);
  }

  async get(entryId: string): Promise<WaitlistEntry | undefined> {
    await this.mutex.runExclusive(() => this.settlement.settle());
    return this.waitlist.findById(entryId);
  }
}
