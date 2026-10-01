# Immigration Advisor Booking API

A GraphQL API for booking consultations with immigration advisors: list
bookable slots, hold one for a candidate, let the advisor confirm it within
10 minutes, list bookings, and run a waitlist that offers freed slots to
candidates in order.

Built with NestJS, GraphQL (Apollo) and zod. Data lives in memory.

For diagrams of how it fits together, start at
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Each feature folder has its own
README with the flows for that feature:
[advisors](src/advisors/README.md), [availability](src/availability/README.md),
[bookings](src/bookings/README.md), [waitlist](src/waitlist/README.md),
[common](src/common/README.md).

## How to run

Needs Node 20 or newer. No database, no Docker.

```bash
npm install
npm start
```

The API is at `http://localhost:3000/graphql`. Opening that URL in a browser
gives a GraphiQL playground with the schema docs.

**Seeding:** there is no seed step. [data/seed.json](data/seed.json) is read
and validated when the app boots. Restarting the app resets all bookings.

**Tests:**

```bash
npm test
```

The tests are organised around the acceptance criteria. See "How the tests
are organised" below.

**Manual test scenarios:** the acceptance criteria and twelve step-by-step
scenarios, for Postman or curl, are in
[docs/ACCEPTANCE_CRITERIA_AND_TEST_SCENARIOS.md](docs/ACCEPTANCE_CRITERIA_AND_TEST_SCENARIOS.md).

There is a matching Postman collection:
[postman/ia-booking-api.postman_collection.json](postman/ia-booking-api.postman_collection.json).
Import it into Postman, start the server with `npm run start:test` (see below),
and run it top to bottom, once. Each request's Body tab says what you can
change, and the checks follow what you type. Restart the server before running
it again.

**Testing without waiting 10 minutes:** the hold is 10 minutes, as the brief
asks. Nobody wants to wait that long to check that an unconfirmed booking is
released, so the hold length is a setting. For a test run, start the server
in test mode:

```bash
npm run start:test
```

That is `npm start` with two settings: a 15 second hold (`HOLD_MINUTES=0.25`,
a quarter of a minute) and a sweep every second. All the scenarios run on
that one server. Only the lengths change; the hold and expiry logic is the
same code either way.

**Environment variables** (all optional, see [.env.example](.env.example)):

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `HOLD_MINUTES` | `10` | How long a hold or waitlist offer lasts. Use `0.25` (15 seconds) for a test run, see above |
| `SWEEP_INTERVAL_SECONDS` | `5` | How often lapsed holds are released and offered to the waitlist. `0` turns the timer off |
| `SEED_PATH` | `data/seed.json` | Advisor availability file |

### Trying it with curl

List slots (all filters optional):

```bash
curl -s localhost:3000/graphql -H 'content-type: application/json' -d '{"query":"{ availableSlots(filter: {visaType: A, advisorId: \"ia-001\", from: \"2025-03-10T00:00:00Z\", to: \"2025-03-11T00:00:00Z\"}) { advisor { id name } visaType start end } }"}'
```

Request a booking. Leave out `slotStart` and `advisorId` to get the earliest
slot with any advisor:

```bash
curl -s localhost:3000/graphql -H 'content-type: application/json' -d '{"query":"mutation { requestBooking(input: {candidateName: \"Amina Yusuf\", visaType: B}) { id status start end expiresAt advisor { id name } } }"}'
```

Confirm it as the assigned advisor (paste the `id` from the previous call):

```bash
curl -s localhost:3000/graphql -H 'content-type: application/json' -d '{"query":"mutation { confirmBooking(input: {bookingId: \"PASTE_ID\", advisorId: \"ia-001\"}) { id status confirmedAt } }"}'
```

List bookings (filters: `status`, `advisorId`, `visaType`, `from`, `to`;
paging: `first`, `after`):

```bash
curl -s localhost:3000/graphql -H 'content-type: application/json' -d '{"query":"{ bookings(filter: {status: CONFIRMED}, first: 20) { totalCount nextCursor items { id candidateName visaType status start end advisor { name } } } }"}'
```

Fetch one booking, or cancel it:

```bash
curl -s localhost:3000/graphql -H 'content-type: application/json' -d '{"query":"{ booking(id: \"PASTE_ID\") { id status candidateName start end } }"}'
```

```bash
curl -s localhost:3000/graphql -H 'content-type: application/json' -d '{"query":"mutation { cancelBooking(input: {bookingId: \"PASTE_ID\"}) { id status cancelledAt } }"}'
```

**Waitlist.** Joining only works when nothing is bookable for that visa type
(otherwise you get `SLOTS_AVAILABLE`). The quickest way to see it by hand:
request type B bookings until you get `NO_SLOT_AVAILABLE` (17 with the seed
data), then:

```bash
curl -s localhost:3000/graphql -H 'content-type: application/json' -d '{"query":"mutation { joinWaitlist(input: {candidateName: \"Wanda Okafor\", visaType: B}) { id status joinedAt } }"}'
```

Cancel one of the bookings, then check the entry. It will be `OFFERED` with a
booking attached:

```bash
curl -s localhost:3000/graphql -H 'content-type: application/json' -d '{"query":"{ waitlistEntry(id: \"PASTE_ENTRY_ID\") { status offer { id status start end expiresAt advisor { id name } } } }"}'
```

The candidate accepts within 10 minutes. The booking becomes `HELD` and the
advisor confirms it with `confirmBooking` as usual:

```bash
curl -s localhost:3000/graphql -H 'content-type: application/json' -d '{"query":"mutation { acceptOffer(input: {waitlistEntryId: \"PASTE_ENTRY_ID\"}) { id status expiresAt } }"}'
```

Leave the waitlist, or decline an offer (the slot goes to the next candidate):

```bash
curl -s localhost:3000/graphql -H 'content-type: application/json' -d '{"query":"mutation { leaveWaitlist(input: {waitlistEntryId: \"PASTE_ENTRY_ID\"}) { id status } }"}'
```

See the whole queue:

```bash
curl -s localhost:3000/graphql -H 'content-type: application/json' -d '{"query":"{ waitlist { id candidateName visaType status joinedAt } }"}'
```

Errors come back with a stable `extensions.code`: `BAD_USER_INPUT`,
`ADVISOR_NOT_FOUND`, `BOOKING_NOT_FOUND`, `FORBIDDEN`, `NO_SLOT_AVAILABLE`,
`SLOT_UNAVAILABLE`, `INVALID_STATE`, `HOLD_EXPIRED`, `SLOTS_AVAILABLE`,
`WAITLIST_ENTRY_NOT_FOUND`, `OFFER_EXPIRED`, `ACTIVE_REQUEST_EXISTS`.

## What is built

| Requirement | Status |
|---|---|
| 1. Availability | Done. Stretch: filter by visa type, advisor and date range |
| 2. Create a booking request | Done. 10 minute hold; candidate can pick a slot or be assigned the earliest |
| 3. Booking confirmation | Done. Only the assigned advisor, only while the hold is live |
| 4. Bookings | Done. Stretch: filters, cursor pagination, fetch one by id |
| Stretch: advisor breaks | Done. 5 min after type A, 10 min after type B |
| Stretch: waitlist | Done. Join, automatic offer on expiry or cancellation, accept within 10 minutes |
| Extra: cancel a booking | Done. Needed for two reasons: it is one of the waitlist's triggers, and it is how a candidate frees themselves to make a new request |
| Extra: leave the waitlist or decline an offer | Done. The same "cancel" for a waitlist place |
| Extra: one active request per candidate | Done. See "An edge case I found while testing" |

## Project layout

One folder per feature. Each holds its model, storage, logic, API, DTOs and a
README with its flow diagrams, so following one feature means opening one
folder.

```
src/
  main.ts
  app.module.ts          wires every provider (see note below)
  config/
    config.ts            environment variables, validated with zod
    rules.ts             visa types, timings and limits: the one place to change them
  common/                clock, mutex, errors, validation pipe, shared DTO helpers
  advisors/              advisor model, repository, seed file schema
  availability/          slot calculator (pure), service, resolver, DTOs
  bookings/              model, repository, service, resolver, DTOs, hold sweeper
  waitlist/              model, repository, service, settlement, resolver, DTOs
test/
  acceptance/            one file per area of the acceptance criteria, named after them
  unit/                  edge cases for the slot arithmetic, seed file, config and lock
  e2e/                   the API over HTTP: schema, validation, error codes
  support/               fake clock, test harness
```

File suffixes carry the layer: `.model` (plain types and rules), `.repository`
(storage interface and in-memory class), `.service` (business logic),
`.resolver` (GraphQL), `.dto` (the GraphQL input class next to its zod schema).

There is one Nest module rather than one per folder. Bookings and the waitlist
depend on each other (a booking request settles the waitlist; the waitlist
creates bookings), so separate modules would need circular imports.

## Tech choices

- **NestJS.** Its dependency injection gives one shared instance of each
  service, repository, clock and config per process, and lets tests replace
  any of them. I wanted singletons without static `getInstance()` globals,
  which are hard to test.
- **GraphQL, code-first.** The domain has natural relationships (a booking
  has an advisor, a slot has an advisor) and the "make this fetch more useful"
  stretch goals are filters and field selection, which GraphQL gives cheaply.
  The schema is generated from the TypeScript classes, so it cannot drift.
- **zod for DTOs.** Every boundary is parsed by a zod schema: GraphQL inputs
  (the `*.dto.ts` file in each feature folder, e.g.
  [booking.dto.ts](src/bookings/booking.dto.ts)), the seed file
  ([seed.schema.ts](src/advisors/seed.schema.ts)) and environment
  variables ([config.ts](src/config/config.ts)). GraphQL checks types; zod
  checks rules (non-blank name, `from` before `to`, windows that do not
  overlap). Inside the boundary the code trusts its data.
- **In-memory store behind async repository interfaces.** The brief asks for
  something that runs locally with a simple setup step, so there is no
  database. The interfaces are async on purpose so a database can replace
  the in-memory classes without touching the services.
- **One file for the business rules**
  ([rules.ts](src/config/rules.ts)). Visa types, appointment
  lengths, breaks, the hold time and input limits are defined once there.
  The slot logic, config defaults and GraphQL schema descriptions all read
  from it, so changing a duration or adding a visa type is a one-file change.
- **Slot calculation as a pure function**
  ([slot-calculator.ts](src/availability/slot-calculator.ts)). No clock,
  no storage, just intervals in and slots out. It holds the trickiest logic,
  so it is the most heavily tested file.
- **Injected clock.** Nothing calls `new Date()` directly. Tests move a fake
  clock forward to check expiry at 9:59.999 and 10:00.000 without waiting.
- **Jest + supertest.** About 160 tests, about 99% line coverage. See "How the tests are organised".

### Decisions worth knowing about

- **No double booking.** Requesting a booking is "check the slot is free,
  then save". Because the repositories are async, two requests could
  interleave between the check and the save, so both steps run inside a small
  in-process [mutex](src/common/mutex.ts). Tests fire 20 to 25 parallel
  requests at one slot and assert exactly one wins.
- **A candidate can have one active request at a time.** See "An edge case
  I found while testing" below.
- **Hold expiry does not depend on a timer.** Whether a hold still blocks a
  slot is decided from its `expiresAt` and the clock on every read. If the
  background sweeper is late or off, availability is still correct.
- **The waitlist gets first refusal, without relying on the timer.** There is
  a race here: a hold lapses, a new request arrives before the sweeper runs,
  and takes the slot ahead of someone already waiting. To close it, every
  write first "settles" inside the mutex
  ([settlement.service.ts](src/waitlist/settlement.service.ts)):
  release lapsed holds, offer the freed time to the waitlist, and only then do
  its own work. The sweeper runs the same step every 5 seconds so offers still
  go out when no requests are arriving.
- **"First eligible" skips, it does not block.** A freed 30 minute gap goes
  to the first type A candidate even if a type B candidate joined earlier.
- **The settle step is scoped by advisor.** It only looks at waitlist entries
  that could use an advisor whose time was just freed (entries for that
  advisor, or for "any advisor"), rather than the whole queue. One queue with
  an optional advisor, not a queue per advisor: most candidates accept any
  advisor and would otherwise sit in every queue.
- **"The candidate has 10 minutes to confirm" is read as the candidate
  accepting the offer.** The brief has the advisor confirming everywhere else,
  so an accepted offer becomes a normal `HELD` booking and the advisor gets a
  fresh 10 minutes. A waitlisted candidate asked earlier and may have gone
  elsewhere, so booking them without asking seemed wrong. Cost: a slot can be
  blocked for up to 20 minutes before it is confirmed or released.
- **A missed offer removes the candidate from the queue.** They had their
  turn; the slot goes to the next eligible entry.
- **Joining the waitlist is its own mutation**, allowed only when nothing is
  bookable. That keeps `requestBooking` returning one type.
- **Breaks are part of the blocked time.** A booking blocks
  `[start, end + break)`. A new slot is only offered if its own break also
  fits before the next booking. The break may run past the end of a window;
  only the call has to fit inside it.
- **Breaks apply to held bookings too.** The brief says "after each confirmed
  booking". I apply it to holds as well, otherwise a hold that later gets
  confirmed could leave the advisor with no break.
- **Slots are sliced back to back** from the start of each free stretch. So a
  90 minute window gives type A slots at :00, :30 and :60, not every 5 or 15
  minutes. Simple and predictable, at the cost of fewer start times.
- **Windows are never merged.** Rajan has 09:00-09:30 and 09:33-11:30 on
  10 March. They stay separate, so no 60 minute slot spans the 3 minute gap
  and the second window's slots start at 09:33.
- **Short windows give nothing.** Sofia's 20 minute and Rajan's 25 minute
  windows are too short for any visa type.
- **Candidate picks or system assigns.** The brief says the candidate provides
  a name and visa type and that "the assigned IA" confirms, which reads as
  auto-assignment. So `slotStart` and `advisorId` are optional: omit them and
  you get the earliest slot (ties go to the lower advisor id).
- **Past slots are not hidden.** The seed data is from March 2025. Filtering
  out slots before "now" would return nothing, so I left that out.

## How the tests are organised

The tests are grouped by the acceptance criteria in
[docs/ACCEPTANCE_CRITERIA_AND_TEST_SCENARIOS.md](docs/ACCEPTANCE_CRITERIA_AND_TEST_SCENARIOS.md),
so you can read a criterion and find the tests that prove it.

- **`test/acceptance/`** has one file per area: availability, requesting a
  booking, confirming, viewing bookings, advisor breaks and the waitlist. Each
  `describe` is a criterion, in its own words, for example "While a slot is on
  hold, no other candidate can request or book it". The tests run the real
  services with a fake clock, so a hold expiring after ten minutes takes
  milliseconds. This is where the business rules are tested, including the
  boundaries (one millisecond before a hold expires, exactly at ten minutes)
  and requests arriving at the same moment.
- **`test/unit/`** covers what does not belong to one criterion: the slot
  arithmetic's edge cases, the seed file's validation, config, the lock and the
  constants.
- **`test/e2e/`** sends real requests to the running API. It does not repeat
  the business rules. It checks what only a real request can show: the GraphQL
  schema, input validation, error codes as a client sees them, nested fields,
  and parallel requests.
- **One criterion has a placeholder, not a test.** "The advisor receives the
  request to confirm" is only half built (see "Taking it to production"), so it
  is an `it.todo` that shows up in the test output.

**Do the tests catch bugs?** Coverage only shows that code ran. To check the
tests would notice a mistake, I broke the code on purpose in ten ways, one at
a time, and checked that tests failed each time: removing the advisor break,
letting any advisor confirm, switching off the one-request rule, expiring a hold
one tick late, serving the waitlist newest first, removing the lock, ignoring
the visa type or the advisor on a waitlist offer, never passing on a missed
offer, and letting confirmed slots reappear. Nine were caught straight away.
The tenth (a waitlist candidate who asked for one advisor being offered another)
was not, so I added a test for it. The check was done by hand, not wired into
the build.

## An edge case I found while testing

**What I found.** Testing by hand in Postman, I sent the same booking request
several times in a row. I expected the second one to be refused. Instead every
one succeeded, and each put a *different* slot on hold.

**Why it happened.** A booking request is only a name and a visa type, and
the API assigns the earliest free slot. Nothing connected one request to the
next, so the same candidate could keep asking and be handed slot after slot.
Left alone, one candidate could put the whole calendar on hold and lock
everyone else out, ten minutes at a time. None of the automated tests caught
it, because every test used a different candidate name for each request.

**The rule I added.** A candidate can have one active request at a time
([candidate-request.policy.ts](src/bookings/candidate-request.policy.ts)).

- A request is active while it is a booking that is offered, on hold or
  confirmed, or a place on the waitlist.
- A second `requestBooking` or `joinWaitlist` is refused with
  `ACTIVE_REQUEST_EXISTS`. The error says which request is in the way.
- The candidate can request again once the first one is **cancelled** or
  **rejected**. Rejected means the advisor did not confirm in time, so the
  hold expired; there is no separate reject action.
- The check runs inside the same lock as the booking itself, so sending the
  same request many times at once still gives exactly one booking.
- The limit is the constant `MAX_ACTIVE_REQUESTS_PER_CANDIDATE` in
  [rules.ts](src/config/rules.ts).

**Why this needs a cancel mutation.** If a candidate may only have one
request, they must be able to withdraw it, or one wrong booking would lock
them out for good. So the rule is a second reason for `cancelBooking` (the
first is that the brief names a cancelled booking as a waitlist trigger), and
the reason I added `leaveWaitlist`: a place on the waitlist counts as a
request too, and there was no way to give one up.

```
  requestBooking / joinWaitlist
        |
        v
  does this candidate already have an active request?
        |
   no   |   yes ---------------------> refused: ACTIVE_REQUEST_EXISTS
   |
   v
  request goes ahead  -->  active:  booking OFFERED / HELD / CONFIRMED
                                    or waitlist place WAITING
                                         |
            +----------------------------+----------------------------+
            |                            |                            |
     cancelBooking /             advisor does not                missed offer
     leaveWaitlist               confirm in time                 (10 minutes)
            |                            |                            |
            v                            v                            v
        CANCELLED                     EXPIRED                      EXPIRED
            |                            |                            |
            +----------------------------+----------------------------+
                                         |
                                         v
                         the candidate can request again
```

**How "the same candidate" is recognised.** By name, ignoring case and extra
spaces: "Amina Yusuf" and " amina  YUSUF " are the same person. The name is
the only identity the brief gives a candidate, and it is weak in both
directions. Two different people with the same name block each other. And
someone who wants to get round the rule only has to change the name they
type. So this closes the accidental case I hit, not a determined one.

**In production.** The rule would key on a logged-in candidate id rather
than a name, and be enforced by the database, with rate limiting at the
gateway for scripted abuse. See "Taking it to production".

## Challenges and trade-offs

- **Getting the break rule right** was the hardest part. Blocking time after
  an existing booking is easy; remembering that a *new* slot also needs its
  break before the *next* booking, including one in a following window, took
  a second pass and has its own tests.
- **The in-memory store is the biggest shortcut.** Bookings are lost on
  restart and the mutex only protects a single process. Run two instances and
  double booking is possible. This is fine for the brief and wrong for
  production.
- **One global lock.** Every write queues behind every other write. A lock
  per advisor would allow more throughput, but auto-assignment looks across
  advisors, so I kept it simple.
- **No authentication.** `confirmBooking` takes an `advisorId` and checks it
  matches the booking. Anyone can claim to be any advisor, cancel any booking,
  or accept an offer if they know the waitlist entry id.
- **A slot can look free for a few seconds and then be refused.**
  `availableSlots` is read-only, so right after a hold lapses it lists the
  slot; a booking attempt then settles the waitlist first and may return
  `SLOT_UNAVAILABLE`.
- **Waitlisted candidates are not notified.** They find their offer by
  polling `waitlistEntry`. Offers can be up to one sweep (5 seconds) late when
  the API is idle.
- **A candidate is recognised by name only.** The one-active-request rule
  matches on the name typed in. Two different people with the same name block
  each other, and someone can get round the rule by changing the name. There
  is no login to do better with.
- **A confirmed booking counts as active for ever.** Nothing marks an
  appointment as finished once its date has passed, so a candidate with a
  confirmed booking must cancel it before requesting another.
- **Cursor pagination is basic.** The cursor is a booking id and the list is
  filtered and sorted in memory on every call.
- **`advisor` on a booking is resolved one at a time.** Free in memory, an
  N+1 query against a database.

With more time, in order: a per-advisor lock, treating past appointments as
finished, and property-based tests for the slot calculator (generate
random windows and bookings, assert no slot ever overlaps a blocked range).

## Taking it to production

**Storage and correctness**

- Postgres behind the existing repository interfaces.
- Replace the mutex with a database rule so it holds across instances: an
  exclusion constraint on `(advisor_id, blocked_range)` for held and
  confirmed rows. The database then rejects an overlapping insert no matter
  which instance sent it. The service catches that error and returns
  `SLOT_UNAVAILABLE`, or tries the next slot when auto-assigning.
- Expire-and-offer in one transaction, reading waitlist rows with
  `SELECT ... FOR UPDATE SKIP LOCKED` so two workers never make an offer to
  the same candidate, and an index on `(status, advisor_id, joined_at)` so
  the lookup stays small.
- Confirm becomes one conditional update:
  `UPDATE ... SET status = 'CONFIRMED' WHERE id = $1 AND status = 'HELD' AND expires_at > now()`.
- Use database time instead of each instance's clock, to avoid clock skew.
- An idempotency key on `requestBooking`, so a client retry after a timeout
  does not create a second hold.

**Hold expiry and notifications**

Today the sweeper is a `setInterval` inside the app process
([hold-sweeper.ts](src/bookings/hold-sweeper.ts)). That does not
survive production: it runs once per instance, it is lost on a deploy or
crash, it scans every booking, and it is late by up to one interval.

I would schedule one delayed job per hold, and keep a slow sweep as a safety
net:

```
  requestBooking
        |
        v
+--------------------------------------------+
|  one DB transaction                        |
|    insert booking (HELD, expires_at)       |
|    insert outbox row "expire booking X"    |
+--------------------------------------------+
        |
        v
  outbox relay publishes to the queue
  with a 10 minute delay
        |
        v
+------------------+        +-----------------------------------+
|  Queue           |        |  Worker (any instance)            |
|  (SQS delay or   |------->|                                   |
|   BullMQ/Redis)  |        |  UPDATE bookings                  |
+------------------+        |    SET status = 'EXPIRED'         |
                            |    WHERE id = X                   |
                            |      AND status = 'HELD'          |
                            |      AND expires_at <= now()      |
                            |                                   |
                            |  0 rows changed -> do nothing     |
                            |  1 row changed  -> process        |
                            |                    waitlist       |
                            +-----------------------------------+

  Safety net: a scheduled job every minute runs the same UPDATE
  for any HELD row past expires_at, in case a message was lost.
```

- The conditional `UPDATE` makes the job safe to run twice. Queues deliver at
  least once; if the booking was confirmed meanwhile, or another worker got
  there first, zero rows change and nothing happens.
- The outbox row is written in the same transaction as the hold, so there is
  never a hold with no expiry scheduled, or a job for a hold that failed to
  save.
- Any instance can pick the job up, so a deploy or crash does not lose it.
- Reads still check `expires_at`, as they do today. Availability stays correct
  even if the queue is slow; the job only drives the side effects (stored
  status, waitlist offer, notification).

A simpler first step is to skip the queue and run only the scheduled sweep
(`pg_cron`, or a cron job guarded by a Postgres advisory lock so one instance
runs it). Less to operate, but side effects are up to a minute late. I would
start there and add the queue when the lateness matters.

- "The assigned IA receives the request" and telling a waitlisted candidate
  about their offer are not implemented. I would write an outbox row in the
  same transaction as the hold or offer and have a worker deliver it (email,
  push), so a notification is never lost or sent for a row that failed to
  save.

**Ingesting availability**

- The seed file stands in for an external feed. In production: a scheduled
  pull or a webhook, parsed by the same zod schema, upserted by
  `(advisor_id, start, end)` so replays are safe.
- Reject or quarantine a bad payload as a whole and alert, rather than
  half-applying it.
- Decide what happens when a window is withdrawn but already has a booking in
  it. I would keep the booking and flag it for a person to resolve.

**API**

- Authentication, with the advisor identity taken from the token rather than
  an argument. Candidates should only see their own bookings.
- With candidate identity from login, key the one-active-request rule on the
  candidate id instead of the name, and enforce it in the database with a
  unique partial index on `candidate_id` for active bookings, so it holds
  across instances.
- Rate limiting at the gateway, for the script that changes the name on every
  request.
- Query depth and cost limits, and introspection and the playground turned
  off.
- DataLoader for `Booking.advisor`.
- Hide past slots and require a bounded date range on `availableSlots`.

**Running it**

- Stateless containers behind a load balancer, at least two instances,
  health and readiness endpoints, graceful shutdown (already enabled).
- Structured logs with a request id, metrics for holds created, confirmed
  and expired, and an alert on the expiry job falling behind.
- CI running typecheck and tests on every pull request. Integration tests
  against a real Postgres, since the constraint is where correctness lives.

## How I used AI

<!-- TODO before submitting: check this matches how you actually worked, and add your own review notes. -->

I used Claude Code (Claude Opus) throughout.

- **Planning.** I start most work by having the AI draft an ASCII flow of the
  architecture, which became [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and
  the README in each feature folder. I
  used it to argue through the design before any code existed.
- **Decisions that were mine.** GraphQL, zod DTOs, singletons through DI. The
  first plan it proposed used Postgres in Docker; I pushed back because the
  brief asks for a simple local setup, and moved that to the production
  section instead.
- **Design back-and-forth.** For the waitlist I proposed per-advisor queues
  to cut the work per sweep and asked how a waitlisted candidate is protected
  from a new request racing for the same freed slot. That discussion produced
  the advisor-scoped settle step and the "every write settles first" rule.
- **What I delegated.** Scaffolding, the implementation, the test suite and a
  first draft of this README.
- **What the AI missed and I caught.** Its tests all passed, but none of them
  sent the same request twice as the same candidate. Testing by hand in
  Postman, I did, and found that one candidate could hold slot after slot. I
  then specified the fix: one active request per candidate, released only by
  a cancellation or an expiry. See "An edge case I found while testing".
- **How the output was checked.**
  - The expected slot counts in the end-to-end tests (44 type A, 17 type B)
    were counted by hand from the seed data before running the code.
  - The break-rule test cases were worked out on paper per case, including
    the Rajan 09:30 / 09:33 gap.
  - I checked the tests were worth having by breaking the code on purpose and
    seeing whether they failed. One bug got through, which is how I found a
    missing test. See "How the tests are organised".
  - Typecheck and the full test suite run clean, and each endpoint was
    exercised with curl against the running server.
  - I wrote acceptance criteria from the brief and ran step-by-step
    scenarios against the running API in Postman, which is how the edge case
    above was found.
