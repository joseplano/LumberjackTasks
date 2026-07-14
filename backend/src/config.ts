import 'dotenv/config';
import { randomBytes } from 'node:crypto';

const WEAK_SECRETS = ['dev-secret-change-me', 'change-me-in-production', 'test-secret'];
const MIN_SECRET_LENGTH = 32;

function isStrongSecret(secret: string | undefined): secret is string {
  return !!secret && !WEAK_SECRETS.includes(secret) && secret.length >= MIN_SECRET_LENGTH;
}

/**
 * Resolves the JWT signing secret.
 *
 * There is deliberately NO hard-coded fallback secret: a published default would let anyone
 * who reads this repository forge tokens for any user. In production a strong secret is
 * mandatory. Outside production, if none (or a known-weak placeholder) is supplied we mint a
 * random per-process secret so the app still boots for local development — tokens simply do
 * not survive a restart, which is fine for dev and, being unguessable, is not a vulnerability.
 */
function resolveJwtSecret(): string {
  const provided = process.env.JWT_SECRET;
  const isProduction = process.env.NODE_ENV === 'production';

  if (isProduction) {
    if (!isStrongSecret(provided)) {
      throw new Error(
        'JWT_SECRET must be set to a strong value (>= 32 chars, not a known placeholder) ' +
          'in production. Generate one with: openssl rand -hex 32',
      );
    }
    return provided;
  }

  if (isStrongSecret(provided)) return provided;

  if (provided) {
    console.warn(
      '[config] JWT_SECRET is missing or weak; using a random ephemeral secret for this run. ' +
        'Tokens will not survive a restart. Set a strong JWT_SECRET (openssl rand -hex 32) to persist sessions.',
    );
  }
  return randomBytes(32).toString('hex');
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  jwtSecret: resolveJwtSecret(),
  corsOrigin: process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim())
    : ['http://localhost:3000'],
};
