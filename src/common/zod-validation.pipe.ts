import { PipeTransform } from '@nestjs/common';
import { ZodType } from 'zod';
import { DomainError } from './errors';

/** Validates a GraphQL argument against a zod schema and returns the parsed DTO. */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new DomainError('BAD_USER_INPUT', 'Invalid input', {
        issues: result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }
    return result.data;
  }
}
