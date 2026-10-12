import { fieldErrors } from '@flowsync/shared';
import type { z } from 'zod';
import { invalid } from './errors.js';

/** Parse untrusted input or throw a VALIDATION error with per-field messages. */
export function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const fields = fieldErrors(result.error);
    const first = Object.entries(fields)[0];
    throw invalid(first ? `${first[0]}: ${first[1]}` : 'Invalid input', fields);
  }
  return result.data;
}
