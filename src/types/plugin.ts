import type { Plugin } from 'obsidian';
import type { ObsidianGeminiSettings } from './settings';

/**
 * The plugin surface components depend on instead of the concrete class in
 * `src/main.ts` (see #1155). `main.ts` imports nearly the whole codebase, so a
 * type reference back to it folds the module graph into a cycle from almost
 * every file; this interface lives in a leaf module that imports nothing that
 * imports it back, keeping the dependency graph acyclic.
 *
 * Only core members are declared here. Every service/manager handle
 * (`logger`, `gfile`, `sessionManager`, …) is contributed via module
 * augmentation from `./plugin-services.ts`, because naming a service class
 * here would import a module that itself depends on this interface.
 *
 * `class ObsidianGemini` in `main.ts` declares `implements` against the merged
 * interface, so the compiler keeps this surface in sync with the real class.
 */
export interface ObsidianGemini extends Plugin {
	settings: ObsidianGeminiSettings;

	/** Resolved API key for the active provider ('' when none is required/configured). */
	readonly apiKey: string;

	isGeminiInitialized: boolean;

	/**
	 * Snapshot of the last non-empty editor selection at the moment the user
	 * engaged the agent input. Used as a fallback in GetWorkspaceStateTool,
	 * whose live read of view.editor.getSelection() returns empty once focus
	 * has moved to the agent chat input.
	 */
	lastEditorSelection: { path: string; text: string } | null;

	/**
	 * Check if the plugin is initialized and show a notice if not.
	 * @returns true if initialized, false otherwise
	 */
	checkInitialized(): boolean;

	activateAgentView(): Promise<void>;

	loadSettings(): Promise<void>;

	saveSettings(): Promise<void>;
}
