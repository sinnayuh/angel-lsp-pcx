
# User Settings

Open VS Code settings (`Ctrl+,`) and search for **AngelScript** to configure the extension.

The Perception API is built in — no external `as.predefined` file is needed. The settings below let you customize behavior for your project.

---

## Analyzer

### `angelScript.suppressAnalyzerErrors`
**Default:** `true`

Report analyzer problems as warnings instead of errors. Recommended to leave enabled — the type analyzer is still a preview and occasionally produces false positives.

---

## String and Array Types

### `angelScript.builtinStringType`
**Default:** `"string"`

The built-in string type in your project. String literals (`"..."`) can be assigned to this type directly.

### `angelScript.builtinArrayType`
**Default:** `"array"`

The built-in array type. When set, `Type[]` is treated as `array<Type>`.

---

## Include Resolution

### `angelScript.includePath`
**Default:** `[]`

Additional directories to search when resolving `#include` directives. Use relative paths from the workspace root or absolute paths.

```jsonc
"angelScript.includePath": ["shared", "C:/libs/angelscript"]
```

### `angelScript.forceIncludePredefined`
**Default:** `[]`

Paths to additional `.as.predefined` files that are injected globally into every file — on top of the built-in Perception API. Useful for team-shared type libraries or project-specific classes that need to be visible everywhere.

```jsonc
"angelScript.forceIncludePredefined": ["${workspaceFolder}/types/shared.as.predefined"]
```

### `angelScript.implicitMutualInclusion`
**Default:** `false`

When enabled, all `.as` files in the workspace implicitly see each other's symbols — no `#include` required. Works like C# or Java compilation. Useful if your project compiles all scripts into a single module.

---

## Language Features

### `angelScript.hoistEnumParentScope`
**Default:** `false`

Hoist enum members to their parent scope so they appear in autocompletion without needing the enum name prefix.

### `angelScript.explicitPropertyAccessor`
**Default:** `true`

When `true`, functions must use the `property` keyword to be treated as virtual property accessors. Set to `false` for AngelScript < v2.33.1 compatibility, where `get_` / `set_` prefixes are enough.

### `angelScript.allowUnicodeIdentifiers`
**Default:** `false`

Allow non-ASCII characters in identifiers.

### `angelScript.supportsTypedEnumerations`
**Default:** `false`

Enable typed enum syntax (e.g. `enum Color : uint8`).

### `angelScript.supportsForEach`
**Default:** `false`

Enable `foreach` statement support.

### `angelScript.supportsDigitSeparators`
**Default:** `false`

Enable C++14-style digit separators (`1_000_000`).

### `angelScript.characterLiterals`
**Default:** `false`

Enable single-character literals (`'A'`) as per `asEP_USE_CHARACTER_LITERALS`.

---

## Formatter

### `angelScript.formatter.indentSpaces`
**Default:** `4`

Number of spaces per indentation level.

### `angelScript.formatter.useTabIndent`
**Default:** `false`

Use tab characters for indentation instead of spaces.

### `angelScript.formatter.maxBlankLines`
**Default:** `1`

Maximum number of consecutive blank lines allowed between code sections.

---

## Diagnostics / Tracing

### `angelScript.trace.server`
**Default:** `"off"`

Trace LSP communication between VS Code and the language server. Options: `"off"`, `"messages"`, `"verbose"`. Use `"verbose"` when debugging extension issues.
