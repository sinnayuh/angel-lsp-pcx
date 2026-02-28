import * as path from 'path';
import * as fs from 'fs';
import * as cp from 'child_process';
import {workspace, ExtensionContext, commands, debug, DebugConfigurationProvider, WorkspaceFolder, DebugConfiguration, CancellationToken, ProviderResult} from 'vscode';

import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    TransportKind
} from 'vscode-languageclient/node';
import * as vscode from "vscode";

let s_client: LanguageClient;
let s_bundlerChannel: vscode.OutputChannel | undefined;
let s_statusBar: vscode.StatusBarItem | undefined;

export function activate(context: ExtensionContext) {
    const serverModule = context.asAbsolutePath(
        path.join('server', 'out', 'server.js')
    );

    const serverOptions: ServerOptions = {
        run: {module: serverModule, transport: TransportKind.ipc},
        debug: {module: serverModule, transport: TransportKind.ipc}
    };

    const clientOptions: LanguageClientOptions = {
        documentSelector: [
            {scheme: 'file', language: 'angelscript'},
            {scheme: 'file', language: 'angelscript-predefined'}
        ],
        synchronize: {
            fileEvents: workspace.createFileSystemWatcher('**/.clientrc')
        }
    };

    s_client = new LanguageClient(
        'angelScript',
        'AngelScript Language Server',
        serverOptions,
        clientOptions
    );

    s_client.onRequest("angelScript/smartBackspace", () => { /* reserved for future use */ });

    subscribeCommands(context);
    setupStatusBar(context);

    s_client.start().then(() => {
        s_client.onNotification('angelScript/indexProgress', ({scanned, total}: {scanned: number; total: number}) => {
            if (!s_statusBar) return;
            if (scanned < total) {
                s_statusBar.text = `$(sync~spin) Indexing (${scanned}/${total})`;
                s_statusBar.tooltip = 'Perception AngelScript — indexing workspace files...';
                s_statusBar.show();
            } else {
                s_statusBar.text = '$(code) Perception AS';
                s_statusBar.tooltip = 'Perception AngelScript — click for commands';
            }
        });
    });
}

export function deactivate(): Thenable<void> | undefined {
    s_statusBar?.dispose();
    if (!s_client) return undefined;
    return s_client.stop();
}

// ─────────────────────────────────────────────────────────────────────────────
// Status bar
// ─────────────────────────────────────────────────────────────────────────────

function setupStatusBar(context: ExtensionContext) {
    s_statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
    s_statusBar.text = '$(code) Perception AS';
    s_statusBar.tooltip = 'Perception AngelScript — click for commands';
    s_statusBar.command = 'angelScript.statusBarMenu';
    context.subscriptions.push(s_statusBar);

    context.subscriptions.push(
        commands.registerCommand('angelScript.statusBarMenu', showStatusBarMenu)
    );

    const updateVisibility = (editor: vscode.TextEditor | undefined) => {
        const lang = editor?.document.languageId;
        if (lang === 'angelscript' || lang === 'angelscript-predefined') {
            s_statusBar!.show();
        } else {
            s_statusBar!.hide();
        }
    };

    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(updateVisibility)
    );
    updateVisibility(vscode.window.activeTextEditor);
}

async function showStatusBarMenu() {
    const pick = await vscode.window.showQuickPick([
        {label: '$(package) Bundle Script',                  detail: 'Ctrl+Alt+B',       command: 'angelScript.bundle'},
        {label: '$(package) Bundle Script (Strip Comments)', detail: 'Ctrl+Alt+Shift+B', command: 'angelScript.bundleStripped'},
        {label: '$(rocket) Initialize Project',              detail: 'Scaffold tasks.json + source/main.as', command: 'angelScript.initProject'},
        {label: '$(book) Open Perception Docs',              detail: 'docs.perception.cx', command: 'angelScript.openDocs'},
        {label: '$(gear) View Settings',                     detail: 'angelScript.*',     command: 'angelScript.openSettings'},
    ], {placeHolder: 'Perception AngelScript'});

    if (pick) commands.executeCommand(pick.command);
}

// ─────────────────────────────────────────────────────────────────────────────
// Debug adapters
// ─────────────────────────────────────────────────────────────────────────────

class AngelScriptConfigurationProvider implements DebugConfigurationProvider {
    resolveDebugConfiguration(_folder: WorkspaceFolder | undefined, config: DebugConfiguration, _token?: CancellationToken): ProviderResult<DebugConfiguration> {
        return config;
    }
    resolveDebugConfigurationWithSubstitutedVariables(_folder: WorkspaceFolder | undefined, config: DebugConfiguration, _token?: CancellationToken): ProviderResult<DebugConfiguration> {
        return config;
    }
}

class AngelScriptDebugAdapterServerDescriptorFactory implements vscode.DebugAdapterDescriptorFactory {
    async createDebugAdapterDescriptor(session: vscode.DebugSession): Promise<vscode.DebugAdapterDescriptor> {
        return new vscode.DebugAdapterServer(session.configuration.port, session.configuration.address);
    }
}

class AngelScriptDebugAdapterTrackerFactory implements vscode.DebugAdapterTrackerFactory {
    createDebugAdapterTracker(_session: vscode.DebugSession): ProviderResult<vscode.DebugAdapterTracker> {
        return {};
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Bundle task provider
// ─────────────────────────────────────────────────────────────────────────────

class AngelScriptBundleTaskProvider implements vscode.TaskProvider {
    constructor(private readonly _context: ExtensionContext) {}

    provideTasks(): vscode.Task[] { return []; }

    resolveTask(task: vscode.Task): vscode.Task | undefined {
        const def = task.definition as {type: string; src: string; out: string; strip?: boolean};
        if (def.type !== 'angelscript-bundle' || !def.src || !def.out) return undefined;

        const bundlerScript = this._context.asAbsolutePath(path.join('scripts', 'bundler.js'));
        const args = [bundlerScript, def.src, def.out];
        if (def.strip) args.push('--strip');

        return new vscode.Task(
            def,
            vscode.TaskScope.Workspace,
            task.name,
            'angelscript-bundle',
            new vscode.ShellExecution(`node ${args.map(a => `"${a}"`).join(' ')}`)
        );
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Command registration
// ─────────────────────────────────────────────────────────────────────────────

function subscribeCommands(context: ExtensionContext) {
    context.subscriptions.push(
        commands.registerCommand('angelScript.bundle', () => runBundleCommand(context, false)),
        commands.registerCommand('angelScript.bundleStripped', () => runBundleCommand(context, true)),
        commands.registerCommand('angelScript.openSettings', () =>
            commands.executeCommand('workbench.action.openSettings', 'angelScript')
        ),
        commands.registerCommand('angelScript.openDocs', () =>
            vscode.env.openExternal(vscode.Uri.parse('https://docs.perception.cx'))
        ),
        commands.registerCommand('angelScript.initProject', () => initProject()),
        vscode.tasks.registerTaskProvider('angelscript-bundle', new AngelScriptBundleTaskProvider(context)),
        debug.registerDebugConfigurationProvider("angel-lsp-dap", new AngelScriptConfigurationProvider()),
        debug.registerDebugAdapterDescriptorFactory("angel-lsp-dap", new AngelScriptDebugAdapterServerDescriptorFactory()),
        debug.registerDebugAdapterTrackerFactory("angel-lsp-dap", new AngelScriptDebugAdapterTrackerFactory())
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Initialize project
// ─────────────────────────────────────────────────────────────────────────────

async function initProject(): Promise<void> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
        vscode.window.showErrorMessage('AngelScript: No workspace folder open.');
        return;
    }

    const wsRoot = folders[0].uri.fsPath;
    const created: string[] = [];

    // ── .vscode/tasks.json ───────────────────────────────────────────────────
    const vscodeDir = path.join(wsRoot, '.vscode');
    const tasksFile = path.join(vscodeDir, 'tasks.json');

    if (!fs.existsSync(tasksFile)) {
        fs.mkdirSync(vscodeDir, {recursive: true});
        fs.writeFileSync(tasksFile, JSON.stringify({
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
        }, null, 4));
        created.push('.vscode/tasks.json');
    }

    // ── source/main.as ───────────────────────────────────────────────────────
    const sourceDir = path.join(wsRoot, 'source');
    const mainFile = path.join(sourceDir, 'main.as');

    if (!fs.existsSync(mainFile)) {
        fs.mkdirSync(sourceDir, {recursive: true});
        fs.writeFileSync(mainFile,
`int main()
{
    return 1;
}

void on_unload()
{
}
`);
        created.push('source/main.as');
    }

    // ── output/ directory ────────────────────────────────────────────────────
    const outputDir = path.join(wsRoot, 'output');
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, {recursive: true});
        created.push('output/');
    }

    if (created.length === 0) {
        vscode.window.showInformationMessage('AngelScript: Project already initialized — no files created.');
        return;
    }

    const choice = await vscode.window.showInformationMessage(
        `AngelScript: Created ${created.join(', ')}`,
        'Open main.as'
    );
    if (choice === 'Open main.as') {
        vscode.window.showTextDocument(vscode.Uri.file(mainFile));
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Bundle command
// ─────────────────────────────────────────────────────────────────────────────

async function runBundleCommand(context: ExtensionContext, strip: boolean): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage('AngelScript Bundle: No workspace folder open.');
        return;
    }

    const wsRoot = workspaceFolders[0].uri.fsPath;

    const srcInput = await vscode.window.showInputBox({
        title: 'AngelScript Bundle — Source Directory',
        prompt: 'Directory containing your .as files (relative to workspace root)',
        value: 'source',
        validateInput: (v) => v.trim().length === 0 ? 'Source directory cannot be empty' : undefined,
    });
    if (srcInput === undefined) return;

    const outInput = await vscode.window.showInputBox({
        title: 'AngelScript Bundle — Output File',
        prompt: 'Output file path (relative to workspace root)',
        value: 'output/bundled.as',
        validateInput: (v) => v.trim().length === 0 ? 'Output path cannot be empty' : undefined,
    });
    if (outInput === undefined) return;

    const srcPath = path.resolve(wsRoot, srcInput.trim());
    const outPath = path.resolve(wsRoot, outInput.trim());

    if (!s_bundlerChannel) {
        s_bundlerChannel = vscode.window.createOutputChannel('AngelScript Bundler');
    }
    const outputChannel = s_bundlerChannel;
    outputChannel.clear();
    outputChannel.show(true);

    // Pre-build diagnostic check — print errors as clickable file:line:col links
    const allDiagnostics = vscode.languages.getDiagnostics();
    interface DiagEntry { rel: string; line: number; col: number; message: string; }
    const errorEntries: DiagEntry[] = [];

    for (const [uri, diags] of allDiagnostics) {
        if (!uri.fsPath.endsWith('.as')) continue;
        const rel = path.relative(wsRoot, uri.fsPath);
        for (const d of diags) {
            if (d.severity === vscode.DiagnosticSeverity.Error) {
                errorEntries.push({
                    rel,
                    line: d.range.start.line + 1,
                    col:  d.range.start.character + 1,
                    message: d.message,
                });
            }
        }
    }

    if (errorEntries.length > 0) {
        const fileCount = new Set(errorEntries.map(e => e.rel)).size;
        outputChannel.appendLine(`[Pre-build] ⚠ ${errorEntries.length} error(s) in ${fileCount} file(s) — bundling may produce invalid output`);
        outputChannel.appendLine('');
        for (const e of errorEntries) {
            // VS Code auto-linkifies "relative/path.as:line:col" in the Output panel
            outputChannel.appendLine(`  ${e.rel}:${e.line}:${e.col}: ${e.message}`);
        }
        outputChannel.appendLine('');

        const proceed = await vscode.window.showWarningMessage(
            `AngelScript Bundle: ${errorEntries.length} error(s) in ${fileCount} file(s). See Output panel for details.`,
            'Continue Anyway',
            'Cancel'
        );
        if (proceed !== 'Continue Anyway') return;

        outputChannel.appendLine('[Pre-build] Continuing despite errors...');
        outputChannel.appendLine('');
    }
    const bundlerScript = context.asAbsolutePath(path.join('scripts', 'bundler.js'));
    const bundlerArgs = [bundlerScript, srcPath, outPath];
    if (strip) bundlerArgs.push('--strip');

    outputChannel.appendLine(`[Bundle] Starting${strip ? ' (strip comments)' : ''}...`);
    outputChannel.appendLine(`[Bundle]   src: ${srcPath}`);
    outputChannel.appendLine(`[Bundle]   out: ${outPath}`);

    return new Promise<void>((resolve) => {
        const proc = cp.spawn('node', bundlerArgs, {cwd: wsRoot});

        proc.stdout.on('data', (data: Buffer) => outputChannel.append(data.toString()));
        proc.stderr.on('data', (data: Buffer) => outputChannel.append(data.toString()));

        proc.on('close', (code) => {
            if (code === 0) {
                outputChannel.appendLine('[Bundle] ✓ Complete');
                vscode.window.showInformationMessage(
                    `AngelScript Bundle: ✓ Bundled to ${path.relative(wsRoot, outPath)}`,
                    'Open File'
                ).then(choice => {
                    if (choice === 'Open File') {
                        vscode.window.showTextDocument(vscode.Uri.file(outPath));
                    }
                });
            } else {
                outputChannel.appendLine(`[Bundle] ✗ Failed with exit code ${code}`);
                vscode.window.showErrorMessage(
                    'AngelScript Bundle failed. See the "AngelScript Bundler" output panel for details.'
                );
            }
            resolve();
        });

        proc.on('error', (err) => {
            outputChannel.appendLine(`[Bundle] ✗ Error: ${err.message}`);
            vscode.window.showErrorMessage(`AngelScript Bundle error: ${err.message}`);
            resolve();
        });
    });
}
