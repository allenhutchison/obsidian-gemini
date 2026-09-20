/**
 * Pins the provider enumeration in the architecture docs to the code.
 *
 * The API-layer section of `.claude/guidelines/invariants.md` (and the
 * paragraph `AGENTS.md` mirrors from it) hand-enumerates the provider set in
 * the pipeline diagram — the one literal enumeration left in each file. That
 * paragraph has gone stale three times in 90 days (#1302, #1513, #1566): a
 * provider lands, the docs don't follow, and nothing notices until the next
 * audit. This guard makes adding a fifth provider turn the docs red in the
 * same PR, locally, before anyone pushes (#1567).
 *
 * Two enumerations are watched, the two the issue names: the
 * `…Client | …Client` pipeline line and the `src/api/providers/{…}/`
 * implementation-directory token (that list was stale in invariants.md until
 * the guard landed). Prose about behaviour (the no-silent-substitution rule,
 * the routing model) stays human-reviewed.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PROVIDER_IDS } from '../../src/api/providers/registry';

const REPO_ROOT = join(__dirname, '..', '..');

/** The files whose pipeline diagram must name every provider. */
const DOCS = ['.claude/guidelines/invariants.md', 'AGENTS.md'] as const;

/** The code-fence line the diagram lives on — the parser's anchor. */
const ANCHOR = 'ModelClientFactory.createFromPlugin()';

/**
 * Extracts the provider class names from a pipeline line:
 * `… → GeminiClient | OllamaClient | … → RetryDecorator → ModelApi`.
 * Returns them lowercased with the `Client` suffix stripped, so they compare
 * against `ModelProvider` ids.
 */
function parsePipelineProviders(line: string): string[] {
	// The provider list sits between the factory anchor and the next arrow:
	// `src/main.ts → ModelClientFactory.createFromPlugin() → A | B → RetryDecorator…`.
	const afterAnchor = line.slice(line.indexOf(ANCHOR) + ANCHOR.length);
	const segment = afterAnchor.split('→')[1] ?? '';
	return (
		(segment.match(/[A-Za-z]+Client/g) ?? [])
			.map((name) => name.replace(/Client$/, '').toLowerCase())
			// `ModelClientFactory` itself contains the token `ModelClient` — the
			// anchor's own class-shaped word, never a provider id.
			.filter((id) => id !== 'model')
	);
}

describe.each(DOCS)('provider docs sync: %s', (doc) => {
	const lines = readFileSync(join(REPO_ROOT, doc), 'utf-8').split('\n');
	const anchorLines = lines.filter((line) => line.includes(ANCHOR));

	it('still contains the pipeline diagram (anchor line present)', () => {
		// A rewrite that removes the diagram must fail here rather than make
		// the sync assertion below vacuously pass.
		expect(anchorLines.length).toBeGreaterThan(0);
	});

	it('pipeline diagram names exactly the ModelProvider union', () => {
		const diagramLine = anchorLines.find((line) => /[A-Za-z]+Client(\s*\|\s*[A-Za-z]+Client)+/.test(line));
		expect(
			diagramLine,
			`no pipeline diagram found: no line matching '${ANCHOR}' lists multiple *Client classes`
		).toBeDefined();

		const found: string[] = parsePipelineProviders(diagramLine!);
		const expected: string[] = [...PROVIDER_IDS];
		const missing = expected.filter((id) => !found.includes(id));
		const extra = found.filter((id) => !expected.includes(id));
		const duplicated = found.filter((id, i) => found.indexOf(id) !== i);

		if (missing.length > 0 || extra.length > 0 || duplicated.length > 0) {
			const parts = [
				`pipeline diagram in ${doc} is stale`,
				missing.length > 0 && `missing from docs: ${missing.join(', ')}`,
				extra.length > 0 && `not a ModelProvider: ${extra.join(', ')}`,
				duplicated.length > 0 && `duplicated in diagram: ${[...new Set(duplicated)].join(', ')}`,
				`diagram line: ${diagramLine?.trim()}`,
			].filter(Boolean);
			throw new Error(parts.join('; '));
		}
		expect(new Set(found)).toEqual(new Set(expected));
	});

	it('provider implementation-directory list names exactly the ModelProvider union', () => {
		// `src/api/providers/{gemini,…}/` — the other hand-kept enumeration
		// (the one that was stale in invariants.md before this guard existed).
		// Anchored on the package path so an unrelated `{a,b}` token can't be
		// picked up; the token must exist, or the check is vacuous.
		const listLine = lines.find((line) => /providers\/\{[a-z,]+\}\//.test(line));
		expect(listLine, `no 'src/api/providers/{…}/' token found in ${doc}`).toBeDefined();

		const brace = /\{([a-z,]+)\}/.exec(listLine!.match(/providers\/\{[a-z,]+\}\//)![0])![1];
		const found: string[] = brace.split(',').filter(Boolean);
		const expected: string[] = [...PROVIDER_IDS];
		const missing = expected.filter((id) => !found.includes(id));
		const extra = found.filter((id) => !expected.includes(id));
		const duplicated = found.filter((id, i) => found.indexOf(id) !== i);

		if (missing.length > 0 || extra.length > 0 || duplicated.length > 0) {
			const parts = [
				`provider directory list in ${doc} is stale`,
				missing.length > 0 && `missing from docs: ${missing.join(', ')}`,
				extra.length > 0 && `not a ModelProvider: ${extra.join(', ')}`,
				duplicated.length > 0 && `duplicated in list: ${[...new Set(duplicated)].join(', ')}`,
				`list line: ${listLine?.trim()}`,
			].filter(Boolean);
			throw new Error(parts.join('; '));
		}
		expect(new Set(found)).toEqual(new Set(expected));
	});
});
