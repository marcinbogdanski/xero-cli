# Development Notes

Last updated: 2026-02-20

## Purpose
This project is a thin CLI wrapper around official `xero-node`, focused on terminal + agent workflows with broad API coverage.

## Repos Reviewed
- `other-repos/xero-node` (official SDK, currently `13.4.0`)
- `other-repos/xero-mcp-server` (official curated MCP server, currently `0.0.14`)
- `other-repos/xero-cli-yolo-branch` (`yolo` branch contains prior full CLI attempt)

## Feasibility
High. A generic wrapper is practical because SDK surface is consistent:
- 472 generated API methods
- 468 tenant-first signatures (`xeroTenantId` first arg)
- 10 API groups exposed on `XeroClient`

## Architecture Direction
Use a thin layered architecture:
1. `config` resolution (env first, optional file)
2. `auth` (bearer + client_credentials first)
3. `sdk adapter` (API/method discovery and resolution)
4. `invoke engine` (args mapping, tenant injection, headers, file/binary support)
5. `output + error normalization` (stable JSON envelope + exit codes)

Do not copy MCP’s per-endpoint handler model; keep generic invocation as default.

## Findings From Prior Attempt (`xero-cli-yolo-branch`)
What is good:
- Strong generic `invoke` flow
- Tenant/config/auth ergonomics
- Binary input/output handling
- Useful unit test coverage

What should be fixed before treating as production baseline:
- Global env placeholder expansion can fail on unrelated config paths.
- Config file writes do not explicitly enforce restrictive permissions.
- Named-arg mapping depends on parsing `fn.toString()` (brittle).
- Dry-run currently serializes already-materialized args (streams can be awkward).

## External Constraints To Design For
- Xero API rate limits: 60 calls/minute and 5000 calls/day per connection.
- OAuth token lifecycle and refresh semantics.
- Custom integration commercial changes effective 2026-03-02 (planning impact for heavy agent usage).

## Recommended Implementation Plan (Small Steps)
1. Scaffold project baseline (`typescript`, `commander`, `vitest`, strict lint).
2. Add discovery commands: `apis list`, `methods list <api>`.
3. Implement auth core: `auth mode`, `auth token` (bearer + client_credentials).
4. Implement first live read call: `invoke accounting getOrganisations`.
5. Add tenant resolution order (`--tenant-id` -> env -> config -> `/connections`).
6. Add payload engine (`--args`, `--args-file`, headers, file tokens).
7. Add binary response handling (`--output`).
8. Add config store + tenant CRUD commands.
9. Harden retries, idempotency-key support, and error taxonomy.

## Proposed Initial Command Surface
- `xero about`
- `xero apis list`
- `xero methods list <api>`
- `xero auth mode`
- `xero auth token`
- `xero invoke <api> <method> [--args|--args-file] [--tenant-id] [--json]`

## Security Baseline
- Never print access tokens by default.
- Avoid credentials in CLI args where possible (prefer env/config references).
- If storing secrets on disk, write config with restrictive permissions.
- Keep `.env` and secrets out of git.

## Session Resume Checklist
When a new session starts:
1. Read this file first.
2. Confirm `README.md` still matches project direction.
3. Start next uncompleted step from the implementation plan above.
4. Keep changes incremental with tests per step.

