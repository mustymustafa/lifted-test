import { registerEnumType } from '@nestjs/graphql';
import { z } from 'zod';
import { CANDIDATE_NAME_MAX_LENGTH, VISA_RULES, VisaType } from '../config/rules';

/** Building blocks shared by the feature DTOs. */

registerEnumType(VisaType, {
  name: 'VisaType',
  valuesMap: Object.fromEntries(
    Object.values(VisaType).map((type) => {
      const { label, durationMinutes, breakMinutes } = VISA_RULES[type];
      return [
        type,
        { description: `${label}: ${durationMinutes} minute appointment, ${breakMinutes} minute advisor break after` },
      ];
    }),
  ),
});

/** GraphQL sends `null` for an explicitly empty field; the services only deal in `undefined`. */
export const optional = <T extends z.ZodType>(schema: T) =>
  schema.nullish().transform((value) => value ?? undefined);

export const IdSchema = z.string().trim().min(1);

export const CandidateNameSchema = z
  .string()
  .trim()
  .min(1, 'candidateName is required')
  .max(CANDIDATE_NAME_MAX_LENGTH);

export const VisaTypeSchema = z.enum(VisaType);

/** Optional `from` / `to` fields, spread into a filter schema. */
export const dateRange = { from: optional(z.date()), to: optional(z.date()) };
export const fromBeforeTo = (v: { from?: Date; to?: Date }) => !v.from || !v.to || v.from < v.to;
export const fromBeforeToIssue = { message: '`from` must be before `to`', path: ['from'] };
