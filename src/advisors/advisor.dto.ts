import { Field, ID, ObjectType } from '@nestjs/graphql';

@ObjectType('Advisor')
export class AdvisorType {
  @Field(() => ID) id!: string;
  @Field(() => String) name!: string;
}
