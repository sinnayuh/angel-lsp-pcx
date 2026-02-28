import * as path from 'path';
import * as cp from 'child_process';
import {workspace, ExtensionContext, commands, debug, window, WorkspaceEdit, Range, Position, DebugConfigurationProvider, WorkspaceFolder, DebugConfiguration, CancellationToken, ProviderResult} from 'vscode';

import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    TransportKind
} from 'vscode-languageclient/node';
import * as vscode from "vscode";

let s_client: LanguageClient;
let s_bundlerChannel: vscode.OutputChannel | undefined;

export function activate(context: ExtensionContext) {
    // The server is implemented in node
    const serverModule = context.asAbsolutePath(
        path.join('server', 'out', 'server.js')
    );

    // If the extension is launched in debug mode then the debug server options are used
    // Otherwise the run options are used
    const serverOptions: ServerOptions = {
        run: {module: serverModule, transport: TransportKind.ipc},
        debug: {
            module: serverModule,
            transport: TransportKind.ipc,
        }
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

    // Create the language client and start the client.
    s_client = new LanguageClient(
        'angelScript',
        'AngelScript Language Server',
        serverOptions,
        clientOptions
    );

    s_client.onRequest("angelScript/smartBackspace", () => { /* reserved for future use */ });

    subscribeCommands(context);

    // Start the client. This will also launch the server
    s_client.start();
}

export function deactivate(): Thenable<void> | undefined {
    if (!s_client) {
        return undefined;
    }
    return s_client.stop();
}

// -----------------------------------------------

class AngelScriptConfigurationProvider implements DebugConfigurationProvider {
    resolveDebugConfiguration(folder: WorkspaceFolder | undefined, config: DebugConfiguration, token?: CancellationToken): ProviderResult<DebugConfiguration> {
        return config;
    }

    resolveDebugConfigurationWithSubstitutedVariables(folder: WorkspaceFolder | undefined, config: DebugConfiguration, token?: CancellationToken): ProviderResult<DebugConfiguration> {
        return config;
    }
}

class AngelScriptDebugAdapterServerDescriptorFactory implements vscode.DebugAdapterDescriptorFactory {
    async createDebugAdapterDescriptor(session: vscode.DebugSession, executable: vscode.DebugAdapterExecutable | undefined): Promise<vscode.DebugAdapterDescriptor> {
        return new vscode.DebugAdapterServer(session.configuration.port, session.configuration.address);
    }
}

class AngelScriptDebugAdapterTrackerFactory implements vscode.DebugAdapterTrackerFactory {
	createDebugAdapterTracker(session: vscode.DebugSession): ProviderResult<vscode.DebugAdapterTracker> {
		return {};
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// AngelScript Bundle Task Provider
// ─────────────────────────────────────────────────────────────────────────────

class AngelScriptBundleTaskProvider implements vscode.TaskProvider {
    private readonly _context: ExtensionContext;

    constructor(context: ExtensionContext) {
        this._context = context;
    }

    provideTasks(): vscode.Task[] {
        return [];
    }

    resolveTask(task: vscode.Task): vscode.Task | undefined {
        const definition = task.definition as { type: string; src: string; out: string; strip?: boolean };
        if (definition.type !== 'angelscript-bundle') return undefined;
        if (!definition.src || !definition.out) return undefined;

        const bundlerScript = this._context.asAbsolutePath(path.join('scripts', 'bundler.js'));
        const args = [bundlerScript, definition.src, definition.out];
        if (definition.strip) args.push('--strip');

        const execution = new vscode.ShellExecution(`node ${args.map(a => `"${a}"`).join(' ')}`);

        return new vscode.Task(
            definition,
            vscode.TaskScope.Workspace,
            task.name,
            'angelscript-bundle',
            execution,
            []
        );
    }
}

function subscribeCommands(context: ExtensionContext) {
    context.subscriptions.push(
        commands.registerCommand('angelScript.debug.printGlobalScope', async () => {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                const uri = editor.document.uri.toString();
                const result = await s_client.sendRequest("angelScript/printGlobalScope", {uri: uri});
                vscode.window.showInformationMessage(`Print Global Scope: ${result}`);
            } else {
                vscode.window.showInformationMessage('No active editor');
            }
        })
    );

    context.subscriptions.push(
        commands.registerCommand('angelScript.bundle', () => runBundleCommand(context, false))
    );

    context.subscriptions.push(
        commands.registerCommand('angelScript.bundleStripped', () => runBundleCommand(context, true))
    );

    context.subscriptions.push(
        vscode.tasks.registerTaskProvider('angelscript-bundle', new AngelScriptBundleTaskProvider(context))
    );

    context.subscriptions.push(debug.registerDebugConfigurationProvider("angel-lsp-dap", new AngelScriptConfigurationProvider()));
    context.subscriptions.push(debug.registerDebugAdapterDescriptorFactory("angel-lsp-dap", new AngelScriptDebugAdapterServerDescriptorFactory()));
    context.subscriptions.push(debug.registerDebugAdapterTrackerFactory("angel-lsp-dap", new AngelScriptDebugAdapterTrackerFactory()));
}

// ─────────────────────────────────────────────────────────────────────────────
// Bundle command implementation
// ─────────────────────────────────────────────────────────────────────────────

async function runBundleCommand(context: ExtensionContext, strip: boolean): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage('AngelScript Bundle: No workspace folder open.');
        return;
    }

    const wsRoot = workspaceFolders[0].uri.fsPath;

    // ── Step 1: pick source directory ────────────────────────────────────────
    const srcInput = await vscode.window.showInputBox({
        title: 'AngelScript Bundle — Source Directory',
        prompt: 'Enter the source directory containing your .as files (relative to workspace root)',
        value: 'source',
        validateInput: (v) => v.trim().length === 0 ? 'Source directory cannot be empty' : undefined,
    });
    if (srcInput === undefined) return;

    // ── Step 2: pick output file ─────────────────────────────────────────────
    const outInput = await vscode.window.showInputBox({
        title: 'AngelScript Bundle — Output File',
        prompt: 'Enter the output file path (relative to workspace root)',
        value: 'output/bundled.as',
        validateInput: (v) => v.trim().length === 0 ? 'Output path cannot be empty' : undefined,
    });
    if (outInput === undefined) return;

    const srcPath = path.resolve(wsRoot, srcInput.trim());
    const outPath = path.resolve(wsRoot, outInput.trim());

    // ── Step 3: check LSP diagnostics for errors ─────────────────────────────
    const allDiagnostics = vscode.languages.getDiagnostics();
    const errors: string[] = [];

    for (const [uri, diags] of allDiagnostics) {
        if (!uri.fsPath.endsWith('.as')) continue;
        const fileErrors = diags.filter(d => d.severity === vscode.DiagnosticSeverity.Error);
        if (fileErrors.length > 0) {
            errors.push(`${path.relative(wsRoot, uri.fsPath)}: ${fileErrors.length} error(s)`);
        }
    }

    if (errors.length > 0) {
        const proceed = await vscode.window.showWarningMessage(
            `AngelScript Bundle: ${errors.length} file(s) have errors:\n${errors.slice(0, 5).join('\n')}${errors.length > 5 ? `\n…and ${errors.length - 5} more` : ''}\n\nBundling may produce invalid output.`,
            { modal: true },
            'Continue Anyway',
            'Cancel'
        );
        if (proceed !== 'Continue Anyway') return;
    }

    // ── Step 4: run the bundler ───────────────────────────────────────────────
    const bundlerScript = context.asAbsolutePath(path.join('scripts', 'bundler.js'));
    const bundlerArgs = [bundlerScript, srcPath, outPath];
    if (strip) bundlerArgs.push('--strip');

    if (!s_bundlerChannel) {
        s_bundlerChannel = vscode.window.createOutputChannel('AngelScript Bundler');
    }
    const outputChannel = s_bundlerChannel;
    outputChannel.clear();
    outputChannel.show(true);
    outputChannel.appendLine(`[Bundle] Starting${strip ? ' (strip comments)' : ''}...`);
    outputChannel.appendLine(`[Bundle]   src:  ${srcPath}`);
    outputChannel.appendLine(`[Bundle]   out:  ${outPath}`);

    return new Promise<void>((resolve) => {
        const proc = cp.spawn('node', bundlerArgs, { cwd: wsRoot });

        proc.stdout.on('data', (data: Buffer) => {
            outputChannel.append(data.toString());
        });

        proc.stderr.on('data', (data: Buffer) => {
            outputChannel.append(data.toString());
        });

        proc.on('close', (code) => {
            if (code === 0) {
                outputChannel.appendLine(`[Bundle] ✓ Complete`);
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
                    `AngelScript Bundle failed. See the "AngelScript Bundler" output channel for details.`
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