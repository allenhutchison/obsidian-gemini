import { App, FuzzySuggestModal } from 'obsidian';
import type { SkillSummary } from '../../services/skill-manager';
import { t } from '../../i18n';

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
