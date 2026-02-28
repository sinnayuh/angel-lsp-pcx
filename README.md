# AngelScript for Perception

A fully pre-configured AngelScript Language Server for [Perception.cx](https://perception.cx) — install and start writing scripts immediately, with zero setup required.

Built on top of the excellent [angel-lsp](https://github.com/sashi0034/angel-lsp) project by [@sashi0034](https://github.com/sashi0034).

![sample.png](https://raw.githubusercontent.com/sashi0034/angel-lsp/main/sample.png)

> **Install:** Download the latest `.vsix` from [Releases](https://github.com/sinnayuh/angel-lsp-pcx/releases) and use **"Extensions: Install from VSIX..."** in VS Code.


## Features

The entire Perception AngelScript API is bundled directly into the extension. Every feature works out-of-the-box:

| Feature | Description |
|---------|-------------|
| **Autocompletion** | All Perception globals, classes, and methods with parameter hints |
| **Hover docs** | Inline documentation for every API function and type |
| **Signature help** | Parameter hints as you type function calls |
| **Go to Definition** | Ctrl+click any symbol to jump to its declaration |
| **Find References** | Find every use of a variable, function, or class |
| **Type Checking** | Catch type mismatches and undefined symbols as you code |
| **Error Highlighting** | Syntax and semantic errors highlighted in real time |
| **Symbol Renaming** | Safe rename across all files in your project |
| **Snippets** | Perception-specific code templates (see below) |
| **Formatter** | Auto-format on type |
| **Bundler** | Built-in multi-file bundler for `.as` projects |
| **Debugger** | DAP-based debugger attachment support |


## Getting Started

1. Download the latest `.vsix` file from the [Releases](https://github.com/sinnayuh/angel-lsp-pcx/releases) page.
2. In VS Code, open the Command Palette (`Ctrl+Shift+P`) and run **"Extensions: Install from VSIX..."**, then select the downloaded file.
3. Open a folder containing your `.as` files.
4. Start writing — IntelliSense is active immediately.

No `as.predefined` file needed. The full Perception API (proc, GUI, render, math, mutex, atomics, networking, JSON, system, engine helpers) is baked in.


## Bundling Multi-File Projects

Perception scripts must be submitted as a single `.as` file. This extension includes a bundler that concatenates `#include`-linked files into one output file.

### Quick command

Open the Command Palette (`Ctrl+Shift+P`) and run:

- **`AngelScript: Bundle Script`** — bundles with comments preserved
- **`AngelScript: Bundle Script (Strip Comments)`** — minified, comments removed

### Automated build task

Add an `angelscript-bundle` task to your `.vscode/tasks.json`:

```jsonc
{
    "version": "2.0.0",
    "tasks": [
        {
            "label": "Bundle Perception Script",
            "type": "angelscript-bundle",
            "src": "source",
            "out": "output/script.as",
            "strip": true,
            "group": {
                "kind": "build",
                "isDefault": true
            }
        }
    ]
}
```

Run the task with `Ctrl+Shift+B`. The bundler resolves `#include` directives recursively, detects circular dependencies, and checks for LSP errors before building.


## Snippets

| Prefix | Description |
|--------|-------------|
| `pcx-main` | Script entry point (`main` + `on_unload`) |
| `pcx-callback` | Register a recurring callback thread |
| `pcx-attach` | Attach to a process with `ref_process` |
| `pcx-gui` | Create a subtab with a settings panel |
| `pcx-mutex` | Declare and use a `mutex_t` |
| `pcx-esp` | ESP draw loop skeleton |
| `pcx-w2s` | Unreal Engine world-to-screen call |
| `pcx-class` | Named class with `m_` member convention |
| `pcx-rip` | RIP-relative address resolver helper |


## Project Layout (Recommended)

```
my-script/
├── source/
│   ├── main.as           ← entry point (main + on_unload)
│   ├── core/
│   │   └── process.as
│   ├── rendering/
│   │   └── esp.as
│   └── utility/
│       └── offsets.as
└── .vscode/
    └── tasks.json        ← angelscript-bundle task
```

In `main.as`:

```cpp
#include "core/process.as"
#include "rendering/esp.as"
#include "utility/offsets.as"

int main()
{
    return 1;
}

void on_unload()
{
}
```


## Adding Project-Specific Symbols

The built-in Perception API covers all public globals and types. If you want IntelliSense for your own shared types, create an `as.predefined` file in your project root and define them there — the LSP will merge it with the built-in definitions automatically.


## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `angelScript.suppressAnalyzerErrors` | `true` | Show analyzer issues as warnings (recommended — analyzer is still a preview) |
| `angelScript.implicitMutualInclusion` | `false` | Make all `.as` files in the workspace visible to each other without explicit `#include` |
| `angelScript.includePath` | `[]` | Additional directories to search when resolving `#include` |
| `angelScript.forceIncludePredefined` | `[]` | Extra `.as.predefined` files to inject globally (for team-shared type libraries) |
| `angelScript.formatter.indentSpaces` | `4` | Indentation width |
| `angelScript.formatter.useTabIndent` | `false` | Use tabs instead of spaces |

Full settings reference: [docs/user_settings.md](./docs/user_settings.md)


## Credits

This extension ([sinnayuh/angel-lsp-pcx](https://github.com/sinnayuh/angel-lsp-pcx)) is a Perception-specific fork of [angel-lsp](https://github.com/sashi0034/angel-lsp) by [@sashi0034](https://github.com/sashi0034), licensed under the [MIT License](./LICENSE).

The original project provides a general-purpose AngelScript Language Server. The Perception API definitions, bundler integration, and Perception-specific snippets are additions made on top of that foundation.


## License

[MIT License](./LICENSE)
