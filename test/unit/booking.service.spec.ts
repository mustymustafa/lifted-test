import { AppConfig } from '../../src/common/config';
import { Mutex } from '../../src/common/mutex';
import { Advisor } from '../../src/scheduling/domain/advisor';
import { BookingStatus } from '../../src/scheduling/domain/booking';
import { VisaType } from '../../src/scheduling/domain/visa-type';
import { InMemoryAdvisorRepository } from '../../src/scheduling/repositories/advisor.repository';
import { InMemoryBookingRepository } from '../../src/scheduling/repositories/booking.repository';
import { AvailabilityService } from '../../src/scheduling/services/availability.service';
import { BookingService } from '../../src/scheduling/services/booking.service';
import { FakeClock, MINUTE } from '../support/fake-clock';

const t = (time: string): Date => new Date(`2025-03-10T${time}:00Z`);

const SOFIA: Advisor = { id: 'sofia', name: 'Sofia', windows: [{ start: t('09:00'), end: t('10:50') }] };
const RAJAN: Advisor = {
  id: 'rajan',
  name: 'Rajan',
  windows: [
    { start: t('09:00'), end: t('09:30') },
    { start: t('09:33'), end: t('11:30') },
  ],
};

const config: AppConfig = { port: 0, holdMs: 10 * MINUTE, sweepIntervalMs: 0, seedPath: '' };

function setup(advisors: Advisor[] = [SOFIA, RAJAN]) {
  const clock = new FakeClock();
  const bookingRepo = new InMemoryBookingRepository();
  const availability = new AvailabilityService(new InMemoryAdvisorRepository(advisors), bookingRepo, clock);
  const service = new BookingService(bookingRepo, availability, clock, config, new Mutex());
  const slotStarts = async (advisorId: string, visaType: VisaType) =>
    (await availability.findSlots({ advisorId, visaType })).map((s) => s.start.toISOString().slice(11, 16));
  return { clock, bookingRepo, availability, service, slotStarts };
}

describe('BookingService.request', () => {
  it('holds the earliest slot across advisors when no preference is given', async () => {
    const { service, clock } = setup();
    const booking = await service.request({ candidateName: 'Amina', visaType: VisaType.A });

    expect(booking).toMatchObject({
      candidateName: 'Amina',
      advisorId: 'rajan', // both start 09:00; ties break on advisor id
      start: t('09:00'),
      end: t('09:30'),
      status: BookingStatus.HELD,
    });
    expect(booking.expiresAt.getTime() - clock.now().getTime()).toBe(10 * MINUTE);
  });

  it('sets the length from the visa type', async () => {
    const { service } = setup();
    const a = await service.request({ candidateName: 'A', visaType: VisaType.A, advisorId: 'sofia' });
    const b = await service.request({ candidateName: 'B', visaType: VisaType.B, advisorId: 'rajan' });
    expect(a.end.getTime() - a.start.getTime()).toBe(30 * MINUTE);
    expect(b.end.getTime() - b.start.getTime()).toBe(60 * MINUTE);
  });

  it('honours a requested advisor and start time', async () => {
    const { service } = setup();
    const booking = await service.request({
      candidateName: 'Amina',
      visaType: VisaType.A,
      advisorId: 'sofia',
      slotStart: t('09:30'),
    });
    expect(booking).toMatchObject({ advisorId: 'sofia', start: t('09:30') });
  });

  it('rejects a start time that is not an offered slot', async () => {
    const { service } = setup();
    await expect(
      service.request({ candidateName: 'Amina', visaType: VisaType.A, advisorId: 'sofia', slotStart: t('09:10') }),
    ).rejects.toMatchObject({ code: 'SLOT_UNAVAILABLE' });
  });

  it('rejects a slot that is already held', async () => {
    const { service } = setup();
    const wanted = { visaType: VisaType.A, advisorId: 'sofia', slotStart: t('09:00') };
    await service.request({ candidateName: 'First', ...wanted });
    await expect(service.request({ candidateName: 'Second', ...wanted })).rejects.toMatchObject({
      code: 'SLOT_UNAVAILABLE',
    });
  });

  it('rejects an unknown advisor', async () => {
    const { service } = setup();
    await expect(
      service.request({ candidateName: 'Amina', visaType: VisaType.A, advisorId: 'nobody' }),
    ).rejects.toMatchObject({ code: 'ADVISOR_NOT_FOUND' });
  });

  it('reports when nothing is left', async () => {
    const { service } = setup([SOFIA]);
    await service.request({ candidateName: 'One', visaType: VisaType.B }); // 09:00-10:00, blocked to 10:10
    await expect(service.request({ candidateName: 'Two', visaType: VisaType.B })).rejects.toMatchObject({
      code: 'NO_SLOT_AVAILABLE',
    });
  });

  it('gives exactly one winner when many candidates race for the same slot', async () => {
    const { service } = setup();
    const wanted = { visaType: VisaType.A, advisorId: 'sofia', slotStart: t('09:00') };
    const results = await Promise.allSettled(
      Array.from({ length: 25 }, (_, i) => service.request({ candidateName: `C${i}`, ...wanted })),
    );

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(rejected).toHaveLength(24);
    expect(rejected.every((r) => r.reason.code === 'SLOT_UNAVAILABLE')).toBe(true);
  });

  it('never double-books when many candidates race for any slot', async () => {
    const { service } = setup();
    const results = await Promise.allSettled(
      Array.from({ length: 25 }, (_, i) => service.request({ candidateName: `C${i}`, visaType: VisaType.A })),
    );
    const held = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));

    // Sofia fits 3 back-to-back type A calls, Rajan 1 + 3 (breaks included).
    expect(held.length).toBeGreaterThan(0);
    expect(held.length).toBeLessThan(25);
    for (const a of held) {
      for (const b of held) {
        if (a === b || a.advisorId !== b.advisorId) continue;
        const aBlockedUntil = a.end.getTime() + 5 * MINUTE;
        const overlap = a.start < b.end && b.start.getTime() < aBlockedUntil;
        expect(overlap).toBe(false);
      }
    }
  });
});

describe('advisor breaks', () => {
  it('blocks 10 minutes after a type B call', async () => {
    const { service, slotStarts } = setup();
    await service.request({ candidateName: 'B', visaType: VisaType.B, advisorId: 'sofia' }); // 09:00-10:00
    expect(await slotStarts('sofia', VisaType.A)).toEqual(['10:10']);
    expect(await slotStarts('sofia', VisaType.B)).toEqual([]);
  });

  it('blocks 5 minutes after a type A call', async () => {
    const { service, slotStarts } = setup();
    await service.request({ candidateName: 'A', visaType: VisaType.A, advisorId: 'sofia' }); // 09:00-09:30
    expect(await slotStarts('sofia', VisaType.A)).toEqual(['09:35', '10:05']);
    expect(await slotStarts('sofia', VisaType.B)).toEqual(['09:35']);
  });

  it('carries the break into the next window', async () => {
    const { service, slotStarts } = setup();
    await service.request({ candidateName: 'A', visaType: VisaType.A, advisorId: 'rajan' }); // 09:00-09:30
    // Second window opens 09:33 but the break runs to 09:35.
    expect(await slotStarts('rajan', VisaType.A)).toEqual(['09:35', '10:05', '10:35']);
  });

  it('does not affect another advisor', async () => {
    const { service, slotStarts } = setup();
    await service.request({ candidateName: 'B', visaType: VisaType.B, advisorId: 'sofia' });
    expect(await slotStarts('rajan', VisaType.A)).toEqual(['09:00', '09:33', '10:03', '10:33']);
  });
});

describe('BookingService.confirm', () => {
  it('confirms a held booking for the assigned advisor', async () => {
    const { service, clock } = setup();
    const held = await service.request({ candidateName: 'Amina', visaType: VisaType.A, advisorId: 'sofia' });
    clock.advance(4 * MINUTE);

    const confirmed = await service.confirm(held.id, 'sofia');

    expect(confirmed).toMatchObject({ status: BookingStatus.CONFIRMED, confirmedAt: clock.now() });
  });

  it('accepts a confirmation one millisecond before the hold lapses', async () => {
    const { service, clock } = setup();
    const held = await service.request({ candidateName: 'Amina', visaType: VisaType.A });
    clock.advance(10 * MINUTE - 1);
    await expect(service.confirm(held.id, held.advisorId)).resolves.toMatchObject({
      status: BookingStatus.CONFIRMED,
    });
  });

  it('rejects a confirmation at exactly ten minutes and marks the booking expired', async () => {
    const { service, clock, bookingRepo } = setup();
    const held = await service.request({ candidateName: 'Amina', visaType: VisaType.A });
    clock.advance(10 * MINUTE);

    await expect(service.confirm(held.id, held.advisorId)).rejects.toMatchObject({ code: 'HOLD_EXPIRED' });
    expect((await bookingRepo.findById(held.id))?.status).toBe(BookingStatus.EXPIRED);
  });

  it('rejects a different advisor', async () => {
    const { service } = setup();
    const held = await service.request({ candidateName: 'Amina', visaType: VisaType.A, advisorId: 'sofia' });
    await expect(service.confirm(held.id, 'rajan')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects an unknown booking', async () => {
    const { service } = setup();
    await expect(service.confirm('missing', 'sofia')).rejects.toMatchObject({ code: 'BOOKING_NOT_FOUND' });
  });

  it('rejects confirming twice', async () => {
    const { service } = setup();
    const held = await service.request({ candidateName: 'Amina', visaType: VisaType.A });
    await service.confirm(held.id, held.advisorId);
    await expect(service.confirm(held.id, held.advisorId)).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('keeps a confirmed slot out of the pool for good', async () => {
    const { service, clock, slotStarts } = setup();
    const held = await service.request({ candidateName: 'B', visaType: VisaType.B, advisorId: 'sofia' });
    await service.confirm(held.id, 'sofia');
    clock.advance(24 * 60 * MINUTE);

    expect(await slotStarts('sofia', VisaType.A)).toEqual(['10:10']);
  });
});

describe('hold expiry', () => {
  it('releases the slot once the hold lapses, without the sweeper running', async () => {
    const { service, clock, slotStarts } = setup();
    await service.request({ candidateName: 'B', visaType: VisaType.B, advisorId: 'sofia' });
    expect(await slotStarts('sofia', VisaType.B)).toEqual([]);

    clock.advance(10 * MINUTE);

    expect(await slotStarts('sofia', VisaType.B)).toEqual(['09:00']);
  });

  it('keeps the slot held until the last millisecond', async () => {
    const { service, clock, slotStarts } = setup();
    await service.request({ candidateName: 'B', visaType: VisaType.B, advisorId: 'sofia' });
    clock.advance(10 * MINUTE - 1);
    expect(await slotStarts('sofia', VisaType.B)).toEqual([]);
  });

  it('lets another candidate take a slot whose hold lapsed', async () => {
    const { service, clock } = setup();
    const wanted = { visaType: VisaType.A, advisorId: 'sofia', slotStart: t('09:00') };
    const first = await service.request({ candidateName: 'First', ...wanted });
    clock.advance(10 * MINUTE);

    const second = await service.request({ candidateName: 'Second', ...wanted });

    expect(second.status).toBe(BookingStatus.HELD);
    expect(second.id).not.toBe(first.id);
  });

  it('expireStaleHolds marks only lapsed holds and reports the count', async () => {
    const { service, clock, bookingRepo } = setup();
    const lapsed = await service.request({ candidateName: 'Lapsed', visaType: VisaType.A, advisorId: 'sofia' });
    const confirmed = await service.request({ candidateName: 'Confirmed', visaType: VisaType.A, advisorId: 'rajan' });
    await service.confirm(confirmed.id, 'rajan');
    clock.advance(6 * MINUTE);
    const fresh = await service.request({ candidateName: 'Fresh', visaType: VisaType.A, advisorId: 'sofia' });
    clock.advance(4 * MINUTE);

    expect(await service.expireStaleHolds()).toBe(1);
    expect(await service.expireStaleHolds()).toBe(0);

    const status = async (id: string) => (await bookingRepo.findById(id))?.status;
    expect(await status(lapsed.id)).toBe(BookingStatus.EXPIRED);
    expect(await status(confirmed.id)).toBe(BookingStatus.CONFIRMED);
    expect(await status(fresh.id)).toBe(BookingStatus.HELD);
  });
});

describe('BookingService.list', () => {
  async function seeded() {
    const ctx = setup();
    const { service, clock } = ctx;
    const a = await service.request({ candidateName: 'A', visaType: VisaType.A, advisorId: 'sofia' }); // 09:00
    const b = await service.request({ candidateName: 'B', visaType: VisaType.B, advisorId: 'rajan' }); // 09:33
    await service.confirm(b.id, 'rajan');
    clock.advance(10 * MINUTE); // a lapses
    const c = await service.request({ candidateName: 'C', visaType: VisaType.A, advisorId: 'sofia', slotStart: t('09:30') });
    return { ...ctx, a, b, c };
  }

  it('returns every booking ordered by start, with lapsed holds shown as EXPIRED', async () => {
    const { service } = await seeded();
    const page = await service.list();
    expect(page.items.map((b) => [b.candidateName, b.status])).toEqual([
      ['A', BookingStatus.EXPIRED],
      ['C', BookingStatus.HELD],
      ['B', BookingStatus.CONFIRMED],
    ]);
    expect(page).toMatchObject({ totalCount: 3, nextCursor: undefined });
  });

  it('filters by status, advisor, visa type and time range', async () => {
    const { service } = await seeded();
    const names = async (filter: Parameters<typeof service.list>[0]) =>
      (await service.list(filter)).items.map((b) => b.candidateName);

    expect(await names({ status: BookingStatus.CONFIRMED })).toEqual(['B']);
    expect(await names({ advisorId: 'sofia' })).toEqual(['A', 'C']);
    expect(await names({ visaType: VisaType.B })).toEqual(['B']);
    expect(await names({ from: t('09:30') })).toEqual(['C', 'B']);
    expect(await names({ to: t('10:00') })).toEqual(['A', 'C']);
    expect(await names({ advisorId: 'sofia', status: BookingStatus.HELD })).toEqual(['C']);
  });

  it('pages with a cursor', async () => {
    const { service } = await seeded();
    const first = await service.list({}, 2);
    expect(first.items.map((b) => b.candidateName)).toEqual(['A', 'C']);
    expect(first.totalCount).toBe(3);

    const second = await service.list({}, 2, first.nextCursor);
    expect(second.items.map((b) => b.candidateName)).toEqual(['B']);
    expect(second.nextCursor).toBeUndefined();
  });

  it('rejects an unknown cursor', async () => {
    const { service } = await seeded();
    await expect(service.list({}, 2, 'nope')).rejects.toMatchObject({ code: 'BAD_USER_INPUT' });
  });
});

describe('AvailabilityService.findSlots', () => {
  it('returns slots for every visa type when none is given, earliest first', async () => {
    const { availability } = setup([SOFIA]);
    const slots = await availability.findSlots();
    expect(slots.map((s) => `${s.visaType}@${s.start.toISOString().slice(11, 16)}`)).toEqual([
      'A@09:00',
      'B@09:00',
      'A@09:30',
      'A@10:00',
    ]);
  });

  it('filters by time range', async () => {
    const { availability } = setup();
    const slots = await availability.findSlots({ visaType: VisaType.A, from: t('09:30'), to: t('10:05') });
    expect(slots.map((s) => [s.advisor.id, s.start])).toEqual([
      ['sofia', t('09:30')],
      ['rajan', t('09:33')],
    ]);
  });
});
