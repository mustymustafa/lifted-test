# Acceptance criteria and test scenarios

# Part 1: Acceptance criteria

## Availability

- A candidate can see all the slots they can book.
- Slots come from each advisor's availability windows.
- A slot is only shown if the whole appointment fits inside one window.
- A slot that is on hold is not shown.
- A slot that is confirmed is not shown.
- When a hold expires, the slot is shown again.
- (Stretch) Slots can be filtered by visa type, advisor and date.

## Requesting a booking

- A candidate can request a booking by giving their name and visa type.
- A Skilled Worker (type A) appointment is 30 minutes.
- A Family / Dependent (type B) appointment is 60 minutes.
- The slot is put on hold for 10 minutes as soon as the request is made.
- While a slot is on hold, no other candidate can request or book it.
- If two candidates ask for the same slot at the same time, only one gets it.
- The booking is assigned to an advisor, who receives the request to confirm.
- If the advisor does not confirm within 10 minutes, the slot is released
  automatically.
- A request without a name, or with an unknown visa type, is refused.
- If no slot is available, the candidate is told so.

## Confirming a booking

- The assigned advisor can confirm a booking that is on hold.
- The advisor must confirm within 10 minutes of the request.
- Once confirmed, the slot is permanently removed from availability.
- A booking cannot be confirmed after its hold has expired.
- Only the advisor the booking is assigned to can confirm it.
- A booking cannot be confirmed twice.

## Viewing bookings

- All bookings can be listed, with their current status.
- Expired bookings are included, shown as expired.
- (Stretch) Bookings can be filtered by status, advisor, visa type and date.
- (Stretch) A long list can be fetched a page at a time.
- (Stretch) A single booking can be looked up to check its status.

## Waitlist (stretch)

- If no slot is available, a candidate can join a waitlist instead of being
  turned away.
- When a hold expires, the freed slot is offered to the waitlist automatically.
- When a confirmed booking is cancelled, the freed slot is offered to the
  waitlist automatically.
- The slot is offered to the candidate who has waited longest and whose visa
  type fits the slot.
- The offered candidate has 10 minutes to accept.
- While a slot is on offer, nobody else can book it.
- If the candidate does not accept in time, the slot is offered to the next
  person on the waitlist.
- Once the candidate accepts, the advisor confirms the booking as usual.

## Advisor breaks (stretch)

- An advisor gets a 5 minute break after a type A appointment.
- An advisor gets a 10 minute break after a type B appointment.
- No slot is offered that would start during an advisor's break.
- No slot is offered that would leave the advisor without a break before
  their next appointment.
- One advisor's bookings do not affect another advisor's slots.

---

# Part 2: Test scenarios

## Setup

- Every request is `POST http://localhost:3000/graphql`.
- Bookings are kept in memory. Restart the server to start clean.
- Run the scenarios in order. Later ones reuse bookings from earlier ones.
- Advisors: Sofia Andersson is `ia-001`, Rajan Patel is `ia-002`.
- All dates are in March 2025, times in UTC.

Scenarios 1 to 8 use a normal server:

```bash
npm start
```

Scenarios 9 and 10 test expiry. Restart the server with 15 second holds so
you do not have to wait 10 minutes:

```bash
HOLD_MINUTES=0.25 SWEEP_INTERVAL_SECONDS=1 npm start
```

## Scenario 1: A candidate views available slots

1. Ask for available slots for visa type A.
   - 44 slots come back. The first is with Sofia on 10 March, 09:00 to 09:30.
2. Ask for available slots for visa type B.
   - 17 slots come back, each 60 minutes long.
3. Ask for Rajan's type A slots on 10 March.
   - They start at 09:00, 09:33, 10:03 and 10:33. His two windows that
     morning are kept separate.
4. Ask for Sofia's slots on 11 March.
   - None. Her window that day is only 20 minutes.

## Scenario 2: A candidate books and the advisor confirms

1. Request a booking for "Amina Yusuf", visa type B.
   - The booking is on hold with Sofia, 10 March, 09:00 to 10:00.
   - The hold ends 10 minutes after it was made.
2. Ask for Sofia's slots on 10 March.
   - The 09:00 slot is gone. The only slot left is type A at 10:10.
3. Confirm the booking as Sofia.
   - The booking is confirmed.
4. Look up the booking.
   - It shows as confirmed.
5. Ask for Sofia's slots on 10 March again.
   - The 09:00 slot is still gone.

## Scenario 3: Two candidates want the same slot

1. Request a type A booking for "First Candidate" with Rajan on 11 March at
   14:00.
   - The booking is on hold, 14:00 to 14:30.
2. Request the same slot for "Second Candidate".
   - Refused: the slot is not available.
3. Send ten requests at the same moment for Rajan on 12 March at 09:00.
   - Exactly one gets the slot. The other nine are refused.

## Scenario 4: Requests that should be refused

1. Request a booking with a blank name.
   - Refused: the name is required.
2. Request a booking with visa type C.
   - Refused: not a valid visa type.
3. Request a booking with Sofia on 12 March at 10:10, which is not one of
   her slot times.
   - Refused: the slot is not available.
4. Confirm First Candidate's booking (from scenario 3) as Sofia. It is
   assigned to Rajan.
   - Refused: only the assigned advisor can confirm.
5. Confirm a booking that does not exist.
   - Refused: booking not found.
6. Confirm Amina's booking (from scenario 2) a second time.
   - Refused: it is already confirmed.

## Scenario 5: The advisor gets a break between appointments

1. Request a type A booking with Rajan on 13 March at 09:00.
   - The booking is on hold, 09:00 to 09:30.
2. Ask for Rajan's type A slots on 13 March.
   - The next slot starts at 09:35, not 09:30.
3. Ask for Sofia's type A slots on 13 March.
   - 09:00 and 09:30 are both there. Rajan's booking does not affect her.

The 10 minute break after a type B appointment is shown in scenario 2,
step 2: Amina's appointment ends at 10:00 and the next slot is 10:10.

## Scenario 6: Viewing bookings

1. List all bookings.
   - Four bookings, in order of start time, each with a status and an advisor.
2. List only confirmed bookings.
   - Just Amina Yusuf's.
3. List only Rajan's bookings.
   - Three bookings.
4. List bookings two at a time.
   - The first page has two bookings and says there are more.
   - The second page has the other two and says there are no more.

## Scenario 7: A confirmed booking is cancelled

1. Cancel Amina's booking.
   - The booking is cancelled.
2. Ask for Sofia's type B slots on 10 March.
   - 09:00 can be booked again.
3. Cancel the same booking again.
   - Refused: it is already cancelled.

## Scenario 8: A waitlisted candidate gets a cancelled slot

1. Try to join the waitlist for type B with Sofia.
   - Refused: slots are still available, so book one instead.
2. Request type B bookings with Sofia until none are left.
   - Eight bookings are made, then the next is refused. The first of the
     eight is 10 March at 09:00.
3. Join the waitlist as "Wanda Okafor" for type B with Sofia.
   - Wanda is on the waitlist, waiting.
4. Cancel the 10 March 09:00 booking.
   - The booking is cancelled.
5. Look up Wanda's waitlist entry.
   - She has been offered the 10 March 09:00 slot with Sofia.
6. Request a type B booking with Sofia as "Walk In".
   - Refused: nothing is available. The slot is reserved for Wanda.
7. Confirm Wanda's offer as Sofia, before Wanda has accepted.
   - Refused: the candidate has not accepted yet.
8. Accept the offer as Wanda.
   - The booking is now on hold for the advisor to confirm.
9. Confirm the booking as Sofia.
   - The booking is confirmed.
10. View the waitlist.
    - Wanda's entry shows as accepted.

## Scenario 9: The advisor does not confirm in time

Restart the server with 15 second holds first.

1. Request a type A booking with Sofia on 10 March at 09:00.
   - The booking is on hold. The hold ends 15 seconds after it was made.
2. Ask for Sofia's type A slots on 10 March straight away.
   - 09:00 is not offered.
3. Wait about 17 seconds, then look up the booking.
   - It shows as expired. Nobody had to do anything.
4. Ask for Sofia's type A slots on 10 March.
   - 09:00 is offered again.
5. Confirm the booking as Sofia.
   - Refused: the hold has expired.
6. Request the same slot for "Next Candidate".
   - The booking is on hold. Someone else can take the released slot.

## Scenario 10: A waitlisted candidate misses their offer

Steps 1 to 3 need to be done within 15 seconds.

1. Request type B bookings with Rajan until none are left. Confirm every one
   as Rajan except the first.
   - Nine bookings are made. One is still on hold, eight are confirmed.
2. Join the waitlist as "First In Queue" for type B with Rajan.
   - Waiting.
3. Join the waitlist as "Second In Queue" for type B with Rajan.
   - Waiting.
4. Wait about 17 seconds, then look up First In Queue.
   - The unconfirmed hold has expired and its slot has been offered to them.
5. Look up Second In Queue straight away.
   - Still waiting.
6. Wait about 17 seconds, then look up Second In Queue.
   - First In Queue did not answer, so the slot has been offered to them
     instead.
7. Accept the offer as First In Queue.
   - Refused: the offer has expired.
8. Accept the offer as Second In Queue.
   - The booking is on hold for the advisor to confirm.
9. Confirm the booking as Rajan.
   - The booking is confirmed.
10. View the waitlist.
    - First In Queue shows as expired. Second In Queue shows as accepted.
