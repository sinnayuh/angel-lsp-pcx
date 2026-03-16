import * as lsp from "vscode-languageserver/node";
import {TokenObject, TokenString} from "../compiler_tokenizer/tokenObject";
import {NodeScript} from "../compiler_parser/nodes";
import {DelayedTask} from "../utils/delayedTask";
import {PublishDiagnosticsParams} from "vscode-languageserver-protocol";
import {getGlobalSettings, getProjectForUri, isMultiProjectMode} from "../core/settings";
import {PreprocessedOutput} from "../compiler_parser/parserPreprocess";
import {getParentDirectoryList, readFileContent, resolveIncludeUri, resolveUri} from "../service/fileUtils";
import {analyzerDiagnostic} from "../compiler_analyzer/analyzerDiagnostic";
import {Profiler} from "../core/profiler";
import {hoistAfterParsed} from "../compiler_analyzer/hoist";
import {analyzeAfterHoisted} from "../compiler_analyzer/analyzer";
import {logger} from "../core/logger";
import {fileURLToPath} from "node:url";
import * as fs from "fs";
import {AnalyzerScope, createGlobalScope} from "../compiler_analyzer/analyzerScope";
import {AnalysisQueue, AnalysisQueuePriority} from "./analysisQueue";

interface PartialInspectRecord {
    readonly uri: string;
    readonly diagnosticsInParser: lsp.Diagnostic[];
    diagnosticsInAnalyzer: lsp.Diagnostic[];
    readonly rawTokens: TokenObject[];
    readonly preprocessedOutput: PreprocessedOutput;
    readonly ast: NodeScript;
    isAnalyzerPending: boolean;
    analyzerScope: AnalyzerScope;
}

export type InspectRequest = (uri: string, content: string) => void;

export type DiagnosticsCallback = (params: PublishDiagnosticsParams) => void;

const predefinedFileName = 'as.predefined';

const profilerDescriptionLength = 12;

const mediumWaitTime = 500; // ms

const shortWaitTime = 100; // ms

const veryShortWaitTime = 10; // ms

function getAbsolutePathFromIncludeToken(baseUri: string, token: TokenString) {
    return resolveIncludeUri(baseUri, token.getStringContent());
}

export class AnalysisResolver {
    private readonly _analyzerTask: DelayedTask = new DelayedTask();

    private readonly _analysisQueue: AnalysisQueue<PartialInspectRecord> = new AnalysisQueue();

    private readonly _resolvedPredefinedFilepaths: Set<string> = new Set();

    // Tracks directories already scanned for .as files when implicitMutualInclusion
    // is active but no user as.predefined is present.
    private readonly _scannedImplicitDirectories: Set<string> = new Set();

    // Set by the server from LSP InitializeParams — the VS Code workspace folder URI.
    private _workspaceRootUri: string | undefined = undefined;

    // Called with (scanned, total) during workspace indexing so the client can show progress.
    private _scanProgressCallback: ((scanned: number, total: number) => void) | undefined = undefined;

    public constructor(
        public readonly _inspectRecords: Map<string, PartialInspectRecord>,
        private readonly _inspectRequest: InspectRequest,
        private readonly _diagnosticsCallback: DiagnosticsCallback,
        private readonly _builtInPredefinedUri: string | undefined = undefined,
    ) { }

    /**
     * Load the built-in Perception predefined file into the inspect records.
     * Must be called AFTER the owning Inspector has finished initializing all
     * its class fields, so that inspectFile → _analysisResolver.request() is safe.
     */
    public setWorkspaceRoot(uri: string): void {
        this._workspaceRootUri = uri.endsWith('/') ? uri : uri + '/';
    }

    public setScanProgressCallback(cb: (scanned: number, total: number) => void): void {
        this._scanProgressCallback = cb;
    }

    public loadBuiltInPredefined(): void {
        if (this._builtInPredefinedUri === undefined) return;
        if (this._resolvedPredefinedFilepaths.has(this._builtInPredefinedUri)) return;
        const content = readFileContent(this._builtInPredefinedUri);
        if (content !== undefined) {
            this._inspectRequest(this._builtInPredefinedUri, content);
            this._resolvedPredefinedFilepaths.add(this._builtInPredefinedUri);
        }
    }

    public reset() {
        this._analysisQueue.clear();
        this._resolvedPredefinedFilepaths.clear();
        this._scannedImplicitDirectories.clear();

        // Re-register the built-in predefined after a reset so it is always available.
        if (this._builtInPredefinedUri !== undefined) {
            this._resolvedPredefinedFilepaths.add(this._builtInPredefinedUri);
        }
    }

    /**
     * Request to analyze the file specified by the URI at a later time.
     */
    public request(record: PartialInspectRecord, reanalyzeDependents: boolean) {
        this._analysisQueue.pushDirect({record: record!, reanalyzeDependents: reanalyzeDependents});

        this._analyzerTask.reschedule(() => {
            this.handleAnalyze();
        }, mediumWaitTime);
    }

    private rescheduleAnalyzeRemaining() {
        let waitTime;
        if (this._analysisQueue.hasDirect()) {
            waitTime = veryShortWaitTime;
        } else if (this._analysisQueue.hasIndirect()) {
            waitTime = shortWaitTime;
        } else {
            // No files to analyze
            return;
        }

        this._analyzerTask.reschedule(() => {
            this.handleAnalyze();
        }, waitTime);
    }

    // Pop and analyze the file in the queue
    private popAndAnalyze() {
        const element = this._analysisQueue.frontPop();
        if (element === undefined) return;

        this.analyzeFile(element.record);

        if (element.reanalyzeDependents) {
            // Add the dependent files to the indirect queue.
            // If the current file is an element of the direct queue,
            // schedule a reanalysis after processing the newly added elements.
            // This is because those files may affect the current file.
            const reanalyzeDependents = element.queue === AnalysisQueuePriority.Direct;
            this.reanalyzeFilesWithDependency(element.record.uri, reanalyzeDependents);
        }
    }

    /**
     * Processes any queued files for analysis immediately if they exist.
     */
    public flush(uri: string | undefined) {
        // Analyze until the direct queue is empty
        while (this._analysisQueue.hasDirect()) {
            this.popAndAnalyze();
        }

        if (uri === undefined) {
            // If the uri is not specified, reanalyze all files in the reanalysis queue
            while (this._analysisQueue.hasIndirect()) {
                this.popAndAnalyze();
            }
        } else if (this._analysisQueue.isInQueue(uri)) {
            // If the file is in the reanalysis queue, move it to the front of the direct queue and reanalyze it.
            const frontRecord = this._inspectRecords.get(uri);
            if (frontRecord === undefined) return;

            this._analysisQueue.frontPushDirect({record: frontRecord, reanalyzeDependents: false});

            this.popAndAnalyze();
        }
    }

    private handleAnalyze() {
        // Analyze the file in the queue
        this.popAndAnalyze();

        this.rescheduleAnalyzeRemaining();
    }

    private analyzeFile(record: PartialInspectRecord) {
        // In multi-project mode, skip full analysis for syntaxOnly projects.
        // Parser diagnostics (syntax errors) are still reported from the inspect step.
        const project = getProjectForUri(record.uri);
        if (project !== undefined && project.config.lspMode === 'syntaxOnly') {
            record.isAnalyzerPending = false;
            this._diagnosticsCallback({
                uri: record.uri,
                diagnostics: [...record.diagnosticsInParser]
            });
            return;
        }

        const predefinedUri = this.findPredefinedUri(record.uri);

        logger.message(`[Analyzer]\n${record.uri}`);

        // -----------------------------------------------
        analyzerDiagnostic.beginSession();

        // Collect scopes in included files
        const includeScopes = this.collectIncludeScope(record, predefinedUri);

        const profiler = new Profiler();

        // Execute the hoist
        const hoistResult = hoistAfterParsed(record.ast, createGlobalScope(record.uri, includeScopes));
        profiler.mark('Hoist'.padEnd(profilerDescriptionLength));

        // Execute the analyzer
        record.analyzerScope = analyzeAfterHoisted(record.uri, hoistResult);
        profiler.mark('Analyzer'.padEnd(profilerDescriptionLength));

        record.diagnosticsInAnalyzer = analyzerDiagnostic.endSession();
        // -----------------------------------------------

        record.isAnalyzerPending = false;

        // Never surface diagnostics for predefined files (built-in or user as.predefined) —
        // they use generic syntax (T, K, V) and duplicate built-in symbols that the analyzer
        // cannot resolve, producing spurious errors that pollute the Problems panel.
        const isPredefined =
            record.uri === this._builtInPredefinedUri ||
            record.uri.endsWith('.as.predefined');

        this._diagnosticsCallback({
            uri: record.uri,
            diagnostics: isPredefined ? [] : [...record.diagnosticsInParser, ...record.diagnosticsInAnalyzer]
        });

        logger.message(`(${process.memoryUsage().heapUsed / 1024 / 1024} MB used)`);
    }

    // We will reanalyze the files that include the file specified by the given URI.
    private reanalyzeFilesWithDependency(targetUri: string, reanalyzeDependents: boolean) {
        const resolvedSet = new Set<string>();
        this.reanalyzeFilesWithDependencyInternal(resolvedSet, targetUri, reanalyzeDependents);
    }

    private reanalyzeFilesWithDependencyInternal(resolvedSet: Set<string>, targetUri: string, reanalyzeDependents: boolean) {
        if (resolvedSet.has(targetUri)) return;

        const projectFilter = this.createProjectFilter(targetUri);
        const dependentFiles = Array.from(this._inspectRecords.values()) // Get all records
            .filter(r => projectFilter(r.uri)) // Only consider files in the same project
            .filter(r =>
                this.resolveIncludeAbsolutePaths(r, this.findPredefinedUri(r.uri)) // Get include paths of each record
                    .some(uri => uri === targetUri) // Check if the target file is included
            );

        for (const dependent of dependentFiles) {
            this._analysisQueue.pushIndirect({record: dependent, reanalyzeDependents: reanalyzeDependents});
            resolvedSet.add(dependent.uri);
        }

        // Recursively reanalyze the files that include the dependent files
        for (const dependent of dependentFiles) {
            this.reanalyzeFilesWithDependencyInternal(resolvedSet, dependent.uri, reanalyzeDependents);
        }
    }

    private resolveIncludeAbsolutePaths(record: PartialInspectRecord, predefinedUri: string | undefined): string[] {
        const includeSet = new Set<string>();

        // Add built-in Perception predefined first, then 'as.predefined', then any force-included paths.
        const predefinedUriList = [
            this._builtInPredefinedUri,
            predefinedUri,
            ...getGlobalSettings().forceIncludePredefined.map(uri => resolveIncludeUri(record.uri, uri))
        ];
        for (const uri of predefinedUriList) {
            if (uri === undefined || uri == record.uri) {
                continue;
            }

            const predefinedRecord = this._inspectRecords.get(uri);
            if (predefinedRecord !== undefined) {
                this.resolveIncludeAbsolutePathsInternal(includeSet, predefinedRecord);
            } else {
                includeSet.add(uri);
            }
        }

        // Recursively resolve the include-paths
        this.resolveIncludeAbsolutePathsInternal(includeSet, record);

        // Remove the current file from the include paths
        includeSet.delete(record.uri);

        if (getGlobalSettings().implicitMutualInclusion) {
            if (record.uri.endsWith(predefinedFileName) === false) {
                // In multi-project mode, only include files from the same project.
                const projectFilter = this.createProjectFilter(record.uri);

                if (predefinedUri !== undefined) {
                    // Original behaviour: include all .as files under the predefined directory.
                    const predefinedDirectory = resolveUri(predefinedUri, '.');
                    return [...Array.from(includeSet),
                        ...Array.from(this._inspectRecords.keys())
                            .filter(uri => uri.startsWith(predefinedDirectory))
                            .filter(uri => uri.endsWith('.as') && uri !== record.uri)
                            .filter(projectFilter)];
                } else {
                    // No user as.predefined — include every .as file currently known in the
                    // workspace (i.e. all files the LSP has opened or discovered so far).
                    return [...Array.from(includeSet),
                        ...Array.from(this._inspectRecords.keys())
                            .filter(uri => uri.endsWith('.as') && uri !== record.uri)
                            .filter(projectFilter)];
                }
            }
        }

        return Array.from(includeSet);
    }

    private resolveIncludeAbsolutePathsInternal(includeSet: Set<string>, record: PartialInspectRecord) {
        if (includeSet.has(record.uri)) return;
        includeSet.add(record.uri);

        // Add include paths from include directives
        const includePaths =
            record.preprocessedOutput.includePathTokens.map(
                token => getAbsolutePathFromIncludeToken(record.uri, token));

        // Recursively resolve the include-paths
        for (const relativePath of includePaths) {
            const uri = resolveUri(record.uri, relativePath);

            const includeRecord = this._inspectRecords.get(uri);
            if (includeRecord !== undefined) {
                this.resolveIncludeAbsolutePathsInternal(includeSet, includeRecord);
            } else {
                includeSet.add(uri);
            }
        }
    }

    /**
     * Creates a filter function that restricts URIs to the same project as the given file.
     * In single-project mode (no projects defined), returns a pass-through filter.
     */
    private createProjectFilter(fileUri: string): (uri: string) => boolean {
        if (!isMultiProjectMode()) return () => true;

        const project = getProjectForUri(fileUri);
        if (project === undefined) return () => true;

        return (uri: string) => {
            // Built-in predefined and .as.predefined files are always allowed
            if (uri === this._builtInPredefinedUri || uri.endsWith('.as.predefined')) return true;
            return uri.startsWith(project.sourceDirUri);
        };
    }

    private findPredefinedUri(targetUri: string): string | undefined {
        const dirs = getParentDirectoryList(targetUri);

        // Search for nearest 'as.predefined'
        for (const dir of dirs) {
            const predefinedUri = dir + `/${predefinedFileName}`;

            if (this._inspectRecords.get(predefinedUri) !== undefined &&
                this._resolvedPredefinedFilepaths.has(predefinedUri)
            ) {
                return predefinedUri;
            }

            if (targetUri !== predefinedUri) {
                const content = readFileContent(predefinedUri);
                if (content === undefined) continue;

                this._inspectRequest(predefinedUri, content);
            }

            this.inspectUnderDirectory(resolveUri(predefinedUri, '.'));
            this._resolvedPredefinedFilepaths.add(predefinedUri);

            return predefinedUri;
        }

        // No user as.predefined found. When implicitMutualInclusion is enabled, scan
        // the appropriate directory so all project .as files are discovered.
        // In multi-project mode, scan only the project's source directory.
        // Otherwise, scan the workspace root (supplied by the LSP client via setWorkspaceRoot()).
        // Fall back to the file's own directory if no workspace root is known yet.
        if (getGlobalSettings().implicitMutualInclusion) {
            let scanRoot: string | undefined;
            const project = getProjectForUri(targetUri);
            if (project !== undefined) {
                scanRoot = project.sourceDirUri;
            } else {
                scanRoot = this._workspaceRootUri ?? (dirs[0] ? dirs[0] + '/' : undefined);
            }
            if (scanRoot !== undefined && !this._scannedImplicitDirectories.has(scanRoot)) {
                this._scannedImplicitDirectories.add(scanRoot);
                const total = this.countAsFiles(scanRoot);
                const progress = {scanned: 0, total};
                this._scanProgressCallback?.(0, total);
                this.inspectUnderDirectory(scanRoot, progress);
                this._scanProgressCallback?.(total, total);
            }
        }

        return undefined;
    }

    private inspectUnderDirectory(dirUri: string, progress?: { scanned: number; total: number }) {
        const exclude = new Set(getGlobalSettings().indexExclude ?? []);
        const entries = this.getDirectoryEntries(dirUri);
        for (const entry of entries) {
            const fileUri = resolveUri(dirUri, entry.name);
            if (entry.isDirectory()) {
                if (!exclude.has(entry.name)) {
                    this.inspectUnderDirectory(`${fileUri}/`, progress);
                }
            } else if (entry.isFile() && fileUri.endsWith('.as')) {
                const content = readFileContent(fileUri);
                if (content !== undefined) {
                    this._inspectRequest(fileUri, content);
                    if (progress) {
                        progress.scanned++;
                        this._scanProgressCallback?.(progress.scanned, progress.total);
                    }
                }
            }
        }
    }

    // Quick pass to count indexable .as files so we can report accurate progress.
    private countAsFiles(dirUri: string): number {
        const exclude = new Set(getGlobalSettings().indexExclude ?? []);
        let count = 0;
        for (const entry of this.getDirectoryEntries(dirUri)) {
            if (entry.isDirectory() && !exclude.has(entry.name)) {
                count += this.countAsFiles(`${resolveUri(dirUri, entry.name)}/`);
            } else if (entry.isFile() && entry.name.endsWith('.as')) {
                count++;
            }
        }
        return count;
    }

    private getDirectoryEntries(dirUri: string) {
        try {
            return fs.readdirSync(fileURLToPath(dirUri), {withFileTypes: true});
        } catch (e) {
            return [];
        }
    }

    private collectIncludeScope(
        record: PartialInspectRecord, predefinedUri: string | undefined
    ): AnalyzerScope[] {
        const preprocessOutput = record.preprocessedOutput;
        const targetUri = record.uri;

        // Collect scopes in included files
        const includePaths = this.resolveIncludeAbsolutePaths(record, predefinedUri);

        const includedScopes = [];

        // Get the analyzed scope of included files
        for (const uri of includePaths) {
            const includeRecord = this._inspectRecords.get(uri);
            if (includeRecord !== undefined) {
                includedScopes.push(includeRecord.analyzerScope);
                continue;
            }

            // If the file has not been analyzed, start inspecting it
            const content = readFileContent(uri);
            if (content !== undefined) {
                this._inspectRequest(uri, content);
                continue;
            }

            // If the file is not found, notify the error
            const includePathToken =
                preprocessOutput.includePathTokens.find(
                    token => getAbsolutePathFromIncludeToken(targetUri, token) === uri);
            if (includePathToken === undefined) {
                // This happens when implicitMutualInclusion is enabled.
                continue;
            }

            analyzerDiagnostic.error(includePathToken.location, `File not found: ${includePathToken.text}`);
        }

        return includedScopes;
    }
}
