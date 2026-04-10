/**
 * Regression tests for settings-api temperature/topP slider debounce handlers.
 *
 * Covers issue #601:
 *  - Stale async validation results must not overwrite current slider state
 *    when a newer change has already been made (run-ID race condition).
 *  - Validation / save rejections must surface through plugin.logger.error
 *    and a user-facing Notice, not silent unhandled promise rejections.
 */

// `var` (not `const`) so that jest.mock hoisting can reference these below.
// jest.mock is hoisted to the top of the file, while `const` would hit the
// Temporal Dead Zone when the factory runs during module evaluation.
// eslint-disable-next-line no-var
var mockSliderRegistry: Record<string, any>;
// eslint-disable-next-line no-var
var mockNotice: jest.Mock;

jest.mock('../../src/main');

jest.mock('obsidian', () => {
	mockSliderRegistry = {};
	mockNotice = jest.fn();

	class Setting {
		private _name = '';
		constructor(public containerEl: any) {}
		setName(name: string) {
			this._name = name;
			return this;
		}
		setDesc(_desc: string) {
			return this;
		}
		setHeading() {
			return this;
		}
		addToggle(cb: (c: any) => void) {
			const component: any = {};
			component.setValue = () => component;
			component.onChange = () => component;
			cb(component);
			return this;
		}
		addText(cb: (c: any) => void) {
			const component: any = {};
			component.setPlaceholder = () => component;
			component.setValue = () => component;
			component.onChange = () => component;
			cb(component);
			return this;
		}
		addSlider(cb: (c: any) => void) {
			const component: any = {};
			component.setValue = jest.fn(() => component);
			component.setLimits = () => component;
			component.setDynamicTooltip = () => component;
			component._handler = null;
			component.onChange = (handler: any) => {
				component._handler = handler;
				return component;
			};
			cb(component);
			mockSliderRegistry[this._name] = component;
			return this;
		}
		addButton(cb: (c: any) => void) {
			const component: any = {};
			component.setButtonText = () => component;
			component.setTooltip = () => component;
			component.setDisabled = () => component;
			component.onClick = () => component;
			cb(component);
			return this;
		}
	}

	function debounce(cb: any, _timeout?: number, _resetTimer?: boolean) {
		let pendingArgs: any[] | null = null;
		const debounced: any = (...args: any[]) => {
			pendingArgs = args;
			return debounced;
		};
		debounced.cancel = () => {
			pendingArgs = null;
			return debounced;
		};
		debounced.run = () => {
			if (pendingArgs) {
				const args = pendingArgs;
				pendingArgs = null;
				cb(...args);
			}
			return debounced;
		};
		return debounced;
	}

	return {
		Setting,
		Notice: mockNotice,
		debounce,
	};
});

import { renderApiSettings } from '../../src/ui/settings-api';

interface FakePlugin {
	settings: any;
	saveSettings: jest.Mock;
	logger: {
		error: jest.Mock;
		warn: jest.Mock;
		log: jest.Mock;
		debug: jest.Mock;
	};
	getModelManager: () => any;
}

function buildPlugin(): FakePlugin {
	return {
		settings: {
			temperature: 0.7,
			topP: 1.0,
			fileLogging: false,
			allowSystemPromptOverride: false,
			maxRetries: 3,
			initialBackoffDelay: 1000,
			modelDiscovery: { enabled: false, autoUpdateInterval: 24, fallbackToStatic: true },
		},
		saveSettings: jest.fn().mockResolvedValue(undefined),
		logger: {
			error: jest.fn(),
			warn: jest.fn(),
			log: jest.fn(),
			debug: jest.fn(),
		},
		getModelManager: () => ({}),
	};
}

async function setup(validateImpl?: jest.Mock) {
	const plugin = buildPlugin();
	const modelManager = {
		getParameterRanges: jest.fn().mockResolvedValue({
			temperature: { min: 0, max: 2, step: 0.1 },
			topP: { min: 0, max: 1, step: 0.05 },
		}),
		getParameterDisplayInfo: jest.fn().mockResolvedValue({
			hasModelData: false,
			temperature: '',
			topP: '',
		}),
		validateParameters:
			validateImpl ||
			jest.fn().mockResolvedValue({
				temperature: { isValid: true },
				topP: { isValid: true },
			}),
	};
	plugin.getModelManager = () => modelManager;

	const containerEl = {} as HTMLElement;
	const context = { redisplay: jest.fn(), showDeveloperSettings: false };
	await renderApiSettings(containerEl, plugin as any, context);
	return { plugin, modelManager };
}

/** Run a few rounds of microtask flushes so awaited chains settle. */
async function flushMicrotasks() {
	for (let i = 0; i < 5; i++) {
		await Promise.resolve();
	}
}

describe('settings-api slider debounce (issue #601)', () => {
	beforeEach(() => {
		for (const key of Object.keys(mockSliderRegistry)) {
			delete mockSliderRegistry[key];
		}
		mockNotice.mockClear();
		jest.clearAllMocks();
		jest.useFakeTimers();
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	describe('temperature slider', () => {
		it('discards stale validation results when the slider changes mid-validation', async () => {
			let resolveFirst!: (v: any) => void;
			const firstPending = new Promise((res) => {
				resolveFirst = res;
			});

			const validateParameters = jest
				.fn()
				.mockImplementationOnce(() => firstPending)
				.mockImplementationOnce(() =>
					Promise.resolve({
						temperature: { isValid: true },
						topP: { isValid: true },
					})
				);

			const { plugin } = await setup(validateParameters);
			const slider = mockSliderRegistry['Temperature'];
			expect(slider).toBeDefined();

			// User moves the slider to 0.5; advance past the debounce so the
			// async body starts and awaits validation.
			slider._handler(0.5);
			await jest.advanceTimersByTimeAsync(300);
			expect(validateParameters).toHaveBeenCalledTimes(1);

			// User moves the slider again to 0.9 while validation is still pending.
			slider._handler(0.9);
			expect(plugin.settings.temperature).toBe(0.9);

			// The first (now-stale) validation resolves with an "adjusted" value.
			// Without the run-ID guard this would overwrite the current 0.9 slider.
			resolveFirst({
				temperature: { isValid: false, adjustedValue: 0.1, warning: 'out of range' },
				topP: { isValid: true },
			});
			await flushMicrotasks();

			expect(slider.setValue).not.toHaveBeenCalledWith(0.1);
			expect(plugin.settings.temperature).toBe(0.9);
			// The stale Notice warning must not leak through either.
			expect(mockNotice).not.toHaveBeenCalledWith('out of range');

			// The second debounce fires and validates the current value.
			await jest.advanceTimersByTimeAsync(300);
			await flushMicrotasks();
			expect(validateParameters).toHaveBeenCalledTimes(2);
			expect(validateParameters).toHaveBeenLastCalledWith(0.9, 1.0);
			expect(plugin.saveSettings).toHaveBeenCalled();
			expect(plugin.settings.temperature).toBe(0.9);
			expect(slider.setValue).not.toHaveBeenCalledWith(0.1);
		});

		it('logs and surfaces a Notice when validation rejects', async () => {
			const err = new Error('validate failed');
			const validateParameters = jest.fn().mockRejectedValue(err);
			const { plugin } = await setup(validateParameters);

			const slider = mockSliderRegistry['Temperature'];
			slider._handler(0.5);
			await jest.advanceTimersByTimeAsync(300);
			await flushMicrotasks();

			expect(plugin.logger.error).toHaveBeenCalledWith('Failed to validate/save temperature setting:', err);
			expect(mockNotice).toHaveBeenCalledWith(expect.stringContaining('Failed to save temperature setting'));
		});

		it('suppresses errors from stale validation runs that reject after a newer change', async () => {
			let rejectFirst!: (e: any) => void;
			const firstPending = new Promise((_res, rej) => {
				rejectFirst = rej;
			});

			const validateParameters = jest
				.fn()
				.mockImplementationOnce(() => firstPending)
				.mockImplementationOnce(() =>
					Promise.resolve({
						temperature: { isValid: true },
						topP: { isValid: true },
					})
				);

			const { plugin } = await setup(validateParameters);
			const slider = mockSliderRegistry['Temperature'];

			// First change: fire timer so the async body starts and awaits validation.
			slider._handler(0.5);
			await jest.advanceTimersByTimeAsync(300);
			expect(validateParameters).toHaveBeenCalledTimes(1);

			// Second change supersedes the in-flight run.
			slider._handler(0.9);

			// The stale run's validation now rejects.
			rejectFirst(new Error('stale validation error'));
			await flushMicrotasks();

			// Stale rejection must NOT surface to the user: no logger.error, no Notice.
			expect(plugin.logger.error).not.toHaveBeenCalled();
			expect(mockNotice).not.toHaveBeenCalledWith(expect.stringContaining('Failed to save temperature setting'));

			// The current run still completes cleanly.
			await jest.advanceTimersByTimeAsync(300);
			await flushMicrotasks();
			expect(plugin.settings.temperature).toBe(0.9);
			expect(plugin.saveSettings).toHaveBeenCalled();
		});

		it('saves settings after a clean validation without re-adjusting the slider', async () => {
			const { plugin } = await setup();
			const slider = mockSliderRegistry['Temperature'];
			// Ignore the initial setValue(plugin.settings.temperature) from setup.
			slider.setValue.mockClear();

			slider._handler(0.6);
			await jest.advanceTimersByTimeAsync(300);
			await flushMicrotasks();

			expect(plugin.settings.temperature).toBe(0.6);
			expect(plugin.saveSettings).toHaveBeenCalled();
			// A clean validation result must not call setValue (no re-adjustment).
			expect(slider.setValue).not.toHaveBeenCalled();
		});
	});

	describe('topP slider', () => {
		it('discards stale validation results when the slider changes mid-validation', async () => {
			let resolveFirst!: (v: any) => void;
			const firstPending = new Promise((res) => {
				resolveFirst = res;
			});

			const validateParameters = jest
				.fn()
				.mockImplementationOnce(() => firstPending)
				.mockImplementationOnce(() =>
					Promise.resolve({
						temperature: { isValid: true },
						topP: { isValid: true },
					})
				);

			const { plugin } = await setup(validateParameters);
			const slider = mockSliderRegistry['Top P'];
			expect(slider).toBeDefined();

			slider._handler(0.5);
			await jest.advanceTimersByTimeAsync(300);
			expect(validateParameters).toHaveBeenCalledTimes(1);

			slider._handler(0.9);
			expect(plugin.settings.topP).toBe(0.9);

			resolveFirst({
				temperature: { isValid: true },
				topP: { isValid: false, adjustedValue: 0.1, warning: 'stale' },
			});
			await flushMicrotasks();

			expect(slider.setValue).not.toHaveBeenCalledWith(0.1);
			expect(plugin.settings.topP).toBe(0.9);
			expect(mockNotice).not.toHaveBeenCalledWith('stale');

			await jest.advanceTimersByTimeAsync(300);
			await flushMicrotasks();

			expect(validateParameters).toHaveBeenCalledTimes(2);
			expect(validateParameters).toHaveBeenLastCalledWith(0.7, 0.9);
			expect(plugin.saveSettings).toHaveBeenCalled();
			expect(plugin.settings.topP).toBe(0.9);
		});

		it('logs and surfaces a Notice when validation rejects', async () => {
			const err = new Error('validate failed');
			const validateParameters = jest.fn().mockRejectedValue(err);
			const { plugin } = await setup(validateParameters);

			const slider = mockSliderRegistry['Top P'];
			slider._handler(0.5);
			await jest.advanceTimersByTimeAsync(300);
			await flushMicrotasks();

			expect(plugin.logger.error).toHaveBeenCalledWith('Failed to validate/save topP setting:', err);
			expect(mockNotice).toHaveBeenCalledWith(expect.stringContaining('Failed to save Top P setting'));
		});

		it('suppresses errors from stale validation runs that reject after a newer change', async () => {
			let rejectFirst!: (e: any) => void;
			const firstPending = new Promise((_res, rej) => {
				rejectFirst = rej;
			});

			const validateParameters = jest
				.fn()
				.mockImplementationOnce(() => firstPending)
				.mockImplementationOnce(() =>
					Promise.resolve({
						temperature: { isValid: true },
						topP: { isValid: true },
					})
				);

			const { plugin } = await setup(validateParameters);
			const slider = mockSliderRegistry['Top P'];

			slider._handler(0.5);
			await jest.advanceTimersByTimeAsync(300);
			expect(validateParameters).toHaveBeenCalledTimes(1);

			slider._handler(0.9);

			rejectFirst(new Error('stale validation error'));
			await flushMicrotasks();

			expect(plugin.logger.error).not.toHaveBeenCalled();
			expect(mockNotice).not.toHaveBeenCalledWith(expect.stringContaining('Failed to save Top P setting'));

			await jest.advanceTimersByTimeAsync(300);
			await flushMicrotasks();
			expect(plugin.settings.topP).toBe(0.9);
			expect(plugin.saveSettings).toHaveBeenCalled();
		});
	});
});
