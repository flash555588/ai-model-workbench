# MIT-Compatible Upstream Guardrails

This repository is MIT-licensed. When improving it with external ideas or code, keep the following boundaries explicit.

## Safe to reuse directly

- `three.js` - MIT
- `BiscuitCoder/cell-architecture-studio` - MIT, verified through the GitHub repository license metadata on 2026-05-20. The repository is a public fork of `cclank/cell-architecture-studio`, which is also MIT-licensed.

These are good sources for architecture ideas, UX patterns, utility snippets, and verification strategies, as long as upstream attribution is kept where needed.

## Already present but not MIT

- `@babylonjs/*` - Apache-2.0
- `htm` - Apache-2.0

These are compatible dependencies for this project, but direct vendored code or copied files should preserve their license and notice requirements.

## Reference only, no direct code copy

- `ElmoNeedsArson/Obsidian-3D-embed` - GPL-3.0

That repository is useful for product comparison and feature discovery, but its implementation should not be copied into this codebase. If a behavior is worth adopting, reimplement it clean-room from requirements and local architecture.

## Working rule for future changes

1. Prefer MIT upstreams first for code-level borrowing.
2. Treat GPL repositories as design references only.
3. Record the upstream repo and license in docs or PR notes whenever a feature is derived from outside work.
