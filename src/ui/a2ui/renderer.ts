import {
	App,
	MarkdownRenderer,
	setIcon,
	ButtonComponent,
	TextComponent,
	DropdownComponent,
	ToggleComponent,
	MarkdownRenderChild,
} from 'obsidian';
import {
	A2UIComponent,
	A2UIContainer,
	A2UIText,
	A2UIButton,
	A2UIInput,
	A2UISelect,
	A2UISwitch,
	A2UIImage,
	A2UIIcon,
	A2UIMermaid,
} from './types';

export class A2UIRenderer extends MarkdownRenderChild {
	private uiRoot: A2UIComponent;
	private sourcePath: string;
	private app: App;

	constructor(app: App, containerEl: HTMLElement, uiRoot: A2UIComponent, sourcePath: string) {
		super(containerEl);
		this.app = app;
		this.uiRoot = uiRoot;
		this.sourcePath = sourcePath;
	}

	onload() {
		// Handle async rendering and errors
		this.render(this.containerEl, this.uiRoot).catch((err) => {
			console.error('A2UI render failed:', err);
			this.containerEl.createDiv({
				text: 'Failed to render A2UI component',
				cls: 'a2ui-error',
			});
		});
	}

	private async render(parent: HTMLElement, component: A2UIComponent) {
		const wrapper = parent.createDiv({ cls: `a2ui-component a2ui-${component.type}` });

		// Sanitize styles - only allow specific safe properties
		if (component.style) {
			const allowedStyles = [
				'color',
				'backgroundColor',
				'fontSize',
				'fontWeight',
				'textAlign',
				'margin',
				'marginTop',
				'marginBottom',
				'marginLeft',
				'marginRight',
				'padding',
				'paddingTop',
				'paddingBottom',
				'paddingLeft',
				'paddingRight',
				'width',
				'height',
				'maxWidth',
				'maxHeight',
				'minWidth',
				'minHeight',
				'border',
				'borderRadius',
				'display',
				'flex',
				'flexDirection',
				'justifyContent',
				'alignItems',
				'gap',
				'flexWrap',
			];

			for (const [key, value] of Object.entries(component.style)) {
				if (allowedStyles.includes(key) && typeof value === 'string') {
					// Hardened sanitization: case-insensitive check
					const lowerValue = value.toLowerCase();
					if (
						!lowerValue.includes('javascript:') &&
						!lowerValue.includes('url(') &&
						!lowerValue.includes('expression(')
					) {
						wrapper.style.setProperty(
							key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`),
							value
						);
					}
				}
			}
		}

		if (component.cls) {
			// Basic sanitization for class names
			const safeClass = component.cls.replace(/[^a-zA-Z0-9-_ ]/g, '');
			wrapper.addClass(safeClass);
		}

		switch (component.type) {
			case 'container':
				await this.renderContainer(wrapper, component as A2UIContainer);
				break;
			case 'text':
				await this.renderText(wrapper, component as A2UIText);
				break;
			case 'button':
				this.renderButton(wrapper, component as A2UIButton);
				break;
			case 'input':
				this.renderInput(wrapper, component as A2UIInput);
				break;
			case 'select':
				this.renderSelect(wrapper, component as A2UISelect);
				break;
			case 'switch':
				this.renderSwitch(wrapper, component as A2UISwitch);
				break;
			case 'image':
				this.renderImage(wrapper, component as A2UIImage);
				break;
			case 'icon':
				this.renderIcon(wrapper, component as A2UIIcon);
				break;
			case 'mermaid':
				await this.renderMermaid(wrapper, component as A2UIMermaid);
				break;
			default:
				console.warn('Unknown A2UI component type:', (component as any).type);
				wrapper.createDiv({
					text: `Unknown component: ${(component as any).type}`,
					cls: 'a2ui-error',
				});
		}
	}

	private async renderContainer(parent: HTMLElement, component: A2UIContainer) {
		// Layout styles
		parent.style.display = 'flex';
		parent.style.flexDirection = component.direction || 'column';
		parent.style.gap = component.gap || '0.5rem';

		// Flex alignment
		const alignMap: Record<string, string> = {
			start: 'flex-start',
			end: 'flex-end',
			center: 'center',
			stretch: 'stretch',
		};
		parent.style.alignItems = alignMap[component.align || 'stretch'] || 'stretch';

		const justifyMap: Record<string, string> = {
			start: 'flex-start',
			end: 'flex-end',
			center: 'center',
			'space-between': 'space-between',
		};
		parent.style.justifyContent = justifyMap[component.justify || 'start'] || 'flex-start';

		parent.style.flexWrap = component.wrap ? 'wrap' : 'nowrap';

		// Render children
		if (component.children && Array.isArray(component.children)) {
			for (const child of component.children) {
				await this.render(parent, child);
			}
		}
	}

	private async renderText(parent: HTMLElement, component: A2UIText) {
		const contentDiv = parent.createDiv({ cls: 'a2ui-markdown-content' });

		if (component.variant) {
			contentDiv.addClass(`a2ui-text-${component.variant}`);
			if (component.variant.startsWith('h')) {
				contentDiv.style.fontWeight = 'bold';
			}
		}

		await MarkdownRenderer.render(this.app, component.content || '', contentDiv, this.sourcePath, this);
	}

	private renderButton(parent: HTMLElement, component: A2UIButton) {
		const btn = new ButtonComponent(parent)
			.setButtonText(component.label || 'Button')
			.setDisabled(!!component.disabled);

		if (component.variant === 'primary') btn.setCta();
		if (component.variant === 'danger') btn.setWarning();
		if (component.icon) btn.setIcon(component.icon);

		if (component.action) {
			btn.onClick(() => {
				const event = new CustomEvent('a2ui-action', {
					detail: {
						action: component.action,
						payload: component.payload,
						componentId: component.id,
					},
					bubbles: true,
				});
				parent.dispatchEvent(event);
			});
		}
	}

	private renderInput(parent: HTMLElement, component: A2UIInput) {
		const input = new TextComponent(parent);
		if (component.placeholder) input.setPlaceholder(component.placeholder);
		if (component.value) input.setValue(component.value);

		const inputEl = input.inputEl;
		if (component.label) {
			inputEl.setAttribute('aria-label', component.label);
			inputEl.title = component.label;
		}

		if (component.name) inputEl.setAttribute('name', component.name);

		if (component.inputType === 'password') inputEl.type = 'password';
		if (component.inputType === 'email') inputEl.type = 'email';
		if (component.inputType === 'number') inputEl.type = 'number';
	}

	private renderSelect(parent: HTMLElement, component: A2UISelect) {
		const dropdown = new DropdownComponent(parent);

		if (component.options) {
			for (const opt of component.options) {
				dropdown.addOption(opt.value, opt.label);
			}
		}

		if (component.value) dropdown.setValue(component.value);

		const selectEl = dropdown.selectEl;
		if (component.name) selectEl.setAttribute('name', component.name);
	}

	private renderSwitch(parent: HTMLElement, component: A2UISwitch) {
		parent.style.flexDirection = 'row';
		parent.style.alignItems = 'center';
		parent.style.gap = '0.5rem';

		// Render label BEFORE toggle as requested in review
		if (component.label) {
			parent.createSpan({ text: component.label });
		}

		const toggle = new ToggleComponent(parent);
		if (component.checked) toggle.setValue(component.checked);
	}

	private renderImage(parent: HTMLElement, component: A2UIImage) {
		const src = component.src;
		// Validate Source - reject only explicit external schemes
		// Allow vault-relative paths, app://, data:
		// Logic: If it contains '://' or starts with '//', it must be a whitelisted scheme (app, data)
		// Otherwise (no scheme), assume it is a local path
		const isExternal = src.includes('://') || src.startsWith('//');
		const isSafeScheme = src.startsWith('app://') || src.startsWith('data:');

		if (isExternal && !isSafeScheme) {
			parent.createDiv({ text: 'External images not allowed', cls: 'a2ui-error' });
			return;
		}

		const img = parent.createEl('img', {
			attr: {
				src: src,
				alt: component.alt || '',
			},
		});

		if (component.width) img.style.width = component.width;
		if (component.height) img.style.height = component.height;
	}

	private renderIcon(parent: HTMLElement, component: A2UIIcon) {
		const iconSpan = parent.createSpan({ cls: 'a2ui-icon-span' });
		setIcon(iconSpan, component.name || 'help-circle');

		if (component.size) {
			iconSpan.style.width = component.size;
			iconSpan.style.height = component.size;
			iconSpan.style.display = 'inline-block';
		}
	}

	private async renderMermaid(parent: HTMLElement, component: A2UIMermaid) {
		// Sanitize mermaid content (basic prevention of breaking out of code block)
		const cleanContent = (component.content || '').replace(/```/g, "'''");
		const mermaidBlock = '```mermaid\n' + cleanContent + '\n```';

		await MarkdownRenderer.render(this.app, mermaidBlock, parent, this.sourcePath, this);
	}
}
