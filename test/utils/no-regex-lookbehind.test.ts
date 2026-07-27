import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

/**
 * Regression guard for #1242.
 *
 * `.claude/guidelines/coding.md` (Platform guards): regex lookbehind
 * (`(?<=…)` / `(?<!…)`) is only supported on iOS 16.4+. The plugin declares
 * mobile support (`manifest.json` sets `isDesktopOnly: false`), so a lookbehind
 * in a bundled regex *literal* is a parse-time `SyntaxError` when the module is
 * evaluated on older iOS — which aborts the whole `main.js` bundle and crashes
 * plugin **load**, not just the affected feature.
 *
 * Rule: no source file under `src/` may contain a `(?<=` or `(?<!` regex
 * assertion. Lookaheads (`(?=…)` / `(?!…)`) are fine — Safari has supported them
 * for years; only lookbehind is the 16.4 gate.
 */

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

describe('no regex lookbehind in mobile-loaded source (#1242)', () => {
	// Matches either lookbehind assertion opener: `(?<=` or `(?<!`.
	const lookbehind = /\(\?<[=!]/g;

	const files = collectTsFiles(join(process.cwd(), 'src'));

	it('scans a non-trivial number of source files', () => {
		expect(files.length).toBeGreaterThan(50);
	});

	it('no source file uses a regex lookbehind assertion', () => {
		const offenders: string[] = [];
		for (const file of files) {
			const src = readFileSync(file, 'utf8');
			const lines = src.split('\n');
			lines.forEach((line, i) => {
				if (lookbehind.test(line)) {
					offenders.push(`${file.replace(process.cwd() + '/', '')}:${i + 1}: ${line.trim()}`);
				}
				lookbehind.lastIndex = 0;
			});
		}
		expect(
			offenders,
			`Regex lookbehind is iOS 16.4+ only and crashes plugin load on older iOS (#1242). Rewrite these to a lookbehind-free form (e.g. a consuming (^|[^x]) / (?:^|\\D) prefix group):\n${offenders.join('\n')}`
		).toEqual([]);
	});
});
