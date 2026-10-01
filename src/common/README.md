# Common

Small pieces every feature shares. Each is one instance per process,
provided through Nest's dependency injection.

| File | What it holds |
|---|---|
| [clock.ts](clock.ts) | The only source of "now". Tests swap in a fake clock |
| [mutex.ts](mutex.ts) | In-process lock for booking writes |
| [errors.ts](errors.ts) | `DomainError` and the filter that turns it into a GraphQL error |
| [zod-validation.pipe.ts](zod-validation.pipe.ts) | Runs a zod schema against a GraphQL argument |
| [dto-helpers.ts](dto-helpers.ts) | Shared zod building blocks and the `VisaType` GraphQL enum |

## The mutex

```
  request A ---+
  request B ---+--->  [ A ] -> [ B ] -> [ C ]   one at a time,
  request C ---+                                in arrival order
```

Each booking write is "check, then save". The lock stops a second request
running between the two. It only protects one process; with several
instances a database constraint has to do this job.

## From input to error

```
  GraphQL argument
        |
        v
  ZodValidationPipe ---- fails ----> DomainError(BAD_USER_INPUT, issues)
        |                                        |
        v                                        |
  service ------------- rule broken -> DomainError(code, message)
        |                                        |
        v                                        v
  result                              DomainErrorFilter
                                                 |
                                                 v
                              GraphQL error with extensions.code
```

Services throw `DomainError` and know nothing about GraphQL.
