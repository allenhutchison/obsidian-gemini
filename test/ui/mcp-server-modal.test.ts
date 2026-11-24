import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Notice } from 'obsidian';
import type { MCPServerConfig } from '../../src/mcp/types';

// Decision-surface coverage for the MCP server modal (#1596): what Save
// validates and the config it hands back, how the argument and environment
// text areas are parsed, where env vars are stored, and the test-connection
// result. The modal is driven through the Setting components it registers.

interface Row {
	name: string;
	desc: string;
	inputs: Array<{ value: string; change?: (v: string) => void }>;
	dropdown?: { change?: (v: string) => void };
	toggle?: { change?: (v: boolean) => void };
	buttons: Array<{ text: string; click?: () => unknown; setDesc?: unknown }>;
}

const rows: Row[] = [];

vi.mock('obsidian', async () => {
	const original = await vi.importActual<any>('../../__mocks__/obsidian.js');
	const { installObsidianDom } = await import('./obsidian-dom');
	installObsidianDom();

	class Modal extends original.Modal {
		constructor(app: any) {
			super(app);
			this.contentEl = document.createElement('div');
			this.modalEl = document.createElement('div');
			this.closed = false;
		}
		close() {
			this.closed = true;
		}
	}

	class Setting {
		row: Row = { name: '', desc: '', inputs: [], buttons: [] };
		constructor(_container: unknown) {
			rows.push(this.row);
		}
		setName(name: string) {
			this.row.name = name;
			return this;
		}
		setDesc(desc: string) {
			this.row.desc = desc;
			return this;
		}
		private addInput(cb: (c: any) => void) {
			const input: Row['inputs'][number] = { value: '' };
			const component: any = {
				inputEl: { addClass: vi.fn(), rows: 0, cols: 0 },
				setPlaceholder: () => component,
				setValue: (v: string) => {
					input.value = v;
					return component;
				},
				onChange: (fn: (v: string) => void) => {
					input.change = fn;
					return component;
				},
			};
			cb(component);
			this.row.inputs.push(input);
			return this;
		}
		addText(cb: (c: any) => void) {
			return this.addInput(cb);
		}
		addTextArea(cb: (c: any) => void) {
			return this.addInput(cb);
		}
		addDropdown(cb: (c: any) => void) {
			const dropdown: Row['dropdown'] = {};
			const component: any = {
				addOption: () => component,
				setValue: () => component,
				onChange: (fn: (v: string) => void) => {
					dropdown.change = fn;
					return component;
				},
			};
			cb(component);
			this.row.dropdown = dropdown;
			return this;
		}
		addToggle(cb: (c: any) => void) {
			const toggle: Row['toggle'] = {};
			const component: any = {
				setValue: () => component,
				onChange: (fn: (v: boolean) => void) => {
					toggle.change = fn;
					return component;
				},
			};
			cb(component);
			this.row.toggle = toggle;
			return this;
		}
		addButton(cb: (c: any) => void) {
			const button: Row['buttons'][number] = { text: '' };
			const component: any = {
				setButtonText: (text: string) => {
					button.text = text;
					return component;
				},
				setCta: () => component,
				setDestructive: () => component,
				setDisabled: () => component,
				onClick: (fn: () => unknown) => {
					button.click = fn;
					return component;
				},
			};
			cb(component);
			this.row.buttons.push(button);
			return this;
		}
	}

	return { ...original, Modal, Setting };
});

const { secrets } = vi.hoisted(() => ({
	secrets: { resolveServerEnv: vi.fn(), writeServerEnv: vi.fn() },
}));
vi.mock('../../src/mcp/mcp-secrets', () => secrets);

vi.mock('../../src/mcp/mcp-oauth-provider', () => ({
	ObsidianOAuthClientProvider: class {
		hasTokens() {
			return false;
		}
	},
}));

// vi.mock is hoisted, so this import already sees the shims.
import { MCPServerModal } from '../../src/ui/mcp-server-modal';

const NoticeMock = Notice as unknown as ReturnType<typeof vi.fn>;

/** The latest row with this name: switching transport re-renders the form. */
function row(name: string): Row {
	const found = [...rows].reverse().find((r) => r.name === name);
	if (!found) throw new Error(`No setting named "${name}"`);
	return found;
}
const type = (name: string, value: string) => row(name).inputs[0].change!(value);
/** The unnamed Cancel/Save row is the last one rendered. */
const saveButton = () => rows[rows.length - 1].buttons.find((b) => b.text === 'Save')!;
const notices = () => NoticeMock.mock.calls.map(([msg]) => msg);

function makeModal(config: MCPServerConfig | null = null) {
	const onSave = vi.fn();
	const mcpManager = {
		getServerStatus: vi.fn().mockReturnValue(undefined),
		queryToolsForConfig: vi.fn(),
	};
	const modal = new MCPServerModal({} as any, mcpManager as any, config, onSave);
	modal.onOpen();
	return { modal: modal as any, onSave, mcpManager };
}

beforeEach(() => {
	rows.length = 0;
	NoticeMock.mockClear();
	secrets.resolveServerEnv.mockReset().mockReturnValue(undefined);
	secrets.writeServerEnv.mockReset();
});

describe('MCPServerModal save validation', () => {
	it('requires a name', async () => {
		const { modal, onSave } = makeModal();
		type('Command', 'npx');

		await saveButton().click!();

		expect(notices()).toContain('Server name is required');
		expect(onSave).not.toHaveBeenCalled();
		expect(modal.closed).toBe(false);
	});

	it('requires a command for stdio', async () => {
		const { onSave } = makeModal();
		type('Server name', 'files');

		await saveButton().click!();

		expect(notices()).toContain('Command is required for stdio transport');
		expect(onSave).not.toHaveBeenCalled();
	});

	it('requires a URL for HTTP, and a well-formed one', async () => {
		const { onSave } = makeModal();
		type('Server name', 'remote');
		row('Transport').dropdown!.change!('http');

		await saveButton().click!();
		expect(notices()).toContain('Server URL is required for HTTP transport');

		type('Server URL', 'not a url');
		await saveButton().click!();
		expect(notices()).toContain('Invalid URL format');
		expect(onSave).not.toHaveBeenCalled();
	});

	it('does not save when the env vars cannot be stored', async () => {
		secrets.writeServerEnv.mockImplementation(() => {
			throw new Error('keychain locked');
		});
		const { onSave } = makeModal();
		type('Server name', 'files');
		type('Command', 'npx');

		await saveButton().click!();

		expect(notices()).toContain('keychain locked');
		expect(onSave).not.toHaveBeenCalled();
	});
});

describe('MCPServerModal saved config', () => {
	it('saves a stdio server with trimmed args and stores env vars in secret storage', async () => {
		const { modal, onSave } = makeModal();
		type('Server name', '  files  ');
		type('Command', ' npx ');
		type('Arguments', ' -y \n\n @scope/server \n');
		type('Environment variables', 'TOKEN = abc=def\nnot-a-pair\n DEBUG=1 ');

		await saveButton().click!();

		const saved = onSave.mock.calls[0][0] as MCPServerConfig;
		expect(saved).toMatchObject({ name: 'files', transport: 'stdio', command: 'npx', args: ['-y', '@scope/server'] });
		// Env values never ride on the config; they go to secret storage.
		expect(saved).not.toHaveProperty('env');
		expect(secrets.writeServerEnv).toHaveBeenCalledWith({}, saved, { TOKEN: 'abc=def', DEBUG: '1' });
		expect(modal.closed).toBe(true);
	});

	it('passes undefined env when the env box is emptied', async () => {
		const { onSave } = makeModal();
		type('Server name', 'files');
		type('Command', 'npx');
		type('Environment variables', 'no pairs here');

		await saveButton().click!();

		expect(onSave).toHaveBeenCalledTimes(1);
		expect(secrets.writeServerEnv.mock.calls[0][2]).toBeUndefined();
	});

	it('saves an HTTP server without touching secret storage', async () => {
		const { onSave } = makeModal();
		type('Server name', 'remote');
		row('Transport').dropdown!.change!('http');
		type('Server URL', ' https://mcp.example.com/mcp ');

		await saveButton().click!();

		expect(onSave.mock.calls[0][0]).toMatchObject({ transport: 'http', url: 'https://mcp.example.com/mcp' });
		expect(secrets.writeServerEnv).not.toHaveBeenCalled();
	});

	it('saves the enabled toggle', async () => {
		const { onSave } = makeModal();
		type('Server name', 'files');
		type('Command', 'npx');
		row('Enabled').toggle!.change!(false);

		await saveButton().click!();

		expect(onSave.mock.calls[0][0].enabled).toBe(false);
	});

	it("edits a copy: the caller's config and its args array are left alone until save", () => {
		const original: MCPServerConfig = {
			name: 'files',
			transport: 'stdio',
			command: 'npx',
			args: ['-y'],
			enabled: true,
			trustedTools: [],
		};
		makeModal(original);
		type('Arguments', '--other');
		type('Command', 'node');
		expect(original.args).toEqual(['-y']);
		expect(original.command).toBe('npx');
	});

	it('defaults a legacy config with no transport to stdio', () => {
		const legacy = { name: 'old', command: 'npx', args: [], enabled: true } as unknown as MCPServerConfig;
		const { modal } = makeModal(legacy);
		expect(modal.config.transport).toBe('stdio');
		expect(() => row('Command')).not.toThrow();
	});
});

describe('MCPServerModal test connection', () => {
	const testButton = () => row('Test connection').buttons[0];

	it('needs a command before testing a stdio server', async () => {
		const { mcpManager } = makeModal();
		await testButton().click!();
		expect(mcpManager.queryToolsForConfig).not.toHaveBeenCalled();
		expect(notices()).toHaveLength(1);
	});

	it('lists the tools a successful test discovers', async () => {
		const { modal, mcpManager } = makeModal();
		type('Command', 'npx');
		mcpManager.queryToolsForConfig.mockResolvedValue(['read_file', 'write_file']);

		await testButton().click!();

		expect(row('Test connection').desc).toBe('Connected successfully! Found 2 tool(s).');
		const items = [...modal.contentEl.querySelectorAll('.mcp-discovered-tools-container li')].map(
			(li: Element) => li.textContent
		);
		expect(items).toEqual(['read_file', 'write_file']);
	});

	it('shows the failure on the row when the test fails', async () => {
		const { mcpManager } = makeModal();
		type('Command', 'npx');
		mcpManager.queryToolsForConfig.mockRejectedValue(new Error('spawn ENOENT'));

		await testButton().click!();

		expect(row('Test connection').desc).toContain('Connection failed:');
	});

	it("pre-fills the tool list from a connected server's status when editing", () => {
		const config: MCPServerConfig = {
			name: 'files',
			transport: 'stdio',
			command: 'npx',
			args: [],
			enabled: true,
			trustedTools: [],
		};
		const onSave = vi.fn();
		const mcpManager = {
			getServerStatus: vi.fn().mockReturnValue({ toolNames: ['search'] }),
			queryToolsForConfig: vi.fn(),
		};
		const modal = new MCPServerModal({} as any, mcpManager as any, config, onSave) as any;
		modal.onOpen();
		expect(modal.contentEl.querySelector('.mcp-discovered-tools-container li')?.textContent).toBe('search');
	});
});
