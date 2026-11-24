import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Notice } from 'obsidian';
import type { ScheduledTask } from '../../src/services/scheduled-task-manager';

// Decision-surface coverage for the scheduler management modal (#1596): how
// the schedule controls become a stored schedule string, how a stored one maps
// back onto the controls for editing, and the payload Save sends. Row order
// and the shared advanced fields are covered in management-modal-subclasses.

vi.mock('obsidian', async () => {
	const original = await vi.importActual<any>('../../__mocks__/obsidian.js');
	const { installObsidianDom } = await import('./obsidian-dom');
	installObsidianDom();
	class Modal extends original.Modal {
		constructor(app: any) {
			super(app);
			this.contentEl = document.createElement('div');
			this.modalEl = document.createElement('div');
		}
	}
	return { ...original, Modal };
});

// vi.mock is hoisted, so this import already sees the shimmed Modal.
import { SchedulerManagementModal } from '../../src/ui/scheduler-management-modal';

const NoticeMock = Notice as unknown as ReturnType<typeof vi.fn>;

function makeModal() {
	const scheduledTaskManager = {
		createTask: vi.fn().mockResolvedValue(undefined),
		updateTask: vi.fn().mockResolvedValue(undefined),
	};
	const plugin = {
		agentEventBus: null,
		logger: { error: vi.fn(), log: vi.fn() },
		settings: { historyFolder: 'gemini-scribe', features: { chat: { provider: 'gemini', model: 'm' } } },
		app: { vault: { configDir: '.obsidian' } },
		scheduledTaskManager,
	} as any;
	const modal = new SchedulerManagementModal({} as any, plugin) as any;
	// Save re-renders the list afterwards; that rendering isn't under test here.
	vi.spyOn(modal, 'render').mockImplementation(() => {});
	return { modal, scheduledTaskManager };
}

function withForm(modal: any, overrides: Record<string, unknown>) {
	modal.form = { ...modal.blankForm(), slug: 'digest', prompt: 'Summarise.', ...overrides };
}

beforeEach(() => {
	NoticeMock.mockClear();
});

describe('SchedulerManagementModal schedule from the form', () => {
	it.each([
		[{ schedulePreset: 'once' }, 'once'],
		[{ schedulePreset: 'daily' }, 'daily'],
		[{ schedulePreset: 'weekly' }, 'weekly'],
		[{ schedulePreset: 'daily-at', scheduleTime: '7:05' }, 'daily@7:05'],
		[{ schedulePreset: 'custom', scheduleCustom: ' 30m ' }, 'interval:30m'],
		[{ schedulePreset: 'custom', scheduleCustom: 'interval:2h' }, 'interval:2h'],
	])('%o → %s', (form, expected) => {
		const { modal } = makeModal();
		withForm(modal, form);
		expect(modal.resolvedSchedule()).toBe(expected);
	});

	it('stores weekdays in calendar order, whatever order they were picked in', () => {
		const { modal } = makeModal();
		withForm(modal, { schedulePreset: 'weekly-days', scheduleTime: '18:30', scheduleDays: ['fri', 'mon', 'wed'] });
		expect(modal.resolvedSchedule()).toBe('weekly@18:30:mon,wed,fri');
	});

	it.each([
		[{ schedulePreset: 'daily-at', scheduleTime: '24:00' }],
		[{ schedulePreset: 'daily-at', scheduleTime: '9:60' }],
		[{ schedulePreset: 'daily-at', scheduleTime: 'noon' }],
		[{ schedulePreset: 'weekly-days', scheduleTime: '09:00', scheduleDays: [] }],
		[{ schedulePreset: 'custom', scheduleCustom: '' }],
		[{ schedulePreset: 'custom', scheduleCustom: '5s' }],
		[{ schedulePreset: 'custom', scheduleCustom: 'every day' }],
	])('rejects %o', (form) => {
		const { modal } = makeModal();
		withForm(modal, form);
		expect(modal.resolvedSchedule()).toBeNull();
	});
});

describe('SchedulerManagementModal schedule back onto the form', () => {
	it.each([
		['once', 'once'],
		['daily@08:15', 'daily-at'],
		['weekly@08:15:mon,thu', 'weekly-days'],
		['interval:15m', 'custom'],
	])('detects %s as the %s preset', (schedule, preset) => {
		const { modal } = makeModal();
		expect(modal.detectPreset(schedule)).toBe(preset);
	});

	it('reads the time and the valid days out of a weekly schedule', () => {
		const { modal } = makeModal();
		expect(modal.parseTimeAndDaysFromSchedule('weekly@08:15:MON,xyz,thu')).toEqual({
			time: '08:15',
			days: ['mon', 'thu'],
		});
	});

	it('round-trips a stored task through edit and save unchanged', async () => {
		const { modal, scheduledTaskManager } = makeModal();
		const task = {
			slug: 'digest',
			schedule: 'weekly@08:15:mon,thu',
			prompt: 'Summarise.',
			enabled: true,
			runIfMissed: true,
			outputPath: 'gemini-scribe/Scheduled-Tasks/Runs/{slug}/{date}.md',
			filePath: 'gemini-scribe/Scheduled-Tasks/digest.md',
		} as ScheduledTask;
		modal.populateFormForEdit(task);
		modal.editingSlug = 'digest';

		await modal.handleSave(true);

		expect(scheduledTaskManager.updateTask).toHaveBeenCalledWith(
			'digest',
			expect.objectContaining({
				schedule: 'weekly@08:15:mon,thu',
				runIfMissed: true,
				prompt: 'Summarise.',
				outputPath: 'gemini-scribe/Scheduled-Tasks/Runs/{slug}/{date}.md',
			})
		);
	});
});

describe('SchedulerManagementModal save', () => {
	it('refuses an invalid schedule before touching the manager', async () => {
		const { modal, scheduledTaskManager } = makeModal();
		withForm(modal, { schedulePreset: 'custom', scheduleCustom: 'often' });

		await modal.handleSave(false);

		expect(scheduledTaskManager.createTask).not.toHaveBeenCalled();
		expect(NoticeMock).toHaveBeenCalledTimes(1);
	});

	it('refuses an empty prompt', async () => {
		const { modal, scheduledTaskManager } = makeModal();
		withForm(modal, { prompt: '   ' });

		await modal.handleSave(false);

		expect(scheduledTaskManager.createTask).not.toHaveBeenCalled();
	});

	it('sends the same field set on create and update, with blanks as undefined', async () => {
		const create = makeModal();
		withForm(create.modal, { schedulePreset: 'daily-at', scheduleTime: '06:00', maxIterations: ' 4 ' });
		await create.modal.handleSave(false);
		const { slug, ...created } = create.scheduledTaskManager.createTask.mock.calls[0][0];

		const update = makeModal();
		withForm(update.modal, { schedulePreset: 'daily-at', scheduleTime: '06:00', maxIterations: ' 4 ' });
		update.modal.editingSlug = 'digest';
		await update.modal.handleSave(true);
		const [, updated] = update.scheduledTaskManager.updateTask.mock.calls[0];

		expect(slug).toBe('digest');
		expect(updated).toEqual(created);
		expect(created).toMatchObject({
			schedule: 'daily@06:00',
			maxIterations: 4,
			outputPath: undefined,
			model: undefined,
		});
	});

	it('reports a failed save instead of throwing', async () => {
		const { modal, scheduledTaskManager } = makeModal();
		scheduledTaskManager.createTask.mockRejectedValue(new Error('disk full'));
		withForm(modal, {});

		await expect(modal.handleSave(false)).resolves.toBeUndefined();

		expect(NoticeMock.mock.lastCall?.[0]).toContain('disk full');
		expect(modal.render).not.toHaveBeenCalled();
	});
});
