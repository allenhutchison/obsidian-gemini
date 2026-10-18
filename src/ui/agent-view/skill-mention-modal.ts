import { App, FuzzySuggestModal } from 'obsidian';
import type { SkillSummary } from '../../services/skill-types';
import { t } from '../../i18n';

/**
 * Format the literal slash-command token inserted into the agent input when a
 * skill is picked, e.g. `code-review` → `/code-review `. The trailing space
 * places the cursor ready for the user to type free-form instructions (or send
 * as-is). This token is model-facing and persisted verbatim, so it stays English
 * and must match the `/skill-name` convention documented in the system prompt
 * (`prompts/toolCatalogPrompt.hbs`).
 */
export function formatSkillTrigger(name: string): string {
	return `/${name} `;
}

/**
 * Put a skill's trigger token at the very start of the agent input, ahead of
 * anything already typed. The send-bar skill button (#1661) uses this instead
 * of inserting at the caret: the model only honors `/skill-name` at the start
 * of the message, and the caret may be mid-sentence (or outside the input)
 * when the button is tapped.
 */
export function prependSkillTrigger(input: HTMLElement, name: string): void {
	input.prepend(formatSkillTrigger(name));
}

export class SkillMentionModal extends FuzzySuggestModal<SkillSummary> {
	private onSelect: (skill: SkillSummary) => void;
	private skills: SkillSummary[];

	constructor(app: App, onSelect: (skill: SkillSummary) => void, skills: SkillSummary[]) {
		super(app);
		this.onSelect = onSelect;
		this.skills = skills;
		this.setPlaceholder(t('agent.skillMention.placeholder'));
	}

	getItems(): SkillSummary[] {
		return this.skills;
	}

	getItemText(skill: SkillSummary): string {
		return `${skill.name} — ${skill.description}`;
	}

	onChooseItem(skill: SkillSummary, _evt: MouseEvent | KeyboardEvent): void {
		this.onSelect(skill);
	}
}
