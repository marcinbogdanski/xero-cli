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

## Future Proxy Plan (Important)
We may later run the CLI in untrusted environments and move secret-bearing auth to a trusted proxy/token broker.

To keep this migration easy, preserve this boundary from day one:
1. `cli` layer: argument parsing + output formatting only.
2. `backend` interface: one internal execution contract (`execute(operation, params, context)`).
3. `backend` implementation A (now): direct `xero-node` calls.
4. `backend` implementation B (later): proxy HTTP calls with the same contract.

Rules:
- CLI code should never call `xero-node` directly outside backend implementation A.
- Auth and transport details must stay behind the backend interface.
- Operation names, parameter schema, and output envelope should remain stable across A/B implementations.

Expected result: swapping direct SDK transport for proxy transport should be mostly wiring/config, not a full CLI rewrite.

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

## Next Implementation Plan (Current Focus)
Goal: keep `invoke` generic, but make argument handling deterministic and safer via generated metadata.

### Phase 1: Manifest Generator
Create a dev script that generates a manifest from `xero-node` generated signatures.

Manifest should include (per API method parameter):
- API name + method name
- parameter order (for positional SDK call)
- parameter name
- declared TypeScript type (raw)
- flags: required/optional/defaulted
- inferred parse category (initial): `scalar`, `json`, `binary`, `unknown`

Acceptance:
- Deterministic output file (committable)
- Regenerating manifest after SDK update produces a clean diff
- No runtime `fn.toString()` dependency for param names/types

### Phase 2: Generic Param Parser (Progressive)
Build a parser that consumes user inputs and maps to manifest param definitions.

Input style (initial):
- All SDK method params are passed as dynamic named args after `--`
- Format: `--<param-name>=<param-value>`
- Example:
  - `xero invoke accountingApi createInvoices --tenant-id=... -- --invoices=@invoices.json --summarizeErrors=true`

Param value conventions:
- Scalar types: literal value (`--page=1`, `--summarizeErrors=true`)
- JSON/model types: inline JSON or file/stdin reference
  - inline JSON: `--account='{"code":"200","name":"Sales"}'`
  - JSON file: `--account=@account.json`
  - stdin: `--account=@-`
- Binary/stream types: file reference by default (`--body=@invoice.pdf`)
- Optional future extension: `base64:` prefix for binary payloads

Rules:
- Do not guess parse mode from content/path-like strings
- Parse dynamic params only from argv segment after `--`
- Reserve global CLI flags before `--` (for example `--tenant-id`, `--output`, `--help`, `--version`)
- Define escaping for literal leading `@` values when needed (for example `@@value`)
- Validate mode compatibility against manifest type/category
- Fail fast on unknown param names or missing required params

### Phase 3: Invoke Integration
Refactor `invoke` to use manifest + parser output end-to-end.

Flow:
1. Resolve method signature from manifest
2. Parse/validate all provided params using parser
3. Build ordered args array
4. Inject tenant ID using existing resolution rules
5. Call SDK method
6. Return normalized response/error envelope

Acceptance:
- Existing simple invocations still work
- Typed JSON payload methods work (`Account`, `Quotes`, etc.)
- Binary upload methods work via `--<param>=@<file-path>`
- Validation errors are clear and actionable

## Proposed Initial Command Surface
- `xero about`
- `xero apis list`
- `xero methods list <api>`
- `xero auth mode`
- `xero auth token`
- `xero invoke <api> <method> [--tenant-id] [--output] -- --<param>=<value> ...`

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
