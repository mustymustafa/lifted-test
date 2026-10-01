import { Catch } from '@nestjs/common';
import { GqlExceptionFilter } from '@nestjs/graphql';
import { GraphQLError } from 'graphql';

export type ErrorCode =
  | 'BAD_USER_INPUT'
  | 'ADVISOR_NOT_FOUND'
  | 'BOOKING_NOT_FOUND'
  | 'FORBIDDEN'
  | 'NO_SLOT_AVAILABLE'
  | 'SLOT_UNAVAILABLE'
  | 'INVALID_STATE'
  | 'HOLD_EXPIRED'
  | 'WAITLIST_ENTRY_NOT_FOUND'
  | 'SLOTS_AVAILABLE'
  | 'OFFER_EXPIRED'
  | 'ACTIVE_REQUEST_EXISTS';

/** Business rule failure. Services throw this and know nothing about GraphQL. */
export class DomainError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    /** Extra machine-readable context, e.g. validation issues. */
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

/** Turns a DomainError into a GraphQL error with a stable `extensions.code`. */
@Catch(DomainError)
export class DomainErrorFilter implements GqlExceptionFilter {
  catch(error: DomainError): GraphQLError {
    return new GraphQLError(error.message, { extensions: { code: error.code, ...error.details } });
  }
}
