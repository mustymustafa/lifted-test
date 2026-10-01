import { Field, ID, InputType, ObjectType, registerEnumType } from '@nestjs/graphql';
import { z } from 'zod';
import { CandidateNameSchema, IdSchema, optional, VisaTypeSchema } from '../common/dto-helpers';
import { VisaType } from '../config/rules';
import { WaitlistStatus } from './waitlist.model';

// Each input has two halves: a class that gives GraphQL its shape, and a zod
// schema that enforces the rules and produces the DTO type the service receives.

registerEnumType(WaitlistStatus, { name: 'WaitlistStatus' });

// ---------- Output ----------

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

// ---------- Join the waitlist ----------

@InputType()
export class JoinWaitlistInput {
  @Field(() => String) candidateName!: string;
  @Field(() => VisaType) visaType!: VisaType;
  @Field(() => ID, { nullable: true, description: 'Omit to accept any advisor.' })
  advisorId?: string;
}

export const JoinWaitlistSchema = z.object({
  candidateName: CandidateNameSchema,
  visaType: VisaTypeSchema,
  advisorId: optional(IdSchema),
});
export type JoinWaitlistDto = z.infer<typeof JoinWaitlistSchema>;

// ---------- Accept an offer ----------

@InputType()
export class AcceptOfferInput {
  @Field(() => ID) waitlistEntryId!: string;
}

export const AcceptOfferSchema = z.object({ waitlistEntryId: IdSchema });
export type AcceptOfferDto = z.infer<typeof AcceptOfferSchema>;

// ---------- Leave the waitlist ----------

@InputType()
export class LeaveWaitlistInput {
  @Field(() => ID) waitlistEntryId!: string;
}

export const LeaveWaitlistSchema = z.object({ waitlistEntryId: IdSchema });
export type LeaveWaitlistDto = z.infer<typeof LeaveWaitlistSchema>;

// ---------- List the waitlist ----------

export const WaitlistStatusSchema = optional(z.enum(WaitlistStatus));
