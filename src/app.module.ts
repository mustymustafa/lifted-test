import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { GraphQLModule } from '@nestjs/graphql';
import { AdvisorRepository, InMemoryAdvisorRepository } from './advisors/advisor.repository';
import { AvailabilityResolver } from './availability/availability.resolver';
import { AvailabilityService } from './availability/availability.service';
import { BookingRepository, InMemoryBookingRepository } from './bookings/booking.repository';
import { BookingResolver } from './bookings/booking.resolver';
import { BookingService } from './bookings/booking.service';
import { CandidateRequestPolicy } from './bookings/candidate-request.policy';
import { HoldSweeper } from './bookings/hold-sweeper';
import { CommonModule } from './common/common.module';
import { DomainErrorFilter } from './common/errors';
import { AppConfig } from './config/config';
import { SettlementService } from './waitlist/settlement.service';
import { InMemoryWaitlistRepository, WaitlistRepository } from './waitlist/waitlist.repository';
import { WaitlistResolver } from './waitlist/waitlist.resolver';
import { WaitlistService } from './waitlist/waitlist.service';

/**
 * One module wires every feature. Bookings and the waitlist depend on each
 * other (a booking request settles the waitlist; the waitlist creates
 * bookings), so a module per folder would need circular imports. The folders
 * give the structure; this file gives the wiring.
 */
@Module({
  imports: [
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: true,
      sortSchema: true,
      graphiql: true,
    }),
    CommonModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: DomainErrorFilter },

    // Storage. Swap these three providers to move from memory to a database.
    {
      provide: AdvisorRepository,
      useFactory: (config: AppConfig) => InMemoryAdvisorRepository.fromSeedFile(config.seedPath),
      inject: [AppConfig],
    },
    { provide: BookingRepository, useClass: InMemoryBookingRepository },
    { provide: WaitlistRepository, useClass: InMemoryWaitlistRepository },

    // Business rules.
    AvailabilityService,
    SettlementService,
    CandidateRequestPolicy,
    BookingService,
    WaitlistService,
    HoldSweeper,

    // GraphQL.
    AvailabilityResolver,
    BookingResolver,
    WaitlistResolver,
  ],
})
export class AppModule {}
