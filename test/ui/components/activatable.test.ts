import { describe, it, expect, vi } from 'vitest';
import { wireActivation } from '../../../src/ui/components/activatable';

function key(el: HTMLElement, k: string): KeyboardEvent {
	const e = new KeyboardEvent('keydown', { key: k, cancelable: true });
	el.dispatchEvent(e);
	return e;
}

describe('wireActivation (#1800)', () => {
	it('activates on click, Enter and Space, preventing the key default', () => {
		const el = document.createElement('div');
		const activate = vi.fn();
		wireActivation(el, activate);

		el.click();
		const enter = key(el, 'Enter');
		const space = key(el, ' ');

		expect(activate).toHaveBeenCalledTimes(3);
		expect(enter.defaultPrevented).toBe(true);
		expect(space.defaultPrevented).toBe(true);
	});

	it('ignores other keys and leaves their default alone', () => {
		const el = document.createElement('div');
		const activate = vi.fn();
		wireActivation(el, activate);

		const tab = key(el, 'Tab');
		key(el, 'a');

		expect(activate).not.toHaveBeenCalled();
		expect(tab.defaultPrevented).toBe(false);
	});

	it('does nothing, and keeps the key default, while shouldActivate is false', () => {
		const el = document.createElement('div');
		const activate = vi.fn();
		let ready = false;
		wireActivation(el, activate, { shouldActivate: () => ready });

		el.click();
		const blocked = key(el, 'Enter');
		expect(activate).not.toHaveBeenCalled();
		expect(blocked.defaultPrevented).toBe(false);

		ready = true;
		el.click();
		key(el, ' ');
		expect(activate).toHaveBeenCalledTimes(2);
	});
});
