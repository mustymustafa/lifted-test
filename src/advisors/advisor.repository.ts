import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Advisor } from './advisor.model';
import { parseSeed } from './seed.schema';

/** Abstract class so it doubles as the DI token. Async so a database can sit behind it. */
export abstract class AdvisorRepository {
  abstract findAll(): Promise<Advisor[]>;
  abstract findById(id: string): Promise<Advisor | undefined>;
}

export class InMemoryAdvisorRepository extends AdvisorRepository {
  private readonly byId: Map<string, Advisor>;

  constructor(advisors: Advisor[]) {
    super();
    this.byId = new Map(advisors.map((a) => [a.id, a]));
  }

  /** Loads and validates the seed file. Throws on bad data so the app fails at boot, not mid-request. */
  static fromSeedFile(path: string): InMemoryAdvisorRepository {
    const raw: unknown = JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8'));
    return new InMemoryAdvisorRepository(parseSeed(raw));
  }

  async findAll(): Promise<Advisor[]> {
    return [...this.byId.values()];
  }

  async findById(id: string): Promise<Advisor | undefined> {
    return this.byId.get(id);
  }
}
