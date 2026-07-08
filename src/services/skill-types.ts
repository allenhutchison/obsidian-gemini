/**
 * Skill metadata shared by SkillManager and BundledSkillRegistry. Lives in a
 * leaf module so bundled-skills.ts doesn't have to import skill-manager.ts
 * back (which would create an import cycle — see #1155). skill-manager.ts
 * re-exports it, so existing import paths keep working.
 */
export interface SkillSummary {
	name: string;
	description: string;
}
