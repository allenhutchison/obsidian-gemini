import { describe, it, expect } from 'vitest';
import { load as parseYaml } from 'js-yaml';
import {
	DEFAULT_COOLDOWN_MS,
	DEFAULT_DEBOUNCE_MS,
	HOOK_FIELD_KEYS,
	mergeHookFields,
	normalizeHookFields,
	parseHookFields,
	serializeHookFields,
	type HookFields,
} from '../../src/services/hook-types';
import { PolicyPreset, ToolPermission } from '../../src/types/tool-policy';

// The HOOK_FIELDS descriptor table (#1315) is the single enumeration every hook
// field flows through — parse, normalize, merge, serialize. These tests are the
// regression net for that table itself: they walk it rather than naming fields
// one at a time, so a field added to `Hook` is covered the moment it is
// described, without anyone remembering to extend a fixture.

/** Parse an emitted frontmatter block back into the record a hook file yields. */
function parseFrontmatter(lines: string[]): Record<string, unknown> {
	return (parseYaml(lines.join('\n')) ?? {}) as Record<string, unknown>;
}

/** A hook with every field set to a *non-default* value. */
function fullyPopulatedFields(): HookFields {
	return {
		trigger: 'file-renamed',
		action: 'command',
		pathGlob: 'Notes/**/*.md',
		frontmatterFilter: { status: 'draft', pinned: true, priority: 3 },
		debounceMs: DEFAULT_DEBOUNCE_MS + 1234,
		maxRunsPerHour: 7,
		cooldownMs: DEFAULT_COOLDOWN_MS + 5678,
		toolPolicy: {
			preset: PolicyPreset.READ_ONLY,
			overrides: { read_file: ToolPermission.APPROVE },
		},
		enabledSkills: ['summarize', 'index-files'],
		model: 'gemini-flash-latest',
		maxIterations: 9,
		outputPath: 'Reports/{slug}-{date}.md',
		commandId: 'editor:save-file',
		enabled: false,
		desktopOnly: false,
		focusFile: true,
	};
}

describe('HOOK_FIELDS table shape', () => {
	it('covers exactly the frontmatter-backed hook fields, in emission order', () => {
		// Declaration order in the table *is* serialization order: reordering it
		// rewrites every existing hook file on its next save. Pinning the list
		// here also catches a field added to `Hook` and described in the table
		// but never thought about here.
		expect(HOOK_FIELD_KEYS).toEqual([
			'trigger',
			'action',
			'pathGlob',
			'frontmatterFilter',
			'debounceMs',
			'maxRunsPerHour',
			'cooldownMs',
			'toolPolicy',
			'enabledSkills',
			'model',
			'maxIterations',
			'outputPath',
			'commandId',
			'enabled',
			'desktopOnly',
			'focusFile',
		]);
	});
});

describe('hook field round-trip', () => {
	it('parse(serialize(hook)) recovers every field', () => {
		const fields = fullyPopulatedFields();

		const reparsed = parseHookFields(parseFrontmatter(serializeHookFields(fields)));

		expect(reparsed).toEqual(fields);
	});

	it('round-trips a minimal hook to its defaults', () => {
		const minimal = normalizeHookFields({ trigger: 'file-created', action: 'summarize' });

		const reparsed = parseHookFields(parseFrontmatter(serializeHookFields(minimal)));

		expect(reparsed).toEqual(minimal);
		expect(minimal.debounceMs).toBe(DEFAULT_DEBOUNCE_MS);
		expect(minimal.cooldownMs).toBe(DEFAULT_COOLDOWN_MS);
		expect(minimal.enabled).toBe(true);
		expect(minimal.desktopOnly).toBe(true);
		expect(minimal.enabledSkills).toEqual([]);
	});

	it('is order-stable: a fully-populated hook emits its documented frontmatter', () => {
		// The golden block. A round-trip assertion is order-insensitive, so only
		// this one notices a table ordered by `Hook`'s declaration order rather
		// than by emission order.
		expect(serializeHookFields(fullyPopulatedFields())).toEqual([
			"trigger: 'file-renamed'",
			"action: 'command'",
			"pathGlob: 'Notes/**/*.md'",
			'frontmatterFilter:',
			"  'status': 'draft'",
			"  'pinned': true",
			"  'priority': 3",
			'debounceMs: 6234',
			'maxRunsPerHour: 7',
			'cooldownMs: 35678',
			'toolPolicy:',
			'  preset: read_only',
			'  overrides:',
			"    'read_file': allow",
			'enabledSkills:',
			"  - 'summarize'",
			"  - 'index-files'",
			"model: 'gemini-flash-latest'",
			'maxIterations: 9',
			"outputPath: 'Reports/{slug}-{date}.md'",
			"commandId: 'editor:save-file'",
			'enabled: false',
			'desktopOnly: false',
			'focusFile: true',
		]);
	});

	it('emits nothing but trigger and action for an all-defaults hook', () => {
		const minimal = normalizeHookFields({ trigger: 'file-modified', action: 'agent-task' });

		expect(serializeHookFields(minimal)).toEqual(["trigger: 'file-modified'", "action: 'agent-task'"]);
	});
});

describe('parseHookFields', () => {
	it('returns null when trigger is missing or unrecognised', () => {
		expect(parseHookFields({ action: 'summarize' })).toBeNull();
		expect(parseHookFields({ trigger: 'file-exploded', action: 'summarize' })).toBeNull();
	});

	it('returns null when action is missing or unrecognised', () => {
		expect(parseHookFields({ trigger: 'file-created' })).toBeNull();
		expect(parseHookFields({ trigger: 'file-created', action: 'transmogrify' })).toBeNull();
	});

	it('migrates the legacy enabledTools array into a tool policy', () => {
		const fields = parseHookFields({
			trigger: 'file-created',
			action: 'agent-task',
			enabledTools: ['read_only'],
		});

		expect(fields?.toolPolicy).toEqual({ preset: PolicyPreset.READ_ONLY });
	});

	it('falls back to defaults for malformed scalar values', () => {
		const fields = parseHookFields({
			trigger: 'file-created',
			action: 'agent-task',
			debounceMs: 'soon',
			cooldownMs: null,
			enabled: 'yes',
			maxIterations: 0,
			enabledSkills: 'summarize',
		});

		expect(fields).toMatchObject({
			debounceMs: DEFAULT_DEBOUNCE_MS,
			cooldownMs: DEFAULT_COOLDOWN_MS,
			enabled: true,
			maxIterations: undefined,
			enabledSkills: [],
		});
	});

	it('folds the empty sentinels to undefined so "unset" has one representation', () => {
		const fields = parseHookFields({
			trigger: 'file-created',
			action: 'agent-task',
			pathGlob: '',
			model: '',
			outputPath: '',
			commandId: '',
			maxRunsPerHour: 0,
			frontmatterFilter: {},
			focusFile: false,
		});

		expect(fields).toMatchObject({
			pathGlob: undefined,
			model: undefined,
			outputPath: undefined,
			commandId: undefined,
			maxRunsPerHour: undefined,
			frontmatterFilter: undefined,
			focusFile: undefined,
		});
	});
});

describe('mergeHookFields', () => {
	const current = fullyPopulatedFields();

	// Before #1315 only `toolPolicy` and `maxIterations` used `in`-based merge;
	// the rest used `??`, so emptying them in the edit form silently restored
	// the previous value. All sixteen now behave the same way.
	const clearable: (keyof HookFields)[] = [
		'pathGlob',
		'frontmatterFilter',
		'maxRunsPerHour',
		'toolPolicy',
		'model',
		'maxIterations',
		'outputPath',
		'commandId',
		'focusFile',
	];

	it.each(clearable)('clears %s when the edit form sends it as undefined', (key) => {
		expect(current[key]).toBeDefined();

		const merged = mergeHookFields(current, { [key]: undefined });

		expect(merged[key]).toBeUndefined();
	});

	it('refuses to clear trigger and action, which have no default', () => {
		// `HookUpdateParams` is a Partial, so nothing stops a caller passing
		// `trigger: undefined`. Honouring that would serialize a definition file
		// with no `trigger:` line, which parseHookFields rejects on the next
		// load — the hook would silently disappear.
		const merged = mergeHookFields(current, { trigger: undefined, action: undefined });

		expect(merged.trigger).toBe(current.trigger);
		expect(merged.action).toBe(current.action);
		expect(parseHookFields(parseFrontmatter(serializeHookFields(merged)))).not.toBeNull();
	});

	it('still replaces trigger and action when given a real value', () => {
		const merged = mergeHookFields(current, { trigger: 'file-created', action: 'summarize' });

		expect(merged.trigger).toBe('file-created');
		expect(merged.action).toBe('summarize');
	});

	it('leaves a field untouched when its key is absent from the params', () => {
		const merged = mergeHookFields(current, { model: 'gemini-pro-latest' });

		expect(merged.model).toBe('gemini-pro-latest');
		expect(merged.pathGlob).toBe(current.pathGlob);
		expect(merged.commandId).toBe(current.commandId);
		expect(merged.focusFile).toBe(true);
	});

	it('restores the default rather than clearing for the fields that have one', () => {
		const merged = mergeHookFields(current, {
			debounceMs: undefined,
			cooldownMs: undefined,
			enabled: undefined,
			desktopOnly: undefined,
			enabledSkills: undefined,
		});

		expect(merged.debounceMs).toBe(DEFAULT_DEBOUNCE_MS);
		expect(merged.cooldownMs).toBe(DEFAULT_COOLDOWN_MS);
		expect(merged.enabled).toBe(true);
		expect(merged.desktopOnly).toBe(true);
		expect(merged.enabledSkills).toEqual([]);
	});

	it('normalizes merged values, so a cleared field survives the next serialize', () => {
		const merged = mergeHookFields(current, { pathGlob: '', maxRunsPerHour: 0, maxIterations: -1 });

		expect(merged.pathGlob).toBeUndefined();
		expect(merged.maxRunsPerHour).toBeUndefined();
		expect(merged.maxIterations).toBeUndefined();
		expect(serializeHookFields(merged)).not.toContain("pathGlob: ''");
	});
});
