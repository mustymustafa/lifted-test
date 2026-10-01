# Architecture

Immigration Advisor Booking API: GraphQL, in-memory store, single process.

## 1. Layers

```
   curl / Postman
         |
         v
+-------------------------------------------------------------+
|  GraphQL layer (resolvers)            src/scheduling/graphql|
|  availableSlots | requestBooking | confirmBooking | bookings|
|  cancelBooking  | joinWaitlist   | acceptOffer    | waitlist|
+-------------------------------------------------------------+
         |  input DTOs (zod schemas)        ^  output DTOs
         v                                  |
+-------------------------------------------------------------+
|  Services (business rules)           src/scheduling/services|
|                                                             |
|  AvailabilityService          BookingService                |
|    - builds bookable slots      - request, confirm, cancel  |
|                                                             |
|  SettlementService            WaitlistService               |
|    - release lapsed holds       - join the queue            |
|    - offer freed slots          - accept an offer           |
|            \                      /                         |
|             v                    v                          |
|   domain: slot-calculator (pure function), booking rules    |
+-------------------------------------------------------------+
         |
         v
+-------------------------------------------------------------+
|  Repositories (async interfaces) src/scheduling/repositories|
|  AdvisorRepository   BookingRepository   WaitlistRepository |
+-------------------------------------------------------------+
         |
         v
+-------------------------------------------------------------+
|  In-memory implementations (singletons)                     |
|  advisors + windows  <-- data/seed.json, validated at boot  |
|  bookings, waitlist  <-- Maps, live for the process         |
+-------------------------------------------------------------+

Singletons shared by all layers (src/common):
  Clock | AppConfig | Mutex        plus HoldSweeper (timer)
```

Production swap: only the bottom box changes (Postgres behind the same
interfaces). Nothing above the repository line knows where data lives.

## 2. Booking lifecycle

```
  requestBooking                    settle (slot freed,
  (slot available)                  someone is waiting)
        |                                  |
        |                                  v
        |                            +---------+  10 min, no answer
        |                            | OFFERED |-------------------+
        |                            +---------+                   |
        |                 acceptOffer (candidate)                  |
        |                 fresh 10 min hold                        |
        v                                  |                       |
   +--------+ <----------------------------+                       |
   |  HELD  |------- 10 min, advisor does not confirm -------+     |
   +--------+                                                |     |
     |    \                                                  v     v
     |     \   cancelBooking                             +---------+
     |      +----------------------+                     | EXPIRED |
     | confirmBooking (advisor)    |                     +---------+
     v                             v
 +-----------+  cancelBooking  +-----------+
 | CONFIRMED |---------------->| CANCELLED |
 +-----------+                 +-----------+
```

OFFERED, HELD and CONFIRMED block the slot. EXPIRED and CANCELLED free it.

## 3. Request a booking

```
requestBooking(candidateName, visaType, slotStart?, advisorId?)
        |
        v
  validate input DTO (zod) ------ invalid --> BAD_USER_INPUT
        |
        v
  visaType -> duration + break
     A = 30 min call, 5 min break
     B = 60 min call, 10 min break
        |
        v
+--------------------------------------------------+
|  INSIDE THE MUTEX (one request at a time)        |
|                                                  |
|  1. settle: release lapsed holds, offer freed    |
|     slots to the waitlist (section 7)            |
|  2. compute free slots for this duration         |
|  3. pick slot: requested one, else the earliest  |
|  4. none free? ---> SLOT_UNAVAILABLE             |
|                     or NO_SLOT_AVAILABLE         |
|  5. save booking as HELD                         |
+--------------------------------------------------+
        |
        v
  return booking (id, advisor, start, end, expiresAt)
```

The repositories are async, so a second request could otherwise slip in
between step 2 and step 5. The mutex queues requests so that cannot
happen within one process. With several instances, a database constraint
has to take over this job (see README, "Taking it to production").

## 4. Confirm a booking

```
confirmBooking(bookingId, advisorId)
        |
        v
  booking exists? ---------------- no --> NOT_FOUND
        |
  belongs to this advisor? ------- no --> FORBIDDEN
        |
  hold lapsed? ------------------- yes -> HOLD_EXPIRED
        |
  status is HELD? ---------------- no --> INVALID_STATE
        |                                 (e.g. still OFFERED, or CANCELLED)
        |
        v
  status = CONFIRMED
```

## 5. How slots are calculated

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

## 6. Hold expiry

```
            +------------------------------+
            |  Clock (singleton)           |
            |  real time in the app        |
            |  fake time in tests          |
            +------------------------------+
                 |                  |
                 v                  v
  On every read                On every write, and on the
  a hold or offer past         HoldSweeper tick (every 5s):
  expiresAt no longer          settle() marks it EXPIRED and
  blocks its slot              offers the slot to the waitlist
```

No double booking and correct availability come from the left side and the
mutex; they do not depend on the timer firing. The timer only matters when
no requests are arriving: it makes sure waitlist offers still go out.

## 7. Settle: the waitlist gets first refusal

```
  requestBooking | confirmBooking | cancelBooking
  joinWaitlist   | acceptOffer    | sweeper (every 5s)
                        |
                        v
+----------------------------------------------------------+
|  MUTEX                                                   |
|                                                          |
|  1. lapsed HELD    -> EXPIRED      } remember which      |
|     lapsed OFFERED -> EXPIRED      } advisors were       |
|       (its waitlist entry -> EXPIRED, turn missed)       |
|     cancelled booking              } freed               |
|                                                          |
|  2. nothing freed? stop.                                 |
|                                                          |
|  3. WAITING entries for a freed advisor (or "any"),      |
|     oldest first:                                        |
|       slot fits their visa type?                         |
|         no  -> skip to the next entry                    |
|         yes -> booking OFFERED, expiresAt = now + 10 min |
|                entry   OFFERED                           |
|                                                          |
|  4. only now does the caller's own work run              |
|     (e.g. find a slot for a new request)                 |
+----------------------------------------------------------+
```

Without step 4's ordering there is a race: a hold lapses, a new request
arrives before the sweeper, and takes the slot ahead of someone who was
already waiting. Because every write settles first, inside the same lock,
whoever arrives first after the lapse hands the slot to the waitlist.

"Skip to the next entry" means the queue is never blocked: a freed 30 minute
gap goes to the first type A candidate even if a type B candidate is ahead.

## 8. Waitlist entry lifecycle

```
joinWaitlist(candidateName, visaType, advisorId?)
        |
        v
  slot available right now? ---- yes --> SLOTS_AVAILABLE
        |                                (use requestBooking)
        no
        v
   +---------+   settle offers    +---------+   acceptOffer   +----------+
   | WAITING |------------------->| OFFERED |---------------->| ACCEPTED |
   +---------+   a freed slot     +---------+   (in 10 min)   +----------+
                                       |                           |
                                       | 10 min, no answer         v
                                       v                    booking is HELD,
                                  +---------+               advisor confirms
                                  | EXPIRED |               as in section 4
                                  +---------+
                                  out of the queue;
                                  slot goes to the next entry
```
