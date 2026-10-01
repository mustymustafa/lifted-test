import { AppConfig } from '../../src/config/config';
import { Mutex } from '../../src/common/mutex';
import { Advisor } from '../../src/advisors/advisor.model';
import { VisaType } from '../../src/config/rules';
import { InMemoryAdvisorRepository } from '../../src/advisors/advisor.repository';
import { InMemoryBookingRepository } from '../../src/bookings/booking.repository';
import { InMemoryWaitlistRepository } from '../../src/waitlist/waitlist.repository';
import { AvailabilityService } from '../../src/availability/availability.service';
import { BookingService } from '../../src/bookings/booking.service';
import { CandidateRequestPolicy } from '../../src/bookings/candidate-request.policy';
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
  const policy = new CandidateRequestPolicy(bookingRepo, waitlistRepo, clock);
  const service = new BookingService(bookingRepo, availability, settlement, policy, clock, config, mutex);
  const waitlist = new WaitlistService(waitlistRepo, bookingRepo, availability, settlement, policy, clock, config, mutex);
  const slotStarts = async (advisorId: string, visaType: VisaType) =>
    (await availability.findSlots({ advisorId, visaType })).map((s) => s.start.toISOString().slice(11, 16));
  return { clock, bookingRepo, waitlistRepo, availability, service, waitlist, slotStarts };
}

/**
 * Sofia alone has one 110 minute window (09:00-10:50). A type B booking at
 * 09:00 leaves room for exactly one type A call (10:10) and no type B call.
 */
export async function sofiaFullForTypeB() {
  const ctx = setup([SOFIA]);
  const blocker = await ctx.service.request({ candidateName: 'Blocker', visaType: VisaType.B });
  return { ...ctx, blocker };
}

export const entryStatus = async (ctx: ReturnType<typeof setup>, id: string) =>
  (await ctx.waitlistRepo.findById(id))?.status;
