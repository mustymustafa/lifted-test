import { Args, ID, Int, Mutation, Parent, Query, ResolveField, Resolver } from '@nestjs/graphql';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { DEFAULT_HOLD_MINUTES, DEFAULT_PAGE_SIZE } from '../config/rules';
import { AdvisorRepository } from '../advisors/advisor.repository';
import { BookingService } from './booking.service';
import { AdvisorType } from '../advisors/advisor.dto';
import { IdSchema } from '../common/dto-helpers';
import {
  BookingPageType,
  BookingsFilterDto,
  BookingsFilterInput,
  BookingsFilterSchema,
  BookingType,
  CancelBookingDto,
  CancelBookingInput,
  CancelBookingSchema,
  ConfirmBookingDto,
  ConfirmBookingInput,
  ConfirmBookingSchema,
  PageSizeSchema,
  RequestBookingDto,
  RequestBookingInput,
  RequestBookingSchema,
} from './booking.dto';

@Resolver(() => BookingType)
export class BookingResolver {
  constructor(
    private readonly bookingService: BookingService,
    private readonly advisors: AdvisorRepository,
  ) {}

  @Mutation(() => BookingType, {
    description: `Request a booking. The slot is held for ${DEFAULT_HOLD_MINUTES} minutes while the advisor confirms. A candidate can have one active request at a time.`,
  })
  requestBooking(
    @Args('input', { type: () => RequestBookingInput }, new ZodValidationPipe(RequestBookingSchema))
    input: RequestBookingDto,
  ): Promise<BookingType> {
    return this.bookingService.request(input);
  }

  @Mutation(() => BookingType, {
    description: 'The assigned advisor confirms a held booking before the hold lapses.',
  })
  confirmBooking(
    @Args('input', { type: () => ConfirmBookingInput }, new ZodValidationPipe(ConfirmBookingSchema))
    input: ConfirmBookingDto,
  ): Promise<BookingType> {
    return this.bookingService.confirm(input.bookingId, input.advisorId);
  }

  @Mutation(() => BookingType, {
    description:
      'Cancel a held or confirmed booking. The freed time is offered to the waitlist, and the candidate can request again.',
  })
  cancelBooking(
    @Args('input', { type: () => CancelBookingInput }, new ZodValidationPipe(CancelBookingSchema))
    input: CancelBookingDto,
  ): Promise<BookingType> {
    return this.bookingService.cancel(input.bookingId);
  }

  @Query(() => BookingType, { nullable: true, description: 'One booking by id, e.g. to poll its status.' })
  booking(
    @Args('id', { type: () => ID }, new ZodValidationPipe(IdSchema)) id: string,
  ): Promise<BookingType | undefined> {
    return this.bookingService.get(id);
  }

  @Query(() => BookingPageType, { description: 'All bookings, ordered by start time.' })
  bookings(
    @Args('filter', { type: () => BookingsFilterInput, defaultValue: {} },
      new ZodValidationPipe(BookingsFilterSchema))
    filter: BookingsFilterDto,
    @Args('first', { type: () => Int, defaultValue: DEFAULT_PAGE_SIZE }, new ZodValidationPipe(PageSizeSchema))
    first: number,
    @Args('after', { type: () => ID, nullable: true }) after?: string,
  ): Promise<BookingPageType> {
    return this.bookingService.list(filter, first, after ?? undefined);
  }

  @ResolveField(() => AdvisorType)
  async advisor(@Parent() booking: BookingType): Promise<AdvisorType> {
    // One lookup per booking. Fine in memory; behind a database this wants a DataLoader.
    const advisor = await this.advisors.findById(booking.advisorId);
    return advisor!;
  }
}
