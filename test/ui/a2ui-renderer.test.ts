import { A2UIRenderer } from '../../src/ui/a2ui/renderer';
import { A2UIComponent, A2UIContainer, A2UIText, A2UIButton, A2UIMermaid } from '../../src/ui/a2ui/types';
import { App, MarkdownRenderer, ButtonComponent, ToggleComponent, DropdownComponent, TextComponent } from 'obsidian';
import { attachObsidianMockMethods } from '../test-helper';

// Mock Obsidian
jest.mock('obsidian', () => {
	const { attachObsidianMockMethods } = require('../test-helper');
	const mockEl = () => {
		const el = document.createElement('div');
		attachObsidianMockMethods(el);
		return el;
	};

	return {
		App: jest.fn(),
		MarkdownRenderer: {
			render: jest.fn().mockImplementation((app, content, el) => {
				el.textContent = content;
				return Promise.resolve();
			}),
		},
		MarkdownRenderChild: class {
			containerEl: HTMLElement;
			constructor(containerEl: HTMLElement) {
				this.containerEl = containerEl;
			}
			load() {}
			onload() {}
			onunload() {}
		},
		setIcon: jest.fn((el: HTMLElement, icon: string) => {
			el.setAttribute('data-icon', icon);
		}),
		ButtonComponent: jest.fn().mockImplementation((el: HTMLElement) => {
			const btn = document.createElement('button');
			el.appendChild(btn);
			return {
				setButtonText: jest.fn().mockReturnThis(),
				setDisabled: jest.fn().mockReturnThis(),
				setCta: jest.fn().mockReturnThis(),
				setWarning: jest.fn().mockReturnThis(),
				setIcon: jest.fn().mockReturnThis(),
				onClick: jest.fn().mockReturnThis(),
				buttonEl: btn,
			};
		}),
		TextComponent: jest.fn().mockImplementation((el: HTMLElement) => {
			const input = document.createElement('input');
			el.appendChild(input);
			return {
				setPlaceholder: jest.fn().mockReturnThis(),
				setValue: jest.fn().mockReturnThis(),
				setDisabled: jest.fn().mockReturnThis(),
				onChange: jest.fn().mockReturnThis(),
				inputEl: input,
			};
		}),
		DropdownComponent: jest.fn().mockImplementation((el: HTMLElement) => {
			const select = document.createElement('select');
			el.appendChild(select);
			return {
				addOption: jest.fn().mockReturnThis(),
				setValue: jest.fn().mockReturnThis(),
				setDisabled: jest.fn().mockReturnThis(),
				onChange: jest.fn().mockReturnThis(),
				selectEl: select,
			};
		}),
		ToggleComponent: jest.fn().mockImplementation((el: HTMLElement) => {
			const toggle = document.createElement('input');
			toggle.type = 'checkbox';
			el.appendChild(toggle);
			return {
				setValue: jest.fn().mockReturnThis(),
				setDisabled: jest.fn().mockReturnThis(),
				onChange: jest.fn().mockReturnThis(),
				toggleEl: toggle,
			};
		}),
	};
});

describe('A2UIRenderer', () => {
	let app: App;
	let containerEl: HTMLElement;

	beforeEach(() => {
		app = {} as App;
		containerEl = document.createElement('div');
		attachObsidianMockMethods(containerEl);
	});

	afterEach(() => {
		jest.clearAllMocks();
	});

	describe('Component Rendering', () => {
		it('should render a text component', async () => {
			const component: A2UIText = {
				type: 'text',
				content: 'Hello, World!',
				variant: 'h1',
			};

			const renderer = new A2UIRenderer(app, containerEl, component, 'test.md');
			renderer.onload();

			await new Promise((resolve) => setTimeout(resolve, 10));

			expect(containerEl.querySelector('.a2ui-text')).toBeTruthy();
			expect(MarkdownRenderer.render).toHaveBeenCalled();
		});

		it('should render a container with children', async () => {
			const component: A2UIContainer = {
				type: 'container',
				direction: 'row',
				gap: '10px',
				children: [
					{ type: 'text', content: 'Child 1' },
					{ type: 'text', content: 'Child 2' },
				],
			};

			const renderer = new A2UIRenderer(app, containerEl, component, 'test.md');
			renderer.onload();

			await new Promise((resolve) => setTimeout(resolve, 10));

			const container = containerEl.querySelector('.a2ui-container');
			expect(container).toBeTruthy();

			// Verify children were rendered
			const children = containerEl.querySelectorAll('.a2ui-text');
			expect(children.length).toBe(2);
			expect(children[0].textContent).toBe('Child 1');
			expect(children[1].textContent).toBe('Child 2');
			expect(MarkdownRenderer.render).toHaveBeenCalledTimes(2);
		});

		it('should render a button component', async () => {
			const component: A2UIButton = {
				type: 'button',
				label: 'Click Me',
				variant: 'primary',
			};

			const renderer = new A2UIRenderer(app, containerEl, component, 'test.md');
			renderer.onload();

			await new Promise((resolve) => setTimeout(resolve, 10));

			expect(containerEl.querySelector('.a2ui-button')).toBeTruthy();
			expect(ButtonComponent).toHaveBeenCalled();
		});

		it('should handle unknown component type gracefully', async () => {
			const component = {
				type: 'unknown-type',
			} as any;

			const renderer = new A2UIRenderer(app, containerEl, component, 'test.md');
			renderer.onload();

			await new Promise((resolve) => setTimeout(resolve, 10));

			// Should not throw, should create wrapper with error indication
			const wrapper = containerEl.querySelector('.a2ui-unknown-type');
			expect(wrapper).toBeTruthy();
			const errorEl = wrapper?.querySelector('.a2ui-error');
			expect(errorEl).toBeTruthy();
			expect(errorEl?.textContent).toContain('Unknown component: unknown-type');
		});
	});

	describe('Style Sanitization', () => {
		it('should apply allowed styles', async () => {
			const component: A2UIContainer = {
				type: 'container',
				style: {
					padding: '10px',
					margin: '5px',
					backgroundColor: '#fff',
				},
				children: [],
			};

			const renderer = new A2UIRenderer(app, containerEl, component, 'test.md');
			renderer.onload();

			await new Promise((resolve) => setTimeout(resolve, 10));

			const wrapper = containerEl.querySelector('.a2ui-container') as HTMLElement;
			expect(wrapper).toBeTruthy();
			expect(wrapper.style.padding).toBe('10px');
			expect(wrapper.style.margin).toBe('5px');
			// Browsers/JSDOM normalize colors to rgb()
			const validColors = ['#fff', 'rgb(255, 255, 255)'];
			expect(validColors).toContain(wrapper.style.backgroundColor);
		});

		it('should block javascript: URLs in styles', async () => {
			const component: A2UIContainer = {
				type: 'container',
				style: {
					backgroundImage: 'javascript:alert(1)',
				} as any,
				children: [],
			};

			const renderer = new A2UIRenderer(app, containerEl, component, 'test.md');
			renderer.onload();

			await new Promise((resolve) => setTimeout(resolve, 10));

			const wrapper = containerEl.querySelector('.a2ui-container') as HTMLElement;
			expect(wrapper).toBeTruthy();
			// javascript: should be blocked
			expect(wrapper.style.backgroundImage).not.toContain('javascript');
		});

		it('should block url() in styles', async () => {
			const component: A2UIContainer = {
				type: 'container',
				style: {
					backgroundColor: 'url(http://evil.com/track.png)',
				} as any,
				children: [],
			};

			const renderer = new A2UIRenderer(app, containerEl, component, 'test.md');
			renderer.onload();

			await new Promise((resolve) => setTimeout(resolve, 10));

			const wrapper = containerEl.querySelector('.a2ui-container') as HTMLElement;
			// url() should be blocked
			expect(wrapper.style.backgroundColor).not.toContain('url');
		});

		it('should block expression() in styles (IE attack vector)', async () => {
			const component: A2UIContainer = {
				type: 'container',
				style: {
					width: 'expression(alert(1))',
				} as any,
				children: [],
			};

			const renderer = new A2UIRenderer(app, containerEl, component, 'test.md');
			renderer.onload();

			await new Promise((resolve) => setTimeout(resolve, 10));

			const wrapper = containerEl.querySelector('.a2ui-container') as HTMLElement;
			// expression() should be blocked
			expect(wrapper.style.width).not.toContain('expression');
		});
	});

	describe('Button Actions', () => {
		it('should dispatch a2ui-action event on button click', async () => {
			const component: A2UIButton = {
				type: 'button',
				label: 'Save',
				action: 'save-note',
				payload: { content: 'Test content' },
			};

			const renderer = new A2UIRenderer(app, containerEl, component, 'test.md');
			renderer.onload();

			await new Promise((resolve) => setTimeout(resolve, 10));

			// Check that ButtonComponent onClick was set up
			expect(ButtonComponent).toHaveBeenCalled();
			const buttonMock = (ButtonComponent as jest.Mock).mock.results[0].value;
			expect(buttonMock.onClick).toHaveBeenCalled();
		});

		it('should not set up onClick for buttons without action', async () => {
			const component: A2UIButton = {
				type: 'button',
				label: 'Display Only',
				// No action property
			};

			const renderer = new A2UIRenderer(app, containerEl, component, 'test.md');
			renderer.onload();

			await new Promise((resolve) => setTimeout(resolve, 10));

			expect(ButtonComponent).toHaveBeenCalled();
			const buttonMock = (ButtonComponent as jest.Mock).mock.results[0].value;
			expect(buttonMock.onClick).not.toHaveBeenCalled();
		});
	});

	describe('Switch Component', () => {
		it('should handle checked = false correctly', async () => {
			const component = {
				type: 'switch',
				label: 'Toggle',
				checked: false,
			};

			const renderer = new A2UIRenderer(app, containerEl, component as any, 'test.md');
			renderer.onload();

			await new Promise((resolve) => setTimeout(resolve, 10));

			expect(ToggleComponent).toHaveBeenCalled();
			const toggleMock = (ToggleComponent as jest.Mock).mock.results[0].value;
			// setValue should be called with false
			expect(toggleMock.setValue).toHaveBeenCalledWith(false);
		});

		it('should handle checked = undefined correctly', async () => {
			const component = {
				type: 'switch',
				label: 'Toggle',
				// checked is undefined
			};

			const renderer = new A2UIRenderer(app, containerEl, component as any, 'test.md');
			renderer.onload();

			await new Promise((resolve) => setTimeout(resolve, 10));

			expect(ToggleComponent).toHaveBeenCalled();
			const toggleMock = (ToggleComponent as jest.Mock).mock.results[0].value;
			// setValue should NOT be called when checked is undefined
			expect(toggleMock.setValue).not.toHaveBeenCalled();
		});
	});

	describe('Error Handling', () => {
		it('should display error div on render failure', async () => {
			// Create a malformed component that will cause issues
			const component = null as any;

			// This should not throw, but handle gracefully
			const renderer = new A2UIRenderer(app, containerEl, component, 'test.md');

			// The renderer will catch the error in onload
			expect(() => renderer.onload()).not.toThrow();

			await new Promise((resolve) => setTimeout(resolve, 10));
			const errorEl = containerEl.querySelector('.a2ui-error');
			expect(errorEl).toBeTruthy();
		});
	});
});
