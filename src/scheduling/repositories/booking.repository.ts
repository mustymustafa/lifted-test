import { Booking } from '../domain/booking';

/** Abstract class so it doubles as the DI token. Async so a database can sit behind it. */
export abstract class BookingRepository {
  abstract save(booking: Booking): Promise<void>;
  abstract findById(id: string): Promise<Booking | undefined>;
  abstract findAll(): Promise<Booking[]>;
}

/** One instance per process (Nest singleton). State is lost on restart. */
export class InMemoryBookingRepository extends BookingRepository {
  private readonly byId = new Map<string, Booking>();

  async save(booking: Booking): Promise<void> {
    this.byId.set(booking.id, { ...booking });
  }

  async findById(id: string): Promise<Booking | undefined> {
    const found = this.byId.get(id);
    return found && { ...found };
  }

  async findAll(): Promise<Booking[]> {
    return [...this.byId.values()].map((b) => ({ ...b }));
  }
}
