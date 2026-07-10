import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

/**
 * Regression guard for #1154.
 *
 * `@allenhutchison/gemini-utils` groups Node-built-in-touching modules
 * (`FileUploader`, transcription, etc.) behind its barrel entry. A *value*
 * import from the bare barrel pulls those `fs`/`path`/`crypto`/`url` requires
 * into the plugin's load path, which Obsidian warns about on every load because
 * the plugin declares mobile support (`isDesktopOnly: false`).
 *
 * Rule: any static import from the *bare* barrel specifier must be `import type`
 * (erased at build). Runtime values must come from a built-in-free subpath
 * (`/mime`, `/support-registry`, `/research`) or be lazy-loaded via
 * `await import(...)`.
 */

const BARE_BARREL = '@allenhutchison/gemini-utils';

function collectTsFiles(dir: string, acc: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) {
			collectTsFiles(full, acc);
		} else if (entry.endsWith('.ts')) {
			acc.push(full);
		}
	}
	return acc;
}

describe('gemini-utils barrel is never a load-time value import (#1154)', () => {
	// Matches a static import whose specifier is EXACTLY the bare barrel
	// (a trailing `/subpath` or `/mime'` is fine and won't match). Group 1 is
	// the import clause (`type { … }`, `{ … }`, `Foo`, …).
	const bareBarrelImport = /import\s+([^;]*?)\s+from\s+['"]@allenhutchison\/gemini-utils['"]/g;

	const files = collectTsFiles(join(process.cwd(), 'src'));

	it('scans a non-trivial number of source files', () => {
		expect(files.length).toBeGreaterThan(50);
	});

	it('every bare-barrel import is type-only', () => {
		const offenders: string[] = [];
		for (const file of files) {
			const src = readFileSync(file, 'utf8');
			for (const match of src.matchAll(bareBarrelImport)) {
				const clause = match[1] ?? '';
				// `import type { … }` and `import type Foo` are erased — allowed.
				if (!clause.startsWith('type ')) {
					offenders.push(`${file.replace(process.cwd() + '/', '')}: import ${clause} from '${BARE_BARREL}'`);
				}
			}
		}
		expect(
			offenders,
			`Value imports from the bare barrel force Node built-ins into the load path (#1154). Use a subpath (/mime, /support-registry, /research) or a lazy await import().\n${offenders.join('\n')}`
		).toEqual([]);
	});
});
