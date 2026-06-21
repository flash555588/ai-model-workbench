# Fuck My Shit Mountain Audit Report

**Project:** AI Model Workbench
**Audit mode:** full
**Date:** 2026-06-22
**Reviewer:** Codex GPT-5

---

## 1. Executive Summary

AI Model Workbench is in much better shape than a typical legacy plugin of this size: the renderer routing contract is documented, the release workflow signs and attests release assets, remote drafting is local-first by default, and the project has meaningful verification scripts for preview, settings migration, diagnostics, knowledge generation, and release assets. The audit found no critical or high-severity issues, `npm audit` reported zero vulnerabilities, and the main non-Obsidian verification commands passed.

The main technical debt is structural. The Three and Babylon preview classes, knowledge-note generation pipeline, settings UI, helper toolbar, and CAD converter adapter have grown into large multi-responsibility modules. That does not make the current release unsafe by itself, but it makes future renderer migration, ruler work, conversion changes, and knowledge-note behavior harder to change with confidence.

The most important engineering risks before a stable public release are persistence consistency, non-atomic knowledge generation, unbounded remote-draft request waiting, and the gap between custom verification scripts and normal unit coverage. These are practical, local fixes; this codebase does not need a rewrite.

### Score Dashboard

```
Security        [########..]  8.0  A   Local-first defaults, command validation, network guard, and zero npm vulnerabilities are strong; diagnostics still expose model/vault paths by design.
Stability       [#######...]  6.5  B   Verification is broad, but unsynchronized save ordering, partial multi-file generation, and remote requests without timeout create realistic failure modes.
Performance     [########..]  7.5  A   Preview smoke checks pass and renderers include disposal/visibility work, but very large renderer classes make performance regressions easy to introduce.
Testing         [#####.....]  5.0  B   Custom verification scripts are valuable, but Vitest coverage is 1.8 percent overall and most source modules report zero unit coverage.
Maintainability [######....]  5.8  B   Clear module directories and docs exist, but several core files exceed 700-2,000 lines and mix unrelated responsibilities.
Design          [######....]  6.0  B   Renderer-agnostic interfaces help, while SRP and boundary-contract debt remains in renderers, converters, and knowledge generation.
Release         [########..]  8.0  A   Release checks, asset hashes, and GitHub attestations are good; the audit did not run the real Obsidian smoke test.
-------------------------------------
Overall         [#######...]  6.7  B
```

Each dimension scored 0.0 to 10.0. **Higher = better (10 = clean, 0 = worst).** Scores are judgment-based, not formula-based.

### Finding Statistics

| Severity | Count | Confirmed | Suspected |
|----------|-------|-----------|-----------|
| Critical | 0 | 0 | 0 |
| High | 0 | 0 | 0 |
| Medium | 6 | 6 | 0 |
| Low | 2 | 2 | 0 |
| Info | 0 | 0 | 0 |
| **Total** | **8** | **8** | **0** |

## 2. Project Map

AI Model Workbench is an Obsidian desktop/mobile plugin. `src/main.ts` owns plugin lifecycle, commands, direct file view registration, code block processors, Live Preview extension registration, settings, diagnostics, and cache wiring. State is owned by `src/store/plugin-store.ts`, persisted through Obsidian `loadData` and `saveData`, with settings defaults in `src/domain/constants.ts` and shared contracts in `src/domain/models.ts`.

Rendering is split into renderer-agnostic contracts under `src/render/preview`, Three.js implementation under `src/render/three`, Babylon.js implementation under `src/render/babylon`, and `3dgrid`/preset rendering under `src/render/presets` plus Babylon grid code. Routing decisions are centralized in `src/render/preview/routing.ts`, `src/view/direct-view-routing.ts`, and documented in `docs/preview-routing-matrix.md`.

Model I/O is split into direct loading, format capability registration, conversion orchestration, cache records, and adapter-specific conversion. Local conversion uses desktop Node/Electron capabilities through `src/utils/node-shim.ts` and external tools such as Python/CadQuery, FreeCAD, FBX2glTF, obj2gltf, and trimesh.

Knowledge generation lives mainly in `src/view/workbench/knowledge-note.ts` and `src/view/workbench/analysis-result.ts`. It writes reports, sidecars, indexes, snapshots, and part-note drafts into the vault, and can optionally send sanitized evidence to a configured remote draft endpoint. Remote draft behavior is in `src/view/workbench/remote-draft.ts` and output normalization is in `remote-draft-normalizer.ts`.

The audit excluded generated/minified `main.js` as source evidence, dependency folders, binary model fixtures, generated coverage output, `.tmp`, and pre-existing untracked audit/GIF/test-model artifacts. Commands run during this audit: `git status --short --branch`, `rg --files`, targeted `rg` searches, `npm audit --json`, `npm audit --omit=dev --json`, `npm run test:coverage`, `npm run typecheck`, `npm run lint`, `npm run verify:settings`, `npm run verify:remote-draft`, `npm run verify:knowledge-index`, `npm run verify:diagnostics`, `npm run verify:release`, and `npm run verify:preview`. The real Obsidian smoke test was not run for this audit.

### Coverage Matrix

| Dimension | Coverage | Evidence inspected | Exclusions / limits |
|-----------|----------|--------------------|---------------------|
| Architecture | High | `src/main.ts`, renderer folders, I/O folders, store, docs handoff, routing matrix, file-size inventory | Did not inspect every binary fixture or generated bundle |
| Security | Medium | command discovery validation, remote draft, network guard, diagnostics, npm audit, release workflow | No dynamic penetration testing or real malicious model corpus |
| Stability | High | store persistence, conversion manager, knowledge generation writes, remote draft, preview verification, diagnostics verification | Real Obsidian app smoke not run |
| Performance | Medium | renderer classes, grid/render verification output, conversion timeout/cache behavior, file-size inventory | No profiling session or benchmark suite |
| Testing | High | Vitest test files, coverage output, package scripts, verification scripts, CI workflow | Coverage report treats external verification scripts separately from Vitest |
| Maintainability | High | largest source files, TODO debt markers, module map, converter adapters, settings/helper UI | Did not inspect every line of all renderer math branches |
| Design | High | renderer interfaces, direct-view routing, store, conversion service, knowledge-note pipeline, principles rubric | Design scoring limited to static review plus passing checks |
| Release | High | package scripts, release workflow, release verifier, README release docs, SECURITY.md, npm audit | Did not publish a release or run `verify:obsidian` |
| Documentation | Medium | README, development handoff, routing docs, security policy, changelog | Did not validate every README example in a live Obsidian install |
| Configuration | Medium | defaults, settings UI, command discovery, diagnostics, remote draft decision logic | No migration test beyond `verify:settings` |
| Observability | Medium | logger, diagnostics report, verification scripts, conversion logs | No production telemetry because this is a local plugin |
| Data Integrity | High | store persistence, knowledge generation, managed index replacement, converted asset cache | No fault-injection run against vault writes |
| Privacy | Medium | remote-draft sanitization, diagnostics report, README privacy claims, verify-remote-draft | No review of external service implementation because only client exists here |
| Accessibility | Medium | helper toolbar labels, canvas keyboard handling, annotations, inline/direct UI snippets | No screen-reader or browser accessibility tree run |
| Supply Chain | High | package manifests, lockfile, npm audit, GitHub workflow, attestations, release asset verifier | GitHub Actions pinned to tags, not SHA-pinned actions |
| Cost | Medium | remote draft, conversion timeout/cache, render settings, model limits | No real user workload cost profile |
| AI-Safety | Medium | remote drafting client, normalizer tests, privacy verifier, local-first defaults | No server-side LLM implementation present |
| Fallback | Medium | direct view fallback, route matrix, knowledge generation warnings, converter fallback behavior | Did not force every fallback path at runtime |
| Testing-Authenticity | High | Vitest tests, custom verification scripts, coverage output, CI workflow | No mutation testing |
| Type-Safety | Medium | TypeScript interfaces, type assertions searches, `tsc` result, node shim | No runtime schema validation added during audit |
| Frontend-State | Medium | helper toolbar, inline code blocks, direct view, annotation manager references | No UI interaction trace beyond existing preview harness |
| Backend-API | Not assessed | Project has no backend API server; only optional client POST to `/draft-note` | Server behavior is outside this repository |
| Dependency-Weight | Medium | package dependencies, package-lock metadata, npm audit, release bundle size | No bundle analyzer by module |
| Code-Consistency | Medium | lint result, largest modules, error handling and UI construction patterns | Did not create a full duplication index |
| Comment-Coverage | Medium | TODO markers, README, docs, public contracts, converter script comments | Did not enforce doc-comment coverage mechanically |

## 3. Top Risks

1. Medium: Persisted plugin state saves can complete out of order, which can overwrite newer state with an older snapshot.
2. Medium: Knowledge generation writes multiple files and store state without a transaction or recovery marker, so partial output can become visible.
3. Medium: Remote draft requests have no explicit timeout, cancellation, or retry budget.
4. Medium: Normal unit coverage is only 1.8 percent overall; most source modules have zero Vitest coverage.
5. Medium: Three and Babylon preview classes are monolithic and already marked as debt in code.
6. Medium: The CAD converter embeds a large Python/GLB post-processing program inside a TypeScript string array.
7. Low: Keyboard-focusable preview canvases do not expose an accessible name or role.
8. Low: Diagnostics reports intentionally omit secrets but still include model and vault-relative paths that can reveal project names.

## 4. Detailed Findings

### Finding: Persisted store saves are not serialized

- Severity: Medium
- Confidence: High
- Category: Stability
- Status: Confirmed
- Affected area: Plugin state persistence
- Evidence:
  - File: `src/store/plugin-store.ts:44-62`
  - Function / Module: `scheduleSave`, `persist`
  - Relevant behavior: Each store change schedules `persist().catch(...)`; `persist` snapshots the whole store and calls `plugin.saveData(data)`.
  - File: `src/store/plugin-store.ts:125-131`
  - Function / Module: `dispose`
  - Relevant behavior: Dispose clears the pending timer and starts a fire-and-forget final `persist`.
- Problem: Multiple `saveData` calls can overlap, and there is no single-flight queue, revision number, or "latest write wins" guard. If an older save resolves after a newer save, the persisted `data.json` can contain stale settings, annotations, converted cache records, or generated-note metadata.
- Why it matters: The plugin treats persisted state as the source of truth after restart, so save ordering bugs become user-visible data loss or stale metadata.
- Realistic failure scenario: A user adds an annotation, immediately generates a knowledge note, then closes Obsidian while saves are still in flight. The final async flush or an older autosave finishes later and persists the pre-generation profile.
- Minimal fix: Add a serialized save queue with a monotonically increasing dirty revision; only one `saveData` runs at a time, and a new run starts if state changed while the previous save was pending.
- Better long-term fix: Model persistence as a small state machine with explicit `clean`, `dirty`, `saving`, and `failed` states plus a visible diagnostics signal for failed saves.
- Regression test suggestion: Unit-test `createPluginStore` with a fake `saveData` whose first promise resolves after the second, then assert the persisted payload is the newest state.
- Estimated effort: 3-5 hours.

### Finding: Knowledge generation can leave partial vault output

- Severity: Medium
- Confidence: High
- Category: Stability
- Status: Confirmed
- Affected area: Knowledge note generation and vault writes
- Evidence:
  - File: `src/view/workbench/knowledge-note.ts:1209-1343`
  - Function / Module: `generateKnowledgeNote`
  - Relevant behavior: The function captures evidence, creates part note drafts, optionally requests a remote draft, creates a knowledge index, writes an analysis sidecar, writes the report note, then updates the model profile and last-generation record.
  - File: `src/view/workbench/knowledge-note.ts:743-787`
  - Function / Module: `ensureFolder`, `createTextFileIfMissing`, `upsertTextFile`
  - Relevant behavior: Folder creation logs and continues on failure; create/modify retries a narrow race but has no multi-file rollback or generation manifest.
- Problem: Report note, sidecar JSON, index, part notes, snapshots, and profile metadata are committed independently. A failure after some writes but before the final profile update leaves the vault in a mixed state that later workflows may interpret as complete.
- Why it matters: Knowledge-generation artifacts are linked together. A missing sidecar or stale profile link can break registered-part reuse, "open index", or later report refreshes.
- Realistic failure scenario: The plugin writes several part notes and the index, then the sidecar write fails because the report folder was moved or disk sync locks the file. The vault now contains new notes but the model profile still points to older artifacts.
- Minimal fix: Write a generation manifest or status sidecar first, mark it `pending`, then mark `success` only after all writes and profile updates complete. On startup or next generation, reconcile or clean pending generations.
- Better long-term fix: Extract a `KnowledgeArtifactWriter` with explicit phases, idempotent upserts, and a recovery routine that can repair missing profile links from sidecars.
- Regression test suggestion: Add a test where the fake vault fails on the sidecar or report write after part notes are created, then assert the last-generation record is `failed` and recovery can identify incomplete artifacts.
- Estimated effort: 1-2 days.

### Finding: Remote draft request has no timeout or cancellation budget

- Severity: Medium
- Confidence: High
- Category: Stability
- Status: Confirmed
- Affected area: Optional remote draft client
- Evidence:
  - File: `src/view/workbench/remote-draft.ts:126-140`
  - Function / Module: `requestRemoteDraft`
  - Relevant behavior: Calls Obsidian `requestUrl` with URL, method, headers, and body, then awaits the response without an explicit timeout, abort signal, retry policy, or circuit breaker.
  - File: `src/view/workbench/knowledge-note.ts:1279-1293`
  - Function / Module: `generateKnowledgeNote`
  - Relevant behavior: The whole generation flow waits on `requestRemoteDraft` when remote drafting is enabled.
- Problem: A slow or hanging configured draft service can stall note generation indefinitely from the user's point of view.
- Why it matters: Remote drafting is optional, but when configured it sits inside a high-value local workflow. A network dependency should not block local artifact generation without a bounded wait.
- Realistic failure scenario: A user configures a local draft service, the service accepts a connection but never responds, and `generateKnowledgeNote` remains stuck before writing the local report.
- Minimal fix: Add a configurable default timeout around `requestUrl` with a clear warning recorded in `analysis.warnings` when it expires.
- Better long-term fix: Move remote draft into a post-local phase: write local report first, then update the report with remote output when it arrives or times out.
- Regression test suggestion: Extend `verify-remote-draft` or a Vitest test with a never-resolving `requestUrl` shim and assert generation continues after the timeout.
- Estimated effort: 3-6 hours.

### Finding: Unit coverage does not protect most critical modules

- Severity: Medium
- Confidence: High
- Category: Testing
- Status: Confirmed
- Affected area: Automated tests and critical source paths
- Evidence:
  - File: `package.json:11-23`
  - Function / Module: npm scripts
  - Relevant behavior: The repo has Vitest plus custom verification scripts for preview, Obsidian, settings, remote draft, knowledge index, diagnostics, and release.
  - File: coverage command output from `npm run test:coverage`
  - Function / Module: Vitest coverage
  - Relevant behavior: Overall coverage was 1.8 percent statements and 1.84 percent lines; `main.ts`, `settings.ts`, `plugin-store.ts`, `knowledge-note.ts`, Three scene, Babylon scene, and most renderer/IO files showed zero covered lines.
- Problem: The custom verification scripts provide useful confidence, but the normal unit test layer misses the modules most likely to break during refactoring.
- Why it matters: The next debt cleanup needs small safety nets around store persistence, knowledge artifact writes, routing, conversion caching, and renderer-agnostic helpers. Without those, refactors depend too heavily on slow end-to-end harnesses.
- Realistic failure scenario: A developer changes `plugin-store` save behavior or `knowledge-note` write ordering. Unit tests stay green because those modules have no direct tests, and the bug only appears after an Obsidian restart or partial vault-write failure.
- Minimal fix: Add focused Vitest tests for store save ordering, knowledge-note partial failures, conversion-cache reuse, direct-view routing, and remote-draft timeout behavior.
- Better long-term fix: Treat verification scripts as integration tests and add a small coverage threshold for core pure modules while keeping renderer/browser paths validated by Playwright.
- Regression test suggestion: Start with a `plugin-store.test.ts` fake plugin and `knowledge-note.test.ts` fake vault that exercise failure and recovery paths.
- Estimated effort: 2-4 days for a meaningful first tranche.

### Finding: Preview renderers are oversized multi-responsibility classes

- Severity: Medium
- Confidence: High
- Category: Maintainability
- Status: Confirmed
- Affected area: Three.js and Babylon.js preview implementations
- Evidence:
  - File: `src/render/three/scene.ts:214-216`
  - Function / Module: `ThreeModelPreview`
  - Relevant behavior: The source itself marks a `TODO(P2)` to decompose the class; file inventory measured 2,265 lines.
  - File: `src/render/babylon/scene.ts:242-244`
  - Function / Module: `BabylonModelPreview`
  - Relevant behavior: The source itself marks a `TODO(P2)` to split loader, camera, light, and annotation helpers; file inventory measured 1,739 lines.
  - File: `src/render/three/scene.ts:551-607`
  - Function / Module: annotation provider and model evidence methods
  - Relevant behavior: Renderer class owns annotation projection, model evidence extraction, material summaries, and part candidate generation.
  - File: `src/render/three/scene.ts:1949-2122`
  - Function / Module: measurement helpers
  - Relevant behavior: Renderer class also owns measurement interaction, labels, markers, and export record creation.
- Problem: Rendering, loading, camera fitting, lights, picking, annotation projection, measurement UI, selection focus, evidence extraction, and performance disposal all live in the same classes.
- Why it matters: Changes to one workflow carry high blast radius and are hard to review. This is already visible in the repeated Three/Babylon measurement work and the need to keep two large classes behaviorally aligned.
- Realistic failure scenario: A future annotation or ruler change updates the Three path but misses Babylon, or a camera/disposal optimization breaks measurement labels because both live in the same class state.
- Minimal fix: Extract low-risk pure helpers first: measurement records, evidence summaries, camera-fit wrappers, material disposal utilities, and annotation provider adapters.
- Better long-term fix: Split each renderer into loader, scene lifecycle, camera/controls, picking/selection, measurement, annotation projection, and evidence modules behind the existing `WorkbenchPreview` interface.
- Regression test suggestion: Add parity tests for shared measurement/evidence helper outputs and route-level preview tests for both renderer backends.
- Estimated effort: 3-6 days staged over several PRs.

### Finding: CAD conversion logic is embedded as a generated Python string

- Severity: Medium
- Confidence: High
- Category: Maintainability
- Status: Confirmed
- Affected area: STEP/IGES/BREP conversion adapter
- Evidence:
  - File: `src/io/conversion/adapters/freecad-converter.ts:52-77`
  - Function / Module: `buildCadScript`
  - Relevant behavior: Builds a Python program as a TypeScript string array, injecting source/output paths and imports.
  - File: `src/io/conversion/adapters/freecad-converter.ts:339-489`
  - Function / Module: embedded OCCT glTF writer path
  - Relevant behavior: The embedded script reads XDE documents, triangulates shapes, rewrites GLB JSON chunks, patches metadata, and handles temporary files.
  - File: `src/io/conversion/adapters/freecad-converter.ts:694-715`
  - Function / Module: `FreeCadConverter.convert`
  - Relevant behavior: Writes the generated script to a temp path, executes it, then removes the script fire-and-forget.
- Problem: A large Python program lives inside TypeScript string literals, so Python syntax, GLB chunk manipulation, and OCCT behavior are hard to lint, unit-test, diff, or type-check.
- Why it matters: CAD conversion is a support-heavy feature. Bugs here are hard to diagnose, and small edits can silently break syntax or platform behavior without local converter availability.
- Realistic failure scenario: A developer changes metadata post-processing in the string array, TypeScript and unit tests pass, but the generated Python has a syntax error or corrupts a GLB chunk only when a STEP file hits the OCCT writer path.
- Minimal fix: Move the Python script into a fixture/template file and add a test that renders it with sample paths, compiles it with `python -m py_compile`, and verifies key generated lines.
- Better long-term fix: Keep converter scripts as first-class assets with their own lint/smoke tests and minimal JSON contract tests between TypeScript and Python.
- Regression test suggestion: Add a unit test for `buildCadScript` output plus a script-level syntax test in CI when Python is present.
- Estimated effort: 1-2 days.

### Finding: Focusable preview canvases lack accessible names

- Severity: Low
- Confidence: High
- Category: Maintainability
- Status: Confirmed
- Affected area: Inline preview keyboard accessibility
- Evidence:
  - File: `src/view/inline/code-block.ts:200-211`
  - Function / Module: inline `3d` preview canvas creation
  - Relevant behavior: Creates a canvas, sets `tabIndex = 0`, and handles keyboard shortcuts for reset, wireframe, gizmo, bounding box, animation, and measurement.
  - File: `src/view/inline/helper-buttons.ts:243-612`
  - Function / Module: helper toolbar buttons
  - Relevant behavior: Toolbar buttons mostly have `aria-label`, but the focusable canvas itself does not expose an accessible name or role in the inspected snippet.
- Problem: Keyboard users can tab to an unlabeled interactive canvas. Screen readers may announce a generic canvas with no action context.
- Why it matters: The preview has meaningful keyboard behavior, so it should identify itself and its interaction mode when focused.
- Realistic failure scenario: A user navigating by keyboard reaches the canvas and cannot tell whether it is a model viewport, what interaction is available, or how to leave model interaction mode.
- Minimal fix: Add `role="img"` or an appropriate interactive role, an `aria-label` such as "3D model preview", and verify focus outline/escape behavior.
- Better long-term fix: Add an accessibility smoke in the Playwright harness that checks focusable controls have accessible names.
- Regression test suggestion: Extend `verify-preview` to evaluate focusable `.ai3d-canvas-full` elements and assert an accessible name is present.
- Estimated effort: 1-2 hours.

### Finding: Diagnostics reports include model and vault-relative paths

- Severity: Low
- Confidence: High
- Category: Security
- Status: Confirmed
- Affected area: Diagnostics and support report privacy
- Evidence:
  - File: `src/diagnostics/report.ts:82-103`
  - Function / Module: `buildDiagnosticsReport`
  - Relevant behavior: Report includes current model path, report note path, analysis sidecar path, knowledge index path, report folder, part notes folder, snapshot folder, last generated model, and last report/index paths.
  - File: `src/diagnostics/report.ts:112-114`
  - Function / Module: diagnostics notes
  - Relevant behavior: Notes explicitly say draft service URL and command paths are omitted.
- Problem: The diagnostic report avoids the highest-risk secrets but still includes filenames and vault-relative paths that can reveal customer, product, project, or model names.
- Why it matters: Diagnostics are designed to be copied into bug reports. Users may not realize model paths are sensitive even when no absolute filesystem path or service URL is included.
- Realistic failure scenario: A user attaches diagnostics to a public issue, exposing an unreleased product model name through `Current Model` or generated report paths.
- Minimal fix: Add a setting or prompt to redact model and note paths in diagnostics, defaulting to basename-only or `<redacted>` for support copies.
- Better long-term fix: Provide two diagnostics modes: "safe public report" and "local full report", with `verify:diagnostics` checking both redaction policies.
- Regression test suggestion: Extend `verify-diagnostics` to assert a redacted mode removes model/report path values while preserving counts and renderer state.
- Estimated effort: 2-4 hours.

## 5. Architecture Concerns

- Coverage: High
- Inspected evidence: `src/main.ts`, renderer implementations, `src/render/preview/*`, conversion pipeline, store, direct-view routing, docs.
- Exclusions / limits: No generated bundle or binary fixture internals inspected.

The architecture has a clear top-level shape, and the renderer routing decision is documented and tested. The biggest architectural issue is module boundary drift in the renderer and knowledge-generation areas.

| Concern | Findings | Affected Areas | Recommended Action |
|---------|----------|----------------|-------------------|
| ModuleBoundary | 2 | Three/Babylon scenes, knowledge note pipeline | Extract helpers behind existing preview and artifact-writer interfaces |
| DependencyDirection | 0 | None confirmed | Keep renderer-agnostic contracts in `src/render/preview` |
| StateOwnership | 1 | plugin store persistence | Serialize persisted state writes |
| BoundaryContract | 2 | converter script, knowledge artifacts | Add explicit generated-script and artifact manifest contracts |
| EvolutionRisk | 2 | renderer migration, conversion support | Reduce change blast radius with smaller modules |

## 6. Security Concerns

- Coverage: Medium
- Inspected evidence: command validation, remote draft URL validation, network guard, diagnostics report, npm audit, release workflow.
- Exclusions / limits: No adversarial model corpus or external draft service implementation was tested.

No critical or high security issues were confirmed. Strong points include local-first remote drafting defaults, raw model upload blocking, converter command metacharacter rejection, Babylon network guard documentation, and zero npm audit findings. Low-severity information disclosure remains in diagnostics path reporting.

## 7. Stability Concerns

- Coverage: High
- Inspected evidence: store persistence, knowledge generation writes, remote draft waiting, conversion timeout, preview smoke, settings migration, diagnostics.
- Exclusions / limits: Real Obsidian verification and fault injection were not run.

The stability risk is concentrated in async workflow boundaries: save ordering, multi-file generation, and remote dependency waits. Conversion has a 300-second timeout and verification coverage, which is positive.

| Area | Finding | Impact |
|------|---------|--------|
| Persistence | Store saves are not serialized | Stale persisted state after rapid changes or unload |
| Knowledge artifacts | Multi-file writes are not transactional | Partial report/index/sidecar output |
| Remote draft | No timeout | Generation can wait indefinitely |

## 8. Performance Concerns

- Coverage: Medium
- Inspected evidence: renderer file structure, preview verification performance output, conversion cache and timeout behavior, render scale settings.
- Exclusions / limits: No profiler, benchmark, or heavy-model stress run.

Performance is acceptable for the inspected smoke path, and `verify:preview` reported a valid rendered model with disposal audit counts at zero after model switch. The main performance debt is maintainability-driven: oversized renderer classes make it harder to reason about render loops, disposal, and per-feature costs.

## 9. Testing Gaps

- Coverage: High
- Inspected evidence: Vitest tests, verification scripts, coverage command, package scripts, CI workflow.
- Exclusions / limits: No mutation testing or real Obsidian smoke in this audit.

The project has good custom verification breadth but weak unit coverage. `npm run test:coverage` reported 1.8 percent statements overall. Most renderer, store, settings, direct view, and knowledge-generation modules have zero Vitest coverage. This is the single highest-leverage cleanup area.

## 10. Maintainability Concerns

- Coverage: High
- Inspected evidence: file-size inventory, TODO debt markers, renderer/converter/settings/knowledge modules, lint.
- Exclusions / limits: Did not produce a full duplication report.

Large modules are the dominant maintainability risk. The worst offenders are `src/render/three/scene.ts` at 2,265 lines, `src/render/babylon/scene.ts` at 1,739 lines, `src/view/workbench/knowledge-note.ts` at 1,351 lines, `src/view/inline/helper-buttons.ts` at 787 lines, and `src/io/conversion/adapters/freecad-converter.ts` at 737 lines.

## 11. Design / Principles Concerns

- Coverage: High
- Inspected evidence: renderer interfaces, source TODOs, store, knowledge pipeline, converter adapter, settings UI.
- Exclusions / limits: Static review only for many UI paths.

### Principles Violated

| Principle | Violations | Severity | Affected Areas |
|-----------|------------|----------|----------------|
| Single Responsibility (1.1) | 4 | Medium | renderers, knowledge note generation, settings UI, FreeCAD converter |
| File Size Limit (1.2) | 5 | Medium | `three/scene.ts`, `babylon/scene.ts`, `knowledge-note.ts`, `helper-buttons.ts`, `settings.ts` |
| Fail-Fast (4.4) | 2 | Medium | remote draft timeout, folder creation continuing after failure |
| No hidden side effects (5.3) | 1 | Medium | `generateKnowledgeNote` writes many artifacts and updates store |
| Timeout every external call (10.4) | 1 | Medium | remote draft request |

### Principles Respected

Renderer-agnostic preview contracts are a good boundary. Settings defaults are centralized. Converter command discovery validates shell metacharacters. Release verification checks versions, hashes, and expected assets.

## 12. Release Concerns

- Coverage: High
- Inspected evidence: `.github/workflows/release.yml`, package scripts, `scripts/verify-release-assets.mjs`, README release docs, SECURITY.md, npm audit.
- Exclusions / limits: No actual release was published and `verify:obsidian` was not run.

Release maturity is strong for a community plugin. The workflow builds from source, runs typecheck/lint/knowledge/diagnostics/release verification, publishes only supported assets, and creates GitHub artifact attestations. `npm audit` found zero vulnerabilities. The main release risk is that the real Obsidian smoke test is documented but not part of the release workflow.

## 13. Documentation Analysis

- Coverage: Medium
- Inspected evidence: README, SECURITY.md, development handoff, preview routing matrix, changelog, cross-platform docs.
- Exclusions / limits: Did not validate every install step in a fresh Obsidian environment.

Documentation is better than average: product contract, verification matrix, routing decisions, security token policy, and release flow are all documented. The main gap is operational: when partial knowledge-generation output occurs, there is no user-facing recovery or runbook.

## 14. Observability / Operability Analysis

- Coverage: Medium
- Inspected evidence: `src/utils/log.ts`, diagnostics report, converter diagnostics, verification scripts.
- Exclusions / limits: No production telemetry or alerting is expected for a local plugin.

The diagnostics report and converter diagnostics are useful. Logs are simple console logs gated by level. Missing signals are mostly around persistence and artifact generation: failed saves and partial generations are logged/warned but not surfaced as durable status users can recover from later.

## 15. Configuration Safety Analysis

- Coverage: Medium
- Inspected evidence: `DEFAULT_SETTINGS`, settings UI, command discovery, remote draft URL normalization, settings migration verifier.
- Exclusions / limits: No full schema validator or fuzzing of legacy `data.json`.

Defaults are conservative: remote drafting is local by default, raw model upload is false, converters are disabled by default, and log level defaults to warn. The code relies on TypeScript/default merging rather than a formal runtime settings schema, but `verify:settings` passed.

## 16. Data Integrity Analysis

- Coverage: High
- Inspected evidence: plugin store, converted asset cache, knowledge-note writes, managed index replacement, settings migration.
- Exclusions / limits: No simulated file-lock or cloud-sync failure test.

The key data-integrity issues are save ordering and multi-file artifact generation. The converted asset cache has reasonable caps and age limits, but the knowledge output set needs a recovery marker or reconciliation routine.

## 17. Privacy / Data Governance Analysis

- Coverage: Medium
- Inspected evidence: remote draft sanitization, diagnostics report, README privacy claims, remote draft verifier.
- Exclusions / limits: No external draft service reviewed.

Remote drafting is privacy-conscious: raw model upload is blocked, geometry and preview references can be withheld, and `verify:remote-draft` passed. Diagnostics path disclosure is the main remaining privacy issue.

## 18. Accessibility / UX Correctness Analysis

- Coverage: Medium
- Inspected evidence: helper toolbar labels, canvas keyboard handlers, inline preview UI snippets, annotations references.
- Exclusions / limits: No screen-reader/browser accessibility tree run.

Toolbar buttons are mostly labeled, which is good. The focusable canvas needs an accessible name/role, and the keyboard shortcut flow should be included in preview verification.

## 19. Supply Chain / Reproducibility Analysis

- Coverage: High
- Inspected evidence: package manifests, lockfile, npm audit, GitHub workflow, release asset verification, SECURITY.md.
- Exclusions / limits: Did not inspect every transitive package manually or pin GitHub Actions by SHA.

Supply-chain posture is good: release assets are limited and attested, `GITHUB_TOKEN` is used, and npm audit is clean. The workflow uses `npm install` rather than `npm ci`, apparently intentionally to avoid lockfile mismatch issues, so reproducibility is slightly weaker than a locked CI install but covered by version/hash verification.

## 20. Cost / Resource Economics Analysis

- Coverage: Medium
- Inspected evidence: remote draft client, conversion timeout/cache, render quality settings, max file setting, preview harness output.
- Exclusions / limits: No real workload cost measurements.

Cost risk is low because this is a local plugin with optional remote drafting. Remote calls need timeout/budget behavior. Conversion and rendering have some controls, including file-size setting, conversion timeout, cache reuse, render scale, and quality settings.

## 21. AI / LLM Safety Analysis

- Coverage: Medium
- Inspected evidence: remote draft decision, sanitizer, normalizer tests, privacy verifier, knowledge drafting input.
- Exclusions / limits: No server-side LLM, prompt execution engine, retrieval service, or tool-calling agent exists in this repo.

The local-first architecture avoids most AI safety hazards. The client sanitizes remote output and blocks raw model uploads. Missing items are evals for malicious remote draft output beyond current normalizer tests and timeout/budget behavior for remote calls.

## 22. Fallback / Defensive Code Analysis

- Coverage: Medium
- Inspected evidence: direct-view Three-to-Babylon fallback, converter cache fallback, knowledge generation warning behavior, route docs.
- Exclusions / limits: Did not run every converter fallback path.

Fallbacks are generally intentional and documented. The main problematic fallback shape is artifact generation continuing after folder creation warnings, which can hide setup problems until later writes fail.

## 23. Testing Authenticity Analysis

- Coverage: High
- Inspected evidence: test files, coverage output, verification scripts, CI workflow.
- Exclusions / limits: No mutation testing.

The custom verification scripts are authentic because they exercise browser preview, routing, generated knowledge index, diagnostics, and settings migration. The weak point is not fake tests; it is missing small unit tests around core stateful modules.

### Valuable Tests

- `src/io/conversion/manager.test.ts` covers conversion timeout and in-flight deduplication.
- `src/view/direct-view-routing.test.ts` covers route behavior.
- `src/view/workbench/remote-draft.test.ts` covers remote output normalization.
- Verification scripts cover knowledge index, diagnostics, settings migration, preview smoke, and release assets.

### Missing Tests

- Store save ordering.
- Knowledge-generation partial write recovery.
- Remote draft timeout.
- Converter script rendering/syntax.
- Accessibility checks for focusable preview surfaces.

## 24. Type Safety Analysis

- Coverage: Medium
- Inspected evidence: `tsc`, shared models, type assertion search, remote normalizer, component identity parsing.
- Exclusions / limits: No full runtime schema validation for persisted data or external draft JSON.

TypeScript checks pass. External inputs are manually normalized in several places, especially persisted profiles and remote draft output. The biggest type-safety debt is boundary validation depth: TypeScript interfaces document persisted state, but runtime schemas would make legacy data and sidecar parsing safer.

## 25. Frontend State Analysis

- Coverage: Medium
- Inspected evidence: helper toolbar, inline code block renderer, direct view, annotation and measurement UI snippets.
- Exclusions / limits: No full browser trace or accessibility tree inspection.

Frontend state is hand-rolled DOM state rather than framework state. That is appropriate for Obsidian, but it increases the importance of small controller modules. `helper-buttons.ts` is large enough that toolbar capability state, ARIA state, calibration panel state, and output actions should be split before more controls are added.

## 26. Backend API Analysis

- Coverage: Not assessed
- Inspected evidence: Repository inventory and remote draft client.
- Exclusions / limits: No backend API server is implemented in this repository.

The project is an Obsidian plugin, not a backend API. The only endpoint contract is optional client-side `POST /draft-note`, covered under security, privacy, AI safety, and stability.

## 27. Dependency Weight Analysis

- Coverage: Medium
- Inspected evidence: `package.json`, `package-lock.json`, npm audit metadata, release asset size.
- Exclusions / limits: No module-level bundle analyzer.

Runtime dependencies are intentionally small: Three.js, Babylon core, and Babylon loaders. Dev dependencies are heavier because of TypeScript, Playwright, Vitest, ESLint, and Obsidian types. This is reasonable for the domain. Release `main.js` is about 3.99 MB in the inspected verification output, which should be tracked over time.

## 28. Code Consistency Analysis

- Coverage: Medium
- Inspected evidence: ESLint result, source layout, error handling searches, converter adapters, renderers.
- Exclusions / limits: No automated clone detector.

Lint passes with zero warnings. Pattern inconsistency appears in large modules rather than broad style drift: renderer responsibilities and converter script generation patterns are the consistency risks to address first.

## 29. Comment Coverage Analysis

- Coverage: Medium
- Inspected evidence: TODO markers, README, handoff docs, inline comments in key modules.
- Exclusions / limits: No doc-comment coverage rule exists.

Comments are generally useful and debt markers follow the repo convention. The best comment work now is not adding prose everywhere; it is converting existing TODO(P2) markers into small tracked cleanup issues and documenting recovery behavior for knowledge generation.

---

## 30. Principles Compliance

The codebase follows useful large-scale principles in several places: renderer-agnostic interfaces, local-first defaults, explicit routing decisions, and release verification. The main principle violations are SRP, file-size discipline, fail-fast timeout handling, and atomicity of multi-step side effects.

### Principles Violated

| Principle | Violations | Severity | Affected Areas |
|-----------|------------|----------|----------------|
| Single Responsibility (SRP) | 4 | Medium | renderer scenes, knowledge generation, settings UI, FreeCAD converter |
| File Size Limit | 5 | Medium | major renderer/UI/converter modules |
| Fail-Fast | 2 | Medium | remote draft wait, folder creation warning path |
| Timeout Every External Call | 1 | Medium | remote draft request |
| No Hidden Side Effects | 1 | Medium | knowledge generation writes and store updates |

### Principles Respected

- Dependency direction is mostly clean: domain models do not import runtime code.
- Renderer routing is centralized and documented.
- Defaults are privacy-preserving.
- Converter execution uses `execFile`, not shell string execution.
- Release assets are verified and attested.

---

## 31. Architecture Analysis

### Architecture Summary

| Subtype | Count | Affected Areas | Recommended Action |
|---------|-------|----------------|-------------------|
| ModuleBoundary | 2 | renderers, knowledge generation | Split by controller/helper responsibility |
| DependencyDirection | 0 | none confirmed | Keep existing preview/domain boundaries |
| StateOwnership | 1 | plugin store | Add serialized persistence owner |
| BoundaryContract | 2 | converter script, artifact generation | Add explicit script/artifact contracts |
| EvolutionRisk | 2 | renderer migration, CAD conversion | Add narrow tests before refactors |

The project architecture is serviceable. The path forward is extraction, not rewrite: keep the existing public interfaces and move volatile logic out of large classes.

## 32. Documentation Analysis

### Documentation Summary

| Subtype | Count | Affected Docs | Recommended Action |
|---------|-------|---------------|-------------------|
| UserDocs | 0 | README | Keep current install/usage docs |
| OperatorDocs | 1 | README / troubleshooting | Add recovery notes for partial knowledge output |
| DeveloperDocs | 0 | development handoff | Keep verification matrix updated |
| ApiDocs | 1 | remote draft contract | Document timeout and response contract after implementation |
| DecisionRecord | 0 | routing docs | Existing renderer decision docs are useful |
| StaleDocs | 0 | none confirmed | Continue changelog discipline |

## 33. Privacy / Data Governance Analysis

### Privacy Summary

| Subtype | Count | Affected Data | Recommended Action |
|---------|-------|---------------|-------------------|
| DataInventory | 1 | model paths, annotations, reports, sidecars | Add a compact data inventory table to docs |
| Minimization | 0 | remote draft | Existing defaults minimize remote data |
| AccessBoundary | 0 | local vault | Obsidian vault access is user-local |
| Retention | 1 | snapshots, sidecars, part notes | Document retention/cleanup behavior |
| Deletion | 1 | generated artifacts | Add cleanup/reconciliation command later |
| Export | 0 | diagnostics | Add redacted diagnostics mode |
| TelemetryPrivacy | 0 | none | No telemetry observed |

## 34. Accessibility / UX Correctness Analysis

### Accessibility Summary

| Subtype | Count | Affected Workflows | Recommended Action |
|---------|-------|-------------------|-------------------|
| SemanticStructure | 1 | focusable preview canvas | Add accessible name/role |
| KeyboardFocus | 1 | inline preview shortcuts | Verify keyboard path in preview harness |
| ResponsiveVisual | 0 | not confirmed | Keep visual harness screenshots |
| ErrorState | 0 | load feedback | Existing feedback component uses text |
| LoadingState | 0 | direct view | Existing generation guard present |
| UXStateCorrectness | 0 | not confirmed | Continue route/status panel checks |

## 35. Supply Chain / Reproducibility Analysis

### Supply Chain Summary

| Subtype | Count | Affected Surface | Recommended Action |
|---------|-------|------------------|-------------------|
| DependencyProvenance | 0 | npm packages | npm audit clean |
| Reproducibility | 1 | workflow install | Consider `npm ci` once lockfile stability issue is resolved |
| CIIntegrity | 1 | GitHub Actions tags | Consider SHA pinning for stricter provenance |
| ArtifactProvenance | 0 | release assets | Attestations are present |
| RegistryHygiene | 0 | package release | Private package; release assets limited |

## 36. Cost / Resource Economics Analysis

### Cost Summary

| Subtype | Count | Cost Driver | Recommended Action |
|---------|-------|-------------|-------------------|
| UnboundedWork | 1 | remote request wait | Add timeout |
| ExternalApiCost | 1 | optional draft service | Add retry/rate/budget guidance if remote service becomes shared |
| LLMCost | 0 | client only | No model billing in repo |
| InfrastructureSizing | 0 | local plugin | Not applicable |
| ObservabilityCost | 0 | console logs | Low volume |
| CostVisibility | 1 | release bundle size | Track bundle size in release notes |

## 37. AI / LLM Safety Analysis

### AI Safety Summary

| Subtype | Count | Boundary Crossed | Recommended Action |
|---------|-------|------------------|-------------------|
| PromptInjection | 0 | client only | No prompt tool execution found |
| ToolAuthorization | 0 | none | Model output does not trigger tools |
| RAGLeakage | 0 | none | No retrieval service |
| ModelFallback | 0 | none | No model fallback implemented |
| OutputValidation | 1 | remote draft response | Keep normalizer tests and add malicious markdown cases |
| EvalGap | 1 | remote draft safety | Add negative-case eval fixtures if server is added |
| AbuseCost | 1 | remote draft endpoint | Add timeout/budget |

## 38. Observability / Operability Analysis

### Signal Summary

| Subtype | Count | Critical Signals Missing | Recommended Action |
|---------|-------|--------------------------|-------------------|
| Logging | 1 | save/generation failure durability | Surface persistent warnings |
| Metrics | 0 | local plugin | Not applicable |
| Tracing | 0 | local plugin | Not applicable |
| HealthCheck | 1 | converter setup | Existing diagnostics are good; add recovery status |
| Alerting | 0 | local plugin | Not applicable |
| Runbook | 1 | partial knowledge generation | Add recovery guidance |
| Debuggability | 0 | diagnostics | Existing diagnostics are useful |

## 39. Configuration Safety Analysis

### Configuration Summary

| Subtype | Count | Affected Keys / Files | Recommended Action |
|---------|-------|-----------------------|-------------------|
| SchemaValidation | 1 | persisted settings | Add runtime schema for loaded data |
| UnsafeDefault | 0 | defaults | Defaults are conservative |
| EnvironmentSeparation | 0 | converter env vars | Discovery is centralized |
| SecretConfig | 0 | remote URL | Diagnostics omit service URL |
| FeatureFlag | 1 | Experimental Three workbench | Keep tests/docs tied to flag |
| ConfigDocs | 0 | README/settings | Adequate coverage |

## 40. Data Integrity Analysis

### Integrity Summary

| Subtype | Count | Invariants at Risk | Recommended Action |
|---------|-------|-------------------|-------------------|
| TransactionBoundary | 1 | report/index/sidecar/profile consistency | Add generation manifest |
| Idempotency | 1 | repeated note generation | Make artifact writer idempotent and recoverable |
| ConcurrencyConsistency | 1 | persisted store state | Serialize saves |
| MigrationSafety | 0 | settings | `verify:settings` passed |
| InvariantValidation | 1 | persisted profile records | Add runtime schema over time |
| BackupRestore | 1 | generated artifacts | Add reconciliation command |
| Reconciliation | 1 | profiles vs sidecars | Rebuild links from sidecars/index |

## 41. Fallback / Defensive Code Analysis

### Fallback Summary

| Subtype | Count | KeepWithAlert | FailFast | Remove |
|---------|-------|---------------|----------|--------|
| SilentFallback | 1 | 1 | 0 | 0 |
| EmptyCatch | 1 | 0 | 1 | 0 |
| CompatibilityBranch | 2 | 2 | 0 | 0 |
| SilentCorrection | 0 | 0 | 0 | 0 |
| DefensiveGuess | 0 | 0 | 0 | 0 |

The Three-to-Babylon route fallback is appropriate and documented. The folder-create warning path in knowledge generation should become either fail-fast or explicitly recoverable.

## 42. Testing Authenticity Analysis

### Confidence Assessment

| Test Area | Real Confidence | Risk | Action |
|-----------|-----------------|------|--------|
| Preview verification | High | Browser route regressions | Keep and expand accessibility checks |
| Knowledge index verifier | High | Managed index refresh regressions | Keep |
| Remote draft verifier | High | Privacy regressions | Add timeout case |
| Vitest unit suite | Medium | Core modules are mostly uncovered | Augment |
| Release verifier | High | Asset/version mismatch | Keep |

### Valuable Tests

The verification scripts exercise behavior that unit tests cannot easily cover, especially browser rendering and generated markdown/index behavior.

### Suspicious Tests

No over-mocked tests were confirmed. The concern is missing coverage, not fake coverage.

### Missing Tests

Add focused tests for store persistence ordering, knowledge artifact partial failures, converter script rendering, and accessibility names.

---

## 43. Type Safety Analysis

### Summary

| Subtype | Count | Critical | High | Medium | Low |
|---------|-------|----------|------|--------|-----|
| UnsafeBlock | 0 | 0 | 0 | 0 | 0 |
| TypeAssertion | 1 | 0 | 0 | 0 | 1 |
| InputBoundary | 1 | 0 | 0 | 1 | 0 |
| OutputLeak | 0 | 0 | 0 | 0 | 0 |
| BooleanTrap | 0 | 0 | 0 | 0 | 0 |
| StringlyTyped | 1 | 0 | 0 | 0 | 1 |
| ErrorType | 1 | 0 | 0 | 0 | 1 |

The type system is used well enough for current scale. Runtime schemas at persisted and sidecar boundaries would improve safety more than broad type refactors.

## 44. Frontend State Analysis

### Summary

| Subtype | Count | Affected Components |
|---------|-------|-------------------|
| ComponentSize | 2 | helper toolbar, direct view |
| StateDuplication | 0 | none confirmed |
| PropDrilling | 0 | not applicable |
| EffectChain | 0 | no framework effects |
| UIBusinessCoupling | 1 | helper toolbar capability sync |
| DOMasState | 1 | toolbar/calibration panel state |
| RequestState | 1 | direct model load generation guard |
| RenderPerf | 0 | not confirmed |

## 45. Backend API Analysis

### Summary

| Subtype | Count | Affected Endpoints |
|---------|-------|-------------------|
| ApiConsistency | 0 | not applicable |
| Validation | 0 | optional client only |
| Auth | 0 | not applicable |
| NplusOne | 0 | not applicable |
| Caching | 0 | not applicable |
| ErrorResponse | 0 | optional remote service not in repo |
| BusinessLogic | 0 | not applicable |
| DataFlow | 0 | client request only |

No backend API server was present.

## 46. Dependency Weight Analysis

### Dependency Scoreboard

| Dependency | Status | Weight | Transitives | Used For | Recommended Action |
|------------|--------|--------|-------------|----------|-------------------|
| `three` | Healthy | large runtime | included in lockfile | primary single-model renderer | Keep |
| `@babylonjs/core` | Healthy but heavy | large runtime | included in lockfile | 3dgrid and fallback renderer | Keep until route migration evidence changes |
| `@babylonjs/loaders` | Healthy | medium runtime | included in lockfile | GLTF/OBJ/Babylon loader support | Keep |
| `playwright-core` | Healthy dev dependency | dev only | many transitive dependencies | preview harness | Keep |
| TypeScript/Vitest/ESLint | Healthy dev dependencies | dev only | normal | checks and tests | Keep |

## 47. Recommended Fix Order

### Fix Immediately

No critical or high-severity issues were found.

### Fix Before Stable Release

1. Serialize plugin store saves and add save-order tests.
2. Add a pending/success generation marker for knowledge artifacts.
3. Add remote draft timeout behavior.
4. Add unit tests around store, knowledge artifact writes, and converter script rendering.

### Schedule Later

1. Split Three/Babylon preview classes by controller responsibility.
2. Move generated converter scripts into first-class template/script assets.
3. Add redacted diagnostics mode.
4. Add accessibility checks for focusable canvases.

### Ignore for Now

Do not rewrite the renderer stack wholesale. The current split between Three and Babylon is documented, tested, and appropriate for the product contract.

## 48. Quick Wins

| Quick win | Value | Effort |
|-----------|-------|--------|
| Add `aria-label` to focusable preview canvases | Improves keyboard/screen-reader usability | 1-2 hours |
| Add remote draft timeout wrapper | Prevents stuck note generation | 3-6 hours |
| Add store save-order unit test | Locks down persistence correctness | 2-3 hours |
| Add redacted diagnostics mode | Reduces public support-report privacy risk | 2-4 hours |
| Add `python -m py_compile` check for rendered CAD script | Catches syntax regressions before users hit converters | 2-4 hours |

## 49. Long-term Refactor Plan

1. Renderer modularization: extract shared measurement, evidence, selection, camera, and lifecycle helpers while keeping `WorkbenchPreview` stable. Test each extracted helper with pure unit tests and retain preview harness coverage.
2. Knowledge artifact writer: introduce a small writer/reconciler module responsible for pending/success state, idempotent writes, and recovery. Test with a fake vault that can fail at each write phase.
3. Converter script assets: move embedded Python into script templates with syntax checks and a minimal contract test. Keep TypeScript responsible for invocation, cache identity, and output validation only.
4. Testing strategy cleanup: keep browser/Obsidian verification for integrated behavior, but add a unit-test floor for store, routing, conversion, artifact writing, and remote draft edge cases.
