# Cross-Platform Development Guide

This plugin is not a generic front-end-only Obsidian plugin. The render layer is mostly portable, but the conversion layer depends on local CLI tools, Python environments, and filesystem behavior that differ across Windows, macOS, and Linux.

This guide defines the portability rules for this repository so new work does not reintroduce Windows-first assumptions.

## Scope

Apply this guide to all code that touches:

- Vault paths and filesystem paths
- External converter discovery and invocation
- Python script generation
- Snapshot export and generated filenames
- Platform-specific UI copy and diagnostics

## Core Rule

Develop on Windows if needed, but write as if the code will execute on macOS and Linux tomorrow.

That means:

- Do not treat Windows behavior as the default behavior.
- Do not make macOS and Linux fix-ups an afterthought.
- Do not assume that a command being found means the environment is actually usable.

## Path Rules

### 1. Keep vault paths and filesystem paths separate

Vault paths are logical Obsidian paths and should use `/`.

- Prefer Obsidian APIs for vault-relative operations.
- Prefer normalized vault paths over manual string concatenation.
- Do not feed vault paths into Node path utilities unless the code is explicitly converting to a filesystem path first.

Filesystem paths are OS-native execution paths.

- Use the wrappers from `src/utils/node-shim.ts` when interacting with Node path behavior.
- Convert between vault and filesystem paths at a single boundary, not repeatedly across the call stack.

### 2. Do not hardcode Windows separators or drive assumptions

Avoid:

- Hardcoded drive roots like `C:/...`
- Manual `"\\"` concatenation
- Treating `%ProgramFiles%`-style locations as universal install locations

If a platform-specific candidate path is needed for discovery:

- Gate it behind platform detection
- Keep it as a heuristic, not as the only valid location
- Always preserve settings and environment-variable overrides ahead of hardcoded candidates

### 3. Do not hand-roll basename and dirname logic repeatedly

If code needs filename extraction or parent directory handling more than once, centralize it.

Current baseline:

- Shared helpers in `src/utils/resolve-path.ts` cover the common portable basename, dirname, and stem cases.
- Future edits in these areas should reuse those helpers instead of adding fresh ad hoc parsing.

## Command Discovery Rules

### 4. Discovery order must prefer user-controlled environments

For Python-based converters and external CLIs, prefer this order:

1. Plugin setting
2. Environment variable
3. User-managed common install locations
4. PATH fallback
5. System-level fallback locations

Reason:

- System Python often exists but is missing required packages.
- PATH often reflects the user’s actively managed environment.
- Platform package managers install into different prefixes on different machines.

### 5. Hardcoded candidates are hints, not truth

Candidate lists in `src/io/conversion/command-discovery.ts` should be treated as portability hints only.

Allowed use:

- Common FreeCAD bundle locations on macOS
- Common Homebrew or MacPorts prefixes
- Known Windows install folders when environment variables point there

Not allowed:

- Assuming one hardcoded Windows absolute path is representative for all Windows users
- Assuming the first discovered executable is valid without a usability check

### 6. A found command still needs a runtime probe

Diagnostics must distinguish between:

- command not found
- command found but not executable
- command launches but dependencies are missing
- command launches and is usable

Current direction is correct:

- Python converters use import-based self-checks
- Native CLIs use lightweight launch probes

Keep extending diagnostics before adding more converter integrations.

## Python Script Rules

### 7. Python path escaping must stay explicit and centralized

Converters currently normalize Windows backslashes to `/` before embedding paths into Python scripts. That is acceptable because Python accepts forward slashes on all target desktop platforms.

Do not duplicate this logic in more places.

If another converter needs Python path embedding, reuse the shared helper in `src/io/conversion/python-path.ts`.

Current baseline:

- `src/io/conversion/adapters/assimp-converter.ts`
- `src/io/conversion/adapters/freecad-converter.ts`
- `src/io/conversion/adapters/sldprt-converter.ts`

All three already call the shared helper rather than duplicating the normalization logic inline.

## UI and Diagnostics Rules

### 8. Platform-specific copy must describe the current platform, not Windows by default

Settings placeholders and diagnostics copy should reflect the platform-specific command names users are expected to enter.

Examples:

- Windows: `FreeCADCmd.exe`
- macOS: `FreeCADCmd`
- Linux: `freecadcmd`

### 9. Diagnostics must be the first debugging surface

If a portability issue requires a user to open DevTools before they can tell what failed, the UX is too late.

Before adding new converter formats or new route preferences, ensure settings diagnostics can answer:

- Which command was selected
- Why it was selected
- Which exact executable path was resolved
- Whether the environment passed a minimal usability check

## Review Checklist

Before merging code that touches conversion, IO, or path handling, check all of the following:

- Are vault paths still `/`-based and kept distinct from filesystem paths?
- Does the code avoid hardcoded Windows-only behavior unless it is behind an explicit Windows branch?
- Are settings and environment overrides still higher priority than built-in candidates?
- If a command is auto-discovered, is there a probe that verifies the environment is usable?
- Is new path handling using an existing helper instead of fresh string parsing?
- Does the user-facing copy remain correct on Windows, macOS, and Linux?

## Current Follow-Up Items

These are known portability debts still present in the repository:

1. `src/io/conversion/command-discovery.ts` still keeps platform-specific candidate heuristics for converters such as FreeCAD, `obj2gltf`, and `FBX2glTF`, but they are now environment-derived rather than hardcoded to a specific drive. FreeCAD discovery now also includes Linux AppImage heuristics (`~/Applications` and `~/Downloads` scanning for `FreeCAD_*.AppImage`) plus a `freecad` console-binary fallback alongside `freecadcmd`; environment-variable overrides remain the highest priority. Future discovery code should keep following that pattern instead of reintroducing fixed absolute paths.
2. Shared helpers now cover the main basename, dirname, and Python path-literal cases, but future path handling should keep converging on those helpers instead of adding fresh string parsing in feature code.

These are not release blockers by themselves, but they are the main places where future Windows-first regressions are likely to reappear.