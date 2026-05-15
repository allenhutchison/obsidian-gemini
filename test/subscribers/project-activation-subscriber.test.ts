import { AgentEventBus } from '../../src/agent/agent-event-bus';
import { ProjectActivationSubscriber } from '../../src/subscribers/project-activation-subscriber';
import { ChatSession, SessionType } from '../../src/types/agent';
import { TFile } from 'obsidian';

vi.mock('obsidian');

function makeTFile(path: string): TFile {
	const basename = path.includes('/') ? path.split('/').pop()! : path;
	const extension = basename.includes('.') ? basename.split('.').pop()! : '';
	return Object.assign(new TFile(), { path, basename, extension });
}

function createMockLogger(): any {
	return {
		log: vi.fn(),
		debug: vi.fn(),
		error: vi.fn(),
		warn: vi.fn(),
		child: vi.fn().mockReturnThis(),
	};
}

function createMockSession(overrides: Partial<ChatSession> = {}): ChatSession {
	return {
		id: 'test-session-id',
		type: SessionType.AGENT_SESSION,
		title: 'Test Session',
		context: { contextFiles: [], requireConfirmation: [] },
		created: new Date(),
		lastActive: new Date(),
		historyPath: 'gemini-scribe/Agent-Sessions/test.md',
		...overrides,
	};
}

function createMockPlugin(bus: AgentEventBus): any {
	return {
		agentEventBus: bus,
		logger: createMockLogger(),
		projectManager: {
			getProjectForPath: vi.fn(),
			getProject: vi.fn(),
		},
		sessionHistory: {
			updateSessionMetadata: vi.fn().mockResolvedValue(undefined),
		},
	};
}

describe('ProjectActivationSubscriber', () => {
	let bus: AgentEventBus;
	let plugin: any;
	let subscriber: ProjectActivationSubscriber;

	beforeEach(() => {
		vi.clearAllMocks();
		bus = new AgentEventBus(createMockLogger());
		plugin = createMockPlugin(bus);
		subscriber = new ProjectActivationSubscriber(plugin);
	});

	afterEach(() => {
		subscriber.destroy();
	});

	describe('sessionCreated', () => {
		it('should skip when session.projectPath is already set', async () => {
			const session = createMockSession({ projectPath: 'projects/existing.md' });

			await bus.emit('sessionCreated', { session });

			expect(plugin.projectManager.getProjectForPath).not.toHaveBeenCalled();
		});

		it('should auto-detect project from context files and break after first match', async () => {
			const contextFile1 = makeTFile('src/file1.md');
			const contextFile2 = makeTFile('src/file2.md');
			const session = createMockSession({
				context: {
					contextFiles: [contextFile1, contextFile2],
					requireConfirmation: [],
				},
			});

			const matchedProject = {
				file: { path: 'projects/my-project.md' },
				config: { name: 'My Project' },
			};
			plugin.projectManager.getProjectForPath.mockReturnValueOnce(matchedProject);

			await bus.emit('sessionCreated', { session });

			expect(session.projectPath).toBe('projects/my-project.md');
			expect(plugin.sessionHistory.updateSessionMetadata).toHaveBeenCalledWith(session);
			// Should have broken after first match — only called once
			expect(plugin.projectManager.getProjectForPath).toHaveBeenCalledTimes(1);
			expect(plugin.logger.log).toHaveBeenCalledWith(expect.stringContaining('My Project'));
		});

		it('should not set projectPath when no context files match a project', async () => {
			const contextFile = makeTFile('notes/random.md');
			const session = createMockSession({
				context: {
					contextFiles: [contextFile],
					requireConfirmation: [],
				},
			});

			plugin.projectManager.getProjectForPath.mockReturnValue(undefined);

			await bus.emit('sessionCreated', { session });

			expect(session.projectPath).toBeUndefined();
			expect(plugin.sessionHistory.updateSessionMetadata).not.toHaveBeenCalled();
		});

		it('should log error but not throw when persistence fails', async () => {
			const contextFile = makeTFile('src/file.md');
			const session = createMockSession({
				context: {
					contextFiles: [contextFile],
					requireConfirmation: [],
				},
			});

			plugin.projectManager.getProjectForPath.mockReturnValue({
				file: { path: 'projects/my-project.md' },
				config: { name: 'My Project' },
			});
			plugin.sessionHistory.updateSessionMetadata.mockRejectedValue(new Error('write failed'));

			await bus.emit('sessionCreated', { session });

			expect(plugin.logger.error).toHaveBeenCalledWith('Failed to persist project linkage:', expect.any(Error));
		});
	});

	describe('sessionLoaded', () => {
		it('should skip when no projectPath is set', async () => {
			const session = createMockSession({ projectPath: undefined });

			await bus.emit('sessionLoaded', { session });

			expect(plugin.projectManager.getProject).not.toHaveBeenCalled();
		});

		it('should verify linked project exists and keep it', async () => {
			const session = createMockSession({ projectPath: 'projects/my-project.md' });
			plugin.projectManager.getProject.mockResolvedValue({
				file: { path: 'projects/my-project.md' },
				config: { name: 'My Project' },
			});

			await bus.emit('sessionLoaded', { session });

			expect(session.projectPath).toBe('projects/my-project.md');
			expect(plugin.sessionHistory.updateSessionMetadata).not.toHaveBeenCalled();
		});

		it('should unlink deleted project — clears projectPath and persists', async () => {
			const session = createMockSession({ projectPath: 'projects/deleted-project.md' });
			plugin.projectManager.getProject.mockResolvedValue(undefined);

			await bus.emit('sessionLoaded', { session });

			expect(session.projectPath).toBeUndefined();
			expect(plugin.logger.warn).toHaveBeenCalledWith(expect.stringContaining('no longer exists'));
			expect(plugin.sessionHistory.updateSessionMetadata).toHaveBeenCalledWith(session);
		});

		it('should log error but not throw when persistence of unlink fails', async () => {
			const session = createMockSession({ projectPath: 'projects/deleted.md' });
			plugin.projectManager.getProject.mockResolvedValue(undefined);
			plugin.sessionHistory.updateSessionMetadata.mockRejectedValue(new Error('write failed'));

			await bus.emit('sessionLoaded', { session });

			expect(plugin.logger.error).toHaveBeenCalledWith('Failed to persist project unlink:', expect.any(Error));
		});
	});

	it('should not trigger handlers after destroy() unsubscribes', async () => {
		subscriber.destroy();

		const session = createMockSession({
			context: {
				contextFiles: [makeTFile('src/file.md')],
				requireConfirmation: [],
			},
		});
		plugin.projectManager.getProjectForPath.mockReturnValue({
			file: { path: 'projects/my-project.md' },
			config: { name: 'My Project' },
		});

		await bus.emit('sessionCreated', { session });
		await bus.emit('sessionLoaded', { session });

		expect(plugin.projectManager.getProjectForPath).not.toHaveBeenCalled();
		expect(plugin.projectManager.getProject).not.toHaveBeenCalled();
	});
});
