// Import bundled prompt files
import explainSelectionMd from '../../prompts/bundled-prompts/explain-selection.md';
import explainCodeMd from '../../prompts/bundled-prompts/explain-code.md';
import summarizeSelectionMd from '../../prompts/bundled-prompts/summarize-selection.md';
import fixGrammarMd from '../../prompts/bundled-prompts/fix-grammar.md';
import convertToBulletsMd from '../../prompts/bundled-prompts/convert-to-bullets.md';

interface BundledPrompt {
	name: string;
	description: string;
	content: string;
	tags: string[];
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
 * Parse frontmatter property from YAML.
 * Simple parser — looks for key: ... line.
 */
function parseProperty(md: string, key: string): string {
	const match = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (!match) return '';
	const frontmatter = match[1];
	const propMatch = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
	if (!propMatch) return '';

	const value = propMatch[1].trim();
	// Remove quotes if present
	if (value.startsWith('"') && value.endsWith('"')) {
		return value.slice(1, -1);
	}
	if (value.startsWith("'") && value.endsWith("'")) {
		return value.slice(1, -1);
	}
	return value;
}

/**
 * Parse tags from frontmatter.
 * Expects format: tags: ["tag1", "tag2"]
 */
function parseTags(md: string): string[] {
	const match = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (!match) return [];
	const frontmatter = match[1];
	const tagsMatch = frontmatter.match(/^tags:\s*\[(.*)\]/m);
	if (!tagsMatch) return [];

	return tagsMatch[1]
		.split(',')
		.map((t) => t.trim().replace(/['"]/g, ''))
		.filter((t) => t.length > 0);
}

const prompts: Map<string, BundledPrompt> = new Map();

function registerPrompt(id: string, content: string) {
	prompts.set(id, {
		name: parseProperty(content, 'name') || id,
		description: parseProperty(content, 'description'),
		content: stripFrontmatter(content),
		tags: parseTags(content),
	});
}

registerPrompt('explain-selection', explainSelectionMd);
registerPrompt('explain-code', explainCodeMd);
registerPrompt('summarize-selection', summarizeSelectionMd);
registerPrompt('fix-grammar', fixGrammarMd);
registerPrompt('convert-to-bullets', convertToBulletsMd);

/**
 * Static registry of prompts bundled with the plugin at build time.
 */
export const BundledPromptRegistry = {
	getPrompts(): BundledPrompt[] {
		return Array.from(prompts.values());
	},

	getPrompt(id: string): BundledPrompt | null {
		return prompts.get(id) ?? null;
	},

	has(id: string): boolean {
		return prompts.has(id);
	},
};
