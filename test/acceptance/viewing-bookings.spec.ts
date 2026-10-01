import { BookingStatus } from '../../src/bookings/booking.model';
import { VisaType } from '../../src/config/rules';
import { MINUTE } from '../support/fake-clock';
import { setup, t } from '../support/harness';

/** Three bookings: A has expired, B is confirmed, C is on hold. */
async function seeded() {
  const ctx = setup();
  const { service, clock } = ctx;
  const a = await service.request({ candidateName: 'A', visaType: VisaType.A, advisorId: 'sofia' }); // 09:00
  const b = await service.request({ candidateName: 'B', visaType: VisaType.B, advisorId: 'rajan' }); // 09:33
  await service.confirm(b.id, 'rajan');
  clock.advance(10 * MINUTE); // a expires
  const c = await service.request({ candidateName: 'C', visaType: VisaType.A, advisorId: 'sofia', slotStart: t('09:30') });
  return { ...ctx, a, b, c };
}

/**
 * Acceptance criteria: Viewing bookings.
 * The groups below are the criteria, word for word, from
 * docs/ACCEPTANCE_CRITERIA_AND_TEST_SCENARIOS.md.
 */
describe('Viewing bookings', () => {
  describe('All bookings can be listed, with their current status', () => {
    it('returns every booking in order of start time', async () => {
      const { service } = await seeded();
      const page = await service.list();
      expect(page.items.map((b) => b.candidateName)).toEqual(['A', 'C', 'B']);
      expect(page).toMatchObject({ totalCount: 3, nextCursor: undefined });
    });
  });

  describe('Expired bookings are included, shown as expired', () => {
    it('shows a hold that ran out as EXPIRED, alongside held and confirmed ones', async () => {
      const { service } = await seeded();
      const page = await service.list();
      expect(page.items.map((b) => [b.candidateName, b.status])).toEqual([
        ['A', BookingStatus.EXPIRED],
        ['C', BookingStatus.HELD],
        ['B', BookingStatus.CONFIRMED],
      ]);
    });
  });

  describe('(Stretch) Bookings can be filtered by status, advisor, visa type and date', () => {
    it('applies each filter, alone and combined', async () => {
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
  });

  describe('(Stretch) A long list can be fetched a page at a time', () => {
    it('returns a page, then the rest, with the total and no repeats', async () => {
      const { service } = await seeded();
      const first = await service.list({}, 2);
      expect(first.items.map((b) => b.candidateName)).toEqual(['A', 'C']);
      expect(first.totalCount).toBe(3);

      const second = await service.list({}, 2, first.nextCursor);
      expect(second.items.map((b) => b.candidateName)).toEqual(['B']);
      expect(second.nextCursor).toBeUndefined();
    });

    it('refuses a cursor it does not recognise', async () => {
      const { service } = await seeded();
      await expect(service.list({}, 2, 'nope')).rejects.toMatchObject({ code: 'BAD_USER_INPUT' });
    });
  });

  describe('(Stretch) A single booking can be looked up to check its status', () => {
    it('returns the booking with its current status, or nothing if it does not exist', async () => {
      const { service, clock } = setup();
      const held = await service.request({ candidateName: 'A', visaType: VisaType.A });
      expect((await service.get(held.id))?.status).toBe(BookingStatus.HELD);

      clock.advance(10 * MINUTE);
      expect((await service.get(held.id))?.status).toBe(BookingStatus.EXPIRED);
      expect(await service.get('missing')).toBeUndefined();
    });
  });
});
