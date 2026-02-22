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
- Default to the shortest clean implementation that solves the actual requirement end-to-end.
- Avoid introducing abstractions (extra classes, layers, wrappers) unless they clearly reduce total complexity.
- Do not create tiny helpers used in one place; inline straightforward logic at call site.
- Refactor existing code only when it makes the final code simpler; otherwise prefer minimal, local edits.
- Keep data flow obvious: parse -> validate -> execute -> output, without indirection.
- Keep tests focused on behavior and critical edge cases; avoid over-engineered test scaffolding.

## Testing Guidelines
- Framework: Vitest (`vitest.config.ts` includes `tests/**/*.test.ts`).
- Name test files as `*.test.ts` and write behavior-focused test names.
- Add or update tests for auth changes, parameter parsing, and command behavior.
- No hard coverage threshold is defined; prioritize regression protection for edge cases.

## Commit & Pull Request Guidelines
- Follow Conventional Commit prefixes used in history: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`.
- Keep each commit scoped to one logical change.
- PRs should include a short problem statement, implementation notes, and verification steps.
- Include commands run (for example, `npm test`, `npm run build`) and representative CLI output when behavior changes.
