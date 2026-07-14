import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { ApiError } from './errors';

export interface AuthUser {
  sub: string;
  email: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    next(new ApiError(401, 'UNAUTHENTICATED', 'Missing bearer token'));
    return;
  }
  try {
    const payload = jwt.verify(header.slice(7), config.jwtSecret, { algorithms: ['HS256'] });
    if (typeof payload !== 'object' || payload === null || typeof payload.sub !== 'string') {
      next(new ApiError(401, 'UNAUTHENTICATED', 'Invalid token payload'));
      return;
    }
    req.user = { sub: payload.sub, email: String((payload as { email?: unknown }).email ?? '') };
    next();
  } catch {
    next(new ApiError(401, 'UNAUTHENTICATED', 'Invalid or expired token'));
  }
}
