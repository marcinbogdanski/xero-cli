# Repository Guidelines

## Project Structure & Module Organization
- `src/` contains CLI implementation code.
- `src/index.ts` defines commands and user-facing CLI flows.
- `src/auth.ts` handles auth config, encryption, and token storage.
- `src/client.ts` builds authenticated `XeroClient` instances.
- `src/invoke.ts` implements manifest-driven generic API invocation.
- `tests/` contains Vitest suites (`*.test.ts`), currently focused on auth behavior.
- `dev/` contains maintenance scripts such as `generate-manifest.ts` and `completeness-report.ts`.
- `resources/` stores generated manifest and example payload/file assets.
- `dist/` is generated build output; do not edit manually.

## Build, Test, and Development Commands
- `npm install`: install project dependencies.
- `npm run build`: compile TypeScript into `dist/` (with declarations and source maps).
- `npm run cli`: run the CLI directly from source via `tsx`.
- `npm run start`: run the compiled CLI from `dist/index.js`.
- `npm test`: run all tests once with Vitest.
- `npx vitest run tests/auth.test.ts`: run a single test file.
- `npm run manifest`: regenerate `resources/xero-api-manifest.json` after SDK updates.
- `npx tsx dev/completeness-report.ts`: check invoke-parameter support coverage.

## Coding Style & Naming Conventions
- Use TypeScript with strict typing (`tsconfig.json` has `"strict": true`).
- Match existing style: 2-space indentation, semicolons, double quotes, trailing commas.
- Use `camelCase` for variables/functions and `PascalCase` for interfaces/types.
- Keep file names lower-case (for example, `auth.ts`, `invoke.ts`).
- Prefer explicit error messages and fail-closed validation for CLI input.

## Implementation Simplicity Policy
- Default to the shortest clean implementation that solves the requested behavior only.
- Work in atomic increments: one small step, verify, then move to the next.
- Avoid introducing abstractions (extra classes/layers/wrappers/protocol objects) unless there is repeated need in current scope.
- Do not add new interfaces/types for one-off plumbing; prefer existing shapes and local object literals.
- Prefer one canonical validation/execution path. Avoid duplicating full validation logic in multiple layers.
- Client-side checks should stay lightweight (for obvious local issues only); keep authoritative validation in one place.
- Inline straightforward logic. Extract a helper only when it clearly improves readability or is likely to be extended next.
- Refactor only when it reduces total code or removes duplication. Do not refactor for style alone.
- Keep data flow obvious: parse -> validate -> execute -> output.

## Proxy/Invoke Extension Rules
- Keep `src/invoke.ts` as the source of truth for invoke semantics and argument validation.
- Keep proxy transport minimal: JSON over HTTP unless a stronger requirement is explicitly requested.
- Prefer minimal payload contracts. Add new payload fields only when needed for current behavior.
- For file handling in proxy mode: serialize only what is necessary, and avoid sending local file content unless required.
- Preserve direct mode behavior unless the task explicitly asks to change it.

## Error Handling
- Default to fail-fast behavior with concise, explicit user-facing errors.
- Avoid retries, fallback branches, recovery frameworks, and broad catch blocks unless explicitly requested.
- Do not add defensive checks for hypothetical cases that are outside the current requirement.

## Testing Guidelines
- Framework: Vitest (`vitest.config.ts` includes `tests/**/*.test.ts`).
- Name test files as `*.test.ts` and write behavior-focused test names.
- Add or update tests for auth changes, parameter parsing, and command behavior.
- No hard coverage threshold is defined; prioritize regression protection for edge cases.
- For iterative CLI work, prefer quick smoke verification of changed paths plus existing test suite; avoid adding test scaffolding unless required by the change.

## Commit & Pull Request Guidelines
- Follow Conventional Commit prefixes used in history: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`.
- Keep each commit scoped to one logical change.
- PRs should include a short problem statement, implementation notes, and verification steps.
- Include commands run (for example, `npm test`, `npm run build`) and representative CLI output when behavior changes.
