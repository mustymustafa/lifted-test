import { BookingStatus } from '../../../src/bookings/booking.model';
import { VisaType } from '../../../src/config/rules';
import { WaitlistStatus } from '../../../src/waitlist/waitlist.model';
import { MINUTE } from '../../support/fake-clock';
import { RAJAN, setup, SOFIA, t } from '../../support/harness';

/**
 * Sofia alone has one 110 minute window (09:00-10:50). A type B booking at
 * 09:00 leaves room for exactly one type A call (10:10) and no type B call.
 */
async function sofiaFullForTypeB() {
  const ctx = setup([SOFIA]);
  const blocker = await ctx.service.request({ candidateName: 'Blocker', visaType: VisaType.B });
  return { ...ctx, blocker };
}

const entryStatus = async (ctx: ReturnType<typeof setup>, id: string) => (await ctx.waitlistRepo.findById(id))?.status;

describe('WaitlistService.join', () => {
  it('adds the candidate when nothing is available', async () => {
    const { waitlist, clock } = await sofiaFullForTypeB();
    const entry = await waitlist.join({ candidateName: 'Wanda', visaType: VisaType.B });
    expect(entry).toMatchObject({
      candidateName: 'Wanda',
      visaType: VisaType.B,
      status: WaitlistStatus.WAITING,
      joinedAt: clock.now(),
    });
  });

  it('refuses when a slot is available right now', async () => {
    const { waitlist } = await sofiaFullForTypeB();
    // Type A still fits at 10:10.
    await expect(waitlist.join({ candidateName: 'Wanda', visaType: VisaType.A })).rejects.toMatchObject({
      code: 'SLOTS_AVAILABLE',
    });
  });

  it('judges availability for the requested advisor only', async () => {
    const ctx = setup([SOFIA, RAJAN]);
    await ctx.service.request({ candidateName: 'Blocker', visaType: VisaType.B, advisorId: 'sofia' });
    // Rajan has type B room, Sofia does not.
    await expect(ctx.waitlist.join({ candidateName: 'Any', visaType: VisaType.B })).rejects.toMatchObject({
      code: 'SLOTS_AVAILABLE',
    });
    await expect(
      ctx.waitlist.join({ candidateName: 'Sofia only', visaType: VisaType.B, advisorId: 'sofia' }),
    ).resolves.toMatchObject({ advisorId: 'sofia', status: WaitlistStatus.WAITING });
  });

  it('rejects an unknown advisor', async () => {
    const { waitlist } = setup();
    await expect(
      waitlist.join({ candidateName: 'Wanda', visaType: VisaType.A, advisorId: 'nobody' }),
    ).rejects.toMatchObject({ code: 'ADVISOR_NOT_FOUND' });
  });
});

describe('offering freed slots', () => {
  it('offers the slot when a hold lapses', async () => {
    const ctx = await sofiaFullForTypeB();
    const entry = await ctx.waitlist.join({ candidateName: 'Wanda', visaType: VisaType.B });

    ctx.clock.advance(10 * MINUTE);
    expect(await ctx.service.settle()).toEqual({ expired: 1, offered: 1 });

    const updated = await ctx.waitlist.get(entry.id);
    expect(updated?.status).toBe(WaitlistStatus.OFFERED);
    const offer = await ctx.service.get(updated!.bookingId!);
    expect(offer).toMatchObject({
      candidateName: 'Wanda',
      status: BookingStatus.OFFERED,
      start: t('09:00'),
      end: t('10:00'),
      expiresAt: new Date(ctx.clock.now().getTime() + 10 * MINUTE),
    });
  });

  it('offers the slot when a confirmed booking is cancelled', async () => {
    const ctx = await sofiaFullForTypeB();
    await ctx.service.confirm(ctx.blocker.id, 'sofia');
    const entry = await ctx.waitlist.join({ candidateName: 'Wanda', visaType: VisaType.B });

    await ctx.service.cancel(ctx.blocker.id);

    expect(await entryStatus(ctx, entry.id)).toBe(WaitlistStatus.OFFERED);
  });

  it('does nothing while the blocking hold is still live', async () => {
    const ctx = await sofiaFullForTypeB();
    const entry = await ctx.waitlist.join({ candidateName: 'Wanda', visaType: VisaType.B });
    ctx.clock.advance(10 * MINUTE - 1);
    expect(await ctx.service.settle()).toEqual({ expired: 0, offered: 0 });
    expect(await entryStatus(ctx, entry.id)).toBe(WaitlistStatus.WAITING);
  });

  it('serves the queue oldest first', async () => {
    const ctx = await sofiaFullForTypeB();
    const first = await ctx.waitlist.join({ candidateName: 'First', visaType: VisaType.B });
    ctx.clock.advance(MINUTE);
    const second = await ctx.waitlist.join({ candidateName: 'Second', visaType: VisaType.B });

    ctx.clock.advance(9 * MINUTE);
    await ctx.service.settle();

    expect(await entryStatus(ctx, first.id)).toBe(WaitlistStatus.OFFERED);
    expect(await entryStatus(ctx, second.id)).toBe(WaitlistStatus.WAITING);
  });

  it('skips a candidate the freed slot does not fit, rather than blocking the queue', async () => {
    // Fill Sofia with A at 09:00, 09:35 and 10:10. Nothing is left for A or B.
    const ctx = setup([SOFIA]);
    for (const name of ['One', 'Two']) {
      const b = await ctx.service.request({ candidateName: name, visaType: VisaType.A });
      await ctx.service.confirm(b.id, 'sofia');
    }
    const last = await ctx.service.request({ candidateName: 'Three', visaType: VisaType.A }); // 10:10
    await ctx.service.confirm(last.id, 'sofia');

    const typeB = await ctx.waitlist.join({ candidateName: 'Needs 60', visaType: VisaType.B });
    ctx.clock.advance(MINUTE);
    const typeA = await ctx.waitlist.join({ candidateName: 'Needs 30', visaType: VisaType.A });

    await ctx.service.cancel(last.id); // frees 30 minutes only

    expect(await entryStatus(ctx, typeB.id)).toBe(WaitlistStatus.WAITING);
    expect(await entryStatus(ctx, typeA.id)).toBe(WaitlistStatus.OFFERED);
  });

  it('only considers candidates who could use the freed advisor', async () => {
    const ctx = setup([SOFIA, RAJAN]);
    const sofiaHold = await ctx.service.request({ candidateName: 'S', visaType: VisaType.B, advisorId: 'sofia' });
    const rajanHold = await ctx.service.request({ candidateName: 'R', visaType: VisaType.B, advisorId: 'rajan' });
    await ctx.service.confirm(sofiaHold.id, 'sofia');
    await ctx.service.confirm(rajanHold.id, 'rajan');
    // Rajan's type B call runs 09:33-10:33; the 47 minutes left cannot fit another.
    expect(await ctx.slotStarts('rajan', VisaType.B)).toEqual([]);

    const wantsRajan = await ctx.waitlist.join({ candidateName: 'Rajan only', visaType: VisaType.B, advisorId: 'rajan' });
    ctx.clock.advance(MINUTE);
    const wantsAnyone = await ctx.waitlist.join({ candidateName: 'Anyone', visaType: VisaType.B });

    await ctx.service.cancel(sofiaHold.id);

    expect(await entryStatus(ctx, wantsRajan.id)).toBe(WaitlistStatus.WAITING);
    const offered = await ctx.waitlist.get(wantsAnyone.id);
    expect(offered?.status).toBe(WaitlistStatus.OFFERED);
    expect((await ctx.service.get(offered!.bookingId!))?.advisorId).toBe('sofia');
  });

  it('an offered slot is blocked for everyone else', async () => {
    const ctx = await sofiaFullForTypeB();
    await ctx.waitlist.join({ candidateName: 'Wanda', visaType: VisaType.B });
    ctx.clock.advance(10 * MINUTE);
    await ctx.service.settle();

    expect(await ctx.slotStarts('sofia', VisaType.B)).toEqual([]);
    await expect(ctx.service.request({ candidateName: 'Walk-in', visaType: VisaType.B })).rejects.toMatchObject({
      code: 'NO_SLOT_AVAILABLE',
    });
  });
});

describe('waitlist has first refusal over new requests', () => {
  it('a walk-in arriving before the sweeper cannot take the freed slot', async () => {
    const ctx = await sofiaFullForTypeB();
    const entry = await ctx.waitlist.join({ candidateName: 'Wanda', visaType: VisaType.B });
    ctx.clock.advance(10 * MINUTE);
    // The sweeper has NOT run. The lapsed hold looks free to a plain read.
    expect(await ctx.slotStarts('sofia', VisaType.B)).toEqual(['09:00']);

    await expect(
      ctx.service.request({ candidateName: 'Walk-in', visaType: VisaType.B, slotStart: t('09:00') }),
    ).rejects.toMatchObject({ code: 'SLOT_UNAVAILABLE' });

    expect(await entryStatus(ctx, entry.id)).toBe(WaitlistStatus.OFFERED);
  });

  it('a walk-in still gets a freed slot nobody on the waitlist can use', async () => {
    const ctx = await sofiaFullForTypeB();
    ctx.clock.advance(10 * MINUTE);
    await expect(ctx.service.request({ candidateName: 'Walk-in', visaType: VisaType.B })).resolves.toMatchObject({
      status: BookingStatus.HELD,
      start: t('09:00'),
    });
  });

  it('gives one slot to one candidate when the sweeper and many walk-ins race', async () => {
    const ctx = await sofiaFullForTypeB();
    const entry = await ctx.waitlist.join({ candidateName: 'Wanda', visaType: VisaType.B });
    ctx.clock.advance(10 * MINUTE);

    const results = await Promise.allSettled([
      ...Array.from({ length: 10 }, (_, i) => ctx.service.request({ candidateName: `W${i}`, visaType: VisaType.B })),
      ctx.service.settle(),
      ...Array.from({ length: 10 }, (_, i) => ctx.service.request({ candidateName: `X${i}`, visaType: VisaType.B })),
    ]);

    const walkInsBooked = results.filter((r) => r.status === 'fulfilled' && 'candidateName' in (r.value as object));
    expect(walkInsBooked).toHaveLength(0);
    expect(await entryStatus(ctx, entry.id)).toBe(WaitlistStatus.OFFERED);
    const live = (await ctx.bookingRepo.findAll()).filter((b) => b.status === BookingStatus.OFFERED);
    expect(live).toHaveLength(1);
  });
});

describe('WaitlistService.acceptOffer', () => {
  async function offered() {
    const ctx = await sofiaFullForTypeB();
    const entry = await ctx.waitlist.join({ candidateName: 'Wanda', visaType: VisaType.B });
    ctx.clock.advance(10 * MINUTE);
    await ctx.service.settle();
    return { ...ctx, entry };
  }

  it('turns the offer into a held booking with a fresh ten minutes for the advisor', async () => {
    const ctx = await offered();
    ctx.clock.advance(7 * MINUTE);

    const booking = await ctx.waitlist.acceptOffer(ctx.entry.id);

    expect(booking).toMatchObject({
      candidateName: 'Wanda',
      status: BookingStatus.HELD,
      expiresAt: new Date(ctx.clock.now().getTime() + 10 * MINUTE),
    });
    expect(await entryStatus(ctx, ctx.entry.id)).toBe(WaitlistStatus.ACCEPTED);

    ctx.clock.advance(9 * MINUTE);
    await expect(ctx.service.confirm(booking.id, 'sofia')).resolves.toMatchObject({
      status: BookingStatus.CONFIRMED,
    });
  });

  it('the advisor cannot confirm an offer the candidate has not accepted', async () => {
    const ctx = await offered();
    const { bookingId } = (await ctx.waitlist.get(ctx.entry.id))!;
    await expect(ctx.service.confirm(bookingId!, 'sofia')).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('accepts one millisecond before the offer lapses', async () => {
    const ctx = await offered();
    ctx.clock.advance(10 * MINUTE - 1);
    await expect(ctx.waitlist.acceptOffer(ctx.entry.id)).resolves.toMatchObject({ status: BookingStatus.HELD });
  });

  it('rejects at exactly ten minutes, and the candidate leaves the queue', async () => {
    const ctx = await offered();
    ctx.clock.advance(10 * MINUTE);
    await expect(ctx.waitlist.acceptOffer(ctx.entry.id)).rejects.toMatchObject({ code: 'OFFER_EXPIRED' });
    expect(await entryStatus(ctx, ctx.entry.id)).toBe(WaitlistStatus.EXPIRED);
  });

  it('passes a missed offer to the next candidate in the queue', async () => {
    const ctx = await sofiaFullForTypeB();
    const first = await ctx.waitlist.join({ candidateName: 'First', visaType: VisaType.B });
    ctx.clock.advance(MINUTE);
    const second = await ctx.waitlist.join({ candidateName: 'Second', visaType: VisaType.B });
    ctx.clock.advance(9 * MINUTE);
    await ctx.service.settle(); // offered to First

    ctx.clock.advance(10 * MINUTE); // First does not answer
    expect(await ctx.service.settle()).toEqual({ expired: 1, offered: 1 });

    expect(await entryStatus(ctx, first.id)).toBe(WaitlistStatus.EXPIRED);
    expect(await entryStatus(ctx, second.id)).toBe(WaitlistStatus.OFFERED);
  });

  it('rejects accepting before there is an offer, accepting twice, and an unknown entry', async () => {
    const ctx = await sofiaFullForTypeB();
    const entry = await ctx.waitlist.join({ candidateName: 'Wanda', visaType: VisaType.B });
    await expect(ctx.waitlist.acceptOffer(entry.id)).rejects.toMatchObject({ code: 'INVALID_STATE' });

    ctx.clock.advance(10 * MINUTE);
    await ctx.waitlist.acceptOffer(entry.id);
    await expect(ctx.waitlist.acceptOffer(entry.id)).rejects.toMatchObject({ code: 'INVALID_STATE' });

    await expect(ctx.waitlist.acceptOffer('missing')).rejects.toMatchObject({ code: 'WAITLIST_ENTRY_NOT_FOUND' });
  });

  it('frees the slot again if the advisor never confirms the accepted booking', async () => {
    const ctx = await offered();
    await ctx.waitlist.acceptOffer(ctx.entry.id);
    ctx.clock.advance(10 * MINUTE);
    expect(await ctx.slotStarts('sofia', VisaType.B)).toEqual(['09:00']);
  });
});

describe('WaitlistService.list', () => {
  it('lists entries in join order and filters by status', async () => {
    const ctx = await sofiaFullForTypeB();
    await ctx.waitlist.join({ candidateName: 'First', visaType: VisaType.B });
    ctx.clock.advance(MINUTE);
    await ctx.waitlist.join({ candidateName: 'Second', visaType: VisaType.B });
    ctx.clock.advance(9 * MINUTE); // blocker lapses; listing settles and offers to First

    const all = await ctx.waitlist.list();
    expect(all.map((e) => [e.candidateName, e.status])).toEqual([
      ['First', WaitlistStatus.OFFERED],
      ['Second', WaitlistStatus.WAITING],
    ]);
    expect((await ctx.waitlist.list(WaitlistStatus.WAITING)).map((e) => e.candidateName)).toEqual(['Second']);
  });
});
