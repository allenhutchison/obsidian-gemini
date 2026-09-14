import type { FeatureToolPolicy } from '../types/tool-policy';
import { parseMaxIterations, resolveFeatureToolPolicy } from './feature-definition';
import { formatToolPolicyYaml } from './feature-policy-yaml';
import { yamlScalar } from './yaml-scalar';

/**
 * Hook definition, state, and fire-context types plus the prompt-template
 * renderer and the field-descriptor table that every hook field flows through,
 * extracted to a leaf module so both HookManager and HookRunner can depend on
 * them without importing each other (see #1155). hook-manager.ts re-exports
 * everything here, so external import paths are unchanged.
 */
// ─── Defaults ─────────────────────────────────────────────────────────────────
//
// These live in the leaf (rather than in hook-manager.ts) because both the
// manager and the management modal need them: the manager applies them when
// creating/parsing a hook, and the modal seeds its form, placeholder, and
// field description from the same numbers. A second copy in the UI would let
// the two drift, so the modal shows one default while the manager writes
// another.

/** Default per-(hook, file) debounce window (ms). Resets on every matching event. */
export const DEFAULT_DEBOUNCE_MS = 5000;

/**
 * Default cooldown after a hook fire completes — further (hook, file) events
 * within this window are suppressed to prevent self-retrigger when the hook's
 * agent run wrote to the same file that triggered it.
 */
export const DEFAULT_COOLDOWN_MS = 30_000;

// ─── Public types ─────────────────────────────────────────────────────────────

export type HookTrigger = 'file-created' | 'file-modified' | 'file-deleted' | 'file-renamed';
export type HookAction = 'agent-task' | 'summarize' | 'rewrite' | 'command';

/**
 * A hook definition parsed from a markdown file at
 * {historyFolder}/Hooks/<slug>.md. Frontmatter controls the trigger, filter,
 * and action; the file body is the prompt template.
 */
export interface Hook {
	/** Derived from the file basename (no extension). */
	slug: string;
	trigger: HookTrigger;
	/**
	 * Optional glob matched against the triggering file's vault path.
	 * Supports `*` (single segment) and `**` (any depth). When omitted the
	 * hook fires for every path that survives the implicit state-folder
	 * exclusion.
	 */
	pathGlob?: string;
	/**
	 * Optional frontmatter constraints. Every key must match the value in the
	 * note's frontmatter for the hook to fire.
	 */
	frontmatterFilter?: Record<string, unknown>;
	/** Per-(hook, file) debounce window in milliseconds. */
	debounceMs: number;
	/** Optional sliding-window rate limit per (hook, file). */
	maxRunsPerHour?: number;
	/**
	 * After a fire completes, ignore further (hook, file) events for this
	 * window. Prevents the hook's own writes from re-triggering itself.
	 */
	cooldownMs: number;
	action: HookAction;
	/**
	 * Tool policy applied for the duration of each headless fire. Layered on
	 * top of the global plugin policy via FeatureToolPolicy. Undefined means
	 * inherit the global policy.
	 */
	toolPolicy?: FeatureToolPolicy;
	/** Slugs of skills to pre-activate in the headless session. */
	enabledSkills: string[];
	/** Optional model override; defaults to plugin chat model. */
	model?: string;
	/**
	 * Cap on agent tool-execution iterations for an `agent-task` fire. Each
	 * iteration is one tool-call batch, not a single tool call. Omitted means
	 * use DEFAULT_HEADLESS_MAX_ITERATIONS. Ignored for non-`agent-task` actions,
	 * which don't drive the agent loop.
	 */
	maxIterations?: number;
	/**
	 * Optional output path template for the agent run's final response.
	 * Supports {slug}, {date}, and {fileName} placeholders. When omitted no
	 * output file is written (the hook may still mutate files via tools).
	 */
	outputPath?: string;
	enabled: boolean;
	/**
	 * When true the hook is skipped on mobile platforms. Defaults to true for
	 * `agent-task` actions because headless agent runs can be heavyweight.
	 */
	desktopOnly: boolean;
	/**
	 * Prompt template body. Semantics depend on `action`:
	 *   agent-task → instruction sent to the model (supports {{filePath}} etc.)
	 *   rewrite    → rewrite instruction (also supports template variables)
	 *   summarize  → ignored (the summary template builds its own prompt)
	 *   command    → ignored (use commandId)
	 */
	prompt: string;
	/**
	 * Command palette command id to execute when `action: command`.
	 * Ignored for every other action.
	 */
	commandId?: string;
	/**
	 * When `action: command` and this is true, focus the triggering file in
	 * the workspace before dispatching the command. Lets editor-scoped
	 * commands (`editor:save-file`, etc.) target the file that fired the
	 * hook rather than whatever happens to be active. Defaults to false to
	 * keep global-command hooks from jumping the user's view on every fire.
	 * Ignored for every action other than `command`.
	 */
	focusFile?: boolean;
	/** Vault path of the hook definition file. */
	filePath: string;
}

/** Per-hook volatile runtime state stored in the sidecar JSON. */
export interface HookState {
	/** Recent fire timestamps (ms epoch) for hard-loop ceiling check. */
	recentFires?: number[];
	/** Recent fire timestamps used for `maxRunsPerHour` rate limit. */
	hourlyFires?: number[];
	/** Wall-clock timestamps when each (hook, file) last fired. */
	lastFireAt?: Record<string, number>;
	/** Error message from the most recent failed run, if any. */
	lastError?: string;
	/** Number of consecutive failures since the last success. */
	consecutiveFailures?: number;
	/** When true the hook is auto-paused until manually reset. */
	pausedDueToErrors?: boolean;
}

export type HooksState = Record<string, HookState>;

/**
 * The vault event payload passed to a hook fire. Captures everything the
 * runner needs without re-reading from the vault (which may have changed by
 * the time the debounce timer fires).
 */
export interface HookFireContext {
	hook: Hook;
	trigger: HookTrigger;
	filePath: string;
	fileName: string;
	oldPath?: string;
	frontmatter?: Record<string, unknown>;
}

/**
 * Fields that `Hook` requires but a caller may omit on create/update, because
 * `HookManager` fills them in from a default (`toHook`) rather than failing.
 */
type HookDefaultedField = 'debounceMs' | 'cooldownMs' | 'enabledSkills' | 'enabled' | 'desktopOnly';

/**
 * Parameters accepted by `HookManager.createHook` and the union of fields
 * `updateHook` understands. Mirrors the on-disk frontmatter schema; defaults
 * are applied at serialization time so callers can omit unset fields.
 *
 * Derived from `Hook` rather than re-listed so a new hook field can't land on
 * `Hook` alone and silently become unsettable through create/update — the
 * compiler now forces every addition to be either a create param or an
 * explicit `HookDefaultedField`. `filePath` is excluded because the manager
 * derives it from the slug.
 */
export type HookCreateParams = Omit<Hook, 'filePath' | HookDefaultedField> & Partial<Pick<Hook, HookDefaultedField>>;

export type HookUpdateParams = Partial<Omit<HookCreateParams, 'slug'>>;

// ─── Field descriptor table ───────────────────────────────────────────────────
//
// Every hook field used to be written out longhand in four uncompile-checked
// places (`updateHook`'s merge ladder, `serializeHook`, `hookToParams`, and
// `parseDefinitionFile`'s literal) plus the two the compiler did check. Adding
// a field to `Hook` and forgetting one of those sites produced a field that
// loaded from a hand-written file but vanished the first time the management UI
// saved it — silent, and invisible to type-check, lint, and tests alike (#1315).
//
// `HOOK_FIELDS` replaces all of them with one entry per field. Its type is a
// mapped type over `HookFieldKey`, so it is *total*: a field added to `Hook`
// fails to compile until it is described here.

/**
 * The hook fields that live in frontmatter — everything except `slug` (the file
 * basename), `filePath` (the file's vault path), and `prompt` (the file body).
 */
export type HookFieldKey = keyof Omit<Hook, 'slug' | 'filePath' | 'prompt'>;

/** The frontmatter-derived slice of a `Hook`, in its canonical in-memory form. */
export type HookFields = Pick<Hook, HookFieldKey>;

export interface HookFieldDescriptor<K extends HookFieldKey> {
	/**
	 * Read this field out of a note's frontmatter, returning `undefined` when
	 * the key is absent or malformed (the caller then falls through to
	 * `normalize`). Takes the whole record rather than a single key's value
	 * because not every field maps to one key: `toolPolicy` is resolved from
	 * the canonical `toolPolicy` block *and* the legacy `enabledTools` array it
	 * migrates from, and a one-key parser would silently drop unmigrated files.
	 */
	parse(frontmatter: Record<string, unknown>): Hook[K] | undefined;
	/**
	 * Put a value into its canonical in-memory form: apply the field's default
	 * when it is absent, and fold the empty sentinels (`''`, `0`) back to
	 * `undefined` so "unset" has exactly one representation. Used on both the
	 * read path and the create/update path, which is what keeps them agreeing.
	 */
	normalize(value: Hook[K] | undefined): Hook[K] | undefined;
	/**
	 * Emit the field's YAML line(s), or `null` when the value is the default
	 * and should be elided so saved files stay minimal. Returns an array rather
	 * than a single line because `frontmatterFilter`, `enabledSkills`, and
	 * `toolPolicy` all emit nested blocks.
	 */
	serialize(value: Hook[K] | undefined): string[] | null;
}

/**
 * One descriptor per frontmatter-backed hook field.
 *
 * **Declaration order is emission order.** `serializeHookFields` walks this
 * table's keys, so reordering entries rewrites every existing hook file the
 * next time it is saved. The order below is the one `serializeHook` has always
 * emitted, which is deliberately *not* the order `Hook` declares its fields in.
 */
const HOOK_FIELDS: { readonly [K in HookFieldKey]: HookFieldDescriptor<K> } = {
	trigger: {
		parse: (fm) => parseTrigger(fm.trigger),
		normalize: (v) => v,
		serialize: (v) => (v ? [`trigger: '${v}'`] : null),
	},
	action: {
		parse: (fm) => parseAction(fm.action),
		normalize: (v) => v,
		serialize: (v) => (v ? [`action: '${v}'`] : null),
	},
	pathGlob: {
		parse: (fm) => (typeof fm.pathGlob === 'string' ? fm.pathGlob : undefined),
		normalize: (v) => v || undefined,
		serialize: (v) => (v ? [`pathGlob: ${yamlScalar(v)}`] : null),
	},
	frontmatterFilter: {
		parse: (fm) =>
			fm.frontmatterFilter && typeof fm.frontmatterFilter === 'object'
				? (fm.frontmatterFilter as Record<string, unknown>)
				: undefined,
		normalize: (v) => (v && Object.keys(v).length > 0 ? v : undefined),
		serialize: (v) => {
			if (!v || Object.keys(v).length === 0) return null;
			const lines = ['frontmatterFilter:'];
			for (const [key, value] of Object.entries(v)) {
				// The key is user-authored free text, so it needs the same quoting as
				// any other string. The value is typed `unknown` and must keep its YAML
				// type (a boolean filter has to parse back as a boolean, not `'true'`),
				// so only string values go through the string emitter; everything else
				// stays on JSON.stringify, which is a valid YAML flow scalar.
				const emitted = typeof value === 'string' ? yamlScalar(value) : JSON.stringify(value);
				lines.push(`  ${yamlScalar(key)}: ${emitted}`);
			}
			return lines;
		},
	},
	debounceMs: {
		parse: (fm) => (typeof fm.debounceMs === 'number' ? fm.debounceMs : undefined),
		normalize: (v) => v ?? DEFAULT_DEBOUNCE_MS,
		serialize: (v) => (v !== undefined && v !== DEFAULT_DEBOUNCE_MS ? [`debounceMs: ${v}`] : null),
	},
	maxRunsPerHour: {
		parse: (fm) => (typeof fm.maxRunsPerHour === 'number' ? fm.maxRunsPerHour : undefined),
		// `0` (and anything below it) means "no limit", the same reading
		// `serializeHook` has always taken when eliding the key. Folding it to
		// `undefined` here is what lets the rate-limit check stay a plain
		// `!== undefined` test.
		normalize: (v) => (v !== undefined && v > 0 ? v : undefined),
		serialize: (v) => (v !== undefined && v > 0 ? [`maxRunsPerHour: ${v}`] : null),
	},
	cooldownMs: {
		parse: (fm) => (typeof fm.cooldownMs === 'number' ? fm.cooldownMs : undefined),
		normalize: (v) => v ?? DEFAULT_COOLDOWN_MS,
		serialize: (v) => (v !== undefined && v !== DEFAULT_COOLDOWN_MS ? [`cooldownMs: ${v}`] : null),
	},
	toolPolicy: {
		parse: (fm) => resolveFeatureToolPolicy(fm),
		normalize: (v) => v,
		serialize: (v) => formatToolPolicyYaml(v),
	},
	enabledSkills: {
		parse: (fm) => (Array.isArray(fm.enabledSkills) ? (fm.enabledSkills as string[]) : undefined),
		normalize: (v) => v ?? [],
		serialize: (v) => (v && v.length > 0 ? ['enabledSkills:', ...v.map((s) => `  - ${yamlScalar(s)}`)] : null),
	},
	model: {
		parse: (fm) => (typeof fm.model === 'string' ? fm.model : undefined),
		normalize: (v) => v || undefined,
		serialize: (v) => (v ? [`model: ${yamlScalar(v)}`] : null),
	},
	maxIterations: {
		// parseMaxIterations rejects non-integers and anything <= 0 on both the
		// read path and the write path, so an invalid value can neither load nor
		// be persisted.
		parse: (fm) => parseMaxIterations(fm.maxIterations),
		normalize: (v) => parseMaxIterations(v),
		serialize: (v) => (v !== undefined ? [`maxIterations: ${v}`] : null),
	},
	outputPath: {
		parse: (fm) => (typeof fm.outputPath === 'string' ? fm.outputPath : undefined),
		normalize: (v) => v || undefined,
		serialize: (v) => (v ? [`outputPath: ${yamlScalar(v)}`] : null),
	},
	commandId: {
		parse: (fm) => (typeof fm.commandId === 'string' ? fm.commandId : undefined),
		normalize: (v) => v || undefined,
		serialize: (v) => (v ? [`commandId: ${yamlScalar(v)}`] : null),
	},
	// Defaults are enabled=true, desktopOnly=true, focusFile=false — only the
	// non-default value is written.
	enabled: {
		parse: (fm) => (typeof fm.enabled === 'boolean' ? fm.enabled : undefined),
		normalize: (v) => v ?? true,
		serialize: (v) => (v === false ? ['enabled: false'] : null),
	},
	desktopOnly: {
		parse: (fm) => (typeof fm.desktopOnly === 'boolean' ? fm.desktopOnly : undefined),
		normalize: (v) => v ?? true,
		serialize: (v) => (v === false ? ['desktopOnly: false'] : null),
	},
	focusFile: {
		parse: (fm) => (fm.focusFile === true ? true : undefined),
		normalize: (v) => (v === true ? true : undefined),
		serialize: (v) => (v === true ? ['focusFile: true'] : null),
	},
};

/** The table's keys in emission order. */
export const HOOK_FIELD_KEYS = Object.keys(HOOK_FIELDS) as HookFieldKey[];

/**
 * `HOOK_FIELDS[key]` for a `key` that is only known to be *some* `HookFieldKey`.
 * TypeScript cannot correlate the index type with the descriptor's own type
 * parameter across a loop, so the four walkers below widen once, here, rather
 * than each dealing with the union inline.
 */
function descriptorFor(key: HookFieldKey): HookFieldDescriptor<HookFieldKey> {
	return HOOK_FIELDS[key];
}

/**
 * Read every hook field out of a note's frontmatter.
 *
 * Returns `null` when `trigger` or `action` is missing or unrecognised — those
 * two are the only fields with no default, so a file without them is not a
 * usable hook definition at all.
 */
export function parseHookFields(frontmatter: Record<string, unknown>): HookFields | null {
	const fields: Record<string, unknown> = {};
	for (const key of HOOK_FIELD_KEYS) {
		const descriptor = descriptorFor(key);
		fields[key] = descriptor.normalize(descriptor.parse(frontmatter));
	}
	if (fields.trigger === undefined || fields.action === undefined) return null;
	return fields as HookFields;
}

/** Put create/update params into their canonical in-memory form. */
export function normalizeHookFields(params: Partial<HookFields>): HookFields {
	const fields: Record<string, unknown> = {};
	for (const key of HOOK_FIELD_KEYS) {
		const descriptor = descriptorFor(key);
		fields[key] = descriptor.normalize(params[key]);
	}
	return fields as HookFields;
}

/**
 * Merge update params over an existing hook's fields.
 *
 * **Replace semantics, uniformly:** a key *present* in `params` wins even when
 * its value is `undefined`. That is how the edit form clears a field — it sends
 * every emptied optional field as `undefined` — and before #1315 only
 * `toolPolicy` and `maxIterations` honoured it. The other six clearable fields
 * used `??`, so emptying `pathGlob`, `model`, `outputPath`, `commandId`,
 * `maxRunsPerHour`, or `focusFile` in the UI silently restored the old value.
 */
export function mergeHookFields(current: HookFields, params: Partial<HookFields>): HookFields {
	const fields: Record<string, unknown> = {};
	for (const key of HOOK_FIELD_KEYS) {
		const descriptor = descriptorFor(key);
		fields[key] = descriptor.normalize(key in params ? params[key] : current[key]);
	}
	return fields as HookFields;
}

/** Emit the frontmatter body (no `---` fences) for a set of hook fields. */
export function serializeHookFields(fields: HookFields): string[] {
	const lines: string[] = [];
	for (const key of HOOK_FIELD_KEYS) {
		const emitted = descriptorFor(key).serialize(fields[key]);
		if (emitted) lines.push(...emitted);
	}
	return lines;
}

function parseTrigger(value: unknown): HookTrigger | undefined {
	if (value === 'file-created' || value === 'file-modified' || value === 'file-deleted' || value === 'file-renamed') {
		return value;
	}
	return undefined;
}

function parseAction(value: unknown): HookAction | undefined {
	if (value === 'agent-task' || value === 'summarize' || value === 'rewrite' || value === 'command') return value;
	return undefined;
}

// ─── Prompt rendering ──────────────────────────────────────────────────────────
//
// Glob / frontmatter matching lives in ./hook-matcher (matchesGlob,
// matchesFrontmatterFilter, globToRegExp). renderPrompt lives here (not in
// hook-manager) because it's shared with hook-runner, and a leaf home keeps
// the manager ↔ runner edge one-way (see #1155).

/** Substitute {{var}} placeholders in `template` from `vars`. */
export function renderPrompt(template: string, vars: Record<string, string>): string {
	return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name: string) => vars[name] ?? '');
}
