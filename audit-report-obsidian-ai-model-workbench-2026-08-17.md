# Fuck My Shit Mountain Audit Report

**Project:** AI Model Workbench for Obsidian
**Audit mode:** full
**Date:** 2026-08-17
**Reviewer:** OpenAI Codex (GPT-5)

---

## 1. Executive Summary

AI Model Workbench is a capable local-first Obsidian plugin with unusually strong verification for a desktop plugin: strict TypeScript, 308 passing tests, real Playwright preview coverage across both renderers, an Obsidian smoke harness, release checksums, and a clean production dependency audit. The renderer-neutral contracts and explicit Babylon/Three routing policy are sound architectural choices. No critical or high-severity project finding was confirmed, and no credential material was found in the repository scan.

The main risks sit at trust boundaries and feature-growth pressure points. Persisted plugin data is asserted into trusted types without runtime normalization; optional remote drafting can send broader private context than its consent label promises and can use plaintext HTTP; conversion timeouts can release the deduplication lock while work is still running; knowledge artifacts are updated in an order that can expose partial generations; and measurement snapping performs a full vertex-and-edge scan on every hover frame. The two renderer scene classes have also accumulated enough duplicated state-machine behavior that future parity fixes are becoming expensive.

Release engineering is better than average but not yet self-enforcing: the release workflow uses `npm install`, omits the core test suite, and there is no pull-request CI workflow. Five high-rated upstream advisories exist only in the development toolchain and are fixable through the lockfile; production dependencies report zero vulnerabilities. Overall, the project is stable enough to improve incrementally rather than through a rewrite.

### Score Dashboard

```text
Security        ████████░░  7.8  A   Local-first guards are strong; remote HTTP and privacy scope need tightening
Stability       ███████░░░  7.1  A   Good lifecycle tests; timeout dedupe and partial writes remain
Performance     ███████░░░  7.0  A   Cached geometry extraction; hover snapping still scans all candidates
Testing         ████████░░  8.0  A   308 tests and real preview harness; no PR CI gate
Maintainability ██████░░░░  5.8  B   Renderer scenes and verification scripts are oversized
Design          ██████░░░░  6.4  B   Good renderer ports; duplicated controllers weaken SRP and DRY
Release         ███████░░░  6.5  B   Checksums and attestation; non-deterministic install and stale docs
──────────────────────────────────────────────────────────────────────────────
Overall         ███████░░░  6.9  B
```

Each dimension is scored from 0.0 to 10.0, where 10 is clean. Scores are evidence-based engineering judgments, not a mechanical average of finding counts.

### Finding Statistics

| Severity | Count | Confirmed | Suspected |
|----------|-------|-----------|-----------|
| Critical | 0 | 0 | 0 |
| High | 0 | 0 | 0 |
| Medium | 10 | 10 | 0 |
| Low | 1 | 1 | 0 |
| Info | 0 | 0 | 0 |
| **Total** | **11** | **11** | **0** |

## 2. Project Map

The Obsidian entry point is `src/main.ts`. Persisted settings, conversion records, and registered-part state are owned by `src/store/plugin-store.ts`; user settings are defined in `src/settings.ts`. Inline previews and direct-file views create renderer-neutral preview sessions from `src/render/preview`, then route to the Babylon implementation in `src/render/babylon/scene.ts` or the opt-in Three implementation in `src/render/three/scene.ts`. Both renderers implement model loading, camera and light control, selection, measurement, slicing, annotations, and disposal.

Local format conversion is orchestrated by `src/io/conversion`, with Python/CadQuery/OCCT and other local executables forming an explicit host trust boundary. Converted outputs are indexed by `src/io/cache/converted-asset-cache.ts`. Knowledge generation in `src/view/workbench/knowledge-note.ts` writes report, sidecar, index, and model-profile artifacts. Optional remote drafting in `src/view/workbench/remote-draft.ts` is the only first-party network boundary and is disabled by default.

The highest-risk surfaces are persisted-data hydration, remote drafting, conversion concurrency, multi-file knowledge writes, and the large renderer scene classes. Generated `main.js` is intentionally checked in for Obsidian distribution and was treated as an output artifact rather than the primary review source.

### Coverage Matrix

| Dimension | Coverage | Evidence inspected | Exclusions / limits |
|-----------|----------|--------------------|---------------------|
| Architecture | High | Entry point, store, renderer ports/backends, conversion and knowledge flows | No historical commit archaeology |
| Security | High | Network guards, remote draft, converter execution, secret scan, dependency audit | No dynamic penetration test against a hostile vault |
| Stability | High | Lifecycle/disposal, conversion manager, persistence, knowledge writes, 308 tests | No multi-hour soak test |
| Performance | Medium | Hot render paths, snap algorithm, cache bounds, bundle size | No GPU profile on low-end hardware |
| Testing | High | Vitest suite, Playwright harnesses, Obsidian verifier, release checks | Obsidian UI automation remains smoke-level |
| Maintainability | High | File size, TODOs, duplication, ownership boundaries | No contributor survey |
| Design | High | Renderer interfaces, state machines, principle rubric | Visual design was sampled, not exhaustively critiqued |
| Release | High | Package scripts, release workflow, manifest/version/checksums | No live GitHub release was created |
| Documentation | High | README files, handoff, routing matrix, changelog, security docs | External marketplace listing not inspected |
| Configuration | High | Settings type/defaults, settings UI, persisted hydration | Unknown user-local settings files not sampled |
| Observability | Medium | Diagnostics module, console/log paths, verifier output | No production telemetry exists by design |
| Data Integrity | High | Cache records, conversion outputs, knowledge write order | Host filesystem crash injection not performed |
| Privacy | High | Remote payload construction and consent copy | No external endpoint implementation inspected |
| Accessibility | Medium | Button semantics, labels, keyboard metadata, native tooltips | No screen-reader session performed |
| Supply Chain | High | `npm audit`, lockfile, workflow actions, release assets | Action transitive internals not audited |
| Cost | Medium | CPU hot paths, cache caps, remote request shape | No production usage metrics exist |
| AI Safety | Medium | Remote prompt construction, payload sanitization, output handling | Model-provider behavior is outside this repository |
| Fallback | High | Renderer fallback, conversion fallback, timeout/error behavior | Platform-specific executable failures were not exhaustively simulated |
| Testing Authenticity | High | Test implementation and real browser/Obsidian harnesses | No mutation-testing score |
| Type Safety | High | Strict config, assertions, unknown boundaries, generic setters | Generated dependency declarations excluded |
| Frontend State | High | Preview controls, scene state, direct view, helper buttons | No framework devtools trace; UI is imperative DOM |
| Backend API | Not assessed | Remote-draft client contract only | Repository contains no backend service implementation |
| Dependency Weight | High | Direct dependencies, lockfile graph, built bundle | No source-map bundle treemap |
| Code Consistency | High | Naming, error handling, comments, file organization | Generated bundle excluded from style judgments |
| Comment Coverage | High | TODO convention, complex-path comments, documentation handoff | No automated comment-density metric used |

## 3. Top Risks

1. **Persisted state bypasses runtime validation (Medium):** malformed or stale Obsidian data can enter trusted code and crash cache hydration or silently corrupt settings.
2. **Remote drafting can use plaintext transport (Medium):** scheme-less endpoints become HTTP and non-loopback HTTP is accepted.
3. **Geometry consent includes unrelated private fields (Medium):** enabling geometry sharing also retains paths, notes, tags, and note references that the label does not disclose.
4. **Conversion timeout breaks in-flight deduplication (Medium):** a retry can launch a second converter against the same output while the first process continues.
5. **Knowledge artifact writes expose partial generations (Medium):** the index can point to report or sidecar files that failed to update.
6. **Measurement hover snapping is linear in all geometry candidates (Medium):** large selected assemblies can produce pointer-frame jank.
7. **Renderer scene classes duplicate large feature state machines (Medium):** selection, measurement, slicing, and lifecycle fixes can drift across backends.
8. **Release checks are not enforced on pull requests (Medium):** the only workflow is tag-driven and omits the main test suite.
9. **Development lockfile contains five fixable advisory groups (Medium):** production is clean, but build and verification tooling remains exposed.
10. **Routing documentation contradicts the implementation (Medium):** stale Three-default guidance can cause incorrect maintenance changes and support advice.
11. **Native hover tooltips remain in the preview surface (Low):** browser tooltips can obscure the model despite the product requirement to disable them.

## 4. Detailed Findings

### Finding: Persisted settings and cache records bypass runtime validation

- Severity: Medium
- Confidence: High
- Category: Stability, Configuration, Type Safety, Data Integrity
- Status: Confirmed
- Affected area: Plugin startup and persisted conversion cache
- Evidence: `src/store/plugin-store.ts:167-180` casts `loadData()` and merges nested values; `src/settings.ts:72-90` uses generic record casts; `src/io/cache/converted-asset-cache.ts:19-31,82-93` assumes typed records and calls `warnings.join()`.
- Problem: Data loaded from Obsidian is untrusted JSON but is asserted directly to `PersistedPluginState`. Nested settings and converted records are not normalized before trusted code uses them.
- Why it matters: Old plugin versions, hand-edited data, interrupted writes, or incompatible values can crash startup or create invalid behavior that the TypeScript compiler cannot prevent.
- Realistic failure scenario: A persisted converted record has `warnings: null`; cache normalization reaches `sameRecord`, calls `.join()`, and plugin loading fails before the user can repair settings through the UI.
- Minimal fix: Parse loaded data as `unknown`, normalize each setting against defaults, and admit converted records only through a runtime type guard.
- Better long-term fix: Add a versioned persisted-state schema with explicit migrations and a quarantined diagnostics record for rejected data.
- Regression test suggestion: Load malformed settings and cache records, assert startup succeeds, defaults are restored, and invalid records are discarded.
- Estimated effort: 0.5-1 day

### Finding: Remote drafting accepts insecure non-local HTTP endpoints

- Severity: Medium
- Confidence: High
- Category: Security, Privacy, Configuration
- Status: Confirmed
- Affected area: Optional remote drafting transport
- Evidence: `src/view/workbench/remote-draft.ts:35-53` prefixes scheme-less endpoints with `http://` and accepts both HTTP and HTTPS without restricting host scope.
- Problem: A user can configure a non-loopback remote endpoint that receives drafting evidence over plaintext HTTP.
- Why it matters: Model metadata and user-authored knowledge context can be observed or modified by an intermediary even though the feature is presented as an optional remote drafting service.
- Realistic failure scenario: A user enters `draft.example.com/api`; the plugin silently sends the request to `http://draft.example.com/api` on an untrusted network.
- Minimal fix: Default scheme-less endpoints to HTTPS and reject HTTP unless the hostname is loopback-local.
- Better long-term fix: Model endpoint security as an explicit validated configuration type and show transport status in converter/remote diagnostics.
- Regression test suggestion: Verify scheme-less public hosts become HTTPS, public HTTP is rejected, and localhost HTTP remains supported for development.
- Estimated effort: 1-2 hours

### Finding: Geometry-sharing consent retains unrelated private context

- Severity: Medium
- Confidence: High
- Category: Privacy, AI Safety, Documentation
- Status: Confirmed
- Affected area: Remote draft payload sanitization and settings copy
- Evidence: `src/view/workbench/remote-draft.ts:65-117` strips full paths, notes, tags, and annotation note references only when geometry sharing is disabled; `src/i18n/en.ts` describes the toggle as sharing mesh counts, bounds, parts, coordinates, and nearest-part links.
- Problem: Enabling geometry summary sharing broadens the payload beyond geometry and retains private user context not named by the consent label.
- Why it matters: Consent is not granular or accurately described, violating data minimization and making it difficult for users to predict what leaves the vault.
- Realistic failure scenario: A user enables geometry details to improve a draft and unintentionally sends vault paths, investigation notes, tags, and heading references to a third-party endpoint.
- Minimal fix: Always reduce paths to basenames and remove user notes, tags, note paths, and heading references; let the toggle control geometry fields only.
- Better long-term fix: Build remote payloads from an allowlisted transfer DTO with a previewable field inventory and versioned privacy contract.
- Regression test suggestion: With geometry enabled, assert private text and vault paths are absent while allowed counts, bounds, and coordinates remain.
- Estimated effort: 2-4 hours

### Finding: Conversion timeout releases deduplication before work finishes

- Severity: Medium
- Confidence: High
- Category: Stability, Performance, Cost, Data Integrity
- Status: Confirmed
- Affected area: Local conversion orchestration
- Evidence: `src/io/conversion/manager.ts:16-24` times out via `Promise.race` without cancellation; `src/io/conversion/manager.ts:68-87` stores the timed promise and removes it when that wrapper settles.
- Problem: The manager forgets an in-flight conversion when the caller timeout fires even though the underlying converter continues running.
- Why it matters: A retry can start duplicate CPU-heavy converters writing to the same destination, wasting resources and risking partial or nondeterministic output.
- Realistic failure scenario: A large STEP conversion exceeds the UI timeout, the user retries, and two CadQuery/OCCT processes concurrently replace the same GLB output.
- Minimal fix: Store the raw conversion promise in the pending map until the converter itself settles; apply timeout wrappers independently to callers.
- Better long-term fix: Add cancellable converter processes, per-job identifiers, temporary outputs, and atomic promotion after successful validation.
- Regression test suggestion: Time out the first caller, retry before the raw promise settles, and assert the converter runs once and the retry joins the same job.
- Estimated effort: 2-4 hours

### Finding: Measurement hover snapping scans every vertex and edge

- Severity: Medium
- Confidence: High
- Category: Performance, Frontend State, Cost
- Status: Confirmed
- Affected area: Short-distance measurement preview
- Evidence: `src/render/preview/measurement.ts:165-214` scans every vertex and edge for each snap query; `src/render/three/scene.ts:3816-3881` and `src/render/babylon/scene.ts:3186-3253` invoke snapping during pointer hover.
- Problem: Candidate extraction is cached, but nearest-point ranking remains O(vertices + edges) for every pointer update.
- Why it matters: Selected CAD assemblies can contain hundreds of thousands of candidates, turning a precision interaction into a frame-time bottleneck.
- Realistic failure scenario: Hovering over a dense PCB assembly while measuring causes visible lag, stale preview endpoints, and missed clicks.
- Minimal fix: Build a renderer-neutral spatial index with the candidate cache and retain linear search only below a small threshold.
- Better long-term fix: Use screen-space-aware hierarchical snapping with bounded candidate visitation and frame-budget instrumentation.
- Regression test suggestion: Assert indexed and linear snap results match for indexed/non-indexed geometry, then enforce a visitation bound for a large synthetic mesh.
- Estimated effort: 1-2 days

### Finding: Renderer scene classes duplicate oversized feature state machines

- Severity: Medium
- Confidence: High
- Category: Architecture, Maintainability, Design, Code Consistency
- Status: Confirmed
- Affected area: Babylon and Three preview backends
- Evidence: `src/render/three/scene.ts` is 4,250 lines and `src/render/babylon/scene.ts` is 3,572 lines; both own loading, camera, lights, selection, focus, measurement, slicing, annotations, performance, and disposal, with local decomposition TODOs near lines 348 and 370.
- Problem: Renderer adapters have become feature coordinators and duplicate the same workflow logic around renderer-specific primitives.
- Why it matters: Behavior changes must be implemented and verified twice, increasing parity drift and making narrow fixes risky.
- Realistic failure scenario: A measurement cleanup fix lands in Babylon but not Three, reproducing the persistent focus/highlight artifact only on the rollout path.
- Minimal fix: Extract one renderer-neutral controller at a time, beginning with measurement-session state and target locking.
- Better long-term fix: Keep scene adapters responsible only for graphics primitives while shared controllers own selection, measurement, slicing, annotations, and lifecycle transitions.
- Regression test suggestion: Contract-test both adapters against the same controller transition suite before moving each feature.
- Estimated effort: 1-3 weeks incrementally

### Finding: Release automation is not a deterministic CI gate

- Severity: Medium
- Confidence: High
- Category: Release, Testing, Supply Chain
- Status: Confirmed
- Affected area: GitHub Actions and release verification
- Evidence: `.github/workflows/release.yml` is the only workflow, uses `npm install`, and does not run `npm test`, `verify:settings`, `verify:remote-draft`, or the full preview success matrix.
- Problem: Pull requests and branch pushes have no automated quality gate, while tag builds can resolve a dependency tree differently from the committed lockfile and skip core behavior checks.
- Why it matters: A release can be produced from changes that were never tested in CI or from a subtly different dependency graph than local verification.
- Realistic failure scenario: A contributor changes persisted-state behavior, local tests are not run, and the tag workflow ships because typecheck/build alone pass.
- Minimal fix: Use `npm ci`, run the unit suite in release, and add a pull-request workflow for lint, typecheck, tests, and lightweight verification scripts.
- Better long-term fix: Split deterministic fast CI from browser/Obsidian integration jobs, publish machine-readable test artifacts, and require checks before merge/tagging.
- Regression test suggestion: Open a deliberately failing test PR and confirm required checks block merge and tag workflow execution.
- Estimated effort: 0.5 day

### Finding: Development toolchain has five fixable advisory groups

- Severity: Medium
- Confidence: High
- Category: Supply Chain, Release, Security
- Status: Confirmed
- Affected area: Locked development dependencies
- Evidence: `npm audit --json` reports high-rated advisories in transitive `brace-expansion`, `fast-uri`, `js-yaml`, `nanoid`, and `postcss`; `npm audit --omit=dev --json` reports zero production vulnerabilities; `npm audit fix --dry-run` reports lockfile-compatible upgrades.
- Problem: Build, lint, test, and packaging tools use known-vulnerable transitive versions even though runtime dependencies are clean.
- Why it matters: Development-only exposure has a lower project impact than runtime exposure, but CI and contributor machines still process repository-controlled inputs through this graph.
- Realistic failure scenario: A crafted fixture or dependency metadata triggers a vulnerable parser during CI, or a release remains blocked later when audit enforcement is added.
- Minimal fix: Run the non-breaking audit fix, review the lockfile delta, rerun all checks, and require zero known production advisories.
- Better long-term fix: Add scheduled dependency review, automated update PRs, and a documented policy that distinguishes runtime from development advisory thresholds.
- Regression test suggestion: Run both full and production-only audit commands in CI and fail according to the documented severity policy.
- Estimated effort: 1-2 hours

### Finding: Knowledge generation updates the index before dependent artifacts

- Severity: Medium
- Confidence: High
- Category: Data Integrity, Stability
- Status: Confirmed
- Affected area: Knowledge report, sidecar, index, and profile generation
- Evidence: `src/view/workbench/knowledge-note.ts:1400-1414` updates the knowledge index before the sidecar and report writes at lines 1426-1434.
- Problem: A multi-file generation has no transaction boundary and writes the discoverability index before the files it references are guaranteed to exist or be current.
- Why it matters: A filesystem error can leave a plausible-looking index that points to missing or stale evidence, undermining trust in generated knowledge.
- Realistic failure scenario: The index update succeeds, the report write fails due to a locked file, and users navigate from the index to an older report while assuming generation completed.
- Minimal fix: Write sidecar and report first and update the index last; do not mark the model profile successful until every required write succeeds.
- Better long-term fix: Stage artifacts under temporary names, validate them, atomically promote each file, and store a generation identifier for reconciliation.
- Regression test suggestion: Inject a report-write failure and assert the index and success profile remain unchanged.
- Estimated effort: 0.5-1 day

### Finding: Routing and version documentation contradict current behavior

- Severity: Medium
- Confidence: High
- Category: Documentation, Maintainability, Release
- Status: Confirmed
- Affected area: Developer handoff and bilingual user documentation
- Evidence: `docs/development-handoff.md:11,249-253` references 0.7.6 and calls Three the single-model main path despite the Babylon-default contract at lines 26-55; `README.zh-CN.md:523-534` repeats Three-default routing; package and manifest versions are 0.7.8.
- Problem: Authoritative-looking documents disagree with the code and with each other about the production renderer and current release.
- Why it matters: Maintainers and support agents can broaden the wrong backend, recommend incorrect troubleshooting, or omit required compatibility verification.
- Realistic failure scenario: A contributor follows the stale handoff direction and changes Three only for a default preview bug that users encounter in Babylon.
- Minimal fix: Update version references and route tables to the current Babylon-default contract, linking the routing matrix as the source of truth.
- Better long-term fix: Generate version badges and routing summaries from checked configuration or verify them with a documentation consistency script.
- Regression test suggestion: Add a script that compares package/manifest/handoff versions and checks documented default renderer tokens.
- Estimated effort: 1-2 hours

### Finding: Native hover tooltips remain in the model preview

- Severity: Low
- Confidence: High
- Category: Accessibility, UX Correctness, Testing
- Status: Confirmed
- Affected area: Inline preview controls and caption
- Evidence: `src/view/inline/helper-buttons.ts:531,567`, `src/view/inline/zoom-control.ts:75`, and `src/view/inline/code-block.ts:235` set native `title` attributes; `scripts/verify-preview.mjs:377-423` checks only the canvas for tooltip attributes.
- Problem: Browser-native tooltips still appear over the preview despite the explicit product requirement to disable hover tooltips.
- Why it matters: Delayed native bubbles obscure model details and create inconsistent behavior across controls; accessible names already exist through ARIA and do not require `title`.
- Realistic failure scenario: A user pauses over the measurement button or model caption while placing a precise point and a tooltip covers the target geometry.
- Minimal fix: Remove preview `title`/`data-tooltip` attributes and retain `aria-label` or `aria-valuetext` for assistive technology.
- Better long-term fix: Centralize preview control creation and add a DOM policy test for forbidden native tooltip attributes.
- Regression test suggestion: Query the entire preview root and toolbar for `[title]` and `[data-tooltip]` in both normal and measurement states.
- Estimated effort: Under 1 hour

## 5. Architecture Concerns

- Coverage: High
- Inspected evidence: `src/main.ts`, store, preview contracts, both renderer scenes, conversion and knowledge boundaries
- Exclusions / limits: Historical architectural decisions were read from current handoff documents, not reconstructed from all commits.

The renderer-neutral interfaces are a strong port boundary, and conservative routing limits blast radius. The primary concern is ownership leakage: the renderer scenes coordinate application workflows in addition to graphics. Persisted-state validation is also missing at a major architecture boundary. Incremental controller extraction is preferable to a renderer rewrite.

## 6. Security Concerns

- Coverage: High
- Inspected evidence: Remote draft transport/payload, external-resource guards, converter command execution, secret patterns, npm advisories
- Exclusions / limits: No hostile endpoint or malicious model fuzzing campaign was run.

Production dependencies are clean, raw-model upload is blocked, converter execution uses argument arrays instead of shell concatenation, and remote renderer resources are guarded. Confirmed security debt is limited to optional plaintext remote drafting and development advisories. No secrets were found.

## 7. Stability Concerns

- Coverage: High
- Inspected evidence: Conversion manager, cache hydration, scene disposal, knowledge generation, full tests
- Exclusions / limits: No long-duration GPU or process soak test.

The most credible failure modes are malformed persisted data, duplicate work after conversion timeout, and partial knowledge generations. Renderer disposal and fallback paths have meaningful automated coverage.

## 8. Performance Concerns

- Coverage: Medium
- Inspected evidence: Measurement hot path, candidate caches, renderer loop controls, bounded local caches, bundle output
- Exclusions / limits: No hardware matrix or formal frame-time capture.

The measurement snap query should be indexed before precision selection is promoted for very large CAD assemblies. Dual renderer weight is intentional, and existing visibility/disposal controls reduce background work. Cache record counts and ages are bounded.

## 9. Testing Gaps

- Coverage: High
- Inspected evidence: 50 Vitest files, 308 passing tests, preview and Obsidian harnesses, release scripts
- Exclusions / limits: No mutation testing and no full assistive-technology run.

Missing high-value tests target malformed persisted state, timeout/retry deduplication, geometry-enabled privacy, knowledge write failures, and DOM-wide tooltip policy. The absence of PR CI makes every existing test optional in practice.

## 10. Maintainability Concerns

- Coverage: High
- Inspected evidence: File inventory, line counts, duplication, TODOs, module boundaries
- Exclusions / limits: Contributor onboarding time was not measured.

`src/render/three/scene.ts`, `src/render/babylon/scene.ts`, `src/view/workbench/knowledge-note.ts`, and `src/view/inline/helper-buttons.ts` exceed 1,000 lines. The first two carry the highest coordination complexity. Extraction should follow feature ownership and shared contract tests, not arbitrary line-count splits.

## 11. Design / Principles Concerns

- Coverage: High
- Inspected evidence: Preview interfaces, scene responsibilities, setting controls, state transitions
- Exclusions / limits: Product visual language was not exhaustively scored.

The design respects interface segregation at renderer boundaries but violates single responsibility inside renderer implementations. Generic setting mutation and unvalidated hydration also weaken fail-fast behavior. UI controls generally use appropriate buttons, labels, and stable toolbar structure.

## 12. Release Concerns

- Coverage: High
- Inspected evidence: `.github/workflows/release.yml`, package scripts, manifest, versions, release verifier
- Exclusions / limits: A live marketplace submission and rollback were not exercised.

Release assets have checksums and provenance verification, but the dependency install is not lockfile-strict and the workflow skips unit tests. A fast required PR workflow is the largest release-quality improvement.

## 13. Documentation Analysis

- Coverage: High
- Inspected evidence: English and Chinese READMEs, development handoff, routing matrix, changelog, security and format docs
- Exclusions / limits: External posts and marketplace copy were not inspected.

### Documentation Summary

| Subtype | Count | Affected Docs | Recommended Action |
|---------|-------|---------------|-------------------|
| UserDocs | 1 | `README.zh-CN.md` | Correct renderer routing |
| OperatorDocs | 0 | Release/security docs | Keep current verification commands |
| DeveloperDocs | 1 | `docs/development-handoff.md` | Update version and product direction |
| ApiDocs | 0 | Internal TypeScript contracts | No public API documentation required |
| DecisionRecord | 0 | Routing matrix | Continue treating it as source of truth |
| StaleDocs | 1 | README release highlights | Remove stale release-centric wording |

## 14. Configuration Safety Analysis

- Coverage: High
- Inspected evidence: Setting defaults/types/UI, persisted store hydration, endpoint normalization
- Exclusions / limits: User-local plugin data was not collected.

### Configuration Summary

| Subtype | Count | Affected Keys / Files | Recommended Action |
|---------|-------|-----------------------|-------------------|
| SchemaValidation | 1 | Persisted settings and cache records | Validate and migrate at startup |
| UnsafeDefault | 1 | Scheme-less remote endpoint | Default to HTTPS |
| EnvironmentSeparation | 0 | Renderer/converter settings | Current separation is explicit |
| SecretConfig | 0 | API key setting | Existing redaction rules are adequate |
| FeatureFlag | 0 | Three rollout flags | Documented with routing tests |
| ConfigDocs | 1 | Remote geometry consent | Narrow and clarify shared fields |

## 15. Observability / Operability Analysis

- Coverage: Medium
- Inspected evidence: Diagnostics exports, converter diagnostics, verifier logs, error notices
- Exclusions / limits: No production telemetry exists, consistent with a local-first plugin.

### Signal Summary

| Subtype | Count | Critical Signals Missing | Recommended Action |
|---------|-------|--------------------------|-------------------|
| Logging | 0 | None critical | Keep redaction and concise console output |
| Metrics | 1 | Snap candidate/query cost | Add development-only frame diagnostics |
| Tracing | 0 | Not applicable | Local request correlation is sufficient |
| HealthCheck | 0 | Not applicable | Converter diagnostics cover dependencies |
| Alerting | 0 | Not applicable | User notices are appropriate |
| Runbook | 0 | None critical | Existing handoff and troubleshooting are strong |
| Debuggability | 0 | None critical | Preview failure artifacts are useful |

## 16. Data Integrity Analysis

- Coverage: High
- Inspected evidence: Converted cache records, conversion output ownership, knowledge artifact writes, model profile updates
- Exclusions / limits: Power-loss behavior was inferred from write order rather than physically injected.

### Integrity Summary

| Subtype | Count | Invariants at Risk | Recommended Action |
|---------|-------|-------------------|-------------------|
| TransactionBoundary | 1 | Index references current report/sidecar | Write dependencies before index |
| Idempotency | 1 | One conversion per input/settings key | Keep raw promise registered |
| ConcurrencyConsistency | 1 | Single writer per converted output | Add cancellable jobs and atomic promotion |
| MigrationSafety | 1 | Persisted state matches runtime types | Version and normalize state |
| InvariantValidation | 1 | Cache record fields are usable | Add runtime guard |
| BackupRestore | 0 | Vault remains user-owned | No special backup layer required |
| Reconciliation | 1 | Knowledge index matches files | Add generation identifiers later |

## 17. Privacy / Data Governance Analysis

- Coverage: High
- Inspected evidence: Remote payload construction, consent copy, path sanitization, local cache behavior
- Exclusions / limits: Remote provider retention policy is outside the repository.

### Privacy Summary

| Subtype | Count | Affected Data | Recommended Action |
|---------|-------|---------------|-------------------|
| DataInventory | 1 | Geometry versus user-authored context | Publish an allowlisted payload inventory |
| Minimization | 1 | Paths, notes, tags, note references | Always strip from remote DTO |
| AccessBoundary | 1 | Optional remote endpoint | Require secure public transport |
| Retention | 0 | Local generated artifacts | User controls vault retention |
| Deletion | 0 | Converted cache | Existing age/count pruning is present |
| Export | 0 | Knowledge notes | Vault-native files are portable |
| TelemetryPrivacy | 0 | Diagnostics | No default telemetry found |

## 18. Accessibility / UX Correctness Analysis

- Coverage: Medium
- Inspected evidence: Preview controls, ARIA labels, canvas keyboard metadata, measurement status, tooltip attributes
- Exclusions / limits: No screen-reader or high-contrast manual session.

### Accessibility Summary

| Subtype | Count | Affected Workflows | Recommended Action |
|---------|-------|-------------------|-------------------|
| SemanticStructure | 0 | Preview toolbar | Existing button semantics are sound |
| KeyboardFocus | 0 | Canvas and toolbar | Keep current keyboard metadata/tests |
| ResponsiveVisual | 0 | Desktop/mobile preview | Existing harness covers viewport layout |
| ErrorState | 0 | Conversion/preview failure | Notices and fallback diagnostics exist |
| LoadingState | 0 | Model loading | Current state handling is explicit |
| UXStateCorrectness | 1 | Hovering model controls | Remove native tooltip attributes |

## 19. Supply Chain / Reproducibility Analysis

- Coverage: High
- Inspected evidence: Direct dependencies, lockfile, npm audits, GitHub workflow, release checksum verifier
- Exclusions / limits: GitHub-hosted runner image internals were not audited.

### Supply Chain Summary

| Subtype | Count | Affected Surface | Recommended Action |
|---------|-------|------------------|-------------------|
| DependencyProvenance | 1 | Five dev transitive advisory groups | Refresh lockfile and monitor |
| Reproducibility | 1 | Release dependency install | Use `npm ci` |
| CIIntegrity | 1 | Pull requests and tags | Add required CI and unit test gate |
| ArtifactProvenance | 0 | Release bundle | Checksums and attestation are strong |
| RegistryHygiene | 0 | Obsidian release assets | Release verifier constrains files |

## 20. Cost / Resource Economics Analysis

- Coverage: Medium
- Inspected evidence: Measurement query complexity, conversion deduplication, cache caps, optional remote request count
- Exclusions / limits: No fleet or billing data exists for a local desktop plugin.

### Cost Summary

| Subtype | Count | Cost Driver | Recommended Action |
|---------|-------|-------------|-------------------|
| UnboundedWork | 2 | Snap scans and duplicate converters | Index candidates; preserve job dedupe |
| ExternalApiCost | 0 | Optional draft endpoint | One explicit request per action |
| LLMCost | 0 | Provider-specific usage | Endpoint owner controls billing |
| InfrastructureSizing | 0 | Local desktop runtime | Not applicable |
| ObservabilityCost | 0 | Local diagnostics | No telemetry ingestion |
| CostVisibility | 1 | Large local conversion duration | Surface active job and elapsed time |

## 21. AI / LLM Safety Analysis

- Coverage: Medium
- Inspected evidence: Remote draft payload, prompt composition, raw-model exclusion, output sanitization
- Exclusions / limits: The remote model and service implementation are not present.

### AI Safety Summary

| Subtype | Count | Boundary Crossed | Recommended Action |
|---------|-------|------------------|-------------------|
| PromptInjection | 0 | Evidence text to draft model | Output is treated as draft text, not commands |
| ToolAuthorization | 0 | No model-controlled tools | Keep deterministic local action boundary |
| RAGLeakage | 1 | Vault context to remote endpoint | Use a strict allowlisted DTO |
| ModelFallback | 0 | Local versus remote drafting | Remote is explicit and optional |
| OutputValidation | 0 | Draft response | Existing sanitization is adequate for note text |
| EvalGap | 1 | Privacy contract | Add geometry-enabled payload tests |
| AbuseCost | 0 | User-triggered request | No autonomous request loop found |

## 22. Fallback / Defensive Code Analysis

- Coverage: High
- Inspected evidence: Renderer fallback, external resource guards, converter fallback, timeout and disposal paths
- Exclusions / limits: Every platform-specific executable failure was not simulated.

### Fallback Summary

| Subtype | Count | KeepWithAlert | FailFast | Remove |
|---------|-------|---------------|----------|--------|
| SilentFallback | 1 | 1 | 0 | 0 |
| EmptyCatch | 0 | 0 | 0 | 0 |
| CompatibilityBranch | 2 | 2 | 0 | 0 |
| SilentCorrection | 1 | 0 | 1 | 0 |
| DefensiveGuess | 1 | 0 | 1 | 0 |

Renderer fallback is intentional, documented, and covered by route verification. The unsafe defensive guesses are persisted-state assertions and scheme-less HTTP normalization; both should become explicit validation outcomes.

## 23. Testing Authenticity Analysis

- Coverage: High
- Inspected evidence: Vitest source, Playwright preview harness, Obsidian smoke harness, failure artifacts
- Exclusions / limits: No mutation test was run.

### Confidence Assessment

| Test Area | Real Confidence | Risk | Action |
|-----------|-----------------|------|--------|
| Renderer-neutral domain logic | High | Boundary corruption cases are missing | Keep and extend |
| Babylon/Three preview matrix | High | Hardware-specific GPU defects can escape | Keep |
| Obsidian integration | Medium | Smoke assertions do not cover every interaction | Keep and deepen selectively |
| Remote drafting | Medium | Geometry-enabled privacy scope is untested | Extend |
| Release process | Medium | Workflow itself is not exercised on PRs | Add CI gate |

### Valuable Tests

The measurement geometry tests, renderer route harness, external-resource guards, knowledge-index checks, and real Obsidian launch smoke test provide genuine regression protection. They execute real algorithms and browser behavior instead of only verifying mocks.

### Suspicious Tests

No test file was identified as wholly fake or assertion-free. Some imperative UI tests rely on helper stubs, but they are complemented by Playwright and Obsidian-level checks.

### Missing Tests

Malformed persisted data, post-timeout conversion retries, private-field exclusion with geometry enabled, failed multi-file knowledge writes, and preview-wide native tooltip absence need explicit regression coverage.

## 24. Type Safety Analysis

- Coverage: High
- Inspected evidence: Strict compiler settings, assertions, unknown boundaries, settings generic helpers, cache record use
- Exclusions / limits: Third-party declaration quality was not independently audited.

### Summary

| Subtype | Count | Critical | High | Medium | Low |
|---------|-------|----------|------|--------|-----|
| UnsafeBlock | 0 | 0 | 0 | 0 | 0 |
| TypeAssertion | 2 | 0 | 0 | 1 | 1 |
| InputBoundary | 2 | 0 | 0 | 2 | 0 |
| OutputLeak | 0 | 0 | 0 | 0 | 0 |
| BooleanTrap | 0 | 0 | 0 | 0 | 0 |
| StringlyTyped | 1 | 0 | 0 | 0 | 1 |
| ErrorType | 0 | 0 | 0 | 0 | 0 |

Strict TypeScript is consistently used. The major exception is the persisted JSON boundary, where assertions suppress exactly the uncertainty the type system should expose.

## 25. Frontend State Analysis

- Coverage: High
- Inspected evidence: Inline preview code, direct view, helper buttons, both renderer scene state machines
- Exclusions / limits: No React/Vue framework applies; the plugin uses imperative DOM and renderer classes.

### Summary

| Subtype | Count | Affected Components |
|---------|-------|---------------------|
| ComponentSize | 4 | Both scenes, knowledge note, helper buttons |
| StateDuplication | 2 | Selection/measurement/slice across renderers |
| PropDrilling | 0 | Imperative composition avoids deep prop chains |
| EffectChain | 1 | Scene interaction-mode transitions |
| UIBusinessCoupling | 2 | Renderer scenes coordinate domain workflows |
| DOMasState | 0 | Core state is held in objects/store |
| RequestState | 1 | Conversion timeout versus underlying job |
| RenderPerf | 1 | Measurement hover snapping |

## 26. Backend API Analysis

- Coverage: Not assessed
- Inspected evidence: `src/view/workbench/remote-draft.ts` client request contract only
- Exclusions / limits: This repository contains no backend API implementation, authentication layer, database access, or server endpoint.

The client should enforce HTTPS and a minimal transfer DTO. Server authorization, rate limiting, validation, and retention cannot be assessed from this codebase.

## 27. Dependency Weight Analysis

- Coverage: High
- Inspected evidence: `package.json`, lockfile, built `main.js`, runtime imports
- Exclusions / limits: No source-map treemap was generated.

### Dependency Scoreboard

| Dependency | Status | Weight | Transitives | Used For | Recommended Action |
|------------|--------|--------|-------------|----------|-------------------|
| `@babylonjs/core@9.6.0` | Healthy | Large | Low runtime graph | Production compatibility renderer | Keep and monitor |
| `@babylonjs/loaders@9.6.0` | Healthy | Medium | Low runtime graph | GLTF/GLB and format loading | Keep |
| `three@0.182.0` | Healthy | Large | Low runtime graph | Opt-in renderer and converted fast path | Keep while rollout remains supported |
| Development toolchain | Needs refresh | Large | About 446 packages | Build, lint, test, verification | Patch advisories and use deterministic CI |

The checked bundle is about 4.4 MB because both renderer implementations ship together. This is an explicit compatibility tradeoff, not evidence of an unused dependency, but route-level lazy loading could be evaluated if Obsidian startup profiling identifies bundle parse time as material.

## 28. Code Consistency Analysis

- Coverage: High
- Inspected evidence: Source layout, naming patterns, error handling, TODO convention, renderer parity
- Exclusions / limits: Generated `main.js` was excluded from style analysis.

Naming and error handling are generally consistent, lint is clean, and source boundaries are discoverable. Consistency risk arises from duplicated renderer feature implementations and stale documentation rather than formatting or naming drift.

## 29. Comment Coverage Analysis

- Coverage: High
- Inspected evidence: Complex conversion/renderer paths, TODO markers, development handoff, public contracts
- Exclusions / limits: No numeric comment-density target was applied.

Comments are mostly concise and useful, and the repository has a disciplined `TODO(Pn)` convention. The larger need is decomposition and current documentation, not more inline narration. Existing scene decomposition TODOs are justified and should be converted into tracked, test-backed refactor slices.

## 30. Principles Compliance

### Principles Violated

| Principle | Violations | Severity | Affected Areas |
|-----------|------------|----------|----------------|
| Single Responsibility (SRP) | 2 | Medium | Babylon and Three scene classes |
| File Size Limit | 4 | Medium | Scene classes, knowledge note, helper buttons |
| Fail-Fast | 2 | Medium | Persisted state and remote endpoint parsing |
| DRY | 2 | Medium | Renderer measurement and slicing workflows |
| Explicit Data Boundaries | 2 | Medium | Persistence and remote geometry consent |
| Transactional Integrity | 1 | Medium | Knowledge artifact generation |

### Principles Respected

Renderer-neutral contracts, local-first defaults, argument-safe process execution, strict typing, bounded caches, focused modules around conversion and preview domains, and layered real-world verification are all strong. The project generally favors explicit compatibility behavior over hidden magic and records intentional debt in handoff documents.

## 31. Architecture Analysis

### Architecture Summary

| Subtype | Count | Affected Areas | Recommended Action |
|---------|-------|----------------|-------------------|
| ModuleBoundary | 2 | Renderer scene classes | Extract shared workflow controllers |
| DependencyDirection | 0 | Renderer ports | Current direction is sound |
| StateOwnership | 2 | Measurement and slice sessions | Move ownership out of renderer adapters |
| BoundaryContract | 2 | Persistence and remote drafting | Add schemas/allowlisted DTOs |
| EvolutionRisk | 2 | Dual renderer parity | Contract-test shared transitions |

The architecture does not need a rewrite. Preserve the current routing and renderer interfaces, then reduce scene-class responsibility one workflow at a time. Persistence and network schemas should be fixed before structural extraction because they provide stable contracts for later work.

## 32. Recommended Fix Order

### Fix Immediately

1. Require HTTPS for non-local remote draft endpoints and reduce the remote DTO to explicitly consented fields.
2. Validate persisted settings and converted cache records before hydration.
3. Keep raw conversion jobs registered after caller timeout to prevent duplicate converters.
4. Refresh the lockfile advisories and make release installs deterministic.

### Fix Before Stable Release

1. Add required pull-request CI and run unit tests in the release workflow.
2. Reorder knowledge writes so the index is committed last and test failure behavior.
3. Remove all native preview tooltip attributes and expand the DOM verifier.
4. Correct renderer/version documentation drift.
5. Add a spatial index for measurement snapping on large targets.

### Schedule Later

1. Extract renderer-neutral measurement and slicing session controllers.
2. Add atomic temporary-file promotion and generation identifiers for knowledge artifacts.
3. Profile startup and evaluate lazy renderer loading only if bundle parsing is material.

### Ignore for Now

1. Do not replace Babylon or Three solely to reduce bundle size; both have active product roles.
2. Do not add remote telemetry to solve local observability; existing diagnostics fit the privacy model.
3. Do not split large files by line count without first establishing ownership and contract tests.

## 33. Quick Wins

1. Remove four native `title` attributes and add a preview-root tooltip assertion.
2. Change public scheme-less draft endpoints to HTTPS and reject non-local HTTP.
3. Run the lockfile-only audit fix and verify production and full audits.
4. Replace `npm install` with `npm ci` in release automation and add `npm test -- --run`.
5. Correct 0.7.6 and Three-default references in current handoff/readme text.

## 34. Long-term Refactor Plan

1. **Stabilize boundaries.** Motivation: runtime uncertainty currently leaks into trusted settings and remote requests. Approach: add versioned persisted-state normalization and an allowlisted remote DTO. Risk: migration could discard legitimate legacy values. Testing: fixture every historical settings shape and privacy mode.
2. **Make jobs and writes transactional.** Motivation: timeouts and multi-file generation can expose partial work. Approach: durable in-flight conversion jobs, temporary outputs, atomic promotion, and knowledge generation IDs. Risk: platform-specific filesystem semantics. Testing: inject timeout, cancellation, lock, and rename failures on Windows-compatible paths.
3. **Index precision snapping.** Motivation: selected-object measurement must remain responsive on dense CAD geometry. Approach: renderer-neutral spatial index with a small-input linear fallback and bounded query diagnostics. Risk: ranking changes near corners. Testing: parity corpus for vertex priority, edge projection, transformed descendants, and screen-space tolerances.
4. **Thin renderer adapters.** Motivation: duplicated scene workflows increase parity drift. Approach: extract measurement first, then slicing and annotation controllers behind existing renderer primitives. Risk: subtle lifecycle regressions. Testing: shared transition contract tests plus Babylon/Three preview success runs after each extraction.
5. **Institutionalize verification.** Motivation: strong local tests are not mandatory today. Approach: required fast CI, separate browser integration job, deterministic release installs, audit policy, and artifact retention. Risk: slower contribution feedback. Testing: seed intentional failures and verify every required gate blocks merge or release.

## 35. Post-Audit Remediation Status

This report records the pre-remediation baseline. The implementation pass completed immediately afterward addressed ten of the eleven findings:

| Finding | Remediation |
|---------|-------------|
| Persisted state validation | Fixed with settings normalization, cache record guards, cleanup persistence, and malformed-data tests |
| Public remote HTTP | Fixed; public shorthand defaults to HTTPS and HTTP is loopback-only |
| Geometry consent privacy scope | Fixed with unconditional vault-context stripping and geometry-enabled privacy tests |
| Conversion timeout deduplication | Fixed by retaining the raw in-flight job until converter settlement |
| Measurement linear hover scan | Fixed for large targets with a cached renderer-neutral AABB hierarchy and parity/visitation tests |
| Oversized renderer scene classes | Partially addressed by extracting measurement session state, endpoint pairing, atomic marker/point ownership, observer delivery, snap input construction, and cache lifecycle; renderer-specific drawing and line primitives remain incremental follow-up work |
| Missing deterministic CI gate | Fixed with PR CI, `npm ci`, unit tests, and focused verifiers in release automation |
| Development advisories | Fixed through lockfile-only compatible upgrades; full and production audits report zero vulnerabilities |
| Knowledge write ordering | Fixed; report and sidecar precede the index, the sidecar is finalized with the index stage, and the generation lock handoff is race-safe |
| Routing/version documentation drift | Fixed in handoff, English/Chinese README, usage, and documentation index files |
| Native preview tooltips | Fixed across canvas, toolbar, zoom, captions, annotation pins, color swatches, and heading-pin badges; preview verification rejects native tooltip attributes |

Post-remediation verification completed successfully with strict typecheck and lint, 314 unit tests across 50 files, settings/remote-draft/knowledge/diagnostics verifiers, the complete Babylon/Three preview success matrix, release asset verification, zero npm advisories, and a clean-vault Obsidian 1.13.7 smoke run. The only scheduled audit item is incremental renderer-controller extraction.
