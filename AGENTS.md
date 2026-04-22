# AGENTS.md

## Scope
This file applies to the repository root.

## Current Repository State
The repository now contains an initialized TypeScript CLI skeleton in addition to the original protocol documents.

Observed project files now include:

1. `package.json`
2. `tsconfig.json`
3. `vitest.config.ts`
4. `src/`
5. `test/`
There was no existing `AGENTS.md` in this repository before this file was added.
There are no Cursor rules in `.cursor/rules/` or `.cursorrules`.
There are no Copilot instructions in `.github/copilot-instructions.md`.

The domain-specific source documents currently in this repo are:

1. `ssv-protocol.md` for SSV cluster accounting concepts, constants, and formulas
2. `subgraph.md` for SSV subgraph endpoints, query shapes, field mappings, and data handling
3. `ssv-contracts.md` for the `~/dev/ssv-network` contract architecture, module responsibilities, storage model, and operational flows

This document is intentionally conservative.
It records only what was actually observed and avoids inventing project-specific commands.

## Command Reference

### Build
Verified from `package.json`:

1. `npm run build`

### Lint
No lint command is currently defined in this repository.

### Test
Verified from `package.json`:

1. `npm test`

### Single-Test Execution
Vitest is configured. Use one of these verified forms:

1. `npx vitest run test/network-selection.test.ts`
2. `npx vitest run test/network-selection.test.ts -t "test name"`

## How Agents Should Work Here
Start by inspecting the repository contents instead of assuming a stack.
Prefer small, reversible changes.
Do not scaffold large frameworks unless the user explicitly asks for that.
Treat `ssv-protocol.md` and `subgraph.md` as the current source of truth for the subject matter of this repository.
Treat `ssv-contracts.md` as the contract-level companion reference for how the legacy SSV-token network is implemented on-chain.
If code is added later, align names, calculations, and data handling with those documents unless the user asks for a deliberate change.

When adding code to this repository:

1. Add the minimum files needed for the requested task.
2. Keep setup consistent with the chosen language ecosystem.
3. Add scripts or commands in the project's native entry points.
4. Update this file once concrete conventions exist.

## Style Guidance
The current codebase is small, but the initial TypeScript CLI establishes a few concrete conventions.

### Imports
Keep imports explicit and minimal.
Use ESM-style imports with `.js` extensions in local TypeScript source files so the emitted NodeNext output resolves correctly.
Prefer built-in modules first, then third-party packages, then local modules.

### Formatting
No formatter config is checked in yet.
Write idiomatic TypeScript with readable line lengths and straightforward control flow.

### Types
TypeScript is configured in strict mode.
Prefer explicit types at module boundaries and for exported APIs.
Use `zod` for runtime validation at environment and input boundaries.

### Naming
Use descriptive names.
Prefer clarity over brevity.
Match the naming conventions of the chosen language.
Avoid abbreviations unless they are standard in the domain.
Name files after the primary unit they contain when the ecosystem expects that.

### Error Handling
Fail loudly on programmer errors and invalid assumptions.
Handle expected runtime errors close to the boundary where they occur.
Return or propagate errors with enough context to diagnose the failure.
Do not swallow errors silently.

### Comments
Write comments only when the code's intent is not obvious from the implementation.
Prefer comments that explain why, not what.

### Functions and Modules
Keep functions focused.
Prefer straightforward control flow over clever abstractions.
Extract helpers only when they improve reuse, readability, or testability.

### Testing Expectations
Use Vitest for automated tests.
Add or update the smallest targeted test set that covers the changed behavior.
Prefer direct assertions over broad snapshots.

### Dependency Changes
Do not add dependencies casually.
Prefer built-in libraries and existing project dependencies first.
If a new dependency is necessary, explain why and keep it minimal.

## Rules Files
No Cursor or Copilot instruction files were present during analysis.
If they are added later, agents should treat them as authoritative project guidance and merge their instructions into future updates of this file.

Expected locations to re-check:

1. `.cursorrules`
2. `.cursor/rules/`
3. `.github/copilot-instructions.md`

## Maintenance
Update this file whenever any of the following appear:

1. A package manager manifest
2. A build system file
3. A formatter or linter config
4. A test runner config
5. Source files that establish naming or architectural conventions
6. Cursor or Copilot instruction files

When updating, replace placeholders with verified commands and conventions from the repository itself.
Prefer observed project rules over generic best practices.
