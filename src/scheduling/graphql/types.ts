import { Field, ID, InputType, Int, ObjectType, registerEnumType } from '@nestjs/graphql';
import { BookingStatus } from '../domain/booking';
import { VisaType } from '../domain/visa-type';

registerEnumType(VisaType, {
  name: 'VisaType',
  valuesMap: {
    A: { description: 'Skilled Worker: 30 minute appointment' },
    B: { description: 'Family / Dependent: 60 minute appointment' },
  },
});
registerEnumType(BookingStatus, { name: 'BookingStatus' });

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
  @Field(() => Date, { description: 'When the hold lapses if the advisor has not confirmed.' })
  expiresAt!: Date;
  @Field(() => Date, { nullable: true }) confirmedAt?: Date;
}

@ObjectType('BookingPage')
export class BookingPageType {
  @Field(() => [BookingType]) items!: BookingType[];
  @Field(() => Int) totalCount!: number;
  @Field(() => ID, { nullable: true, description: 'Pass as `after` to get the next page.' })
  nextCursor?: string;
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
