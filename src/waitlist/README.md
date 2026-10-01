# Waitlist

Candidates queue when nothing is bookable. Freed slots are offered to them,
oldest first, before anyone else can take them.

| File | What it holds |
|---|---|
| [waitlist.model.ts](waitlist.model.ts) | Waitlist entry shape and statuses |
| [waitlist.dto.ts](waitlist.dto.ts) | GraphQL inputs and outputs, each input next to its zod schema |
| [waitlist.service.ts](waitlist.service.ts) | join, accept an offer, leave, list |
| [settlement.service.ts](settlement.service.ts) | Releases lapsed holds and offers freed slots |
| [waitlist.resolver.ts](waitlist.resolver.ts) | GraphQL mutations and queries |
| [waitlist.repository.ts](waitlist.repository.ts) | Storage interface and in-memory class |

## Waitlist entry lifecycle

```
joinWaitlist(candidateName, visaType, advisorId?)
        |
        v
  candidate already has an active request? -- yes --> ACTIVE_REQUEST_EXISTS
        |                                             (see ../bookings)
        no
        v
  slot available right now? ---- yes --> SLOTS_AVAILABLE
        |                                (use requestBooking)
        no
        v
   +---------+   settle offers    +---------+   acceptOffer   +----------+
   | WAITING |------------------->| OFFERED |---------------->| ACCEPTED |
   +---------+   a freed slot     +---------+   (in 10 min)   +----------+
        |                           |     |                        |
        | leaveWaitlist             |     | 10 min, no answer      v
        |          leaveWaitlist    |     v                 booking is HELD,
        |          (decline)        |  +---------+          advisor confirms
        v                           |  | EXPIRED |          (see ../bookings)
   +-----------+ <------------------+  +---------+
   | CANCELLED |
   +-----------+

   EXPIRED or declined: out of the queue, and the slot goes to the next entry.
```

## Settle: the waitlist gets first refusal

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
