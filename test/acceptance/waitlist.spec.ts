import { BookingStatus } from '../../src/bookings/booking.model';
import { HoldSweeper } from '../../src/bookings/hold-sweeper';
import { VisaType } from '../../src/config/rules';
import { WaitlistStatus } from '../../src/waitlist/waitlist.model';
import { MINUTE } from '../support/fake-clock';
import { config, entryStatus, RAJAN, setup, sofiaFullForTypeB, SOFIA, t } from '../support/harness';

const wanda = { candidateName: 'Wanda Okafor', visaType: VisaType.B };

/** Sofia is full for type B; Wanda is waiting; the blocker's hold has just run out and been offered on. */
async function offeredToWanda() {
  const ctx = await sofiaFullForTypeB();
  const entry = await ctx.waitlist.join(wanda);
  ctx.clock.advance(10 * MINUTE);
  await ctx.service.settle();
  return { ...ctx, entry };
}

/**
 * Acceptance criteria: Waitlist (stretch).
 * The groups below are the criteria, word for word, from
 * docs/ACCEPTANCE_CRITERIA_AND_TEST_SCENARIOS.md.
 */
describe('Waitlist (stretch)', () => {
  describe('If no slot is available, a candidate can join a waitlist instead of being turned away', () => {
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

    it('refuses when a slot is available right now, so the candidate books instead', async () => {
      const { waitlist } = await sofiaFullForTypeB();
      // A type A slot is still free at 10:10.
      await expect(waitlist.join({ candidateName: 'Wanda', visaType: VisaType.A })).rejects.toMatchObject({
        code: 'SLOTS_AVAILABLE',
      });
    });

    it('judges availability for the advisor asked for, when one is given', async () => {
      const ctx = setup([SOFIA, RAJAN]);
      await ctx.service.request({ candidateName: 'Blocker', visaType: VisaType.B, advisorId: 'sofia' });
      // Rajan still has type B room, Sofia does not.
      await expect(ctx.waitlist.join({ candidateName: 'Any', visaType: VisaType.B })).rejects.toMatchObject({
        code: 'SLOTS_AVAILABLE',
      });
      await expect(
        ctx.waitlist.join({ candidateName: 'Sofia only', visaType: VisaType.B, advisorId: 'sofia' }),
      ).resolves.toMatchObject({ advisorId: 'sofia', status: WaitlistStatus.WAITING });
    });

    it('refuses an advisor that does not exist', async () => {
      const { waitlist } = setup();
      await expect(
        waitlist.join({ candidateName: 'Wanda', visaType: VisaType.A, advisorId: 'nobody' }),
      ).rejects.toMatchObject({ code: 'ADVISOR_NOT_FOUND' });
    });

    it('lists entries in the order they joined, and can filter by status', async () => {
      const ctx = await sofiaFullForTypeB();
      await ctx.waitlist.join({ candidateName: 'First', visaType: VisaType.B });
      ctx.clock.advance(MINUTE);
      await ctx.waitlist.join({ candidateName: 'Second', visaType: VisaType.B });
      ctx.clock.advance(9 * MINUTE); // the blocker's hold runs out; listing offers it to First

      const all = await ctx.waitlist.list();
      expect(all.map((e) => [e.candidateName, e.status])).toEqual([
        ['First', WaitlistStatus.OFFERED],
        ['Second', WaitlistStatus.WAITING],
      ]);
      expect((await ctx.waitlist.list(WaitlistStatus.WAITING)).map((e) => e.candidateName)).toEqual(['Second']);
    });
  });

  describe('When a hold expires, the freed slot is offered to the waitlist automatically', () => {
    it('offers the slot to the waiting candidate as soon as the hold runs out', async () => {
      const ctx = await sofiaFullForTypeB();
      const entry = await ctx.waitlist.join({ candidateName: 'Wanda', visaType: VisaType.B });

      ctx.clock.advance(10 * MINUTE);
      expect(await ctx.service.settle()).toEqual({ expired: 1, offered: 1 });

      const updated = await ctx.waitlist.get(entry.id);
      expect(updated?.status).toBe(WaitlistStatus.OFFERED);
      expect(await ctx.service.get(updated!.bookingId!)).toMatchObject({
        candidateName: 'Wanda',
        status: BookingStatus.OFFERED,
        start: t('09:00'),
        end: t('10:00'),
      });
    });

    describe('with nobody using the API (the background sweep)', () => {
      afterEach(() => jest.useRealTimers());

      it('makes the offer by itself, when the sweep timer fires', async () => {
        jest.useFakeTimers();
        const ctx = await sofiaFullForTypeB();
        const entry = await ctx.waitlist.join({ candidateName: 'Wanda', visaType: VisaType.B });
        const sweeper = new HoldSweeper(ctx.service, { ...config, sweepIntervalMs: 5_000 });
        sweeper.onModuleInit();

        ctx.clock.advance(10 * MINUTE); // the hold runs out; no request is made
        expect(await entryStatus(ctx, entry.id)).toBe(WaitlistStatus.WAITING);
        await jest.advanceTimersByTimeAsync(5_000); // the next sweep

        expect(await entryStatus(ctx, entry.id)).toBe(WaitlistStatus.OFFERED);
        sweeper.onModuleDestroy();
      });

      it('does not run at all when the interval is zero', async () => {
        jest.useFakeTimers();
        const ctx = await sofiaFullForTypeB();
        const entry = await ctx.waitlist.join({ candidateName: 'Wanda', visaType: VisaType.B });
        const sweeper = new HoldSweeper(ctx.service, { ...config, sweepIntervalMs: 0 });
        sweeper.onModuleInit();

        ctx.clock.advance(10 * MINUTE);
        await jest.advanceTimersByTimeAsync(60_000);

        expect(await entryStatus(ctx, entry.id)).toBe(WaitlistStatus.WAITING);
      });

      it('stops when the app shuts down, and survives a failed sweep', async () => {
        jest.useFakeTimers();
        const ctx = await sofiaFullForTypeB();
        const settle = jest.spyOn(ctx.service, 'settle').mockRejectedValueOnce(new Error('boom'));
        const sweeper = new HoldSweeper(ctx.service, { ...config, sweepIntervalMs: 1_000 });
        sweeper.onModuleInit();

        await jest.advanceTimersByTimeAsync(1_000); // fails, and is logged rather than thrown
        await jest.advanceTimersByTimeAsync(1_000); // the next sweep still runs
        expect(settle).toHaveBeenCalledTimes(2);

        sweeper.onModuleDestroy();
        await jest.advanceTimersByTimeAsync(5_000);
        expect(settle).toHaveBeenCalledTimes(2);
      });
    });

    it('does nothing while the blocking hold is still live', async () => {
      const ctx = await sofiaFullForTypeB();
      const entry = await ctx.waitlist.join({ candidateName: 'Wanda', visaType: VisaType.B });
      ctx.clock.advance(10 * MINUTE - 1);
      expect(await ctx.service.settle()).toEqual({ expired: 0, offered: 0 });
      expect(await entryStatus(ctx, entry.id)).toBe(WaitlistStatus.WAITING);
    });
  });

  describe('When a confirmed booking is cancelled, the freed slot is offered to the waitlist automatically', () => {
    it('offers the slot as soon as the booking is cancelled', async () => {
      const ctx = await sofiaFullForTypeB();
      await ctx.service.confirm(ctx.blocker.id, 'sofia');
      const entry = await ctx.waitlist.join({ candidateName: 'Wanda', visaType: VisaType.B });

      await ctx.service.cancel(ctx.blocker.id);

      expect(await entryStatus(ctx, entry.id)).toBe(WaitlistStatus.OFFERED);
    });
  });

  describe('The slot is offered to the candidate who has waited longest and whose visa type fits the slot', () => {
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
      // Sofia is filled with type A calls at 09:00, 09:35 and 10:10, so nothing is left for A or B.
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

    it('only considers candidates who could use the advisor whose time was freed', async () => {
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
  });

  describe('A candidate who asked for a particular advisor is only offered that advisor', () => {
    it("offers Rajan's freed slot, not Sofia's earlier free one", async () => {
      const ctx = setup([SOFIA, RAJAN]);
      // Rajan's only type B slot (09:33) is held; Sofia still has a free one at 09:00.
      await ctx.service.request({ candidateName: 'Blocker', visaType: VisaType.B, advisorId: 'rajan' });
      expect(await ctx.slotStarts('sofia', VisaType.B)).toEqual(['09:00']);
      const entry = await ctx.waitlist.join({ candidateName: 'Wanda', visaType: VisaType.B, advisorId: 'rajan' });

      ctx.clock.advance(10 * MINUTE);
      await ctx.service.settle();

      const offered = await ctx.waitlist.get(entry.id);
      expect(offered?.status).toBe(WaitlistStatus.OFFERED);
      expect(await ctx.service.get(offered!.bookingId!)).toMatchObject({ advisorId: 'rajan', start: t('09:33') });
    });
  });

  describe('The offered candidate has 10 minutes to accept', () => {
    it('gives the offer the same ten minutes as a hold', async () => {
      const ctx = await offeredToWanda();
      const { bookingId } = (await ctx.waitlist.get(ctx.entry.id))!;
      expect((await ctx.service.get(bookingId!))?.expiresAt).toEqual(new Date(ctx.clock.now().getTime() + 10 * MINUTE));
    });

    it('accepts one millisecond before the offer runs out', async () => {
      const ctx = await offeredToWanda();
      ctx.clock.advance(10 * MINUTE - 1);
      await expect(ctx.waitlist.acceptOffer(ctx.entry.id)).resolves.toMatchObject({ status: BookingStatus.HELD });
    });

    it('refuses at exactly ten minutes, and the candidate leaves the queue', async () => {
      const ctx = await offeredToWanda();
      ctx.clock.advance(10 * MINUTE);
      await expect(ctx.waitlist.acceptOffer(ctx.entry.id)).rejects.toMatchObject({ code: 'OFFER_EXPIRED' });
      expect(await entryStatus(ctx, ctx.entry.id)).toBe(WaitlistStatus.EXPIRED);
    });
  });

  describe('While a slot is on offer, nobody else can book it', () => {
    it('hides the offered slot and refuses a new request for it', async () => {
      const ctx = await offeredToWanda();
      expect(await ctx.slotStarts('sofia', VisaType.B)).toEqual([]);
      await expect(ctx.service.request({ candidateName: 'Walk-in', visaType: VisaType.B })).rejects.toMatchObject({
        code: 'NO_SLOT_AVAILABLE',
      });
    });

    it('stops a new request arriving before the background sweep from taking a freed slot', async () => {
      const ctx = await sofiaFullForTypeB();
      const entry = await ctx.waitlist.join({ candidateName: 'Wanda', visaType: VisaType.B });
      ctx.clock.advance(10 * MINUTE);
      // The sweep has NOT run. The lapsed hold still looks free to a plain read.
      expect(await ctx.slotStarts('sofia', VisaType.B)).toEqual(['09:00']);

      await expect(
        ctx.service.request({ candidateName: 'Walk-in', visaType: VisaType.B, slotStart: t('09:00') }),
      ).rejects.toMatchObject({ code: 'SLOT_UNAVAILABLE' });

      expect(await entryStatus(ctx, entry.id)).toBe(WaitlistStatus.OFFERED);
    });

    it('still gives a freed slot to a new request when nobody on the waitlist can use it', async () => {
      const ctx = await sofiaFullForTypeB();
      ctx.clock.advance(10 * MINUTE);
      await expect(ctx.service.request({ candidateName: 'Walk-in', visaType: VisaType.B })).resolves.toMatchObject({
        status: BookingStatus.HELD,
        start: t('09:00'),
      });
    });

    it('gives one slot to one candidate when the sweep and many new requests race', async () => {
      const ctx = await sofiaFullForTypeB();
      const entry = await ctx.waitlist.join({ candidateName: 'Wanda', visaType: VisaType.B });
      ctx.clock.advance(10 * MINUTE);

      const results = await Promise.allSettled([
        ...Array.from({ length: 10 }, (_, i) => ctx.service.request({ candidateName: `W${i}`, visaType: VisaType.B })),
        ctx.service.settle(),
        ...Array.from({ length: 10 }, (_, i) => ctx.service.request({ candidateName: `X${i}`, visaType: VisaType.B })),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled' && 'candidateName' in (r.value as object))).toHaveLength(0);
      expect(await entryStatus(ctx, entry.id)).toBe(WaitlistStatus.OFFERED);
      const live = (await ctx.bookingRepo.findAll()).filter((b) => b.status === BookingStatus.OFFERED);
      expect(live).toHaveLength(1);
    });
  });

  describe('If the candidate does not accept in time, the slot is offered to the next person on the waitlist', () => {
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
  });

  describe('Once the candidate accepts, the advisor confirms the booking as usual', () => {
    it('turns the offer into a held booking with a fresh ten minutes for the advisor', async () => {
      const ctx = await offeredToWanda();
      ctx.clock.advance(7 * MINUTE);

      const booking = await ctx.waitlist.acceptOffer(ctx.entry.id);

      expect(booking).toMatchObject({
        candidateName: 'Wanda Okafor',
        status: BookingStatus.HELD,
        expiresAt: new Date(ctx.clock.now().getTime() + 10 * MINUTE),
      });
      expect(await entryStatus(ctx, ctx.entry.id)).toBe(WaitlistStatus.ACCEPTED);

      ctx.clock.advance(9 * MINUTE);
      await expect(ctx.service.confirm(booking.id, 'sofia')).resolves.toMatchObject({
        status: BookingStatus.CONFIRMED,
      });
    });

    it('does not let the advisor confirm an offer the candidate has not accepted', async () => {
      const ctx = await offeredToWanda();
      const { bookingId } = (await ctx.waitlist.get(ctx.entry.id))!;
      await expect(ctx.service.confirm(bookingId!, 'sofia')).rejects.toMatchObject({ code: 'INVALID_STATE' });
    });

    it('frees the slot again if the advisor never confirms the accepted booking', async () => {
      const ctx = await offeredToWanda();
      await ctx.waitlist.acceptOffer(ctx.entry.id);
      ctx.clock.advance(10 * MINUTE);
      expect(await ctx.slotStarts('sofia', VisaType.B)).toEqual(['09:00']);
    });

    it('refuses accepting before there is an offer, accepting twice, and an unknown entry', async () => {
      const ctx = await sofiaFullForTypeB();
      const entry = await ctx.waitlist.join({ candidateName: 'Wanda', visaType: VisaType.B });
      await expect(ctx.waitlist.acceptOffer(entry.id)).rejects.toMatchObject({ code: 'INVALID_STATE' });

      ctx.clock.advance(10 * MINUTE);
      await ctx.waitlist.acceptOffer(entry.id);
      await expect(ctx.waitlist.acceptOffer(entry.id)).rejects.toMatchObject({ code: 'INVALID_STATE' });

      await expect(ctx.waitlist.acceptOffer('missing')).rejects.toMatchObject({ code: 'WAITLIST_ENTRY_NOT_FOUND' });
    });
  });

});
