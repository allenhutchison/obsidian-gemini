import { ObsidianGeminiSettings } from '../src/main';

describe('ObsidianGeminiSettings', () => {
	describe('temperature and topP settings', () => {
		it('should have default temperature of 0.7', () => {
			const defaultSettings: Partial<ObsidianGeminiSettings> = {
				temperature: 0.7,
			};
			expect(defaultSettings.temperature).toBe(0.7);
		});

		it('should have default topP of 1', () => {
			const defaultSettings: Partial<ObsidianGeminiSettings> = {
				topP: 1,
			};
			expect(defaultSettings.topP).toBe(1);
		});

		it('should accept temperature values between 0 and 1', () => {
			const settings: Partial<ObsidianGeminiSettings> = {
				temperature: 0,
			};
			expect(settings.temperature).toBe(0);

			settings.temperature = 1;
			expect(settings.temperature).toBe(1);

			settings.temperature = 0.5;
			expect(settings.temperature).toBe(0.5);
		});

		it('should accept topP values between 0 and 1', () => {
			const settings: Partial<ObsidianGeminiSettings> = {
				topP: 0,
			};
			expect(settings.topP).toBe(0);

			settings.topP = 1;
			expect(settings.topP).toBe(1);

			settings.topP = 0.8;
			expect(settings.topP).toBe(0.8);
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