vi.mock('obsidian', () => {
	class TFolder {
		path: string;
		constructor(path: string) {
			this.path = path;
		}
	}

	return {
		TFolder,
		normalizePath: (p: string) => p,
	};
});

import { FolderInitializer } from '../../src/services/folder-initializer';

// Mock ensureFolderExists
const mockEnsureFolderExists = vi.fn().mockResolvedValue({});
vi.mock('../../src/utils/file-utils', () => ({
	ensureFolderExists: (...args: any[]) => mockEnsureFolderExists(...args),
}));

describe('FolderInitializer', () => {
	let folderInitializer: FolderInitializer;
	let mockPlugin: any;

	beforeEach(() => {
		vi.clearAllMocks();
		mockPlugin = {
			app: {
				vault: {
					getAbstractFileByPath: vi.fn().mockReturnValue(null),
				},
				fileManager: {
					renameFile: vi.fn(),
				},
			},
			settings: {
				historyFolder: 'gemini-scribe',
			},
			logger: {
				log: vi.fn(),
				debug: vi.fn(),
				error: vi.fn(),
				warn: vi.fn(),
			},
		};
		folderInitializer = new FolderInitializer(mockPlugin);
	});

	it('should create all plugin state folders in one pass', async () => {
		await folderInitializer.initializeAll();

		// root + 6 subfolders: Agent-Sessions, Background-Tasks, Prompts, Skills, Scheduled-Tasks, Scheduled-Tasks/Runs
		expect(mockEnsureFolderExists).toHaveBeenCalledTimes(7);
		expect(mockEnsureFolderExists).toHaveBeenCalledWith(
			mockPlugin.app.vault,
			'gemini-scribe',
			'plugin state',
			mockPlugin.logger
		);
		expect(mockEnsureFolderExists).toHaveBeenCalledWith(
			mockPlugin.app.vault,
			'gemini-scribe/Agent-Sessions',
			'Agent-Sessions',
			mockPlugin.logger
		);
		expect(mockEnsureFolderExists).toHaveBeenCalledWith(
			mockPlugin.app.vault,
			'gemini-scribe/Background-Tasks',
			'Background-Tasks',
			mockPlugin.logger
		);
		expect(mockEnsureFolderExists).toHaveBeenCalledWith(
			mockPlugin.app.vault,
			'gemini-scribe/Prompts',
			'Prompts',
			mockPlugin.logger
		);
		expect(mockEnsureFolderExists).toHaveBeenCalledWith(
			mockPlugin.app.vault,
			'gemini-scribe/Skills',
			'Skills',
			mockPlugin.logger
		);
		expect(mockEnsureFolderExists).toHaveBeenCalledWith(
			mockPlugin.app.vault,
			'gemini-scribe/Scheduled-Tasks',
			'Scheduled-Tasks',
			mockPlugin.logger
		);
		expect(mockEnsureFolderExists).toHaveBeenCalledWith(
			mockPlugin.app.vault,
			'gemini-scribe/Scheduled-Tasks/Runs',
			'Scheduled-Tasks/Runs',
			mockPlugin.logger
		);
	});

	it('should create root folder before subfolders', async () => {
		const callOrder: string[] = [];
		mockEnsureFolderExists.mockImplementation(async (_vault: any, path: string) => {
			callOrder.push(path);
			return {};
		});

		await folderInitializer.initializeAll();

		expect(callOrder[0]).toBe('gemini-scribe');
		expect(callOrder.slice(1)).toEqual(
			expect.arrayContaining([
				'gemini-scribe/Agent-Sessions',
				'gemini-scribe/Background-Tasks',
				'gemini-scribe/Prompts',
				'gemini-scribe/Skills',
				'gemini-scribe/Scheduled-Tasks',
				'gemini-scribe/Scheduled-Tasks/Runs',
			])
		);
	});

	it('should use the configured historyFolder setting', async () => {
		mockPlugin.settings.historyFolder = 'custom-folder';

		await folderInitializer.initializeAll();

		expect(mockEnsureFolderExists).toHaveBeenCalledWith(
			mockPlugin.app.vault,
			'custom-folder',
			'plugin state',
			mockPlugin.logger
		);
		expect(mockEnsureFolderExists).toHaveBeenCalledWith(
			mockPlugin.app.vault,
			'custom-folder/Prompts',
			'Prompts',
			mockPlugin.logger
		);
	});
});
