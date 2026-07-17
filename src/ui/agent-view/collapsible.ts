import { setIcon } from 'obsidian';

/** Elements that make up one collapsible section (a tool group, tool row, or reasoning row). */
export interface CollapsibleRefs {
	/** The clickable header; `aria-expanded` lives here and is the source of truth. */
	control: HTMLElement;
	/** The collapsible content shown/hidden. */
	body: HTMLElement;
	/** The chevron icon span, swapped between right/down. */
	chevron: HTMLElement;
	/** The element that carries the `*-expanded` class. */
	host: HTMLElement;
	/** e.g. `gemini-tool-group-expanded` / `gemini-tool-row-expanded`. */
	expandedClass: string;
}

/** Apply the expanded/collapsed visual state to a collapsible section. */
export function setCollapsibleExpanded(refs: CollapsibleRefs, expanded: boolean): void {
	refs.body.style.display = expanded ? 'block' : 'none';
	setIcon(refs.chevron, expanded ? 'chevron-down' : 'chevron-right');
	refs.host.toggleClass(refs.expandedClass, expanded);
	refs.control.setAttribute('aria-expanded', String(expanded));
}

/**
 * Wire a header so click / Enter / Space toggles its collapsible body. State is
 * derived from `aria-expanded` so programmatic expansion (auto-expand on error)
 * and user toggling stay in sync.
 */
export function wireCollapsibleToggle(refs: CollapsibleRefs): void {
	const toggle = () => setCollapsibleExpanded(refs, refs.control.getAttribute('aria-expanded') !== 'true');
	refs.control.addEventListener('click', toggle);
	refs.control.addEventListener('keydown', (e: KeyboardEvent) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			toggle();
		}
	});
}
