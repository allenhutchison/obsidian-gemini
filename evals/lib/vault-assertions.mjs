/**
 * Post-run vault-state assertions for eval tasks.
 *
 * The output matchers in `matchers.mjs` score the model's final *text*.
 * These assertions score the *side effects* — what the agent actually did to
 * the vault. This is the state-based verification that separates a real
 * write / edit / delete eval from one that only checks "did it say the right
 * words and call write_file" (the τ-bench lesson — arXiv 2406.12045: compare
 * end state against the goal state, not tool-call syntax).
 *
 * The runner snapshots every referenced path into `vaultState` after the turn
 * ends and passes it here. This module is pure so the unit tests can drive it
 * without a live Obsidian.
 *
 * Grammar (every entry of `task.vaultAssertions`):
 *
 *   { type: 'fileExists',        path }
 *   { type: 'fileAbsent',        path }
 *   { type: 'fileContains',      path, value }            — any-of substring
 *   { type: 'fileLacks',         path, value }            — none-of substring
 *   { type: 'fileMatches',       path, value, flags }     — any-of regex
 *   { type: 'frontmatterEquals', path, key, value }       — deep-equal property
 *   { type: 'fileUnchanged',     path, fixture }          — bytes equal fixture
 *
 * All assertions are AND'ed (every one must hold); within `fileContains` /
 * `fileMatches` an array `value` is any-of (OR), mirroring `matchers.mjs`.
 */

/** Normalize a scalar-or-array value into an array for uniform checks. */
function asArray(value) {
	return Array.isArray(value) ? value : [value];
}

/** Structural deep-equality for frontmatter values (scalars, arrays, objects). */
function deepEqual(a, b) {
	if (a === b) return true;
	if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
	if (Array.isArray(a) !== Array.isArray(b)) return false;
	const ka = Object.keys(a);
	const kb = Object.keys(b);
	if (ka.length !== kb.length) return false;
	return ka.every((k) => deepEqual(a[k], b[k]));
}

/**
 * Evaluate one assertion against the vault snapshot.
 *
 * @param {object} a - Assertion object from task JSON.
 * @param {object} vaultState - `{ [path]: { exists, content, frontmatter } }`.
 * @param {Record<string,string>} fixtureMap - `{ [fixtureFileName]: content }`.
 * @returns {{ ok: boolean, reason: string }}
 */
function evaluateOne(a, vaultState, fixtureMap) {
	const state = vaultState?.[a.path] ?? { exists: false, content: null, frontmatter: null };

	switch (a.type) {
		case 'fileExists':
			return state.exists ? { ok: true, reason: 'exists' } : { ok: false, reason: 'file missing' };

		case 'fileAbsent':
			return !state.exists ? { ok: true, reason: 'absent' } : { ok: false, reason: 'file still present' };

		case 'fileContains': {
			if (!state.exists || typeof state.content !== 'string') return { ok: false, reason: 'file missing' };
			const needles = asArray(a.value).filter((v) => typeof v === 'string');
			if (needles.length === 0) return { ok: false, reason: 'no value to match' };
			const hit = needles.some((n) => state.content.includes(n));
			return hit ? { ok: true, reason: 'substring found' } : { ok: false, reason: 'substring not found' };
		}

		case 'fileLacks': {
			if (!state.exists || typeof state.content !== 'string') return { ok: false, reason: 'file missing' };
			const needles = asArray(a.value).filter((v) => typeof v === 'string');
			if (needles.length === 0) return { ok: false, reason: 'no value to check' };
			const hit = needles.some((n) => state.content.includes(n));
			return hit ? { ok: false, reason: 'forbidden substring present' } : { ok: true, reason: 'clean' };
		}

		case 'fileMatches': {
			if (!state.exists || typeof state.content !== 'string') return { ok: false, reason: 'file missing' };
			const patterns = asArray(a.value).filter((v) => typeof v === 'string');
			if (patterns.length === 0) return { ok: false, reason: 'no pattern to match' };
			const hit = patterns.some((p) => {
				try {
					return new RegExp(p, a.flags ?? '').test(state.content);
				} catch {
					return false;
				}
			});
			return hit ? { ok: true, reason: 'pattern matched' } : { ok: false, reason: 'pattern not matched' };
		}

		case 'frontmatterEquals': {
			// Fail closed on a malformed assertion: without an explicit key and
			// value, `deepEqual(undefined, undefined)` would be true and invent
			// a free solve.
			if (typeof a.key !== 'string' || a.key.length === 0 || !Object.prototype.hasOwnProperty.call(a, 'value')) {
				return { ok: false, reason: 'malformed frontmatterEquals assertion: missing key or value' };
			}
			if (!state.exists) return { ok: false, reason: 'file missing' };
			const fm = state.frontmatter ?? {};
			const actual = fm[a.key];
			return deepEqual(actual, a.value)
				? { ok: true, reason: 'frontmatter matches' }
				: {
						ok: false,
						reason: `frontmatter "${a.key}" = ${JSON.stringify(actual)}, expected ${JSON.stringify(a.value)}`,
					};
		}

		case 'fileUnchanged': {
			if (!state.exists || typeof state.content !== 'string') return { ok: false, reason: 'file missing' };
			const original = fixtureMap?.[a.fixture];
			if (typeof original !== 'string') return { ok: false, reason: `no fixture "${a.fixture}" to compare` };
			return state.content === original
				? { ok: true, reason: 'unchanged' }
				: { ok: false, reason: 'content was modified' };
		}

		default:
			// Unknown assertion type — fail closed so a typo in a task file
			// cannot invent a free solve.
			return { ok: false, reason: `unknown assertion type "${a.type}"` };
	}
}

/**
 * Evaluate every vault assertion. All must hold for `pass` to be true.
 *
 * @param {Array<object>|undefined} assertions - `task.vaultAssertions`.
 * @param {object} vaultState - Post-run snapshot from `readVaultState`.
 * @param {Record<string,string>} [fixtureMap] - Fixture file contents by name.
 * @returns {{ pass: boolean, details: Array<{type,path,ok,reason}> }}
 */
export function evaluateVaultAssertions(assertions, vaultState, fixtureMap = {}) {
	const list = Array.isArray(assertions) ? assertions : [];
	const details = list.map((a) => {
		const { ok, reason } = evaluateOne(a, vaultState || {}, fixtureMap);
		return { type: a.type, path: a.path, ok, reason };
	});
	return { pass: details.every((d) => d.ok), details };
}

/** Collect the distinct vault paths referenced by a task's assertions. */
export function vaultAssertionPaths(assertions) {
	const list = Array.isArray(assertions) ? assertions : [];
	return [...new Set(list.map((a) => a.path).filter((p) => typeof p === 'string'))];
}
