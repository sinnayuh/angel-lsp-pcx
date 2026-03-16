/**
 * Per-project configuration for multi-project workspaces.
 * When projects are defined, each source directory is treated as an isolated
 * project with its own include resolution and analysis scope.
 */
export interface ProjectConfig {
    name: string;
    sourceDirectory: string;
    outputFile: string;
    stripComments: boolean;
    lspMode: 'full' | 'syntaxOnly';
}

/**
 * LanguageServer settings.
 * See package.json because the settings in VSCode are defined in it.
 */
interface LanguageServerSettings {
    suppressAnalyzerErrors: boolean;
    includePath: string[];
    forceIncludePredefined: string[];
    implicitMutualInclusion: boolean;
    indexExclude: string[];
    hoistEnumParentScope: boolean;
    explicitPropertyAccessor: boolean;
    allowUnicodeIdentifiers: boolean;
    supportsForEach: boolean;
    characterLiterals: boolean;
    supportsTypedEnumerations: boolean;
    supportsDigitSeparators: boolean;
    builtinStringType: string;
    builtinArrayType: string;
    formatter: {
        maxBlankLines: number;
        indentSpaces: number;
        useTabIndent: boolean;
    };
    trace: {
        server: 'off' | 'messages' | 'verbose';
    };
    projects: ProjectConfig[];
}

const defaultSettings: LanguageServerSettings = {
    suppressAnalyzerErrors: true,
    includePath: [],
    forceIncludePredefined: [],
    implicitMutualInclusion: false,
    indexExclude: ['output', 'node_modules', '.git', 'reference', '.cursor', '.claude', '.specstory'],
    hoistEnumParentScope: false,
    explicitPropertyAccessor: false,
    allowUnicodeIdentifiers: false,
    supportsForEach: true,
    characterLiterals: false,
    supportsTypedEnumerations: false,
    supportsDigitSeparators: false,
    builtinStringType: "string",
    builtinArrayType: "array",
    formatter: {
        maxBlankLines: 1,
        indentSpaces: 4,
        useTabIndent: false
    },
    trace: {
        server: 'off'
    },
    projects: []
};

let globalSettings: LanguageServerSettings = defaultSettings;

/**
 * Reset the instance of global settings.
 */
export function resetGlobalSettings(config: any) {
    globalSettings = <LanguageServerSettings>(config ?? defaultSettings);
}

/**
 * Get the global settings.
 * The behavior of the LanguageServer configuration is controlled from here.
 */
export function getGlobalSettings(): Readonly<LanguageServerSettings> {
    return globalSettings;
}

export function copyGlobalSettings(): LanguageServerSettings {
    return structuredClone(globalSettings);
}

/**
 * Resolved project configs with absolute source directory URIs.
 * Populated by the server after workspace root is known.
 */
let resolvedProjects: ResolvedProject[] = [];

export interface ResolvedProject {
    config: ProjectConfig;
    sourceDirUri: string; // Absolute file:// URI ending with /
}

export function setResolvedProjects(projects: ResolvedProject[]): void {
    resolvedProjects = projects;
}

export function getResolvedProjects(): readonly ResolvedProject[] {
    return resolvedProjects;
}

/**
 * Find which project a file URI belongs to based on its source directory.
 * Returns undefined if the file is not inside any defined project.
 */
export function getProjectForUri(uri: string): ResolvedProject | undefined {
    if (resolvedProjects.length === 0) return undefined;
    // Find the most specific (longest) matching source directory
    let best: ResolvedProject | undefined;
    for (const proj of resolvedProjects) {
        if (uri.startsWith(proj.sourceDirUri)) {
            if (best === undefined || proj.sourceDirUri.length > best.sourceDirUri.length) {
                best = proj;
            }
        }
    }
    return best;
}

/**
 * Returns true if multi-project mode is active (at least one project defined).
 */
export function isMultiProjectMode(): boolean {
    return resolvedProjects.length > 0;
}
