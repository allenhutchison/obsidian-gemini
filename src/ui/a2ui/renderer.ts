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

	constructor(
		app: App,
		containerEl: HTMLElement,
		uiRoot: A2UIComponent,
		sourcePath: string
	) {
		super(containerEl);
		this.app = app;
		this.uiRoot = uiRoot;
		this.sourcePath = sourcePath;
	}

	onload() {
		this.render(this.containerEl, this.uiRoot);
	}

	private async render(parent: HTMLElement, component: A2UIComponent) {
		const wrapper = parent.createDiv({ cls: `a2ui-component a2ui-${component.type}` });
		if (component.style) {
			Object.assign(wrapper.style, component.style);
		}
		if (component.cls) {
			wrapper.addClass(component.cls);
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
		// Markdown rendering handles basic HTML tags based on the content,
		// but we can wrap it if variant is specific.
		// However, MarkdownRenderer.render clears the container.
		// So we create a child div for the content.
		const contentDiv = parent.createDiv({ cls: 'a2ui-markdown-content' });

		// Apply variant styling (simplified mapping to classes or styles)
		if (component.variant) {
			contentDiv.addClass(`a2ui-text-${component.variant}`);
			// Add basic typography styles if needed
			if (component.variant.startsWith('h')) {
				contentDiv.style.fontWeight = 'bold';
				// Adjust font size relative to variant if desired
			}
		}

		await MarkdownRenderer.render(
			this.app,
			component.content || '',
			contentDiv,
			this.sourcePath,
			this
		);
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
				// Dispatch event that the plugin main logic can listen for
				// We bubble it up to the document or a known container
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
		// Switches often need a label next to them
		parent.style.flexDirection = 'row';
		parent.style.alignItems = 'center';
		parent.style.gap = '0.5rem';

		const toggle = new ToggleComponent(parent);
		if (component.checked) toggle.setValue(component.checked);

		if (component.label) {
			parent.createSpan({ text: component.label });
		}
	}

	private renderImage(parent: HTMLElement, component: A2UIImage) {
		const img = parent.createEl('img', {
			attr: {
				src: component.src,
				alt: component.alt || '',
			},
		});

		// Basic sizing
		if (component.width) img.style.width = component.width;
		if (component.height) img.style.height = component.height;
	}

	private renderIcon(parent: HTMLElement, component: A2UIIcon) {
		// setIcon requires an HTMLElement
		const iconSpan = parent.createSpan({ cls: 'a2ui-icon-span' });
		setIcon(iconSpan, component.name || 'help-circle');

		if (component.size) {
			// Lucide icons are SVGs, we scale the container or the svg
			// Obsidian's setIcon puts an SVG inside.
			// CSS can target svg
			iconSpan.style.width = component.size;
			iconSpan.style.height = component.size;
			iconSpan.style.display = 'inline-block';
		}
	}

	private async renderMermaid(parent: HTMLElement, component: A2UIMermaid) {
		// Render mermaid via standard Markdown code block logic
		const mermaidBlock = '```mermaid\n' + (component.content || '') + '\n```';

		await MarkdownRenderer.render(
			this.app,
			mermaidBlock,
			parent,
			this.sourcePath,
			this
		);
	}
}
