# Immigration Advisor Booking API

A GraphQL API for booking consultations with immigration advisors. A candidate
asks for an appointment, the slot is held for 10 minutes while the advisor
confirms, and a waitlist offers freed slots to whoever is waiting.

All four requirements and both stretch goals (waitlist, advisor breaks) are
built. Beyond the brief: cancelling a booking, leaving the waitlist, and a rule
that a candidate can have one active request at a time.

Built with NestJS, GraphQL (Apollo) and zod. Data lives in memory.

- Architecture and flow diagrams: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md),
  with a README per feature folder
  ([advisors](src/advisors/README.md), [availability](src/availability/README.md),
  [bookings](src/bookings/README.md), [waitlist](src/waitlist/README.md),
  [common](src/common/README.md)).
- Acceptance criteria and test scenarios:
  [docs/ACCEPTANCE_CRITERIA_AND_TEST_SCENARIOS.md](docs/ACCEPTANCE_CRITERIA_AND_TEST_SCENARIOS.md).
- Postman collection:
  [postman/ia-booking-api.postman_collection.json](postman/ia-booking-api.postman_collection.json).

## How to run

Needs Node 20 or newer. No database, no Docker.

```bash
npm install
npm start
```

The API is at `http://localhost:3000/graphql`. Opening it in a browser gives a
GraphiQL playground with the schema docs.

**Seeding:** there is no seed step. [data/seed.json](data/seed.json) is read
and validated when the app boots. Restarting the app resets all bookings. How a
real availability feed would be ingested is in the
[advisors README](src/advisors/README.md).

**Environment variables** (all optional, see [.env.example](.env.example)):

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `HOLD_MINUTES` | `10` | How long a hold or waitlist offer lasts |
| `SWEEP_INTERVAL_SECONDS` | `5` | How often lapsed holds are released and offered to the waitlist. `0` turns the timer off |
| `SEED_PATH` | `data/seed.json` | Advisor availability file |

**Tests:**

```bash
npm test
```

**Trying it by hand, with Postman.** Import
[postman/ia-booking-api.postman_collection.json](postman/ia-booking-api.postman_collection.json)
into Postman, start the server in test mode, and run the collection:

```bash
npm run start:test
```

Test mode shortens the hold from 10 minutes to 15 seconds, so you can watch a
hold expire without waiting. Run the collection top to bottom, once; restart
the server before running it again, because the bookings it makes stay in
memory.

The collection is laid out so you can follow it without reading anything else:

```
IA Booking API: test scenarios
  Scenario 1: A candidate views available slots        <- one folder per scenario, in order,
    1.1 All available slots                               the same 12 as in the scenarios doc
    1.2 Filter by visa type                            <- one request per step, numbered
    ...
  Scenario 2: A candidate books and the advisor confirms
    2.1 Request a booking
    2.2 The held slot is no longer offered
    ...
  Scenario 11: A candidate tries to request more than once
  Scenario 12: A candidate leaves the waitlist
```

- **The Body tab tells you what you can change.** Comments above each value
  list the options: visa types, advisor ids, date formats, statuses. Change
  them and press Send.
- **The Tests tab checks the result against what you sent.** Pick type B and
  it checks for a 60 minute appointment; pick Rajan and it checks every slot is
  his. The test names say what was checked in plain words.
- **Steps hand values to each other.** Confirm uses the booking id from the
  request before it, shown as `{{bookingId}}`, so you never copy and paste.
- **Waiting is done for you.** Steps that need a hold or an offer to run out
  poll until it has, instead of asking you to count seconds.
- **Scenario 1 and 6 are for exploring**: filters you can play with, no data
  changed. Scenario 11 is the edge case found while testing.

The same steps are written out in
[docs/ACCEPTANCE_CRITERIA_AND_TEST_SCENARIOS.md](docs/ACCEPTANCE_CRITERIA_AND_TEST_SCENARIOS.md),
for curl or for reading.

### Trying it with curl

List bookable slots (all filters optional):

```bash
curl -s localhost:3000/graphql -H 'content-type: application/json' -d '{"query":"{ availableSlots(filter: {visaType: A, advisorId: \"ia-001\"}) { advisor { name } visaType start end } }"}'
```

Request a booking. Leave out `slotStart` and `advisorId` to get the earliest
slot with any advisor:

```bash
curl -s localhost:3000/graphql -H 'content-type: application/json' -d '{"query":"mutation { requestBooking(input: {candidateName: \"Amina Yusuf\", visaType: B}) { id status start end expiresAt advisor { id name } } }"}'
```

Confirm it as the assigned advisor (paste the `id` from above):

```bash
curl -s localhost:3000/graphql -H 'content-type: application/json' -d '{"query":"mutation { confirmBooking(input: {bookingId: \"PASTE_ID\", advisorId: \"ia-001\"}) { id status confirmedAt } }"}'
```

All operations: queries `availableSlots`, `bookings`, `booking`, `waitlist`,
`waitlistEntry`; mutations `requestBooking`, `confirmBooking`, `cancelBooking`,
`joinWaitlist`, `acceptOffer`, `leaveWaitlist`. Errors carry a message and a
stable `extensions.code` (`SLOT_UNAVAILABLE`, `HOLD_EXPIRED`,
`ACTIVE_REQUEST_EXISTS`, and so on).

## Tech choices

- **NestJS.** Its dependency injection gives one shared instance of each
  service, repository, clock and config per process, and lets tests swap any
  of them. Singletons without static `getInstance()` globals.
- **GraphQL, code-first.** A booking has an advisor, a slot has an advisor,
  and the "make this fetch more useful" stretch goals are filters and field
  selection, which GraphQL gives cheaply. The schema is generated from the
  TypeScript classes, so it cannot drift.
- **zod for DTOs.** Every boundary is parsed by a zod schema: GraphQL inputs
  (the `*.dto.ts` file in each feature folder), the seed file
  ([seed.schema.ts](src/advisors/seed.schema.ts)) and environment variables
  ([config.ts](src/config/config.ts)). GraphQL checks types; zod checks rules.
  Inside the boundary the code trusts its data.
- **In-memory store behind repository interfaces shaped as queries.** The
  brief asks for a simple local setup, so there is no database. The interfaces
  are async, and their methods are the questions the services ask (active
  bookings for one advisor, holds expired before now, waiting candidates for
  these advisors) rather than "load everything". In memory they are plain
  filters; a Postgres implementation answers each with an indexed query, and
  the services do not change.
- **Business rules in one file** ([rules.ts](src/config/rules.ts)): visa
  types, durations, breaks, hold time, limits. Changing a duration or adding a
  visa type is a one-file change.
- **Slot calculation as a pure function**
  ([slot-calculator.ts](src/availability/slot-calculator.ts)), and an
  **injected clock** so tests move time forward instead of waiting.
- **One folder per feature, each with its own README of flows.** This was my
  decision, made as feedback part-way through: the first layout was a
  catch-all folder split by technical layer (`domain/`, `services/`,
  `graphql/`), with one long architecture document. I asked for
  `advisors/`, `availability/`, `bookings/` and `waitlist/`, with the layer
  carried by the file suffix (`.model`, `.repository`, `.service`,
  `.resolver`, `.dto`), and for the diagrams to be split into a README per
  folder. Following one feature then means opening one folder and reading one
  page of flows. That is easier for a developer joining the project, and
  easier for an LLM to work in: it can load one small module and its README
  instead of the whole codebase.
- **Tests grouped by the acceptance criteria.** `test/acceptance/` has one
  file per area, and each `describe` is a criterion in its own words, so you
  can read a criterion and find the tests that prove it. `test/unit/` covers
  the slot arithmetic and plumbing; `test/e2e/` sends real requests and checks
  only what a real request shows (schema, validation, error codes, parallel
  requests). About 165 tests, 99% line coverage. To check they would notice a
  mistake, I broke the code on purpose in ten ways; nine were caught, and the
  tenth became a new test.

### Assumptions where the brief was open

- The candidate can pick a slot, or leave it out and be assigned the earliest.
- A waitlist offer is accepted by the candidate, then the advisor confirms as
  usual. The brief's "the candidate has 10 minutes to confirm" read that way.
- Breaks apply after held bookings too, not only confirmed ones; otherwise two
  back-to-back holds could both be confirmed with no break between.
- Slots are sliced back to back from the start of each free stretch, and two
  windows are never merged (Rajan's 09:00-09:30 and 09:33-11:30 stay separate).
- A missed waitlist offer passes to the next candidate; the one who missed it
  leaves the queue.
- Past slots are not hidden, because the seed data is from March 2025.

## What was hard

- **Two candidates pressing "book" at the same moment.** A booking is two
  steps, check then save, and the server works on several requests at once.
  Two requests can both check before either saves:

  ```
  Amina   [check 09:00 free?] yes ...... [save 09:00]
  Bola         [check 09:00 free?] yes ...... [save 09:00]   -> one slot, two bookings
  ```

  The fix is a lock ([mutex.ts](src/common/mutex.ts)): booking writes go
  through one at a time, like one till at a shop, so the second check runs
  after the first save and sees the truth:

  ```
              +--- lock: one at a time -----+
  Amina  -->  | check 09:00? free -> save   |  -> HELD
  Bola   -->  | wait ... check 09:00? TAKEN |  -> refused
              +-----------------------------+
  ```

  Tests fire 25 requests at one slot and assert exactly one wins. The lock
  only covers one server process; two servers would have two doors. The fix
  for that is a database constraint: see "With more time".

- **Keeping the waitlist fair without relying on a timer.** A hold expires,
  and a new request arriving before the background sweep would see the slot as
  free and jump the queue:

  ```
  10:00:00  Amina's hold on 09:00 runs out
  10:00:01  walk-in asks for 09:00 -> looks free -> takes it, ahead of Wanda
  10:00:05  sweep runs: nothing left to offer Wanda
  ```

  Solved: every write first releases expired holds and makes any waitlist
  offers, inside the same lock, before doing its own work
  ([settlement.service.ts](src/waitlist/settlement.service.ts)):

  ```
  10:00:01  walk-in's request:  1. settle -> 09:00 offered to Wanda
                                2. look for a slot -> 09:00 TAKEN -> refused
  ```

  A test races 20 walk-ins against the sweep and checks Wanda wins. What is
  left is cosmetic: `availableSlots` is read-only, so for a few seconds it can
  list a just-freed slot that a booking attempt then refuses.

- **The bug the tests did not catch: hard to find, not hard to fix.** Every
  test passed at 99% coverage. Testing by hand in Postman, I sent the same
  request twice and got a second slot:

  ```
  before   request(Amina, A) -> HELD 09:00
           request(Amina, A) -> HELD 09:35
           request(Amina, A) -> HELD 10:10   ... one person holds the calendar

  now      request(Amina, A) -> HELD 09:00
           request(Amina, A) -> refused: ACTIVE_REQUEST_EXISTS (names the booking)
           cancel, or let it expire -> Amina can request again
  ```

  A candidate has one active request: a booking that is offered, on hold or
  confirmed, or a place on the waitlist
  ([candidate-request.policy.ts](src/bookings/candidate-request.policy.ts)).
  The fix is about fifty lines; the work was deciding it. A first attempt that
  limited requests by IP address was dropped because it limited the symptom,
  not the cause. Then: what counts as active, what releases it (cancel or
  expiry), and the knock-on that a candidate with one request must be able to
  withdraw it, which is why `cancelBooking` and `leaveWaitlist` exist. Candidates are matched by
  name, ignoring case and spacing, which is weak: two people with the same
  name block each other, and a changed name gets round it. There is no login
  to do better with.

- **The break rule.** Three things that each look right on their own:

  ```
  window 09:00 ------------------------------ 10:50
  existing appointment 09:30-10:00 (type A, so a 5 minute break after it)

  1. the break after it     10:00 --break--> 10:05, so the next slot starts 10:05    easy
  2. a NEW slot before it   09:00-09:30 plus its own break runs to 09:35, which
                            overlaps the 09:30 appointment, so 09:00 is NOT offered   easy to miss
  3. across a window gap    Rajan's second window opens 09:33, but after a 09:00-09:30
                            appointment his break runs to 09:35, so his next slot is 09:35
  ```

  Point 2 is the one that is easy to miss: the check is "slot plus its break
  must not touch any booking", not only "booking plus its break blocks time".
  Each has its own test.

## Corners I cut

Most of these have their fix drawn under "With more time". Authentication is
not there on purpose: for a booking tool at this stage it would come after
the database, the expiry job and time zones.

- **No database.** Bookings live in memory, so setup is `npm install` and
  `npm start`. The cost is bigger than "lost on restart": a second instance
  cannot see the first one's bookings, so running two is not slower, it is
  impossible. Everything about scale starts there. The guarantee that matters
  most in production, a database constraint that refuses an overlapping
  booking, is described but not built or tested; the tests prove the rules
  against the in-memory store, not against Postgres.
- **Expiry runs on a timer inside the process.** A `setInterval` every 5
  seconds releases expired holds and makes waitlist offers. It runs once per
  instance, dies with it, and scans every booking each tick. Availability does
  not depend on it: a hold stops blocking the moment it expires, on every read.
- **Everything is in UTC.** No time zone on an advisor, nothing handles the
  clocks changing. The seed ends before the UK change on 30 March 2025, so it
  does not show here.
- **No authentication.** `confirmBooking` takes an `advisorId` and checks it
  matches the booking, but anyone can pass any id, cancel any booking, or
  accept any offer. Candidates are matched by name for the same reason.
- **The advisor polls, and cannot decline.** They fetch their requests with
  `bookings(filter: {advisorId, status: HELD})`; email or push is a separate
  system. Their only actions are to confirm or let the hold expire.
- **A confirmed booking counts as active for ever.** Nothing marks an
  appointment as finished, so a candidate must cancel before requesting again.
- **One lock, and every request scans every booking.** Writes, and reads that
  settle expired holds first, queue behind each other; only `availableSlots`
  skips the lock. Fine for two advisors and two weeks of slots.

## With more time

In order of what I would do first.

1. **A real database, and tests that run against it.** The lock becomes a
   database rule, so it holds across instances, and the integration tests
   prove it there rather than against memory.

   ```
   today                               with more time

   +--------+                          +--------+   +--------+
   | server |-- lock --> memory        | server |   | server |
   +--------+                          +----+---+   +---+----+
   one process, one door                    |           |
                                             v           v
                                        +----------------------------+
                                        | Postgres                   |
                                        | EXCLUDE (advisor_id,       |
                                        |          blocked_range)    |
                                        | refuses the second overlap |
                                        +----------------------------+
                                        integration tests run here
   ```

2. **A job for expiry, not a timer.** One delayed job per hold, saved in the
   same transaction as the hold, picked up by any instance. The sweep stays as
   a safety net that runs once a minute.

   ```
   today    every 5s, in every instance:   scan all bookings -> expire -> offer

   with     hold saved --> job "expire X at 10:10" --> any worker, run once
            (Agenda, BullMQ, pg-boss)       cron each minute catches anything missed
   ```

3. **Time zones on advisors.** Windows are stored in UTC and stay there when
   the clocks change, so an advisor's "09:00" would drift by an hour.

   ```
   today    window 09:00Z   -> after the clocks change, that is 10:00 for the advisor

   with     advisor { zone: "Europe/London" }, windows in local time,
            converted to UTC at the edges, so 09:00 stays 09:00
   ```

4. **An advisor decline, and finished appointments.** Two missing states.

   ```
   HELD --confirm--> CONFIRMED --date passes--> COMPLETED  (frees the candidate)
     \
      --decline--> REJECTED  (frees the slot, offers it to the waitlist)
   ```

## Taking it to production

Bookings live in the process's memory at the moment, so every server restart loses
all of them. The first change is durable storage. Once bookings are in a
database, running more than one instance becomes possible, and the lock has to
move into the database with them.

```
                    candidates / advisors
                             |
                     load balancer  (health check: GET /health)
                             |
                    one or more instances                   each one stateless, so a
                    NestJS API                              restart or a second copy is safe
                             |
                 Postgres (primary + standby)               one set of bookings;
                 EXCLUDE (advisor_id, blocked_range)        the lock becomes this constraint

  hold saved + job "expire X at 10:10", one transaction --> worker at 10:10: expire, offer to waitlist
  job every minute --------------------------------------> safety-net sweep
  logs with a request id, four metrics, one alarm on the expiry queue falling behind
```

What changes, in order:

1. **Bookings in Postgres, so they survive a restart.** The in-memory lock
   becomes an exclusion constraint on `(advisor_id, blocked_range)` for
   offered, held and confirmed rows: the database refuses the second
   overlapping booking, whether it came from the same instance or another
   one, and the service maps that to `SLOT_UNAVAILABLE`. Confirm becomes `UPDATE ... WHERE id = $1 AND status =
   'HELD' AND expires_at > now()`. The repositories are already shaped as the
   queries this needs (see Tech choices); they gain indexes on
   `(advisor_id, status)`, `(expires_at)` and `(status, advisor_id, joined_at)`.
2. **Expiry as a delayed job, not a timer in the process.** The
   `setInterval` dies with the process and scans every booking each tick.
   Instead, saving a hold also saves a job, "expire booking X at 10:10", in
   the same transaction. **pg-boss** does this with Postgres tables, so there
   is no new infrastructure and no relay: if the booking fails to save, so
   does the job. A worker runs the expiry and the waitlist offer at 10:10,
   and a pg-boss cron job every minute runs the same sweep as a safety net.
   The managed alternative is **SQS** with a per-message delay, but SQS caps
   the delay at 15 minutes: fine for a 10 minute hold, not for anything
   longer, and it needs an outbox table and a relay to keep the job and the
   booking in one transaction.
3. **Retries and duplicates.** Clients retry after a timeout, and job queues
   run a job at least once. An idempotency key on `requestBooking`,
   stored with the booking, so a retry returns the same hold. Every job is a
   conditional `UPDATE`, so running it twice does nothing the second time.
4. **What breaks first as it grows.** Reads dominate: people browse slots far
   more than they book, and `availableSlots` recomputes every slot for every
   advisor on every call. The fix is a cheap query, not a cache: a bounded
   date range (default the next 14 days), the indexed "bookings blocking this
   advisor in this range" lookup, and slots computed per advisor per day. I
   would not cache availability yet. A cache can show a slot that was taken a
   moment ago, and the point of this API is that what it shows can be booked.
   If it is ever needed, two rules: delete the advisor's cache entry on every
   write, and never consult the cache when booking, so the worst case is a
   "just taken" message, never a double booking. `Booking.advisor` is
   resolved one row at a time; DataLoader batches it.
5. **Before real users.** Authentication through the existing identity
   provider, with advisor and candidate ids taken from the token, which
   replaces matching candidates by name. Rate limits at the edge. GraphQL
   depth and cost limits. Playground and introspection off. Secrets in a
   secrets store, not environment files.
6. **Operating it.** Each of these answers a question that gets asked at
   2am. `GET /health`, so the load balancer stops sending traffic to an
   instance that cannot serve, and a deploy waits for the new one to say yes.
   Logs with a request id, so "my booking vanished" can be followed through
   the API and the worker as one request. Four metrics, which are the funnel
   of what we built:

   ```
   requested --> held --> confirmed
                   \---> expired --> offered to waitlist --> accepted

   expired up, confirmed down    advisors are not confirming (or not being told)
   holds expire, offers stop     the expiry worker is down
   ```

   One alarm, not ten: the expiry queue's oldest job older than the hold
   length means the worker is not keeping up, which is the failure that
   silently breaks the product (holds never release, the waitlist never gets
   offers). CI runs typecheck, the tests, and the integration tests against a
   real Postgres before anything deploys, because the constraint is where
   correctness lives and tests against memory never touch it.

On AWS that is containers on ECS and Postgres on RDS; elsewhere the same parts
with different names. How the availability feed would be ingested is in the
[advisors README](src/advisors/README.md).

## How I used AI

I used Claude Code throughout, in the same four steps I use for all my work, using 3 skills i created (`/refine-agent` `/test-agent`, `/build-from-ascii-plan` )
The split: I own the plan, the decisions and the review; the AI owns writing
the code, generating the test scenarios and drafting the documentation.

```
 1. /refine-agent                 2. /test-agent                  3. /build-from-ascii-plan     4. manual review
 me:  architecture,         AI:  acceptance criteria  AI:  code from the plan,      me:  read the code,
      decisions, edge            from the plan, test       unit tests written to         run the scenarios
      cases, blast radius        scenarios from the        the scenarios, Postman        by hand, give
 AI:  an ASCII plan per          ACs                       collection from both          feedback
      section, a README     me:  review them for      me:  wait                     AI:  apply it, one
      per module                 structure and use                                        commit per change
```

- **Refine is where most of the time goes.** I talk through the architecture
  and the decisions, and Claude turns each section into an ASCII plan. ASCII
  because everyone can follow a flow by looking at it, instead of reading
  paragraphs of generated text. I give it my exact solution, and we go
  through edge cases and blast radius before anything is built. Each
  service folder gets its own README with its flows: small modules with their
  own docs are easier for a person to follow, and easier for an LLM to work
  in without reading the whole codebase.
- **Test generates the acceptance criteria** from the refined plan when the
  ticket has none, then test scenarios from the ACs. The unit tests are later
  written against those scenarios, so they follow the ACs rather than being
  whatever the AI thought of. I review the scenarios for structure and
  usefulness.
- **Build from the ASCII plan** is where the AI is left alone: the code from
  the plan, the unit tests from the scenarios, and the Postman collection from
  the ACs and scenarios.
- **Manual review and testing I do not leave to the AI.** A person has to
  check that the logic and behaviour match the plan and the decisions from
  step one. That is how the double-booking-by-one-candidate bug was found:
  every generated test passed, but sending the same request twice in Postman
  gave me a second slot. I give feedback, and the AI makes the change and
  commits each piece of feedback separately, which is why the git history
  reads as a conversation.

What that looked like on this task: the stack, the in-memory store instead
of Postgres in Docker, and the waitlist design (scoping the sweep by advisor,
the "every write settles first" rule) came out of refine. The folder
structure was my feedback too: the first layout was split by technical layer
with one long architecture document, and I asked for one folder per feature
with its own README of flows (see Tech choices for why). The ACs, scenarios
and Postman collection came out of test and build, and I asked for the
scenarios to be reworked when the first version read as randomly generated rather than
useful.