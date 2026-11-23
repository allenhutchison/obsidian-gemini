/**
 * Click + keyboard activation for a `role="button"` / `role="tab"` element
 * (#1800): the one owner of the Enter/Space policy, so a fix to it lands
 * everywhere. Markup and ARIA stay with the caller; this only wires listeners.
 */
export interface ActivationOptions {
	/** When given, a click or key press only activates while this returns true. */
	shouldActivate?: () => boolean;
}

/** True for the keys that activate a button-like element. */
function isActivationKey(e: KeyboardEvent): boolean {
	return e.key === 'Enter' || e.key === ' ';
}

/**
 * Run `activate` on click and on Enter/Space. The key press's default
 * (scrolling on Space, form submit on Enter) is prevented only when the
 * element actually activates.
 */
export function wireActivation(el: HTMLElement, activate: () => void, opts: ActivationOptions = {}): void {
	const allowed = () => opts.shouldActivate?.() ?? true;
	el.addEventListener('click', () => {
		if (allowed()) activate();
	});
	el.addEventListener('keydown', (e: KeyboardEvent) => {
		if (!isActivationKey(e) || !allowed()) return;
		e.preventDefault();
		activate();
	});
}
