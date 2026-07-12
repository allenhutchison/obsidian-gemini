import type { Mock } from 'vitest';
import { SkillMentionModal, formatSkillTrigger } from '../../src/ui/agent-view/skill-mention-modal';
import { insertTextAtCursor } from '../../src/utils/dom-context';
import type { SkillSummary } from '../../src/services/skill-manager';

vi.mock('obsidian', async () => {
	const original = await vi.importActual<any>('../../__mocks__/obsidian.js');
	// Add setPlaceholder to FuzzySuggestModal mock
	const OriginalFuzzySuggestModal = original.FuzzySuggestModal;
	class FuzzySuggestModal extends OriginalFuzzySuggestModal {
		setPlaceholder(_text: string) {}
	}
	return { ...original, FuzzySuggestModal };
});

describe('SkillMentionModal', () => {
	let onSelect: Mock;
	let skills: SkillSummary[];
	let modal: SkillMentionModal;

	beforeEach(() => {
		onSelect = vi.fn();
		skills = [
			{ name: 'code-review', description: 'Review code for quality' },
			{ name: 'gemini-scribe-help', description: 'Help with plugin usage' },
			{ name: 'audio-transcription', description: 'Transcribe audio files' },
		];
		modal = new SkillMentionModal({} as any, onSelect, skills);
	});

	it('should return all skills from getItems', () => {
		expect(modal.getItems()).toEqual(skills);
	});

	it('should format item text with name and description', () => {
		const text = modal.getItemText(skills[0]);
		expect(text).toBe('code-review — Review code for quality');
	});

	it('should call onSelect when an item is chosen', () => {
		const mockEvt = {} as MouseEvent;
		modal.onChooseItem(skills[1], mockEvt);
		expect(onSelect).toHaveBeenCalledWith(skills[1]);
	});

	it('should handle empty skills list', () => {
		const emptyModal = new SkillMentionModal({} as any, onSelect, []);
		expect(emptyModal.getItems()).toEqual([]);
	});
});

describe('formatSkillTrigger', () => {
	it('formats a skill name as a slash token with a trailing space', () => {
		expect(formatSkillTrigger('code-review')).toBe('/code-review ');
	});
});

// Regression coverage for the picker insertion flow (agent-view.ts showSkillPicker):
// the `/` trigger is stripped, then the token is inserted at the cursor verbatim
// without disturbing surrounding text. showSkillPicker itself wires a modal to an
// AgentView, so this exercises the observable insertion behavior it delegates to
// (removeTrailingTriggerChar + formatSkillTrigger + insertTextAtCursor).
describe('skill-token insertion flow', () => {
	let input: HTMLDivElement;

	beforeEach(() => {
		input = document.createElement('div');
		input.contentEditable = 'true';
		document.body.appendChild(input);
	});

	afterEach(() => {
		document.body.removeChild(input);
		window.getSelection()?.removeAllRanges();
	});

	// Mirror removeTrailingTriggerChar: drop a trailing trigger char at the cursor.
	function stripTrailingTrigger(el: HTMLDivElement, char: string): void {
		const node = el.firstChild;
		if (node?.nodeType === Node.TEXT_NODE) {
			const text = node.textContent || '';
			if (text.endsWith(char)) node.textContent = text.slice(0, -1);
		}
		const range = document.createRange();
		range.selectNodeContents(el);
		range.collapse(false);
		const sel = window.getSelection()!;
		sel.removeAllRanges();
		sel.addRange(range);
	}

	it('replaces the lone `/` trigger with the skill token', () => {
		input.textContent = '/';
		stripTrailingTrigger(input, '/');

		insertTextAtCursor(input, formatSkillTrigger('code-review'));

		expect(input.textContent).toBe('/code-review ');
	});

	it('inserts the token at the cursor without disturbing surrounding text', () => {
		input.textContent = 'note this /';
		stripTrailingTrigger(input, '/');

		insertTextAtCursor(input, formatSkillTrigger('worklog'));

		expect(input.textContent).toBe('note this /worklog ');
	});
});
