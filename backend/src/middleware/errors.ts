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
  // The second sentence exists because the first one has a floor. A batch of
  // ONE commit cannot be split further, so a single commit whose own `files`
  // array exceeds the limit would be permanently unsyncable if "send fewer
  // commits" were the only remedy offered. The escape hatch is already in the
  // design -- report fewer `files` and carry the difference in
  // `truncatedFileCount` (contract section 4 rule 6, FR-023/FR-017) -- so the
  // message names it rather than leaving the caller in a dead end. The
  // remainder is always REPORTED, never silently dropped (constitution
  // Principle IV). Keep this wording in step with
  // plugin/skills/ticket-sync/SKILL.md.
  if (isEntityTooLarge(err)) {
    res.status(413).json({
      error: {
        code: 'PAYLOAD_TOO_LARGE',
        message:
          'Request body is too large. Split the batch and send fewer commits per request (at most 50). ' +
          'If a single commit still exceeds the limit on its own, send fewer files for that commit ' +
          'and add the difference to its truncatedFileCount -- never drop the remainder silently.',
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
