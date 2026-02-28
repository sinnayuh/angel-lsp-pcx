# Change Log

## [0.3.91] — Predefined Fixes

### Fixed
- **`matrix4x4` subscript operator** — added `opIndex(int)` and `const opIndex(int)` to the `matrix4x4` class declaration so `mat[0] = x` and `x = mat[0]` no longer produce "operator 'opIndex' is not defined" warnings.

---

## [0.3.89] — Indexing Progress & Faster Workspace Scan

### Added
- **Indexing progress bar** — the status bar item now shows `$(sync~spin) Indexing (n/total)` while the LSP scans the workspace on startup, then reverts to `$(code) Perception AS` when complete.
- **`angelScript.indexExclude` setting** — array of directory names to skip during workspace indexing (default: `["output", "node_modules", ".git", "reference"]`). Add any large generated or third-party folders to speed up startup significantly.

### Changed
- Workspace scanner now skips excluded directories (configurable via `angelScript.indexExclude`) instead of recursing into everything, which greatly reduces indexing time on larger projects.
- Progress is reported per-file so the count in the status bar updates in real time.

---

## [0.3.87] — Workspace-scoped Inclusion & Bundler Error Panel

### Added
- **Bundler error panel** — pre-build LSP errors are now printed in the **AngelScript Bundler** output panel as `file:line:col: message` entries before the bundle runs. VS Code auto-linkifies each line so you can Ctrl+click straight to the offending code. The blocking modal dialog is replaced with a small non-modal notification.

### Fixed
- **Implicit mutual inclusion no longer escapes the workspace** — the file-discovery scan is now bounded to the VS Code `${workspaceFolder}` URI received from the LSP `InitializeParams`. Previously it walked all parent directories and picked up `.as` files from completely unrelated sibling projects.
- **Scientific notation literals (`1e8`)** — the tokenizer now correctly parses exponents without an explicit sign (`1e8`, `1E6`) in addition to the signed forms (`1e+3`, `1E-3`). Fixes spurious `Expected ')'` errors on lines using float literals like `> 1e8`.

### Changed
- `Inspector` and `AnalysisResolver` now accept and store a workspace root URI (`setWorkspaceRoot`), called once from `server.onInitialize` using `params.workspaceFolders[0].uri`.

---

## [0.3.86] — Implicit Inclusion & CI Improvements

### Fixed
- **Cross-file `Undefined scope` warnings** — `implicitMutualInclusion` now works correctly without a user `as.predefined` file. When enabled, the LSP scans the file's directory tree to discover all sibling `.as` files and merges their scopes together automatically.
- **Mocha process hanging in CI** — added `--exit` flag to `.mocharc.json` so the test runner force-quits after completion instead of waiting on open async handles from the LSP's internal task scheduler.

### Changed
- **CI/CD switched to Bun** — both `ci.yml` and `release.yml` now use `oven-sh/setup-bun` + `bun install` instead of `npm ci`, cutting install time significantly.
- **Server tests removed from CI** — test runs are now local-only (`npm test --prefix server`); the TypeScript compiler still catches type errors on every push.
- **`vsce package --no-dependencies`** — skips redundant bundling of already-excluded node_modules into the VSIX.
- **Version bump no longer commits `package-lock.json`** — only `package.json` is committed by the release bot since Bun doesn't update the npm lockfile.

---

## [0.3.83] — Perception Fork Initial Release

### Added
- **Built-in Perception API** — full `perception.as.predefined` baked into the extension covering all Perception modules: proc, GUI, render, input, math, mutex, atomics, networking, JSON, file system, system, Win, Unicorn engine, Zydis encoder, SIMD intrinsics, hash containers, and engine-specific helpers. No `as.predefined` file needed.
- **`string` class** with `[BuiltinString]` metadata, full operator overloads, and all standard string methods — fixes `'string' is not defined` warnings.
- **Standard math** — `abs`, `sin`, `cos`, `tan`, `acos`, `asin`, `atan`, `atan2`, `log`, `pow`, `sqrt`, `ceil`, `floor` and overloads.
- **Math constants & utilities** — `M_PI`, `RAD2DEG`, `DEG2RAD`, `clamp`, `lerp`, `smoothstep`, `is_nan`, `is_inf`, and more.
- **`dictionaryValue`, `grid<T>`, `hash_set`, `hash_map`** — previously missing core types.
- **`random_*` functions** — `random_seed`, `random`, `random_range`, `random_int`, `random_bool`, `random_gaussian`, `random_unit_vec2/3`.
- **Extended `proc_t`** — `wu8/16/32/64`, bulk r/w (`r128/256/512`), `read_struct`, `alloc_vm`, `virtual_query`, `scan_bytes`, `scan_all_u32/u64`, `cs2_*` helpers.
- **Extended `ws_t`** — `send_json`, `send_binary`, `recv`, `poll`, `close`.
- **Extended render** — `draw_arc`, `draw_polygon`, `create_bitmap`, `draw_bitmap`, `clip_push/pop`, `get_char_advance`, `draw_text` `scale_with_view` overload.
- **Extended Win API** — `WindowInfo` class, `get_all_hwnds`, `post_message`, `send_mouse_input`, `is_foreground_window`, `get_tickcount64`.
- **Multi-file bundler** — `AngelScript: Bundle Script` and `AngelScript: Bundle Script (Strip Comments)` commands with pre-build diagnostic check. `angelscript-bundle` task type for `.vscode/tasks.json`.
- **Keybindings** — `Ctrl+Alt+B` to bundle, `Ctrl+Alt+Shift+B` to bundle (stripped).
- **Status bar item** — `$(code) Perception AS` visible when a `.as` file is active; click opens a command quick-pick.
- **`AngelScript: Initialize Project`** — scaffolds `.vscode/tasks.json`, `source/main.as`, and `output/` in one click.
- **`AngelScript: Open Perception Docs`** — opens `docs.perception.cx` in the browser.
- **`AngelScript: View Settings`** — opens VS Code settings filtered to `angelScript.*`.
- **Perception-specific snippets** — `pcx-main`, `pcx-callback`, `pcx-attach`, `pcx-gui`, `pcx-mutex`, `pcx-esp`, `pcx-w2s`, `pcx-class`, `pcx-rip`.
- **CI/CD pipeline** — `ci.yml` for branch builds; `release.yml` auto-bumps patch version, packages VSIX, and publishes a GitHub Release on every push to `main`.

### Fixed
- `TypeError: Cannot read properties of undefined (reading 'request')` in server tests caused by the built-in predefined being loaded during class field initialization before `Inspector` was fully constructed.
- Server tests polluted by Perception API symbols — isolated via `ANGEL_LSP_TEST=1` environment variable set in `test/setup.ts`.

### Changed
- Removed examples for OpenSiv3D, Sven Co-op, and Trackmania — this extension is Perception-specific.
- Bundler output channel reused across runs (cleared before each build) instead of creating a new channel each time.
- Command palette cleaned up: debug `Print Global Scope` command removed; all commands grouped under `AngelScript` category.

---

## [Perception Fork]

- Bundled the full Perception AngelScript API (`proc_t`, GUI widgets, render, math, mutex, atomics, networking, JSON, system, Win, engine helpers) as a built-in predefined — no `as.predefined` setup required.
- Added Perception-specific code snippets (`pcx-main`, `pcx-callback`, `pcx-attach`, `pcx-gui`, `pcx-mutex`, `pcx-esp`, `pcx-w2s`, `pcx-class`, `pcx-rip`).
- Integrated a multi-file AngelScript bundler with `#include` resolution and circular dependency detection.
- Added `AngelScript: Bundle Script` and `AngelScript: Bundle Script (Strip Comments)` commands.
- Added `angelscript-bundle` task type for `.vscode/tasks.json` integration.
- Pre-build LSP diagnostic check before bundling — warns on existing errors.

Forked and maintained by [@sinnayuh](https://github.com/sinnayuh). Based on [angel-lsp](https://github.com/sashi0034/angel-lsp) by [@sashi0034](https://github.com/sashi0034).

---

## [0.3.52] 2025/08/17

- Support for `#include` of other `*.as.predefined` files inside `as.predefined`

  - For example, you can now write something like:
  ```as
  #include "module.as.predefined"
  ```

- Support for absolute path includes

## [0.3.50] 2025/08/16

- Support for `using namespace` in AngelScript 2.38.0

## [0.3.47] 2025/07/08

- `workspace/diagnostics/refresh` [#195](https://github.com/sashi0034/angel-lsp/pull/195) (Thnaks AlexMorson)

## [0.3.46] 2025/07/03

- Fixed circular include bug reported in #192

## [0.3.39] 2025/03/31

- Debugger support #171 (Thanks Paril)

## [0.3.35] 2025/03/26

- Deprecated the `buitinStringTypes: string[]` setting. Use `buitinStringType: string` instead.
- Added support for include path setting.
- Various other minor changes and improvements.

## [0.3.31] 2025/03/19

- #149

## [0.3.29] 2025/03/17

- [#146](https://github.com/sashi0034/angel-lsp/pull/146), [#145](https://github.com/sashi0034/angel-lsp/pull/145), etc.

## [0.3.28] 2025/03/15

- Fixed bugs.

## [0.3.26] 2025/03/14

- Fixed bugs.

## [0.3.25] 2025/03/13

- Fixed bugs.

## [0.3.23] 2025/03/11

- Add some missing features in AngelScript [#108](https://github.com/sashi0034/angel-lsp/pull/108), [#109](https://github.com/sashi0034/angel-lsp/pull/109), [#110](https://github.com/sashi0034/angel-lsp/pull/110) by Paril

## [0.3.22] 2025/03/10

- [#105](https://github.com/sashi0034/angel-lsp/pull/105), [#106](https://github.com/sashi0034/angel-lsp/pull/106) by Paril

## [0.3.21] 2025/03/04

- Code cleanup.
- Fixed memory leak issues and improved performance.
- Fixes bugs.

## [0.3.19] 2025/02/22

- Fixed some bugs.
- Added a setting 'suppressAnalyzerErrors'.

## [0.3.18] 2025/02/07

- Tentatively fixed to avoid a memory leak problem.

## [0.3.17] 2025/01/19

- Fixed a bug [#71](https://github.com/sashi0034/angel-lsp/pull/71) by Vam-Jam.

## [0.3.16] 2025/01/06

- Support for multiple subsequent metadata declarations [#66](https://github.com/sashi0034/angel-lsp/pull/66) by goulash32
- Fixed some bugs.

## [0.3.15] 2025/01/03

- Fixed some bugs.

## [0.3.14] 2024/12/31

- Fixed a bug in parsing enums [#45](https://github.com/sashi0034/angel-lsp/pull/45) by FnControlOption

## [0.3.13] 2024/12/22

- Added hoistEnumParentScope setting [#42](https://github.com/sashi0034/angel-lsp/pull/42) by Vam-Jam.
- Fixed some bugs [#43](https://github.com/sashi0034/angel-lsp/pull/43), [#44](https://github.com/sashi0034/angel-lsp/pull/44) by Vam-Jam

## [0.3.12] 2024/10/28

- Support for function signature help. [#30](https://github.com/sashi0034/angel-lsp/issues/30)

## [0.3.11] 2024/10/05

- Added settings for builtin array and string types. [#11](https://github.com/sashi0034/angel-lsp/issues/11), [#34](https://github.com/sashi0034/angel-lsp/issues/34)

## [0.3.10] 2024/08/20

- Fixed bugs [#22](https://github.com/sashi0034/angel-lsp/issues/22)

## [0.3.9] - 2024/07/22

- Add settings for implicit mutual inclusion. [#19](https://github.com/sashi0034/angel-lsp/issues/19)

## [0.3.8] - 2024/07/22

Fix README.md

## [0.3.7] - 2024/07/22

- Support for hover to view details on symbols (Experimental)

## [0.3.6] - 2024/07/13

- Fixed bugs [#13](https://github.com/sashi0034/angel-lsp/issues/13), [#14](https://github.com/sashi0034/angel-lsp/issues/14)

## [0.3.5] - 2024/07/13

- Fixed problem [#11](https://github.com/sashi0034/angel-lsp/issues/11)

## [0.3.4] - 2024/06/14

- Fixed formatter bugs and add user settings.

## [0.3.3] - 2024/06/11

- Supports completion and analysis of private and protected fields. [#5](https://github.com/sashi0034/angel-lsp/issues/5)

## [0.3.2] - 2024/06/10

- Fixed bugs [#6](https://github.com/sashi0034/angel-lsp/issues/6)

## [0.3.1] - 2024/06/09

- Parse metadata [#3](https://github.com/sashi0034/angel-lsp/pull/3) by MineBill

## [0.3.0] - 2024/06/04

- Support for `#include` directive (Preview)
- Modified the search method for `as.predefined`
  - Search recursively from the parent directory of the file instead of the root of the workspace directory.
- Fix minor bugs.

## [0.2.0] - 2024/05/10

- Format support (Preview)

## [0.1.7] - 2024/04/11

- Fix parser bugs.

## [0.1.6] - 2024/04/06

- Support for type aliases, getters and setters, etc.
- Fix many bugs.

## [0.1.5] - 2024/04/05

- Support for function handler.

## [0.1.4] - 2024/04/03

- Support for inheritance of classes and interfaces.
- Fixed bugs in templates, etc.

## [0.1.0] - 2024/04/02

- Initial pre-release
