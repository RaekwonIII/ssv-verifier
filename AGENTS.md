# AGENTS.md

## Scope
This file applies to the repository root.

## Current Repository State
The repository currently contains documentation only.
There are no source files, package manifests, test suites, lint configs, formatter configs, or CI files to inspect.
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
No build command is currently defined in this repository.

Agents should not guess a build command.
Before claiming a build command exists, verify it from one of these sources:

1. `package.json` scripts
2. `Makefile`
3. `justfile`
4. `pyproject.toml`
5. `Cargo.toml`
6. `go.mod`
7. CI workflows or project documentation

If none of those files exist, state clearly that no build command is available yet.

### Lint
No lint command is currently defined in this repository.

When tooling appears, prefer the canonical project command, such as:

1. `npm run lint`
2. `pnpm lint`
3. `yarn lint`
4. `ruff check .`
5. `cargo clippy --all-targets --all-features`

Do not recommend a lint command unless it is backed by checked-in config or scripts.

### Test
No test command is currently defined in this repository.

Agents should discover the real test command from project config before using one.
Likely future sources include:

1. `package.json` scripts
2. `pytest.ini`, `pyproject.toml`, or `tox.ini`
3. `Cargo.toml`
4. CI workflow commands

If the repo remains empty, report that there are no tests to run.

### Single-Test Execution
There is no single-test command defined yet because there is no test framework configured.

Once a framework exists, document the exact command form here.
Examples of acceptable future entries are:

1. Vitest: `pnpm vitest run path/to/file.test.ts`
2. Vitest single test: `pnpm vitest run path/to/file.test.ts -t "test name"`
3. Jest: `npm test -- path/to/file.test.ts`
4. Jest single test: `npm test -- path/to/file.test.ts -t "test name"`
5. Pytest: `pytest tests/path/test_file.py::test_case`
6. Cargo: `cargo test test_name`

Do not present these examples as active project commands unless the matching toolchain is actually added.

## How Agents Should Work Here
Start by inspecting the repository contents instead of assuming a stack.
Prefer small, reversible changes.
Do not scaffold large frameworks unless the user explicitly asks for that.
Treat `ssv-protocol.md` and `subgraph.md` as the current source of truth for the subject matter of this repository.
Treat `ssv-contracts.md` as the contract-level companion reference for how the legacy SSV-token network is implemented on-chain.
If code is added later, align names, calculations, and data handling with those documents unless the user asks for a deliberate change.

When adding code to a newly initialized repository:

1. Add the minimum files needed for the requested task.
2. Keep setup consistent with the chosen language ecosystem.
3. Add scripts or commands in the project's native entry points.
4. Update this file once concrete conventions exist.

## Style Guidance
There is no established project style to infer from source code yet.
Until the codebase defines one, use the following defaults.

### Imports
Keep imports explicit and minimal.
Remove unused imports.
Prefer standard-library or built-in imports first, then third-party packages, then local modules if the language distinguishes them.
Avoid wildcard imports unless the language community strongly treats them as idiomatic.

### Formatting
Follow the formatter used by the project once one exists.
If no formatter exists, write code in the default idiomatic style for the language.
Do not introduce a formatter config unless the user asks or the task clearly requires it.
Keep line length reasonable and prioritize readability over dense code.

### Types
Prefer explicit, readable types at public boundaries.
Use inference when it improves readability and the type is obvious.
Avoid unnecessary type indirection.
Do not weaken types without a concrete reason.

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
When tests exist, add or update the smallest test set that covers the behavior changed.
Prefer targeted tests over broad snapshots.
If no test framework exists, do not invent test results.

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
