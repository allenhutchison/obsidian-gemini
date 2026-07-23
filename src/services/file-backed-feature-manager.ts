import { normalizePath, type TFile } from 'obsidian';
import type { ObsidianGemini } from '../types/plugin';
import { JsonSidecarStateStore, purgeOrphanState } from './feature-definition';

/**
 * Minimal shape every file-backed feature definition shares: a `slug` (its
 * stable identifier, also the definition file's basename) and the `filePath`
 * of its `<slug>.md` definition file. `HookManager`'s `Hook` and
 * `ScheduledTaskManager`'s `ScheduledTask` both satisfy this.
 */
export interface FileBackedDefinition {
	readonly slug: string;
	readonly filePath: string;
}

/** Per-manager identity strings that parameterize the shared skeleton. */
export interface FileBackedFeatureManagerConfig {
	/** Folder name under the plugin state folder, e.g. `Hooks`. */
	featureFolder: string;
	/** Sidecar state file name, e.g. `hooks-state.json`. */
	stateFileName: string;
	/** Bracketed tag for log lines, e.g. `[HookManager]`. */
	logPrefix: string;
	/** Lowercase noun used in the parse-failure warning, e.g. `hook`. */
	featureNoun: string;
	/** Label used in the not-found error, e.g. `Hook` or `Scheduled task`. */
	entityLabel: string;
}

/** Subfolder (inside the feature folder) that holds per-run output. */
const RUNS_SUBFOLDER = 'Runs';

/**
 * Shared scaffold for the markdown-defined feature managers — `HookManager`
 * and `ScheduledTaskManager`. Both are file-backed: they discover `<slug>.md`
 * definition files under a folder in the plugin state directory, parse each
 * into a typed definition, and persist volatile per-entry runtime state to a
 * JSON sidecar. This base owns the parts of that outer skeleton that are
 * identical between the two — the folder-path getters, the discover-and-purge
 * template, the sidecar `loadState`/`saveState` wrappers, and the generic
 * `delete` — parameterized by the feature's folder + a per-file parse callback.
 *
 * The genuinely divergent parts stay in each subclass: the in-memory map (via
 * the {@link definitions} accessor), the per-file parse (via
 * {@link parseDefinitionFile}), any per-definition state seeding on discovery
 * (via {@link seedDiscoveredState}), and orphan-purge logging (via
 * {@link onOrphanPurged}). The field-level helpers already extracted into
 * `feature-definition.ts` (state store, `purgeOrphanState`, …) are consumed
 * here rather than re-implemented.
 *
 * @typeParam TDef        The manager's definition type (must expose `slug`/`filePath`).
 * @typeParam TEntryState The per-slug sidecar state value; the sidecar file is a
 *                        `Record<slug, TEntryState>`.
 */
export abstract class FileBackedFeatureManager<TDef extends FileBackedDefinition, TEntryState> {
	/** Live sidecar state map (slug → runtime state). Reassigned on load. */
	protected state: Record<string, TEntryState> = {};
	/** Persistence layer for {@link state}; the live object stays on this class. */
	protected readonly stateStore: JsonSidecarStateStore<Record<string, TEntryState>>;

	constructor(
		protected readonly plugin: ObsidianGemini,
		private readonly featureConfig: FileBackedFeatureManagerConfig
	) {
		// The sidecar path is resolved lazily on every load/save because it
		// depends on `settings.historyFolder`, which can change at runtime.
		this.stateStore = new JsonSidecarStateStore<Record<string, TEntryState>>(
			plugin,
			() => this.stateFilePath,
			featureConfig.logPrefix
		);
	}

	// ── Folder path helpers ──────────────────────────────────────────────────

	/** Absolute path of the feature folder inside the plugin state folder. */
	get featureFolderPath(): string {
		return normalizePath(`${this.plugin.settings.historyFolder}/${this.featureConfig.featureFolder}`);
	}

	/** Absolute path of the per-run output subfolder. */
	get runsFolder(): string {
		return normalizePath(`${this.featureFolderPath}/${RUNS_SUBFOLDER}`);
	}

	/** Absolute path of the JSON sidecar state file. */
	get stateFilePath(): string {
		return normalizePath(`${this.featureFolderPath}/${this.featureConfig.stateFileName}`);
	}

	// ── Subclass-supplied seams ──────────────────────────────────────────────

	/**
	 * The subclass's in-memory definition map. Exposed as an accessor so each
	 * manager keeps its own descriptively-named field (`hooks` / `tasks`) while
	 * the base operates on the same instance.
	 */
	protected abstract get definitions(): Map<string, TDef>;

	/** Parse a single definition file, or return `null` if it isn't valid. */
	protected abstract parseDefinitionFile(file: TFile): Promise<TDef | null>;

	/**
	 * Seed sidecar state for a definition newly encountered during discovery.
	 * Default: no-op (hooks don't seed). Scheduled tasks override this to seed a
	 * `nextRunAt` so a freshly-discovered task is due immediately.
	 */
	protected seedDiscoveredState(_def: TDef): void {}

	/**
	 * Called once per orphan state slug removed during discovery. Default:
	 * no-op (hooks purge silently). Scheduled tasks override this to log.
	 */
	protected onOrphanPurged(_slug: string): void {}

	// ── Discovery ────────────────────────────────────────────────────────────

	/**
	 * Rebuild the in-memory map from the definition files directly inside the
	 * feature folder (excluding the `Runs/` subtree), seed state for newly-seen
	 * definitions, drop orphan state entries, and persist. Replaces the
	 * copy-pasted `discoverHooks` / `discoverTasks` loops.
	 */
	protected async discoverDefinitions(): Promise<void> {
		this.definitions.clear();

		const prefix = this.featureFolderPath + '/';
		const runsPrefix = this.runsFolder + '/';

		const files = this.plugin.app.vault
			.getMarkdownFiles()
			.filter((f) => f.path.startsWith(prefix) && !f.path.startsWith(runsPrefix));

		for (const file of files) {
			try {
				const def = await this.parseDefinitionFile(file);
				if (!def) continue;
				this.definitions.set(def.slug, def);
				this.seedDiscoveredState(def);
			} catch (err) {
				this.plugin.logger.warn(
					`${this.featureConfig.logPrefix} Failed to parse ${this.featureConfig.featureNoun} file ${file.path}:`,
					err
				);
			}
		}

		// Drop state entries whose definition file is gone.
		for (const slug of purgeOrphanState(this.state, (s) => this.definitions.has(s))) {
			this.onOrphanPurged(slug);
		}

		await this.saveState();
	}

	// ── Delete ───────────────────────────────────────────────────────────────

	/**
	 * Delete a definition: trash its file, drop it from the in-memory map, and
	 * clear its sidecar state entry. Replaces the near-identical `deleteHook` /
	 * `deleteTask` bodies.
	 */
	protected async deleteDefinition(slug: string): Promise<void> {
		const def = this.definitions.get(slug);
		if (!def) throw new Error(`${this.featureConfig.entityLabel} "${slug}" not found`);

		const file = this.plugin.app.vault.getAbstractFileByPath(def.filePath);
		if (file) {
			await this.plugin.app.fileManager.trashFile(file);
		}

		this.definitions.delete(slug);
		delete this.state[slug];
		await this.saveState();
	}

	// ── State persistence ────────────────────────────────────────────────────

	protected async loadState(): Promise<void> {
		this.state = await this.stateStore.load();
	}

	protected async saveState(): Promise<void> {
		await this.stateStore.save(this.state);
	}
}
