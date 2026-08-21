import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

function isEntityTooLarge(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { type?: unknown }).type === 'entity.too.large'
  );
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ApiError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }
  // body-parser raises `entity.too.large` when a request body exceeds the global
  // express.json({ limit: '100kb' }) in app.ts. That limit is a denial-of-service
  // control and is deliberately NOT raised (constitution Principle III, research
  // R2); the agent chunks its sync instead. Without this mapping the condition
  // falls through to 500 INTERNAL / "Unexpected error", so a sync would fail
  // without saying why -- which FR-020 and constitution Principle IV forbid.
  // See specs/004-view-repo-git-tree/contracts/http-api.md section 4, rule 10.
  if (isEntityTooLarge(err)) {
    res.status(413).json({
      error: {
        code: 'PAYLOAD_TOO_LARGE',
        message:
          'Request body is too large. Split the batch and send fewer commits per request (at most 50).',
      },
    });
    return;
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    res.status(409).json({ error: { code: 'CONFLICT', message: 'Resource already exists' } });
    return;
  }
  console.error(err);
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Unexpected error' } });
}
