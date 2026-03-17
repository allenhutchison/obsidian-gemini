import { SkillSummary } from './skill-manager';

// Import bundled skill SKILL.md files
import helpSkillMd from '../../prompts/bundled-skills/gemini-scribe-help/SKILL.md';
import basesSkillMd from '../../prompts/bundled-skills/obsidian-bases/SKILL.md';

// Import help skill references
import refGettingStarted from '../../prompts/bundled-skills/gemini-scribe-help/references/getting-started.md';
import refAgentMode from '../../prompts/bundled-skills/gemini-scribe-help/references/agent-mode.md';
import refAgentSkills from '../../prompts/bundled-skills/gemini-scribe-help/references/agent-skills.md';
import refContextSystem from '../../prompts/bundled-skills/gemini-scribe-help/references/context-system.md';
import refCustomPrompts from '../../prompts/bundled-skills/gemini-scribe-help/references/custom-prompts.md';
import refCompletions from '../../prompts/bundled-skills/gemini-scribe-help/references/completions.md';
import refSummarization from '../../prompts/bundled-skills/gemini-scribe-help/references/summarization.md';
import refAiWriting from '../../prompts/bundled-skills/gemini-scribe-help/references/ai-writing.md';
import refDeepResearch from '../../prompts/bundled-skills/gemini-scribe-help/references/deep-research.md';
import refMcpServers from '../../prompts/bundled-skills/gemini-scribe-help/references/mcp-servers.md';
import refSemanticSearch from '../../prompts/bundled-skills/gemini-scribe-help/references/semantic-search.md';
import refSettings from '../../prompts/bundled-skills/gemini-scribe-help/references/settings.md';
import refAdvancedSettings from '../../prompts/bundled-skills/gemini-scribe-help/references/advanced-settings.md';
import refFaq from '../../prompts/bundled-skills/gemini-scribe-help/references/faq.md';

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

// Register gemini-scribe-help
const helpResources = new Map<string, string>([
	['references/getting-started.md', refGettingStarted],
	['references/agent-mode.md', refAgentMode],
	['references/agent-skills.md', refAgentSkills],
	['references/context-system.md', refContextSystem],
	['references/custom-prompts.md', refCustomPrompts],
	['references/completions.md', refCompletions],
	['references/summarization.md', refSummarization],
	['references/ai-writing.md', refAiWriting],
	['references/deep-research.md', refDeepResearch],
	['references/mcp-servers.md', refMcpServers],
	['references/semantic-search.md', refSemanticSearch],
	['references/settings.md', refSettings],
	['references/advanced-settings.md', refAdvancedSettings],
	['references/faq.md', refFaq],
]);

skills.set('gemini-scribe-help', {
	name: 'gemini-scribe-help',
	description: parseDescription(helpSkillMd),
	content: stripFrontmatter(helpSkillMd),
	resources: helpResources,
});

// Register obsidian-bases
skills.set('obsidian-bases', {
	name: 'obsidian-bases',
	description: parseDescription(basesSkillMd),
	content: stripFrontmatter(basesSkillMd),
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
