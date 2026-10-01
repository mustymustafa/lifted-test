# Advisors

Advisors and their availability windows. The seed file stands in for an
external feed.

| File | What it holds |
|---|---|
| [advisor.model.ts](advisor.model.ts) | Advisor and availability window shapes |
| [seed.schema.ts](seed.schema.ts) | zod schema for the incoming file: the ingestion DTO |
| [advisor.repository.ts](advisor.repository.ts) | Storage interface and in-memory class |
| [advisor.dto.ts](advisor.dto.ts) | GraphQL output |

## Loading the seed data

```
  app boots
      |
      v
  read data/seed.json  (path from SEED_PATH)
      |
      v
+--------------------------------------------------+
|  seed.schema.ts (zod)                            |
|                                                  |
|  dates are ISO 8601?                             |
|  each window ends after it starts?               |
|  windows for one advisor do not overlap?         |
|  advisor ids are unique?                         |
|                                                  |
|  then: strings -> Date, windows sorted by start  |
+--------------------------------------------------+
      |                         |
     valid                   invalid
      |                         |
      v                         v
  InMemoryAdvisorRepository   app refuses to start
  (singleton)                 (fails at boot, not mid-request)
```

Everything past this point trusts the shape, the dates and the ordering.

In production this becomes a scheduled pull or a webhook, parsed by the same
schema and upserted so replays are safe. See "Ingesting availability" in the
[README](../../README.md).
