import { readdirSync } from 'fs';
import { join } from 'path';
import { locales } from '../../src/i18n';
import { en } from '../../src/i18n/en';

const I18N_DIR = join(__dirname, '..', '..', 'src', 'i18n');
const NON_LOCALE_FILES = new Set(['en.ts', 'index.ts', 'translation-state.json']);

describe('i18n locales', () => {
	const localeFiles = readdirSync(I18N_DIR)
		.filter((f) => !NON_LOCALE_FILES.has(f) && f.endsWith('.ts'))
		.map((f) => f.replace(/\.ts$/, ''))
		.sort();

	it('registers every language file in the locales registry, and vice versa', () => {
		// Registry keys are Obsidian locale codes ('pt-BR'); files are kebab-case ('pt-br.ts').
		const registeredCodes = Object.keys(locales)
			.map((code) => code.toLowerCase())
			.sort();
		expect(registeredCodes).toEqual(localeFiles);
	});

	it('only contains keys that exist in en.ts, with non-empty translations', () => {
		const enKeys = new Set(Object.keys(en));
		for (const [code, table] of Object.entries(locales)) {
			for (const [key, value] of Object.entries(table)) {
				expect(enKeys.has(key), `${code}: unknown key ${key}`).toBe(true);
				expect(typeof value, `${code}.${key}: not a string`).toBe('string');
				expect((value as string).trim(), `${code}.${key}: empty translation`).not.toBe('');
			}
		}
	});
});
