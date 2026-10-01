import { Field, ID, InputType, Int, ObjectType, registerEnumType } from '@nestjs/graphql';
import { z } from 'zod';
import {
  CandidateNameSchema,
  dateRange,
  fromBeforeTo,
  fromBeforeToIssue,
  IdSchema,
  optional,
  VisaTypeSchema,
} from '../common/dto-helpers';
import { MAX_PAGE_SIZE, VisaType } from '../config/rules';
import { BookingStatus } from './booking.model';

// Each input has two halves: a class that gives GraphQL its shape, and a zod
// schema that enforces the rules and produces the DTO type the service receives.

registerEnumType(BookingStatus, { name: 'BookingStatus' });

// ---------- Output ----------

@ObjectType('Booking')
export class BookingType {
  @Field(() => ID) id!: string;
  @Field(() => String) candidateName!: string;
  @Field(() => VisaType) visaType!: VisaType;
  @Field(() => ID) advisorId!: string;
  @Field(() => Date) start!: Date;
  @Field(() => Date) end!: Date;
  @Field(() => BookingStatus) status!: BookingStatus;
  @Field(() => Date) createdAt!: Date;
  @Field(() => Date, { description: 'When the hold or waitlist offer lapses if nobody acts on it.' })
  expiresAt!: Date;
  @Field(() => Date, { nullable: true }) confirmedAt?: Date;
  @Field(() => Date, { nullable: true }) cancelledAt?: Date;
}

@ObjectType('BookingPage')
export class BookingPageType {
  @Field(() => [BookingType]) items!: BookingType[];
  @Field(() => Int) totalCount!: number;
  @Field(() => ID, { nullable: true, description: 'Pass as `after` to get the next page.' })
  nextCursor?: string;
}

// ---------- Request a booking ----------

@InputType()
export class RequestBookingInput {
  @Field(() => String) candidateName!: string;
  @Field(() => VisaType) visaType!: VisaType;
  @Field(() => Date, { nullable: true, description: 'Omit to be given the earliest available slot.' })
  slotStart?: Date;
  @Field(() => ID, { nullable: true, description: 'Omit to accept any advisor.' })
  advisorId?: string;
}

export const RequestBookingSchema = z.object({
  candidateName: CandidateNameSchema,
  visaType: VisaTypeSchema,
  slotStart: optional(z.date()),
  advisorId: optional(IdSchema),
});
export type RequestBookingDto = z.infer<typeof RequestBookingSchema>;

// ---------- Confirm a booking ----------

@InputType()
export class ConfirmBookingInput {
  @Field(() => ID) bookingId!: string;
  @Field(() => ID, { description: 'The advisor confirming. Stand-in for real authentication.' })
  advisorId!: string;
}

export const ConfirmBookingSchema = z.object({ bookingId: IdSchema, advisorId: IdSchema });
export type ConfirmBookingDto = z.infer<typeof ConfirmBookingSchema>;

// ---------- Cancel a booking ----------

@InputType()
export class CancelBookingInput {
  @Field(() => ID) bookingId!: string;
}

export const CancelBookingSchema = z.object({ bookingId: IdSchema });
export type CancelBookingDto = z.infer<typeof CancelBookingSchema>;

// ---------- List bookings ----------

@InputType()
export class BookingsFilterInput {
  @Field(() => BookingStatus, { nullable: true }) status?: BookingStatus;
  @Field(() => ID, { nullable: true }) advisorId?: string;
  @Field(() => VisaType, { nullable: true }) visaType?: VisaType;
  @Field(() => Date, { nullable: true }) from?: Date;
  @Field(() => Date, { nullable: true }) to?: Date;
}

export const BookingsFilterSchema = z
  .object({
    status: optional(z.enum(BookingStatus)),
    advisorId: optional(IdSchema),
    visaType: optional(VisaTypeSchema),
    ...dateRange,
  })
  .refine(fromBeforeTo, fromBeforeToIssue);
export type BookingsFilterDto = z.infer<typeof BookingsFilterSchema>;

export const PageSizeSchema = z.number().int().min(1).max(MAX_PAGE_SIZE);
