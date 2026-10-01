import { z } from 'zod';

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  HOLD_MINUTES: z.coerce.number().positive().default(10),
  SWEEP_INTERVAL_SECONDS: z.coerce.number().min(0).default(5),
  SEED_PATH: z.string().min(1).default('data/seed.json'),
});

/** Validated runtime config. Abstract class so it doubles as the DI token. */
export abstract class AppConfig {
  abstract readonly port: number;
  abstract readonly holdMs: number;
  /** 0 disables the background sweeper. */
  abstract readonly sweepIntervalMs: number;
  abstract readonly seedPath: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.parse(env);
  return {
    port: parsed.PORT,
    holdMs: parsed.HOLD_MINUTES * 60_000,
    sweepIntervalMs: parsed.SWEEP_INTERVAL_SECONDS * 1000,
    seedPath: parsed.SEED_PATH,
  };
}
