import { ObsidianGeminiSettings } from './main';

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
});