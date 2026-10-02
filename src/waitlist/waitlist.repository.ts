import { candidateKey } from '../bookings/booking.model';
import { WaitlistEntry, WaitlistStatus } from './waitlist.model';

/**
 * Abstract class so it doubles as the DI token. Async so a database can sit
 * behind it.
 *
 * Each method is one question the services ask, instead of a findAll() that
 * loads the whole waitlist so the caller can filter it. That does not perform
 * well as the queue grows, and a database behind findAll() would scan the same
 * way. Precise questions let a Postgres implementation answer each with an
 * indexed query on (status, advisor_id, joined_at).
 */
export abstract class WaitlistRepository {
  abstract save(entry: WaitlistEntry): Promise<void>;
  abstract findById(id: string): Promise<WaitlistEntry | undefined>;
  /** The entry that was offered this booking, if any. */
  abstract findByBookingId(bookingId: string): Promise<WaitlistEntry | undefined>;
  /** Waiting candidates who could use one of these advisors (asked for one of them, or for any advisor), oldest first. */
  abstract findWaitingFor(advisorIds: Iterable<string>): Promise<WaitlistEntry[]>;
  /** This candidate's waiting entries. */
  abstract findWaitingByCandidate(candidateKey: string): Promise<WaitlistEntry[]>;
  /** Entries in the order they joined, optionally only one status. */
  abstract find(status?: WaitlistStatus): Promise<WaitlistEntry[]>;
}

/** One instance per process. The queries are plain filters here; in Postgres they are indexed lookups. */
export class InMemoryWaitlistRepository extends WaitlistRepository {
  private readonly byId = new Map<string, WaitlistEntry>();

  async save(entry: WaitlistEntry): Promise<void> {
    this.byId.set(entry.id, { ...entry });
  }

  async findById(id: string): Promise<WaitlistEntry | undefined> {
    const found = this.byId.get(id);
    return found && { ...found };
  }

  async findByBookingId(bookingId: string): Promise<WaitlistEntry | undefined> {
    return this.where((e) => e.bookingId === bookingId)[0];
  }

  async findWaitingFor(advisorIds: Iterable<string>): Promise<WaitlistEntry[]> {
    const freed = new Set(advisorIds);
    return this.where((e) => e.status === WaitlistStatus.WAITING && (!e.advisorId || freed.has(e.advisorId))).sort(byJoined);
  }

  async findWaitingByCandidate(key: string): Promise<WaitlistEntry[]> {
    return this.where((e) => e.status === WaitlistStatus.WAITING && candidateKey(e.candidateName) === key);
  }

  async find(status?: WaitlistStatus): Promise<WaitlistEntry[]> {
    return this.where((e) => !status || e.status === status).sort(byJoined);
  }

  /** Every entry, for tests and debugging. Not part of the interface the services use. */
  async findAll(): Promise<WaitlistEntry[]> {
    return this.where(() => true);
  }

  private where(keep: (e: WaitlistEntry) => boolean): WaitlistEntry[] {
    return [...this.byId.values()].filter(keep).map((e) => ({ ...e }));
  }
}

const byJoined = (a: WaitlistEntry, b: WaitlistEntry) => a.joinedAt.getTime() - b.joinedAt.getTime();
