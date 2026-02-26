# Development Notes

Last updated: 2026-02-26

## Purpose
Thin CLI wrapper around `xero-node`, designed for terminal/agent usage with broad API coverage through a generic `invoke` command.

## Current State
- CLI commands implemented:
  - `xero about`
  - `xero doctor`
  - `xero auth status`
  - `xero auth login`
  - `xero auth scopes`
  - `xero auth logout`
  - `xero tenants list`
  - `xero policy init --profile ...`
  - `xero policy list`
  - `xero proxy`
  - `xero invoke <api> <method> -- --<param>=<value> ...`
- Auth runtime implemented:
  - env-first `client_credentials` flow (no file read when env creds are present)
  - encrypted file-backed auth config for `client_credentials` and `oauth`
  - OAuth token storage + refresh path through `xero-node`
- Manifest generation implemented:
  - `npm run manifest`
  - output: `resources/xero-api-manifest.json`
  - source: installed `xero-node` type declarations in `node_modules`
- Generic invoke is manifest-driven and fail-closed when signature metadata is missing.

## Invoke Param Parsing (Implemented)
Current parsing rules in `src/invoke.ts`:
- `string`
- `number`
- `boolean` (`true`/`false`)
- `Date` (JS `Date` from ISO-like input)
- `Array<string>` (single comma-separated value)
- `fs.ReadStream | Readable | Buffer` (file path only; must exist and be a regular file)
- string-literal unions (for example `'DRAFT' | 'AUTHORISED'`) parsed/validated when declared type contains ` | `
- all other non-union model types fallback to JSON parsing:
  - if value ends with `.json` -> read and parse file
  - otherwise -> parse inline JSON

Validation behavior:
- unknown param names fail
- duplicate param flags fail
- missing required params fail
- unsupported union shapes fail

## Completeness Report
- Script: `dev/completeness-report.ts`
- Reads manifest and evaluates method/param support.
- Current interpretation:
  - `options` header param is treated as ignored/supported
  - non-union model types are treated as supported via JSON fallback
  - non-literal unions remain unsupported
- Current result: effectively full method coverage under these rules.

## Notable Decisions / Deviations
- Removed `@...` prefix mode for JSON/file parsing.
- JSON file detection uses `.json` suffix.
- Binary stream params use plain file path input (no stdin/base64 mode yet).
- Parser favors minimal, deterministic behavior over rich auto-detection.

## Risks / Gaps
- JSON fallback is syntactic validation only; there is no local schema validation against model fields.
- For mutating endpoints, invalid-but-parseable payloads fail only at API time.
- No dedicated dry-run mode yet.

## Remaining Work (Proxy + Policy)
- Add targeted tests for policy + audit behavior:
  - `policy init` profiles and generated file shape
  - `policy list` effective policy/source output
  - fallback behavior (`get*` allow, non-`get*` block)
  - `ask` behavior in TTY vs non-TTY runs
  - audit JSONL fields and full-mode behavior
- Harden proxy transport:
  - request auth (shared token/header)
  - TLS and/or strict trusted-network deployment guidance
- Harden audit logs:
  - sanitize/truncate SDK error payloads before writing to audit JSONL
- Re-evaluate long-term `ask` flow for daemonized proxy:
  - current behavior is fail-closed without interactive TTY
