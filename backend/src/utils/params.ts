import { ApiError } from '../middleware/errors';

export function asOptionalInt(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n)) {
    throw new ApiError(400, 'VALIDATION', `${field} must be an integer`);
  }
  return n;
}

export function asOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new ApiError(400, 'VALIDATION', `${field} must be a string`);
  return value;
}

export function asOptionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') throw new ApiError(400, 'VALIDATION', `${field} must be a boolean`);
  return value;
}

export function asStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    throw new ApiError(400, 'VALIDATION', `${field} must be an array of strings`);
  }
  return value;
}
