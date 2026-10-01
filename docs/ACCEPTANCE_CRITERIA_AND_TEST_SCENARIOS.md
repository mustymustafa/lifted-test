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
- A candidate can only have one active request at a time. A request is
  active while it is a booking that is on hold, offered or confirmed, or a
  place on the waitlist.
- A second request from the same candidate is refused, and they are told
  which request is in the way.
- A candidate can request again once their earlier request is cancelled, or
  is rejected because the advisor did not confirm in time.
- A candidate can cancel their booking.

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
- A candidate cannot join the waitlist twice, or while they have a booking.
- A candidate can leave the waitlist, or decline an offer. A declined slot is
  offered to the next person on the waitlist.

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
- Visa types: `A` is Skilled Worker (30 minutes), `B` is Family / Dependent
  (60 minutes).
- All dates are in March 2025 (10 to 21 March), times in UTC.
- The same steps are in a Postman collection:
  [postman/ia-booking-api.postman_collection.json](../postman/ia-booking-api.postman_collection.json).
- Give each booking a different candidate name. A candidate can only have one
  active request, so reusing a name is refused.

The scenarios do not fix the candidate, visa type, advisor or slot. Choose
your own; each step says what the result should be for whatever you chose.

The hold is 10 minutes by default. Nobody wants to wait that long to test
that a booking is released, so start the server in test mode:

```bash
npm run start:test
```

Test mode is the same app with a 15 second hold. The rules are otherwise the
same. A hold or a waitlist offer now lasts 15 seconds, so:

- When a step follows a booking request, do it within 15 seconds.
- Where a step says "wait", give it about 17 seconds.

## Scenario 1: A candidate views available slots

This scenario is for exploring. Change the filter values to whatever you
like; the result should always match what you asked for. The counts below are
for a freshly started server.

1. Ask for all available slots, with no filter.
   - Slots come back for both visa types, earliest first. There are 61.
2. Filter by visa type: `A` or `B`.
   - Only slots for that visa type come back: 44 for A, 17 for B.
   - Type A slots are 30 minutes long, type B slots are 60.
3. Filter by advisor: `ia-001` or `ia-002`.
   - Only that advisor's slots come back.
   - Worth a look: Rajan on 10 March has slots at 09:00 and then 09:33. His
     two windows that morning are kept separate.
4. Filter by date: a day, or a longer period.
   - Only slots that start and end inside that period come back.
5. Combine filters: visa type, advisor and date together.
   - Only slots matching all of them come back.
   - Worth a look: type A with Sofia on 11 March returns nothing. Her window
     that day is only 20 minutes.

## Scenario 2: A candidate books and the advisor confirms

1. Request a booking with a candidate name and a visa type of your choice.
   - The booking is on hold, with the earliest free slot and an assigned
     advisor.
   - The appointment is 30 minutes for type A, 60 for type B.
   - The hold lasts 15 seconds (10 minutes on a normal server).
2. Ask for that advisor's slots on the day of the booking.
   - Nothing is offered during the appointment or the break after it.
3. Confirm the booking as the assigned advisor.
   - The booking is confirmed.
4. Look up the booking.
   - It shows as confirmed.
5. Ask for that advisor's slots on that day again.
   - The time is still not offered.

## Scenario 3: Two candidates want the same slot

1. Request a booking for one particular free slot (advisor and start time).
   - The booking is on hold, with that advisor at that time.
2. Request the same slot for a different candidate.
   - Refused: the slot is not available.
3. Send several requests for another free slot at the same moment, each for a
   different candidate. Ten is a good number.
   - Exactly one gets the slot. All the others are refused.

## Scenario 4: Requests that should be refused

1. Request a booking with a blank name.
   - Refused: the name is required.
2. Request a booking with a visa type other than A or B.
   - Refused: not a valid visa type.
3. Request a booking at a time inside an advisor's hours that is not one of
   the start times on offer, for example seven minutes after a real slot.
   - Refused: the slot is not available.
4. Confirm the first booking from scenario 3 as the other advisor, not the
   one it was assigned to.
   - Refused: only the assigned advisor can confirm.
5. Confirm a booking that does not exist.
   - Refused: booking not found.
6. Confirm the booking from scenario 2 a second time.
   - Refused: it is already confirmed.

## Scenario 5: The advisor gets a break between appointments

1. Request a booking with a visa type of your choice.
   - The booking is on hold.
2. Ask for that advisor's slots that day, for the same visa type.
   - Nothing starts during the appointment or the break after it: 5 minutes
     after a type A appointment, 10 after a type B.
   - The next slot starts no earlier than the end of the break.
3. Ask for the other advisor's slots.
   - Every slot they offered before the booking is still offered.

## Scenario 6: Viewing bookings

Change the filter values to whatever you like; the result should match.

1. List all bookings.
   - Every booking comes back, in order of start time, each with a status and
     an advisor. Expired and cancelled bookings are included.
2. Filter by status: offered, held, confirmed, expired or cancelled.
   - Only bookings with that status come back.
3. Filter by advisor.
   - Only that advisor's bookings come back.
4. Combine filters: status, advisor, visa type and dates.
   - Only bookings matching all of them come back.
5. Ask for a page of bookings, two at a time.
   - Two bookings come back, with the total count, and it says whether there
     are more.
6. Ask for the next page.
   - The next bookings come back, none repeated from the page before.

## Scenario 7: A confirmed booking is cancelled

1. Cancel the booking from scenario 2.
   - The booking is cancelled.
2. Ask for that advisor's slots that day, for the same visa type.
   - The time can be booked again.
3. Cancel the same booking again.
   - Refused: it is already cancelled.

## Scenario 8: A waitlisted candidate gets a cancelled slot

Choose one visa type and one advisor for this scenario.

1. Try to join the waitlist for that visa type and advisor.
   - Refused: slots are still available, so book one instead.
2. Request bookings for that visa type and advisor until none are left.
   Confirm each one.
   - Every booking is made and confirmed, then the next is refused.
3. Join the waitlist as a new candidate.
   - They are on the waitlist, waiting.
4. Cancel the first of the bookings from step 2.
   - The booking is cancelled.
5. Look up the candidate's waitlist entry.
   - They have been offered the slot that was just freed. They have 15
     seconds to accept, so do steps 6 to 8 promptly.
6. Request a booking for the same visa type and advisor as another candidate.
   - Refused: nothing is available. The slot is reserved.
7. Confirm the offered booking as the advisor, before the candidate accepts.
   - Refused: the candidate has not accepted yet.
8. Accept the offer as the candidate.
   - The booking is now on hold for the advisor to confirm.
9. Confirm the booking as the advisor.
   - The booking is confirmed.
10. View the waitlist.
    - The candidate's entry shows as accepted.

## Scenario 9: The advisor does not confirm in time

1. Request a booking.
   - The booking is on hold.
2. Ask for that advisor's slots that day straight away.
   - The booked time is not offered.
3. Wait about 17 seconds, then look up the booking.
   - It shows as expired. Nobody had to do anything.
4. Ask for that advisor's slots that day.
   - The time is offered again.
5. Confirm the booking as the assigned advisor.
   - Refused: the hold has expired.
6. Request the released time for a different candidate.
   - The booking is on hold. Someone else can take the released slot.
7. Confirm that booking as the advisor.
   - The booking is confirmed.

## Scenario 10: A waitlisted candidate misses their offer

Choose one visa type and one advisor. Steps 1 to 3 need to be done within 15
seconds.

1. Request bookings for that visa type and advisor until none are left.
   Confirm every one except the first.
   - One booking is still on hold; the rest are confirmed.
2. Join the waitlist as one candidate.
   - Waiting.
3. Join the waitlist as a second candidate.
   - Waiting.
4. Wait about 17 seconds, then look up the first candidate.
   - The unconfirmed hold has expired and its slot has been offered to them.
5. Look up the second candidate straight away.
   - Still waiting.
6. Wait about 17 seconds, then look up the second candidate.
   - The first candidate did not answer, so the slot has been offered to the
     second instead.
7. Accept the offer as the first candidate.
   - Refused: the offer has expired.
8. Accept the offer as the second candidate.
   - The booking is on hold for the advisor to confirm.
9. Confirm the booking as the advisor.
   - The booking is confirmed.
10. View the waitlist.
    - The first candidate shows as expired, the second as accepted.

## Scenario 11: A candidate tries to request more than once

This is an edge case found during manual testing. Sending the same request
repeatedly used to put a new slot on hold each time.

1. Request a booking for a candidate of your choice.
   - The booking is on hold.
2. Send exactly the same request again, as many times as you like.
   - Refused every time: the candidate already has an active request. The
     error names the booking that is in the way.
3. Request again with the same name in different case and spacing, for
   example " DANA   REYES ".
   - Refused: it is the same candidate.
4. Try to join the waitlist as the same candidate.
   - Refused: they already have an active request.
5. Cancel the candidate's booking.
   - The booking is cancelled.
6. Request a booking for the same candidate again.
   - The booking is on hold. A cancelled request no longer counts.
7. Wait about 17 seconds without confirming, then look up the booking.
   - It shows as expired.
8. Request a booking for the same candidate again.
   - The booking is on hold. An expired request no longer counts.
9. Confirm the booking as the assigned advisor.
   - The booking is confirmed.
10. Request a booking for the same candidate once more.
    - Refused: a confirmed booking still counts.

## Scenario 12: A candidate leaves the waitlist

Uses the visa type and advisor from scenario 8, which have no free slots.

1. Join the waitlist as a new candidate.
   - Waiting.
2. Leave the waitlist as that candidate.
   - Their entry is cancelled.
3. Leave the waitlist again.
   - Refused: they have already left.
4. Request a booking for the same candidate, for a visa type that still has
   slots.
   - The booking is on hold. Leaving the waitlist freed them to request.
