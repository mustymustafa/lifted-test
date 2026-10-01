# Bookings

Requesting, confirming and cancelling a booking, and how holds expire.

| File | What it holds |
|---|---|
| [booking.model.ts](booking.model.ts) | Booking shape, statuses, and the "does this still block the slot?" rule |
| [booking.dto.ts](booking.dto.ts) | GraphQL inputs and outputs, each input next to its zod schema |
| [booking.service.ts](booking.service.ts) | request, confirm, cancel, list |
| [candidate-request.policy.ts](candidate-request.policy.ts) | One active request per candidate |
| [booking.resolver.ts](booking.resolver.ts) | GraphQL mutations and queries |
| [booking.repository.ts](booking.repository.ts) | Storage interface and in-memory class |
| [hold-sweeper.ts](hold-sweeper.ts) | Background timer |

## Booking lifecycle

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

## Request a booking

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
|     slots to the waitlist (see ../waitlist)      |
|  2. candidate already has an active request?     |
|       yes ---> ACTIVE_REQUEST_EXISTS             |
|  3. compute free slots for this duration         |
|  4. pick slot: requested one, else the earliest  |
|  5. none free? ---> SLOT_UNAVAILABLE             |
|                     or NO_SLOT_AVAILABLE         |
|  6. save booking as HELD                         |
+--------------------------------------------------+
        |
        v
  return booking (id, advisor, start, end, expiresAt)
```

The repositories are async, so a second request could otherwise slip in
between step 2 and step 6. The mutex queues requests so that cannot
happen within one process. With several instances, a database constraint
has to take over this job (see README, "Taking it to production").

## One active request per candidate

An edge case found in manual testing: sending the same request repeatedly
used to put a different slot on hold each time.

```
  requestBooking / joinWaitlist   (candidate "Amina Yusuf")
        |
        v
  same candidate = same name, ignoring case and extra spaces
        |
        v
  any active request for them?
     a booking that is OFFERED, HELD or CONFIRMED
     or a place on the waitlist (WAITING)
        |
   no   |   yes
   |    +---------> ACTIVE_REQUEST_EXISTS
   v                (the error names the request in the way)
  carry on

  They can request again once that request is
  CANCELLED (cancelBooking, leaveWaitlist) or EXPIRED (nobody acted in time).
```

## Confirm a booking

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

## Cancel a booking

```
cancelBooking(bookingId)
        |
        v
+--------------------------------------------------+
|  INSIDE THE MUTEX                                |
|                                                  |
|  booking exists? --------- no --> NOT_FOUND      |
|        |                                         |
|  HELD or CONFIRMED? ------ no --> INVALID_STATE  |
|        |                                         |
|        v                                         |
|  status = CANCELLED                              |
|        |                                         |
|        v                                         |
|  settle: offer the freed time to the waitlist    |
|  (see ../waitlist)                               |
+--------------------------------------------------+
```

Cancelling does two jobs: it is one of the waitlist's triggers, and it is how
a candidate frees themselves to make a new request.

## Hold expiry

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
