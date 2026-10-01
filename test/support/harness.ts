import { AppConfig } from '../../src/config/config';
import { Mutex } from '../../src/common/mutex';
import { Advisor } from '../../src/advisors/advisor.model';
import { VisaType } from '../../src/config/rules';
import { InMemoryAdvisorRepository } from '../../src/advisors/advisor.repository';
import { InMemoryBookingRepository } from '../../src/bookings/booking.repository';
import { InMemoryWaitlistRepository } from '../../src/waitlist/waitlist.repository';
import { AvailabilityService } from '../../src/availability/availability.service';
import { BookingService } from '../../src/bookings/booking.service';
import { SettlementService } from '../../src/waitlist/settlement.service';
import { WaitlistService } from '../../src/waitlist/waitlist.service';
import { FakeClock, MINUTE } from './fake-clock';

export const t = (time: string): Date => new Date(`2025-03-10T${time}:00Z`);

/** Sofia, 10 March: one 110 minute window. */
export const SOFIA: Advisor = { id: 'sofia', name: 'Sofia', windows: [{ start: t('09:00'), end: t('10:50') }] };
/** Rajan, 10 March: two windows with a 3 minute gap. */
export const RAJAN: Advisor = {
  id: 'rajan',
  name: 'Rajan',
  windows: [
    { start: t('09:00'), end: t('09:30') },
    { start: t('09:33'), end: t('11:30') },
  ],
};

export const config: AppConfig = { port: 0, holdMs: 10 * MINUTE, sweepIntervalMs: 0, seedPath: '' };

/** The real services wired by hand over in-memory repositories and a fake clock. No Nest, no HTTP. */
export function setup(advisors: Advisor[] = [SOFIA, RAJAN]) {
  const clock = new FakeClock();
  const mutex = new Mutex();
  const bookingRepo = new InMemoryBookingRepository();
  const waitlistRepo = new InMemoryWaitlistRepository();
  const availability = new AvailabilityService(new InMemoryAdvisorRepository(advisors), bookingRepo, clock);
  const settlement = new SettlementService(bookingRepo, waitlistRepo, availability, clock, config);
  const service = new BookingService(bookingRepo, availability, settlement, clock, config, mutex);
  const waitlist = new WaitlistService(waitlistRepo, bookingRepo, availability, settlement, clock, config, mutex);
  const slotStarts = async (advisorId: string, visaType: VisaType) =>
    (await availability.findSlots({ advisorId, visaType })).map((s) => s.start.toISOString().slice(11, 16));
  return { clock, bookingRepo, waitlistRepo, availability, service, waitlist, slotStarts };
}
