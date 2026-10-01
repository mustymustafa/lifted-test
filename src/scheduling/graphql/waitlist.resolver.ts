import { Args, ID, Mutation, Parent, Query, ResolveField, Resolver } from '@nestjs/graphql';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { DEFAULT_HOLD_MINUTES } from '../domain/rules';
import { WaitlistStatus } from '../domain/waitlist';
import { BookingService } from '../services/booking.service';
import { WaitlistService } from '../services/waitlist.service';
import {
  AcceptOfferDto,
  AcceptOfferSchema,
  IdSchema,
  JoinWaitlistDto,
  JoinWaitlistSchema,
  WaitlistStatusSchema,
} from './schemas';
import { AcceptOfferInput, BookingType, JoinWaitlistInput, WaitlistEntryType } from './types';

@Resolver(() => WaitlistEntryType)
export class WaitlistResolver {
  constructor(
    private readonly waitlistService: WaitlistService,
    private readonly bookingService: BookingService,
  ) {}

  @Mutation(() => WaitlistEntryType, {
    description: 'Join the waitlist when no slot is available. Freed slots are offered oldest first.',
  })
  joinWaitlist(
    @Args('input', { type: () => JoinWaitlistInput }, new ZodValidationPipe(JoinWaitlistSchema))
    input: JoinWaitlistDto,
  ): Promise<WaitlistEntryType> {
    return this.waitlistService.join(input);
  }

  @Mutation(() => BookingType, {
    description: `The candidate accepts an offered slot within ${DEFAULT_HOLD_MINUTES} minutes. The advisor then confirms as usual.`,
  })
  acceptOffer(
    @Args('input', { type: () => AcceptOfferInput }, new ZodValidationPipe(AcceptOfferSchema))
    input: AcceptOfferDto,
  ): Promise<BookingType> {
    return this.waitlistService.acceptOffer(input.waitlistEntryId);
  }

  @Query(() => [WaitlistEntryType], { description: 'The waitlist in the order candidates joined.' })
  waitlist(
    @Args('status', { type: () => WaitlistStatus, nullable: true }, new ZodValidationPipe(WaitlistStatusSchema))
    status?: WaitlistStatus,
  ): Promise<WaitlistEntryType[]> {
    return this.waitlistService.list(status);
  }

  @Query(() => WaitlistEntryType, { nullable: true, description: 'One entry by id, e.g. to poll for an offer.' })
  waitlistEntry(
    @Args('id', { type: () => ID }, new ZodValidationPipe(IdSchema)) id: string,
  ): Promise<WaitlistEntryType | undefined> {
    return this.waitlistService.get(id);
  }

  @ResolveField(() => BookingType, { nullable: true, description: 'The offered booking, once there is one.' })
  async offer(@Parent() entry: WaitlistEntryType): Promise<BookingType | undefined> {
    return entry.bookingId ? this.bookingService.get(entry.bookingId) : undefined;
  }
}
