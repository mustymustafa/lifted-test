import { Module } from '@nestjs/common';
import { AppConfig } from '../common/config';
import { AvailabilityResolver } from './graphql/availability.resolver';
import { BookingResolver } from './graphql/booking.resolver';
import { AdvisorRepository, InMemoryAdvisorRepository } from './repositories/advisor.repository';
import { BookingRepository, InMemoryBookingRepository } from './repositories/booking.repository';
import { AvailabilityService } from './services/availability.service';
import { BookingService } from './services/booking.service';
import { HoldSweeper } from './services/hold-sweeper';

@Module({
  providers: [
    // Swap these two lines to move from memory to a database.
    {
      provide: AdvisorRepository,
      useFactory: (config: AppConfig) => InMemoryAdvisorRepository.fromSeedFile(config.seedPath),
      inject: [AppConfig],
    },
    { provide: BookingRepository, useClass: InMemoryBookingRepository },
    AvailabilityService,
    BookingService,
    HoldSweeper,
    AvailabilityResolver,
    BookingResolver,
  ],
})
export class SchedulingModule {}
