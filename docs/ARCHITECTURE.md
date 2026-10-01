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
+-------------------------------------------------------------+
         |  input DTOs (zod schemas)        ^  output DTOs
         v                                  |
+-------------------------------------------------------------+
|  Services (business rules)           src/scheduling/services|
|                                                             |
|  AvailabilityService          BookingService                |
|    - builds bookable slots      - request (creates a hold)  |
|                                 - confirm                   |
|                                 - expire stale holds        |
|            \                      /                         |
|             v                    v                          |
|   domain: slot-calculator (pure function), booking rules    |
+-------------------------------------------------------------+
         |
         v
+-------------------------------------------------------------+
|  Repositories (async interfaces) src/scheduling/repositories|
|  AdvisorRepository            BookingRepository             |
+-------------------------------------------------------------+
         |
         v
+-------------------------------------------------------------+
|  In-memory implementations (singletons)                     |
|  advisors + windows  <-- data/seed.json, validated at boot  |
|  bookings            <-- Map, lives for the process         |
+-------------------------------------------------------------+

Singletons shared by all layers (src/common):
  Clock | AppConfig | Mutex        plus HoldSweeper (timer)
```

Production swap: only the bottom box changes (Postgres behind the same
interfaces). Nothing above the repository line knows where data lives.

## 2. Booking lifecycle

```
                  requestBooking
                        |
                        v
                   +--------+
                   |  HELD  |   expiresAt = now + 10 min
                   +--------+
                    /      \
   confirmBooking  /        \  10 min pass, no confirm
   (in time)      /          \
                 v            v
         +-----------+    +---------+
         | CONFIRMED |    | EXPIRED |
         +-----------+    +---------+
          slot removed     slot back in the pool
          permanently
```

HELD and CONFIRMED block the slot. EXPIRED does not.

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
|  1. compute free slots for this duration         |
|     (lapsed holds no longer count)               |
|  2. pick slot: requested one, else the earliest  |
|  3. none free? ---> SLOT_UNAVAILABLE             |
|                     or NO_SLOT_AVAILABLE         |
|  4. save booking as HELD                         |
+--------------------------------------------------+
        |
        v
  return booking (id, advisor, start, end, expiresAt)
```

The repositories are async, so a second request could otherwise slip in
between step 1 and step 4. The mutex queues requests so that cannot
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
  hold still live? --------------- no --> mark EXPIRED, HOLD_EXPIRED
        |
  status is HELD? ---------------- no --> INVALID_STATE
        |
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
  On every read / write       HoldSweeper (every 30s)
  a hold past expiresAt       marks stale holds EXPIRED
  is treated as expired       so stored status stays true
```

Correctness comes from the left side: it does not depend on the timer
firing. The sweeper only keeps stored data tidy, and is where a waitlist
offer would be triggered.
