# Architecture

Immigration Advisor Booking API: GraphQL, in-memory store, single process.

This page is the overview. The flows for each feature live next to the code:

| Folder | Diagrams |
|---|---|
| [src/advisors](../src/advisors/README.md) | Loading and validating the seed data |
| [src/availability](../src/availability/README.md) | From request to slots; how slots are calculated |
| [src/bookings](../src/bookings/README.md) | Booking lifecycle; request, confirm, cancel; hold expiry |
| [src/waitlist](../src/waitlist/README.md) | Waitlist entry lifecycle; settle and first refusal |
| [src/common](../src/common/README.md) | The mutex; from input to error |

Visa types, timings and limits are in [src/config/rules.ts](../src/config/rules.ts).

## Layers

```
   curl / Postman
         |
         v
+-------------------------------------------------------------+
|  GraphQL layer (resolvers)                    *.resolver.ts |
|  availableSlots | requestBooking | confirmBooking | bookings|
|  cancelBooking  | joinWaitlist   | acceptOffer    | waitlist|
+-------------------------------------------------------------+
         |  input DTOs (zod schemas)        ^  output DTOs
         v                                  |
+-------------------------------------------------------------+
|  Services (business rules)                     *.service.ts |
|                                                             |
|  AvailabilityService          BookingService                |
|    - builds bookable slots      - request, confirm, cancel  |
|                                                             |
|  SettlementService            WaitlistService               |
|    - release lapsed holds       - join the queue            |
|    - offer freed slots          - accept an offer           |
|            \                      /                         |
|             v                    v                          |
|   slot-calculator (pure function), *.model.ts rules         |
+-------------------------------------------------------------+
         |
         v
+-------------------------------------------------------------+
|  Repositories (async interfaces)            *.repository.ts |
|  AdvisorRepository   BookingRepository   WaitlistRepository |
+-------------------------------------------------------------+
         |
         v
+-------------------------------------------------------------+
|  In-memory implementations (singletons)                     |
|  advisors + windows  <-- data/seed.json, validated at boot  |
|  bookings, waitlist  <-- Maps, live for the process         |
+-------------------------------------------------------------+

Singletons shared by all layers (src/common, src/config):
  Clock | AppConfig | Mutex        plus HoldSweeper (timer)

Folders are per feature (advisors, availability, bookings, waitlist);
the layer is the file suffix. See "Project layout" in the README.
```

Production swap: only the bottom box changes (Postgres behind the same
interfaces). Nothing above the repository line knows where data lives.
