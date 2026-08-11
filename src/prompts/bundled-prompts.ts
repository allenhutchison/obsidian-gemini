// Import bundled prompt files
import explainSelectionMd from '../../prompts/bundled-prompts/explain-selection.md';
import explainCodeMd from '../../prompts/bundled-prompts/explain-code.md';
import summarizeSelectionMd from '../../prompts/bundled-prompts/summarize-selection.md';
import fixGrammarMd from '../../prompts/bundled-prompts/fix-grammar.md';
import convertToBulletsMd from '../../prompts/bundled-prompts/convert-to-bullets.md';

import { parseFrontmatterList, parseFrontmatterProperty, stripFrontmatter } from '../utils/bundled-frontmatter';

interface BundledPrompt {
	name: string;
	description: string;
	content: string;
	tags: string[];
}

const prompts: Map<string, BundledPrompt> = new Map();

function registerPrompt(id: string, content: string) {
	prompts.set(id, {
		name: parseFrontmatterProperty(content, 'name') || id,
		description: parseFrontmatterProperty(content, 'description'),
		content: stripFrontmatter(content),
		tags: parseFrontmatterList(content, 'tags'),
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
