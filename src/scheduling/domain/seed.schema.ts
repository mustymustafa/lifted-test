import { z } from 'zod';
import { Advisor } from './advisor';

const WindowSchema = z
  .object({ start: z.iso.datetime(), end: z.iso.datetime() })
  .transform((w) => ({ start: new Date(w.start), end: new Date(w.end) }))
  .refine((w) => w.end > w.start, { message: 'window end must be after start' });

const AdvisorSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    availability: z.array(WindowSchema),
  })
  .transform((a) => ({
    id: a.id,
    name: a.name,
    windows: [...a.availability].sort((x, y) => x.start.getTime() - y.start.getTime()),
  }))
  .refine((a) => a.windows.every((w, i) => i === 0 || a.windows[i - 1].end <= w.start), {
    message: 'availability windows must not overlap',
  });

/**
 * DTO for the externally supplied availability feed. Everything that enters
 * the system from outside is parsed here, so the rest of the code can trust
 * the shape, the dates and the ordering.
 */
export const SeedSchema = z
  .object({ advisors: z.array(AdvisorSchema) })
  .refine((s) => new Set(s.advisors.map((a) => a.id)).size === s.advisors.length, {
    message: 'advisor ids must be unique',
  });

export function parseSeed(raw: unknown): Advisor[] {
  return SeedSchema.parse(raw).advisors;
}
