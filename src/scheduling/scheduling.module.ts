import { Module } from '@nestjs/common';
import { AppConfig } from '../common/config';
import { AvailabilityResolver } from './graphql/availability.resolver';
import { BookingResolver } from './graphql/booking.resolver';
import { WaitlistResolver } from './graphql/waitlist.resolver';
import { AdvisorRepository, InMemoryAdvisorRepository } from './repositories/advisor.repository';
import { BookingRepository, InMemoryBookingRepository } from './repositories/booking.repository';
import { InMemoryWaitlistRepository, WaitlistRepository } from './repositories/waitlist.repository';
import { AvailabilityService } from './services/availability.service';
import { BookingService } from './services/booking.service';
import { HoldSweeper } from './services/hold-sweeper';
import { SettlementService } from './services/settlement.service';
import { WaitlistService } from './services/waitlist.service';

@Module({
  providers: [
    // Swap these three providers to move from memory to a database.
    {
      provide: AdvisorRepository,
      useFactory: (config: AppConfig) => InMemoryAdvisorRepository.fromSeedFile(config.seedPath),
      inject: [AppConfig],
    },
    { provide: BookingRepository, useClass: InMemoryBookingRepository },
    { provide: WaitlistRepository, useClass: InMemoryWaitlistRepository },
    AvailabilityService,
    SettlementService,
    BookingService,
    WaitlistService,
    HoldSweeper,
    AvailabilityResolver,
    BookingResolver,
    WaitlistResolver,
  ],
})
export class SchedulingModule {}
