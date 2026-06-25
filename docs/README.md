# Documentation Index

Use this page to choose the right document before changing code.

## Start Here

- `../AGENTS.md` - coding-agent working rules, tool setup, and change-to-test mapping.
- `development-handoff.md` - current architecture, product contract, specification map,
  and handoff checklist for a new model or developer.
- `../CLAUDE.md` - Claude Code entry point that points back to the shared handoff docs.

## Product And Architecture Specs

- `preview-routing-matrix.md` - canonical Three/Babylon routing contract and smoke tests.
- `0.6.0-plus-upgrade-plan.md` - staged upgrade plan for the `0.6.0+`
  reliability, workflow, and maintainability releases.
- `requirements-tracker.md` - stable product requirements, statuses, acceptance
  criteria, and verification mapping.
- `threejs-migration-roadmap.md` - Three.js migration history, target state, and reopen
  conditions.
- `workbench-3dgrid-feasibility-note.md` - why production workbench and `3dgrid`
  remain conservative capability paths.
- `../FORMAT_SUPPORT_DESIGN.md` - format support and local conversion strategy.
- `ai-3d-plugin-design-report.md` - early product/design background.
- `demo.md` - usage examples for code blocks, grids, annotations, snapshots, and notes.

## Engineering Guardrails

- `cross-platform-development.md` - vault/filesystem path rules, converter discovery,
  and platform diagnostics requirements.
- `mit-upstream-guidelines.md` - license boundaries for upstream code or ideas.
- `../SECURITY.md` - release token safety and PAT leak response.

## Release And Verification References

- `../README.md` - user-facing install, format support, verification, and release notes.
- `../README.zh-CN.md` - Simplified Chinese user-facing docs.
- `../CHANGELOG.md` - current unreleased and release history.
- `release-notes/0.6.0.md` - GitHub release notes for the `0.6.0` capability-tree release.
- `../.github/workflows/release.yml` - release asset publishing workflow.

## Quick Selection Guide

| If you are changing... | Read first |
|------------------------|------------|
| Renderer route, rollout, annotation preview | `preview-routing-matrix.md` |
| 0.6.0+ release planning or upgrade sequencing | `0.6.0-plus-upgrade-plan.md` |
| Product scope, requirement status, release gates | `requirements-tracker.md` |
| Three.js migration or workbench route policy | `workbench-3dgrid-feasibility-note.md` |
| `3dgrid` behavior or presets | `workbench-3dgrid-feasibility-note.md`, `demo.md` |
| Supported formats or conversion | `../FORMAT_SUPPORT_DESIGN.md`, `cross-platform-development.md` |
| Generated reports, indexes, part notes | `development-handoff.md`, `../README.md` Knowledge Notes |
| Persisted state, settings migration | `development-handoff.md`, `../AGENTS.md` |
| Release publishing or token handling | `../SECURITY.md`, `../README.md` Release Publishing |
