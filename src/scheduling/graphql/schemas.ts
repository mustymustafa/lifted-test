import { z } from 'zod';
import { BookingStatus } from '../domain/booking';
import { VisaType } from '../domain/visa-type';
import { WaitlistStatus } from '../domain/waitlist';

/** GraphQL sends `null` for an explicitly empty field; the services only deal in `undefined`. */
const optional = <T extends z.ZodType>(schema: T) =>
  schema.nullish().transform((value) => value ?? undefined);

const id = z.string().trim().min(1);
const candidateName = z.string().trim().min(1, 'candidateName is required').max(120);

const dateRange = { from: optional(z.date()), to: optional(z.date()) };
const fromBeforeTo = (v: { from?: Date; to?: Date }) => !v.from || !v.to || v.from < v.to;
const fromBeforeToIssue = { message: '`from` must be before `to`', path: ['from'] };

export const AvailabilityFilterSchema = z
  .object({ visaType: optional(z.enum(VisaType)), advisorId: optional(id), ...dateRange })
  .refine(fromBeforeTo, fromBeforeToIssue);
export type AvailabilityFilterDto = z.infer<typeof AvailabilityFilterSchema>;

export const RequestBookingSchema = z.object({
  candidateName,
  visaType: z.enum(VisaType),
  slotStart: optional(z.date()),
  advisorId: optional(id),
});
export type RequestBookingDto = z.infer<typeof RequestBookingSchema>;

export const ConfirmBookingSchema = z.object({ bookingId: id, advisorId: id });
export type ConfirmBookingDto = z.infer<typeof ConfirmBookingSchema>;

export const BookingsFilterSchema = z
  .object({
    status: optional(z.enum(BookingStatus)),
    advisorId: optional(id),
    visaType: optional(z.enum(VisaType)),
    ...dateRange,
  })
  .refine(fromBeforeTo, fromBeforeToIssue);
export type BookingsFilterDto = z.infer<typeof BookingsFilterSchema>;

export const PageSizeSchema = z.number().int().min(1).max(100);

export const IdSchema = id;

export const CancelBookingSchema = z.object({ bookingId: id });
export type CancelBookingDto = z.infer<typeof CancelBookingSchema>;

export const JoinWaitlistSchema = z.object({
  candidateName,
  visaType: z.enum(VisaType),
  advisorId: optional(id),
});
export type JoinWaitlistDto = z.infer<typeof JoinWaitlistSchema>;

export const AcceptOfferSchema = z.object({ waitlistEntryId: id });
export type AcceptOfferDto = z.infer<typeof AcceptOfferSchema>;

export const WaitlistStatusSchema = optional(z.enum(WaitlistStatus));
