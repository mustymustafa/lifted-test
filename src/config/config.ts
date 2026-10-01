import { z } from 'zod';
import {
  DEFAULT_HOLD_MINUTES,
  DEFAULT_SWEEP_INTERVAL_SECONDS,
  MINUTE,
  SECOND,
} from './rules';

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  HOLD_MINUTES: z.coerce.number().positive().default(DEFAULT_HOLD_MINUTES),
  SWEEP_INTERVAL_SECONDS: z.coerce.number().min(0).default(DEFAULT_SWEEP_INTERVAL_SECONDS),
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
    holdMs: parsed.HOLD_MINUTES * MINUTE,
    sweepIntervalMs: parsed.SWEEP_INTERVAL_SECONDS * SECOND,
    seedPath: parsed.SEED_PATH,
  };
}
