import { ExamplePromptsManager, ExamplePrompt } from '../../src/services/example-prompts';
import { TFile } from 'obsidian';

// Mock obsidian
jest.mock('obsidian', () => ({
	...jest.requireActual('../../__mocks__/obsidian.js'),
	normalizePath: jest.fn((path: string) => path),
	TFile: class TFile {
		path: string = '';
		name: string = '';
	}
}));

describe('ExamplePromptsManager', () => {
	let examplePrompts: ExamplePromptsManager;
	let mockPlugin: any;
	let mockVault: any;

	beforeEach(() => {
		// Reset mocks
		jest.clearAllMocks();

		// Setup mock vault
		mockVault = {
			getAbstractFileByPath: jest.fn(),
			read: jest.fn(),
			modify: jest.fn(),
			create: jest.fn()
		};

		// Setup mock plugin
		mockPlugin = {
			app: {
				vault: mockVault
			},
			settings: {
				historyFolder: 'test-folder'
			},
			logger: {
				log: jest.fn(),
				debug: jest.fn(),
				warn: jest.fn(),
				error: jest.fn()
			}
		};

		examplePrompts = new ExamplePromptsManager(mockPlugin);
	});

	describe('getPromptsFilePath', () => {
		it('should return correct path', () => {
			const path = examplePrompts.getPromptsFilePath();
			expect(path).toBe('test-folder/example-prompts.json');
		});
	});

	describe('exists', () => {
		it('should return true if file exists', async () => {
			const mockFile = new TFile();
			mockVault.getAbstractFileByPath.mockReturnValue(mockFile);

			const result = await examplePrompts.exists();

			expect(result).toBe(true);
			expect(mockVault.getAbstractFileByPath).toHaveBeenCalledWith('test-folder/example-prompts.json');
		});

		it('should return false if file does not exist', async () => {
			mockVault.getAbstractFileByPath.mockReturnValue(null);

			const result = await examplePrompts.exists();

			expect(result).toBe(false);
		});

		it('should return false if path is not a TFile', async () => {
			mockVault.getAbstractFileByPath.mockReturnValue({ path: 'some-folder' });

			const result = await examplePrompts.exists();

			expect(result).toBe(false);
		});
	});

	describe('read', () => {
		it('should read and parse valid JSON successfully', async () => {
			const mockFile = new TFile();
			const validPrompts: ExamplePrompt[] = [
				{ icon: 'search', text: 'Find all notes' },
				{ icon: 'file-plus', text: 'Create a summary' }
			];
			mockVault.getAbstractFileByPath.mockReturnValue(mockFile);
			mockVault.read.mockResolvedValue(JSON.stringify(validPrompts));

			const result = await examplePrompts.read();

			expect(result).toEqual(validPrompts);
			expect(mockVault.read).toHaveBeenCalledWith(mockFile);
		});

		it('should return null if file does not exist', async () => {
			mockVault.getAbstractFileByPath.mockReturnValue(null);

			const result = await examplePrompts.read();

			expect(result).toBeNull();
		});

		it('should return null if path is not a TFile', async () => {
			mockVault.getAbstractFileByPath.mockReturnValue({ path: 'some-folder' });

			const result = await examplePrompts.read();

			expect(result).toBeNull();
		});

		it('should return null if JSON is invalid', async () => {
			const mockFile = new TFile();
			mockVault.getAbstractFileByPath.mockReturnValue(mockFile);
			mockVault.read.mockResolvedValue('{ invalid json');

			const result = await examplePrompts.read();

			expect(result).toBeNull();
			expect(mockPlugin.logger.error).toHaveBeenCalledWith(
				'Failed to read example-prompts.json:',
				expect.any(Error)
			);
		});

		it('should return null if content is not an array', async () => {
			const mockFile = new TFile();
			mockVault.getAbstractFileByPath.mockReturnValue(mockFile);
			mockVault.read.mockResolvedValue(JSON.stringify({ not: 'an array' }));

			const result = await examplePrompts.read();

			expect(result).toBeNull();
			expect(mockPlugin.logger.warn).toHaveBeenCalledWith('Invalid example prompts structure in file');
		});

		it('should return null if prompts are missing required fields', async () => {
			const mockFile = new TFile();
			const invalidPrompts = [
				{ icon: 'search' }, // missing text
				{ text: 'Create a summary' } // missing icon
			];
			mockVault.getAbstractFileByPath.mockReturnValue(mockFile);
			mockVault.read.mockResolvedValue(JSON.stringify(invalidPrompts));

			const result = await examplePrompts.read();

			expect(result).toBeNull();
		});

		it('should handle read errors gracefully', async () => {
			const mockFile = new TFile();
			mockVault.getAbstractFileByPath.mockReturnValue(mockFile);
			mockVault.read.mockRejectedValue(new Error('Read error'));

			const result = await examplePrompts.read();

			expect(result).toBeNull();
			expect(mockPlugin.logger.error).toHaveBeenCalled();
		});
	});

	describe('write', () => {
		it('should write valid prompts to new file', async () => {
			const validPrompts: ExamplePrompt[] = [
				{ icon: 'search', text: 'Find all notes' },
				{ icon: 'file-plus', text: 'Create a summary' }
			];
			mockVault.getAbstractFileByPath.mockReturnValue(null);
			mockVault.create.mockResolvedValue(undefined);

			await examplePrompts.write(validPrompts);

			expect(mockVault.create).toHaveBeenCalledWith(
				'test-folder/example-prompts.json',
				JSON.stringify(validPrompts, null, 2)
			);
			expect(mockVault.modify).not.toHaveBeenCalled();
		});

		it('should update existing file', async () => {
			const mockFile = new TFile();
			const validPrompts: ExamplePrompt[] = [
				{ icon: 'globe', text: 'Research topics' }
			];
			mockVault.getAbstractFileByPath.mockReturnValue(mockFile);
			mockVault.modify.mockResolvedValue(undefined);

			await examplePrompts.write(validPrompts);

			expect(mockVault.modify).toHaveBeenCalledWith(
				mockFile,
				JSON.stringify(validPrompts, null, 2)
			);
			expect(mockVault.create).not.toHaveBeenCalled();
		});

		it('should throw error if prompts is not an array', async () => {
			await expect(examplePrompts.write({} as any)).rejects.toThrow('Invalid example prompts structure');
		});

		it('should throw error if prompts are missing icon field', async () => {
			const invalidPrompts = [
				{ text: 'Missing icon' }
			] as any;

			await expect(examplePrompts.write(invalidPrompts)).rejects.toThrow('Invalid example prompts structure');
		});

		it('should throw error if prompts are missing text field', async () => {
			const invalidPrompts = [
				{ icon: 'search' }
			] as any;

			await expect(examplePrompts.write(invalidPrompts)).rejects.toThrow('Invalid example prompts structure');
		});

		it('should throw error on write failure', async () => {
			const validPrompts: ExamplePrompt[] = [
				{ icon: 'search', text: 'Find notes' }
			];
			mockVault.getAbstractFileByPath.mockReturnValue(null);
			mockVault.create.mockRejectedValue(new Error('Write error'));

			await expect(examplePrompts.write(validPrompts)).rejects.toThrow(
				'Failed to write example-prompts.json: Write error'
			);
			expect(mockPlugin.logger.error).toHaveBeenCalled();
		});

		it('should format JSON with proper indentation', async () => {
			const prompts: ExamplePrompt[] = [
				{ icon: 'search', text: 'Test' }
			];
			mockVault.getAbstractFileByPath.mockReturnValue(null);
			mockVault.create.mockResolvedValue(undefined);

			await examplePrompts.write(prompts);

			const expectedJSON = JSON.stringify(prompts, null, 2);
			expect(mockVault.create).toHaveBeenCalledWith(
				'test-folder/example-prompts.json',
				expectedJSON
			);
		});
	});
});
