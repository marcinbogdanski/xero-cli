# Development Notes

Last updated: 2026-02-22

## Purpose
Thin CLI wrapper around `xero-node`, designed for terminal/agent usage with broad API coverage through a generic `invoke` command.

## Current State
- CLI commands implemented:
  - `xero about`
  - `xero auth status`
  - `xero auth login`
  - `xero auth callback`
  - `xero auth test`
  - `xero auth logout`
  - `xero tenants list`
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

## Future Direction (Still Relevant)
- Keep transport/auth behind a backend boundary so proxy/token-broker mode can be introduced later without CLI UX rewrite.

## Session Resume Checklist
1. Read this file.
2. Regenerate manifest after SDK updates: `npm run manifest`.
3. Re-run completeness report after parser changes.
4. Run tests: `npm test`.
5. Keep README examples aligned with actual parser behavior.
