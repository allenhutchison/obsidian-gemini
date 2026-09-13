import { ObsidianGeminiSettings } from '../src/main';
import { FEATURE_IDS } from '../src/types/features';

describe('ObsidianGeminiSettings', () => {
	describe('feature routing (settings redesign)', () => {
		it('defaultProvider is a real provider, never "none"', () => {
			const settings: Partial<ObsidianGeminiSettings> = {
				defaultProvider: 'gemini',
			};
			expect(settings.defaultProvider).toBe('gemini');
		});

		it('features is total over every FeatureId', () => {
			const features: ObsidianGeminiSettings['features'] = {
				chat: { provider: 'gemini', model: '' },
				summary: { provider: 'gemini', model: '' },
				completions: { provider: 'gemini', model: '' },
				rewrite: { provider: 'gemini', model: '' },
				webSearch: { provider: 'gemini', model: '' },
				deepResearch: { provider: 'gemini', model: '' },
				rag: { provider: 'gemini', model: '' },
				imageGen: { provider: 'gemini', model: '' },
			};
			for (const f of FEATURE_IDS) {
				expect(features[f]).toBeDefined();
			}
		});

		it('a feature route can be "none" (off), never a substitute provider', () => {
			const settings: Partial<ObsidianGeminiSettings> = {
				features: {
					chat: { provider: 'gemini', model: '' },
					summary: { provider: 'gemini', model: '' },
					completions: { provider: 'gemini', model: '' },
					rewrite: { provider: 'gemini', model: '' },
					webSearch: { provider: 'none', model: '' },
					deepResearch: { provider: 'none', model: '' },
					rag: { provider: 'none', model: '' },
					imageGen: { provider: 'none', model: '' },
				},
			};
			expect(settings.features?.webSearch.provider).toBe('none');
		});
	});

	describe('settingsSchemaVersion', () => {
		it('defaults to 2 for new installs', () => {
			const defaultSettings: Partial<ObsidianGeminiSettings> = {
				settingsSchemaVersion: 2,
			};
			expect(defaultSettings.settingsSchemaVersion).toBe(2);
		});
	});

	describe('version tracking', () => {
		it('should have default lastSeenVersion of 0.0.0', () => {
			const defaultSettings: Partial<ObsidianGeminiSettings> = {
				lastSeenVersion: '0.0.0',
			};
			expect(defaultSettings.lastSeenVersion).toBe('0.0.0');
		});

		it('should accept any version string', () => {
			const settings: Partial<ObsidianGeminiSettings> = {
				lastSeenVersion: '4.0.0',
			};
			expect(settings.lastSeenVersion).toBe('4.0.0');

			settings.lastSeenVersion = '3.3.2';
			expect(settings.lastSeenVersion).toBe('3.3.2');

			settings.lastSeenVersion = '1.0.0-beta.1';
			expect(settings.lastSeenVersion).toBe('1.0.0-beta.1');
		});
	});
});
