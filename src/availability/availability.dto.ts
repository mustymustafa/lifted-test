import { Field, ID, InputType, ObjectType } from '@nestjs/graphql';
import { z } from 'zod';
import { AdvisorType } from '../advisors/advisor.dto';
import { dateRange, fromBeforeTo, fromBeforeToIssue, IdSchema, optional, VisaTypeSchema } from '../common/dto-helpers';
import { VisaType } from '../config/rules';

// Each input has two halves: a class that gives GraphQL its shape, and a zod
// schema that enforces the rules and produces the DTO type the service receives.

// ---------- Output ----------

@ObjectType('Slot')
export class SlotType {
  @Field(() => AdvisorType) advisor!: AdvisorType;
  @Field(() => VisaType) visaType!: VisaType;
  @Field(() => Date) start!: Date;
  @Field(() => Date) end!: Date;
}

// ---------- Input ----------

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

export const AvailabilityFilterSchema = z
  .object({ visaType: optional(VisaTypeSchema), advisorId: optional(IdSchema), ...dateRange })
  .refine(fromBeforeTo, fromBeforeToIssue);
export type AvailabilityFilterDto = z.infer<typeof AvailabilityFilterSchema>;
