# Availability

Works out which slots can be booked right now.

| File | What it holds |
|---|---|
| [slot-calculator.ts](slot-calculator.ts) | Pure function: windows and blocked ranges in, slots out. No clock, no storage |
| [availability.service.ts](availability.service.ts) | Loads advisors and live bookings, calls the calculator, applies filters |
| [availability.dto.ts](availability.dto.ts) | Slot output, filter input and its zod schema |
| [availability.resolver.ts](availability.resolver.ts) | `availableSlots` query |

## From request to slots

```
availableSlots(filter: visaType?, advisorId?, from?, to?)
        |
        v
  validate filter (zod) --------- invalid --> BAD_USER_INPUT
        |
        v
  advisors (one, or all) -------- unknown --> ADVISOR_NOT_FOUND
        |
        v
  bookings that still block:  CONFIRMED, or HELD / OFFERED and not lapsed
        |
        v
  for each advisor, for each visa type:
     slot-calculator(windows, blocked ranges, duration, break)
        |
        v
  keep slots inside from / to, sort earliest first
```

Read-only: this never changes stored data.

## How slots are calculated

```
Sofia, 10 March, window 09:00 - 10:50, one Type B booking at 09:00

09:00            10:00  10:10                    10:50
  |================|======|------------------------|
  |  Type B call   | break|       free 40 min      |
  |================|======|------------------------|
   <---- blocked range --->

Free 40 min, sliced back to back from its start:
  Type A (30 min):  10:10 - 10:40      -> 1 slot
  Type B (60 min):  does not fit       -> 0 slots
```

Rules:

1. Start from each advisor window in the seed data.
2. Subtract every blocked range: `[start, end + break)` for each HELD or
   CONFIRMED booking.
3. Slice what is left into back-to-back slots of the visa duration.
4. Drop any remainder shorter than the duration.
5. Drop a slot if the break after it would run into an existing booking.

Windows are never merged. Rajan's 09:00-09:30 and 09:33-11:30 stay two
separate windows, so no slot spans the 3 minute gap.
