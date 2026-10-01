import { Field, ID, InputType, Int, ObjectType, registerEnumType } from '@nestjs/graphql';
import { BookingStatus } from '../domain/booking';
import { VISA_RULES, VisaType } from '../domain/rules';
import { WaitlistStatus } from '../domain/waitlist';

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
registerEnumType(BookingStatus, { name: 'BookingStatus' });
registerEnumType(WaitlistStatus, { name: 'WaitlistStatus' });

// ---------- Output DTOs ----------

@ObjectType('Advisor')
export class AdvisorType {
  @Field(() => ID) id!: string;
  @Field(() => String) name!: string;
}

@ObjectType('Slot')
export class SlotType {
  @Field(() => AdvisorType) advisor!: AdvisorType;
  @Field(() => VisaType) visaType!: VisaType;
  @Field(() => Date) start!: Date;
  @Field(() => Date) end!: Date;
}

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

@ObjectType('WaitlistEntry')
export class WaitlistEntryType {
  @Field(() => ID, { description: 'Keep this: it is what the candidate uses to accept an offer.' })
  id!: string;
  @Field(() => String) candidateName!: string;
  @Field(() => VisaType) visaType!: VisaType;
  @Field(() => ID, { nullable: true, description: 'Empty means any advisor.' }) advisorId?: string;
  @Field(() => WaitlistStatus) status!: WaitlistStatus;
  @Field(() => Date) joinedAt!: Date;
  bookingId?: string;
}

// ---------- Input DTOs (shape only; rules live in the zod schemas) ----------

@InputType()
export class AvailabilityFilterInput {
  @Field(() => VisaType, { nullable: true, description: 'Omit to get slots for every visa type.' })
  visaType?: VisaType;
  @Field(() => ID, { nullable: true }) advisorId?: string;
  @Field(() => Date, { nullable: true, description: 'Only slots starting at or after this time.' })
  from?: Date;
  @Field(() => Date, { nullable: true, description: 'Only slots ending at or before this time.' })
  to?: Date;
}

@InputType()
export class RequestBookingInput {
  @Field(() => String) candidateName!: string;
  @Field(() => VisaType) visaType!: VisaType;
  @Field(() => Date, { nullable: true, description: 'Omit to be given the earliest available slot.' })
  slotStart?: Date;
  @Field(() => ID, { nullable: true, description: 'Omit to accept any advisor.' })
  advisorId?: string;
}

@InputType()
export class ConfirmBookingInput {
  @Field(() => ID) bookingId!: string;
  @Field(() => ID, { description: 'The advisor confirming. Stand-in for real authentication.' })
  advisorId!: string;
}

@InputType()
export class BookingsFilterInput {
  @Field(() => BookingStatus, { nullable: true }) status?: BookingStatus;
  @Field(() => ID, { nullable: true }) advisorId?: string;
  @Field(() => VisaType, { nullable: true }) visaType?: VisaType;
  @Field(() => Date, { nullable: true }) from?: Date;
  @Field(() => Date, { nullable: true }) to?: Date;
}

@InputType()
export class CancelBookingInput {
  @Field(() => ID) bookingId!: string;
}

@InputType()
export class JoinWaitlistInput {
  @Field(() => String) candidateName!: string;
  @Field(() => VisaType) visaType!: VisaType;
  @Field(() => ID, { nullable: true, description: 'Omit to accept any advisor.' })
  advisorId?: string;
}

@InputType()
export class AcceptOfferInput {
  @Field(() => ID) waitlistEntryId!: string;
}
