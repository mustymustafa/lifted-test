import { WaitlistEntry } from './waitlist.model';

/** Abstract class so it doubles as the DI token. Async so a database can sit behind it. */
export abstract class WaitlistRepository {
  abstract save(entry: WaitlistEntry): Promise<void>;
  abstract findById(id: string): Promise<WaitlistEntry | undefined>;
  /** In the order entries were first saved. */
  abstract findAll(): Promise<WaitlistEntry[]>;
}

export class InMemoryWaitlistRepository extends WaitlistRepository {
  private readonly byId = new Map<string, WaitlistEntry>();

  async save(entry: WaitlistEntry): Promise<void> {
    this.byId.set(entry.id, { ...entry });
  }

  async findById(id: string): Promise<WaitlistEntry | undefined> {
    const found = this.byId.get(id);
    return found && { ...found };
  }

  async findAll(): Promise<WaitlistEntry[]> {
    return [...this.byId.values()].map((e) => ({ ...e }));
  }
}
