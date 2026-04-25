import type { Mock } from 'vitest';
import { SkillMentionModal } from '../../src/ui/agent-view/skill-mention-modal';
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
