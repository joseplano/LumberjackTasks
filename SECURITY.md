# Security Policy

## ⚠️ Known limitation: single-tenant, no data isolation

**Lumberjack Tasks is designed to run locally for a single user or a small, trusted team.**
Once a user is authenticated, there is **no per-user authorization**: every authenticated
account can read, modify and delete **all** projects, tickets, columns, labels, phases and
reports of **every** account. There is no concept of resource ownership or roles.

**Do not expose this stack to an untrusted network or the public internet as a multi-user
service.** Run it on `localhost` (the default `docker-compose` setup) or behind an
authenticated reverse proxy that you control. Multi-tenant isolation is tracked as planned
work and is not implemented yet.

## Hardening built in

- **JWT secret is mandatory and never hard-coded.** In production the backend refuses to start
  without a strong `JWT_SECRET` (≥ 32 chars, not a known placeholder). Generate one with
  `openssl rand -hex 32`. Outside production a random per-run secret is used if none is set.
- **Security headers** via `helmet`, and `X-Powered-By` is disabled.
- **Rate limiting** on the authentication endpoints to slow brute-force / credential stuffing.
- **CORS** defaults to `http://localhost:3000`; set `CORS_ORIGIN` (comma-separated) to allow
  other origins explicitly.
- **Passwords** are hashed with bcrypt and must be at least 8 characters.
- **The MCP server binds to `127.0.0.1` by default.** It has no authentication of its own and
  acts on the backend with the bot's credentials, so it must never be exposed to an untrusted
  network. Override the bind host with `MCP_HOST` only behind an authenticated proxy.

## Reporting a vulnerability

If you find a security issue, please **do not open a public issue**. Instead, report it
privately through GitHub's ["Report a vulnerability"](../../security/advisories/new) flow, or
by email to the maintainer. Include steps to reproduce and the potential impact. We aim to
acknowledge reports within a few days.
