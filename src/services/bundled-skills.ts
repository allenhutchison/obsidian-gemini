import { SkillSummary } from './skill-manager';

// Import bundled skill SKILL.md files
import helpSkillMd from '../../prompts/bundled-skills/gemini-scribe-help/SKILL.md';
import basesSkillMd from '../../prompts/bundled-skills/obsidian-bases/SKILL.md';
import propertiesSkillMd from '../../prompts/bundled-skills/obsidian-properties/SKILL.md';
import audioTranscriptionSkillMd from '../../prompts/bundled-skills/audio-transcription/SKILL.md';

// Auto-generated help references from docs/ — see scripts/generate-help-references.mjs
import { helpResources, helpReferencesTable } from './generated-help-references';

interface BundledSkill {
	name: string;
	description: string;
	content: string;
	resources: Map<string, string>;
}

/**
 * Strip YAML frontmatter from a markdown string, returning only the body.
 */
function stripFrontmatter(md: string): string {
	const match = md.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
	if (match) {
		return md.slice(match[0].length).trim();
	}
	return md.trim();
}

/**
 * Parse the description from YAML frontmatter.
 * Simple parser — looks for `description: ...` line.
 */
function parseDescription(md: string): string {
	const match = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (!match) return '';
	const frontmatter = match[1];
	const descMatch = frontmatter.match(/^description:\s*(.+)$/m);
	return descMatch ? descMatch[1].trim() : '';
}

const skills: Map<string, BundledSkill> = new Map();

// Register gemini-scribe-help with auto-generated references table
const helpContent = stripFrontmatter(helpSkillMd).replace('<!-- REFERENCES_TABLE -->', () => helpReferencesTable);

skills.set('gemini-scribe-help', {
	name: 'gemini-scribe-help',
	description: parseDescription(helpSkillMd),
	content: helpContent,
	resources: helpResources,
});

// Register obsidian-bases
skills.set('obsidian-bases', {
	name: 'obsidian-bases',
	description: parseDescription(basesSkillMd),
	content: stripFrontmatter(basesSkillMd),
	resources: new Map(),
});

// Register obsidian-properties
skills.set('obsidian-properties', {
	name: 'obsidian-properties',
	description: parseDescription(propertiesSkillMd),
	content: stripFrontmatter(propertiesSkillMd),
	resources: new Map(),
});

// Register audio-transcription
skills.set('audio-transcription', {
	name: 'audio-transcription',
	description: parseDescription(audioTranscriptionSkillMd),
	content: stripFrontmatter(audioTranscriptionSkillMd),
	resources: new Map(),
});

/**
 * Static registry of skills bundled with the plugin at build time.
 */
export const BundledSkillRegistry = {
	getSummaries(): SkillSummary[] {
		return Array.from(skills.values()).map((s) => ({
			name: s.name,
			description: s.description,
		}));
	},

	loadSkill(name: string): string | null {
		return skills.get(name)?.content ?? null;
	},

	readResource(name: string, path: string): string | null {
		return skills.get(name)?.resources.get(path) ?? null;
	},

	listResources(name: string): string[] {
		const skill = skills.get(name);
		if (!skill) return [];
		return Array.from(skill.resources.keys());
	},

	has(name: string): boolean {
		return skills.has(name);
	},
};
