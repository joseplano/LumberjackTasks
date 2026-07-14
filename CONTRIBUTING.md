# Contributing to Lumberjack Tasks

Thanks for your interest in improving Lumberjack Tasks! This project is open to issues and
pull requests.

## Getting started

1. Fork and clone the repository.
2. Bring up the stack: `docker compose up -d` (see the [README](README.md) for details).
3. Install dependencies per package (`backend/`, `frontend/`, `mcp/`) with `npm install`.

## Development workflow

- Create a topic branch off `main`.
- Follow the existing code style; the codebase is TypeScript throughout.
- **Add or update tests** for any behavior you change. Security-relevant fixes must ship with a
  regression test that fails without the fix.
- Run the full test suite before opening a PR:

  ```bash
  cd backend && npm test          # backend (integration + unit)
  cd mcp && npm test              # MCP server
  cd frontend && npm test         # frontend
  node --test plugin/tests/*.test.mjs   # plugin hooks + token script
  ```

- Keep pull requests focused and describe the motivation and the change.

## Editing the plugin

Before touching anything under `plugin/`, read the "Cómo está armado el plugin, y las cuatro
trampas" section of [docs/ticket-sync.md](docs/ticket-sync.md). Some plugin manifest mistakes
break the plugin **silently**.

## Reporting bugs and security issues

- **Bugs / features:** open a GitHub issue with clear reproduction steps.
- **Security vulnerabilities:** do **not** open a public issue — follow
  [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contributions will be licensed under the
[MIT License](LICENSE).
