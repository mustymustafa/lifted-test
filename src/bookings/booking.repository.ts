import { VisaType } from '../config/rules';
import { blocksAvailability, Booking, BookingStatus, candidateKey, isHoldExpired } from './booking.model';

export interface BookingQuery {
  status?: BookingStatus;
  advisorId?: string;
  visaType?: VisaType;
  /** Only bookings that start at or after this time. */
  from?: Date;
  /** Only bookings that end at or before this time. */
  to?: Date;
}

/**
 * Abstract class so it doubles as the DI token. Async so a database can sit
 * behind it.
 *
 * Each method is one question the services ask, instead of a findAll() that
 * loads every booking so the caller can filter it. Loading everything on every
 * request does not perform well once there are many bookings, and a database
 * behind findAll() would have to do that same scan. Asking precise questions
 * lets a Postgres implementation answer each with an indexed query (advisor +
 * status, expires_at, candidate) while the services stay unchanged.
 */
export abstract class BookingRepository {
  abstract save(booking: Booking): Promise<void>;
  abstract findById(id: string): Promise<Booking | undefined>;
  /** Bookings that still take time away from this advisor at `now`: confirmed, or offered/held and not yet expired. */
  abstract findBlocking(advisorId: string, now: Date): Promise<Booking[]>;
  /** Holds and offers whose time ran out at or before `now`. */
  abstract findExpired(now: Date): Promise<Booking[]>;
  /** This candidate's bookings that still count as active at `now`. */
  abstract findActiveByCandidate(candidateKey: string, now: Date): Promise<Booking[]>;
  /** Bookings matching the query, ordered by start, then by when they were made. */
  abstract find(query: BookingQuery): Promise<Booking[]>;
}

/**
 * One instance per process (Nest singleton). State is lost on restart.
 * The queries are plain filters here; in Postgres they are indexed lookups.
 */
export class InMemoryBookingRepository extends BookingRepository {
  private readonly byId = new Map<string, Booking>();

  async save(booking: Booking): Promise<void> {
    this.byId.set(booking.id, { ...booking });
  }

  async findById(id: string): Promise<Booking | undefined> {
    const found = this.byId.get(id);
    return found && { ...found };
  }

  async findBlocking(advisorId: string, now: Date): Promise<Booking[]> {
    return this.where((b) => b.advisorId === advisorId && blocksAvailability(b, now));
  }

  async findExpired(now: Date): Promise<Booking[]> {
    return this.where((b) => isHoldExpired(b, now));
  }

  async findActiveByCandidate(key: string, now: Date): Promise<Booking[]> {
    return this.where((b) => candidateKey(b.candidateName) === key && blocksAvailability(b, now));
  }

  async find(q: BookingQuery): Promise<Booking[]> {
    return this.where(
      (b) =>
        (!q.status || b.status === q.status) &&
        (!q.advisorId || b.advisorId === q.advisorId) &&
        (!q.visaType || b.visaType === q.visaType) &&
        (!q.from || b.start >= q.from) &&
        (!q.to || b.end <= q.to),
    ).sort(
      (a, b) =>
        a.start.getTime() - b.start.getTime() ||
        a.createdAt.getTime() - b.createdAt.getTime() ||
        a.id.localeCompare(b.id),
    );
  }

  /** Every booking, for tests and debugging. Not part of the interface the services use. */
  async findAll(): Promise<Booking[]> {
    return this.where(() => true);
  }

  private where(keep: (b: Booking) => boolean): Booking[] {
    return [...this.byId.values()].filter(keep).map((b) => ({ ...b }));
  }
}
