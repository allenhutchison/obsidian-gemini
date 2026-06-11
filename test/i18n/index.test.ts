import { getLanguage } from 'obsidian';
import { t, getResolvedLocale, locales, type TranslationKey } from '../../src/i18n';
import { en } from '../../src/i18n/en';

const TITLE_KEY: TranslationKey = 'agent.empty.title';

describe('i18n', () => {
	let originalLocales: Record<string, Partial<Record<TranslationKey, string>>>;

	beforeEach(() => {
		vi.mocked(getLanguage).mockReturnValue('en');
		originalLocales = { ...locales };
	});

	afterEach(() => {
		for (const key of Object.keys(locales)) {
			delete locales[key];
		}
		Object.assign(locales, originalLocales);
	});

	function injectLocale(code: string, table: Partial<Record<TranslationKey, string>>) {
		locales[code] = table;
	}

	describe('getResolvedLocale', () => {
		it('resolves to en by default', () => {
			expect(getResolvedLocale()).toBe('en');
		});

		it('resolves an exact locale match', () => {
			injectLocale('de', { [TITLE_KEY]: 'Testwert' });
			vi.mocked(getLanguage).mockReturnValue('de');
			expect(getResolvedLocale()).toBe('de');
		});

		it('falls back to the base language for regional variants', () => {
			injectLocale('fr', { [TITLE_KEY]: 'Valeur de test' });
			vi.mocked(getLanguage).mockReturnValue('fr-CA');
			expect(getResolvedLocale()).toBe('fr');
		});

		it('prefers an exact regional match over the base language', () => {
			injectLocale('pt', { [TITLE_KEY]: 'pt value' });
			injectLocale('pt-BR', { [TITLE_KEY]: 'pt-BR value' });
			vi.mocked(getLanguage).mockReturnValue('pt-BR');
			expect(getResolvedLocale()).toBe('pt-BR');
		});

		it('falls back to en for unknown locales', () => {
			vi.mocked(getLanguage).mockReturnValue('tlh');
			expect(getResolvedLocale()).toBe('en');
		});

		it('falls back to en when getLanguage returns an empty value', () => {
			vi.mocked(getLanguage).mockReturnValue('');
			expect(getResolvedLocale()).toBe('en');
		});
	});

	describe('t', () => {
		it('returns the English message by default', () => {
			expect(t(TITLE_KEY)).toBe(en[TITLE_KEY].message);
		});

		it('returns the translation for the resolved locale', () => {
			injectLocale('de', { [TITLE_KEY]: 'Testwert' });
			vi.mocked(getLanguage).mockReturnValue('de');
			expect(t(TITLE_KEY)).toBe('Testwert');
		});

		it('falls back to English for a key missing from the locale table', () => {
			injectLocale('de', { [TITLE_KEY]: 'Testwert' });
			vi.mocked(getLanguage).mockReturnValue('de');
			expect(t('agent.empty.description')).toBe(en['agent.empty.description'].message);
		});

		it('falls back to English for an empty-string translation', () => {
			injectLocale('de', { [TITLE_KEY]: '   ' });
			vi.mocked(getLanguage).mockReturnValue('de');
			expect(t(TITLE_KEY)).toBe(en[TITLE_KEY].message);
		});

		it('interpolates {name}-style placeholders', () => {
			injectLocale('de', { [TITLE_KEY]: 'Hallo {name}, du hast {count} Notizen' });
			vi.mocked(getLanguage).mockReturnValue('de');
			expect(t(TITLE_KEY, { name: 'Allen', count: 3 })).toBe('Hallo Allen, du hast 3 Notizen');
		});

		it('leaves unknown placeholders intact', () => {
			injectLocale('de', { [TITLE_KEY]: 'Hallo {name}' });
			vi.mocked(getLanguage).mockReturnValue('de');
			expect(t(TITLE_KEY, { other: 'x' })).toBe('Hallo {name}');
		});

		it('returns the message unchanged when vars are passed but no placeholders exist', () => {
			expect(t(TITLE_KEY, { name: 'Allen' })).toBe(en[TITLE_KEY].message);
		});
	});
});
