import { Injectable } from '@nestjs/common';
import { Clock } from '../../common/clock';
import { DomainError } from '../../common/errors';
import { Advisor } from '../domain/advisor';
import { blockedRange, blocksAvailability } from '../domain/booking';
import { computeSlots } from '../domain/slot-calculator';
import { VISA_RULES, VisaType } from '../domain/visa-type';
import { AdvisorRepository } from '../repositories/advisor.repository';
import { BookingRepository } from '../repositories/booking.repository';

export interface Slot {
  advisor: Advisor;
  visaType: VisaType;
  start: Date;
  end: Date;
}

export interface SlotFilter {
  /** Omit to get slots for every visa type. */
  visaType?: VisaType;
  advisorId?: string;
  /** Only slots that start at or after this time. */
  from?: Date;
  /** Only slots that end at or before this time. */
  to?: Date;
}

@Injectable()
export class AvailabilityService {
  constructor(
    private readonly advisors: AdvisorRepository,
    private readonly bookings: BookingRepository,
    private readonly clock: Clock,
  ) {}

  /** Bookable slots, earliest first. Read-only: never changes stored data. */
  async findSlots(filter: SlotFilter = {}): Promise<Slot[]> {
    const advisors = await this.resolveAdvisors(filter.advisorId);
    const now = this.clock.now();
    const active = (await this.bookings.findAll()).filter((b) => blocksAvailability(b, now));
    const visaTypes = filter.visaType ? [filter.visaType] : Object.values(VisaType);

    const slots: Slot[] = [];
    for (const advisor of advisors) {
      const windows = advisor.windows.map((w) => ({ start: w.start.getTime(), end: w.end.getTime() }));
      const blocked = active.filter((b) => b.advisorId === advisor.id).map(blockedRange);
      for (const visaType of visaTypes) {
        const { durationMs, breakMs } = VISA_RULES[visaType];
        for (const s of computeSlots({ windows, blocked, durationMs, breakMs })) {
          slots.push({ advisor, visaType, start: new Date(s.start), end: new Date(s.end) });
        }
      }
    }

    return slots
      .filter((s) => (!filter.from || s.start >= filter.from) && (!filter.to || s.end <= filter.to))
      .sort(
        (a, b) =>
          a.start.getTime() - b.start.getTime() ||
          a.advisor.id.localeCompare(b.advisor.id) ||
          a.visaType.localeCompare(b.visaType),
      );
  }

  private async resolveAdvisors(advisorId?: string): Promise<Advisor[]> {
    if (!advisorId) return this.advisors.findAll();
    const advisor = await this.advisors.findById(advisorId);
    if (!advisor) throw new DomainError('ADVISOR_NOT_FOUND', `Advisor ${advisorId} does not exist`);
    return [advisor];
  }
}
