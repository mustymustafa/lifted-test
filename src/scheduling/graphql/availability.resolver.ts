import { Args, Query, Resolver } from '@nestjs/graphql';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { AvailabilityService } from '../services/availability.service';
import { AvailabilityFilterDto, AvailabilityFilterSchema } from './schemas';
import { AvailabilityFilterInput, SlotType } from './types';

@Resolver(() => SlotType)
export class AvailabilityResolver {
  constructor(private readonly availability: AvailabilityService) {}

  @Query(() => [SlotType], {
    description: 'Bookable slots, earliest first. Held and confirmed slots are excluded.',
  })
  availableSlots(
    @Args('filter', { type: () => AvailabilityFilterInput, defaultValue: {} },
      new ZodValidationPipe(AvailabilityFilterSchema))
    filter: AvailabilityFilterDto,
  ): Promise<SlotType[]> {
    return this.availability.findSlots(filter);
  }
}
