export type A2UIComponentType =
	| 'container'
	| 'text'
	| 'button'
	| 'input'
	| 'select'
	| 'switch'
	| 'image'
	| 'icon'
	| 'mermaid';

export interface A2UIBaseComponent {
	id?: string;
	type: A2UIComponentType;
	style?: Record<string, string>; // Inline styles
	cls?: string; // CSS classes
}

export interface A2UIContainer extends A2UIBaseComponent {
	type: 'container';
	direction?: 'row' | 'column';
	children: A2UIComponent[];
	gap?: string;
	align?: 'start' | 'center' | 'end' | 'stretch';
	justify?: 'start' | 'center' | 'end' | 'space-between';
	wrap?: boolean;
}

export interface A2UIText extends A2UIBaseComponent {
	type: 'text';
	content: string; // Markdown supported
	variant?: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'p' | 'span' | 'code';
}

export interface A2UIButton extends A2UIBaseComponent {
	type: 'button';
	label: string;
	variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
	icon?: string; // Lucide icon name
	action?: string; // Command ID or internal action
	payload?: any; // Data to send with the action
	disabled?: boolean;
}

export interface A2UIInput extends A2UIBaseComponent {
	type: 'input';
	label?: string;
	placeholder?: string;
	value?: string;
	inputType?: 'text' | 'number' | 'password' | 'email';
	required?: boolean;
	name: string; // Required for form data
}

export interface A2UISelect extends A2UIBaseComponent {
	type: 'select';
	label?: string;
	options: { label: string; value: string }[];
	value?: string;
	name: string;
}

export interface A2UISwitch extends A2UIBaseComponent {
	type: 'switch';
	label: string;
	checked?: boolean;
	name: string;
}

export interface A2UIImage extends A2UIBaseComponent {
	type: 'image';
	src: string;
	alt?: string;
	width?: string;
	height?: string;
}

export interface A2UIIcon extends A2UIBaseComponent {
	type: 'icon';
	name: string; // Lucide icon name
	size?: string;
}

export interface A2UIMermaid extends A2UIBaseComponent {
	type: 'mermaid';
	content: string; // Mermaid diagram definition
}

export type A2UIComponent =
	| A2UIContainer
	| A2UIText
	| A2UIButton
	| A2UIInput
	| A2UISelect
	| A2UISwitch
	| A2UIImage
	| A2UIIcon
	| A2UIMermaid;

export interface A2UIResponse {
	title?: string;
	root: A2UIComponent;
}
