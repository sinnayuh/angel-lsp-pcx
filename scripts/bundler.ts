/**
 * AngelScript bundler for Perception PCX projects.
 *
 * Resolves #include directives recursively in dependency order, detects circular
 * dependencies, and concatenates all source files into a single output file.
 *
 * Usage:
 *   node bundler.js <src_directory> <output_file> [--strip] [--format]
 *
 * Options:
 *   --strip   Remove all comments from the output (production build)
 *   --format  Apply whitespace normalization after bundling (default: always on)
 *
 * Exit codes:
 *   0  Success
 *   1  Fatal error (missing file, circular dependency, I/O error)
 */

import * as fs from 'fs';
import * as path from 'path';

// ─────────────────────────────────────────────────────────────────────────────
// Argument parsing
// ─────────────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
if (args.length < 2) {
    console.error('Usage: node bundler.js <src_directory> <output_file> [--strip] [--format]');
    console.error('Example: node bundler.js src output/bundled.as');
    console.error('Example: node bundler.js src output/bundled.as --strip');
    process.exit(1);
}

const stripComments = args.includes('--strip');
const nonFlagArgs = args.filter(a => !a.startsWith('--'));

if (nonFlagArgs.length < 2) {
    console.error('Usage: node bundler.js <src_directory> <output_file> [--strip] [--format]');
    process.exit(1);
}

const srcDir = path.resolve(nonFlagArgs[0]);
const outputFile = path.resolve(nonFlagArgs[1]);

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────

const visited = new Set<string>();
const processing = new Set<string>();
const fileOrder: string[] = [];

// ─────────────────────────────────────────────────────────────────────────────
// File discovery
// ─────────────────────────────────────────────────────────────────────────────

function getAllAsFiles(dir: string): string[] {
    const files: string[] = [];

    function scan(currentDir: string): void {
        const entries = fs.readdirSync(currentDir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(currentDir, entry.name);
            if (entry.isDirectory()) {
                scan(fullPath);
            } else if (entry.isFile() && entry.name.endsWith('.as')) {
                files.push(fullPath);
            }
        }
    }

    scan(dir);
    return files;
}

// ─────────────────────────────────────────────────────────────────────────────
// Include parsing
// ─────────────────────────────────────────────────────────────────────────────

interface IncludeRef {
    includePath: string;
    line: number;
}

function parseIncludes(content: string): IncludeRef[] {
    const includes: IncludeRef[] = [];
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(/#include\s+"([^"]+)"/);
        if (match) {
            includes.push({ includePath: match[1], line: i + 1 });
        }
    }
    return includes;
}

// ─────────────────────────────────────────────────────────────────────────────
// Comment stripping — AngelScript-aware
// Handles: // single-line, /* */ multi-line, "strings", and """heredoc""" strings.
// ─────────────────────────────────────────────────────────────────────────────

function stripCommentsFromCode(content: string): string {
    let result = '';
    let i = 0;
    const len = content.length;

    while (i < len) {
        const ch = content[i];

        // AngelScript triple-quoted heredoc string: """..."""
        if (ch === '"' && content[i + 1] === '"' && content[i + 2] === '"') {
            const end = content.indexOf('"""', i + 3);
            if (end === -1) {
                // Unterminated heredoc — copy remainder as-is
                result += content.slice(i);
                break;
            }
            result += content.slice(i, end + 3);
            i = end + 3;
            continue;
        }

        // Regular double-quoted string
        if (ch === '"') {
            result += ch;
            i++;
            while (i < len) {
                const sc = content[i];
                result += sc;
                i++;
                if (sc === '\\') {
                    // Escaped character — include next char verbatim
                    if (i < len) { result += content[i]; i++; }
                    continue;
                }
                if (sc === '"') break;
            }
            continue;
        }

        // Single-quoted character literal
        if (ch === "'") {
            result += ch;
            i++;
            while (i < len) {
                const sc = content[i];
                result += sc;
                i++;
                if (sc === '\\') {
                    if (i < len) { result += content[i]; i++; }
                    continue;
                }
                if (sc === "'") break;
            }
            continue;
        }

        // Single-line comment //
        if (ch === '/' && content[i + 1] === '/') {
            while (i < len && content[i] !== '\n') i++;
            // Preserve the newline
            if (i < len && content[i] === '\n') { result += '\n'; i++; }
            continue;
        }

        // Multi-line comment /* */
        if (ch === '/' && content[i + 1] === '*') {
            i += 2;
            while (i < len - 1) {
                if (content[i] === '*' && content[i + 1] === '/') { i += 2; break; }
                // Preserve newlines inside block comments for line number fidelity
                if (content[i] === '\n') result += '\n';
                i++;
            }
            continue;
        }

        result += ch;
        i++;
    }

    return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Whitespace normalization
// ─────────────────────────────────────────────────────────────────────────────

function normalizeWhitespace(content: string): string {
    const lines = content.split('\n');
    const normalized: string[] = [];
    let consecutiveBlanks = 0;

    for (const line of lines) {
        const trimmed = line.replace(/\s+$/, '');
        if (trimmed.length === 0) {
            consecutiveBlanks++;
            if (consecutiveBlanks <= 2) normalized.push('');
        } else {
            consecutiveBlanks = 0;
            normalized.push(trimmed);
        }
    }

    // Remove leading/trailing blank lines
    while (normalized.length > 0 && normalized[0] === '') normalized.shift();
    while (normalized.length > 0 && normalized[normalized.length - 1] === '') normalized.pop();

    return normalized.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Dependency-order file processing
// ─────────────────────────────────────────────────────────────────────────────

function processFile(filePath: string, includeChain: string[] = []): void {
    const normalized = path.resolve(filePath);

    if (visited.has(normalized)) return;

    if (processing.has(normalized)) {
        const chain = [...includeChain, normalized]
            .map(p => path.relative(process.cwd(), p))
            .join('\n  -> ');
        console.error('\nError: Circular dependency detected:');
        console.error(`  -> ${chain}`);
        process.exit(1);
    }

    if (!fs.existsSync(normalized)) {
        console.error(`\nError: File not found: "${normalized}"`);
        if (includeChain.length > 0) {
            const parent = includeChain[includeChain.length - 1];
            console.error(`Referenced from: "${path.relative(process.cwd(), parent)}"`);
        }
        process.exit(1);
    }

    processing.add(normalized);
    visited.add(normalized);

    let content: string;
    try {
        content = fs.readFileSync(normalized, 'utf8');
    } catch (err: unknown) {
        console.error(`\nError: Unable to read file: "${normalized}"`);
        console.error(`Reason: ${(err as Error).message}`);
        process.exit(1);
    }

    const includes = parseIncludes(content);
    const fileDir = path.dirname(normalized);

    for (const inc of includes) {
        const incPath = path.resolve(fileDir, inc.includePath);
        try {
            processFile(incPath, [...includeChain, normalized]);
        } catch (err) {
            console.error(
                `\nError processing include at line ${inc.line} in "${path.relative(process.cwd(), normalized)}"`
            );
            console.error(`Include: #include "${inc.includePath}"`);
            throw err;
        }
    }

    processing.delete(normalized);
    fileOrder.push(normalized);
}

// ─────────────────────────────────────────────────────────────────────────────
// Main bundling logic
// ─────────────────────────────────────────────────────────────────────────────

try {
    console.log(`Scanning directory: ${path.relative(process.cwd(), srcDir)}`);

    const allFiles = getAllAsFiles(srcDir);
    console.log(`Found ${allFiles.length} .as file(s)`);

    for (const file of allFiles) {
        processFile(file);
    }

    const outputChunks: string[] = [];

    for (const file of fileOrder) {
        let content = fs.readFileSync(file, 'utf8');

        // Remove #include lines entirely
        content = content.replace(/#include\s+"[^"]+"\s*\n?/g, '');

        if (stripComments) {
            content = stripCommentsFromCode(content);
        } else {
            content = `// File: ${path.relative(srcDir, file)}\n${content}`;
        }

        content = normalizeWhitespace(content);

        if (content.length > 0) {
            outputChunks.push(content);
        }
    }

    const bundled = normalizeWhitespace(outputChunks.join('\n\n'));

    const outDir = path.dirname(outputFile);
    if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
    }

    fs.writeFileSync(outputFile, bundled, 'utf8');

    console.log(`✓ Successfully bundled ${visited.size} file(s) in dependency order`);
    if (stripComments) console.log('✓ Comments stripped from output');
    console.log(`Output: ${path.relative(process.cwd(), outputFile)}`);

} catch (err: unknown) {
    const error = err as NodeJS.ErrnoException;
    if (error.code !== 'MODULE_NOT_FOUND') {
        console.error(`\nFatal error: ${error.message}`);
    }
    process.exit(1);
}
