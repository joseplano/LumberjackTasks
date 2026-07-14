import { describe, it, expect, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { errorHandler, ApiError } from '../../src/middleware/errors';

function mockRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe('errorHandler', () => {
  it('maps ApiError to its status and code', () => {
    const res = mockRes();
    errorHandler(new ApiError(404, 'NOT_FOUND', 'nope'), {} as any, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: { code: 'NOT_FOUND', message: 'nope' } });
  });

  it('maps Prisma P2002 unique violations to 409 CONFLICT', () => {
    const res = mockRes();
    const err = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: 'test',
    });
    errorHandler(err, {} as any, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('maps unknown errors to 500 INTERNAL', () => {
    const res = mockRes();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    errorHandler(new Error('boom'), {} as any, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(500);
    spy.mockRestore();
  });
});
