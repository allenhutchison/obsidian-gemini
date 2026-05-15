// Mock the .md imports BEFORE importing the module
vi.mock('../../prompts/bundled-prompts/explain-selection.md', () => ({
	default: `---
name: "Explain Selection"
description: "Explain the selected text"
tags: ["explain", "selection"]
---

Explain the following selected text in detail.`,
}));

vi.mock('../../prompts/bundled-prompts/explain-code.md', () => ({
	default: `---
name: Explain Code
description: Explain code snippets
tags: ["code", "explain"]
---

Explain the following code.`,
}));

vi.mock('../../prompts/bundled-prompts/summarize-selection.md', () => ({
	default: `---
name: 'Summarize Selection'
description: 'Create a summary'
tags: ["summary"]
---

Summarize the following text.`,
}));

vi.mock('../../prompts/bundled-prompts/fix-grammar.md', () => ({
	default: `---
name: Fix Grammar
description: Fix grammar issues
tags: ["grammar", "fix"]
---

Fix the grammar in the following text.`,
}));

vi.mock('../../prompts/bundled-prompts/convert-to-bullets.md', () => ({
	default: `---
name: Convert to Bullets
description: Convert text to bullet points
tags: ["bullets", "convert"]
---

Convert the following text to bullet points.`,
}));

// Import after mocks
import { BundledPromptRegistry } from '../../src/prompts/bundled-prompts';

describe('BundledPromptRegistry', () => {
	describe('stripFrontmatter (via registered prompts)', () => {
		it('should strip YAML frontmatter from prompt content', () => {
			const prompt = BundledPromptRegistry.getPrompt('explain-selection');
			expect(prompt).not.toBeNull();
			expect(prompt!.content).not.toContain('---');
			expect(prompt!.content).toContain('Explain the following selected text');
		});

		it('should trim whitespace after stripping frontmatter', () => {
			const prompt = BundledPromptRegistry.getPrompt('explain-selection');
			expect(prompt).not.toBeNull();
			// Content should not start with whitespace
			expect(prompt!.content).toBe(prompt!.content.trim());
		});
	});

	describe('parseProperty (via registered prompts)', () => {
		it('should parse double-quoted name property', () => {
			const prompt = BundledPromptRegistry.getPrompt('explain-selection');
			expect(prompt).not.toBeNull();
			expect(prompt!.name).toBe('Explain Selection');
		});

		it('should parse unquoted name property', () => {
			const prompt = BundledPromptRegistry.getPrompt('explain-code');
			expect(prompt).not.toBeNull();
			expect(prompt!.name).toBe('Explain Code');
		});

		it('should parse single-quoted name property', () => {
			const prompt = BundledPromptRegistry.getPrompt('summarize-selection');
			expect(prompt).not.toBeNull();
			expect(prompt!.name).toBe('Summarize Selection');
		});

		it('should parse description property', () => {
			const prompt = BundledPromptRegistry.getPrompt('explain-selection');
			expect(prompt).not.toBeNull();
			expect(prompt!.description).toBe('Explain the selected text');
		});
	});

	describe('parseTags (via registered prompts)', () => {
		it('should parse tags array from frontmatter', () => {
			const prompt = BundledPromptRegistry.getPrompt('explain-selection');
			expect(prompt).not.toBeNull();
			expect(prompt!.tags).toEqual(['explain', 'selection']);
		});

		it('should parse single tag', () => {
			const prompt = BundledPromptRegistry.getPrompt('summarize-selection');
			expect(prompt).not.toBeNull();
			expect(prompt!.tags).toEqual(['summary']);
		});

		it('should parse multiple tags', () => {
			const prompt = BundledPromptRegistry.getPrompt('fix-grammar');
			expect(prompt).not.toBeNull();
			expect(prompt!.tags).toEqual(['grammar', 'fix']);
		});
	});

	describe('getPrompts', () => {
		it('should return all registered prompts', () => {
			const prompts = BundledPromptRegistry.getPrompts();
			expect(prompts.length).toBe(5);
		});

		it('should return prompts with all required fields', () => {
			const prompts = BundledPromptRegistry.getPrompts();
			for (const prompt of prompts) {
				expect(prompt.name).toBeTruthy();
				expect(prompt.description).toBeTruthy();
				expect(prompt.content).toBeTruthy();
				expect(Array.isArray(prompt.tags)).toBe(true);
			}
		});
	});

	describe('getPrompt', () => {
		it('should return prompt by ID', () => {
			const prompt = BundledPromptRegistry.getPrompt('explain-selection');
			expect(prompt).not.toBeNull();
			expect(prompt!.name).toBe('Explain Selection');
		});

		it('should return null for unknown ID', () => {
			expect(BundledPromptRegistry.getPrompt('nonexistent')).toBeNull();
		});
	});

	describe('has', () => {
		it('should return true for registered prompts', () => {
			expect(BundledPromptRegistry.has('explain-selection')).toBe(true);
			expect(BundledPromptRegistry.has('explain-code')).toBe(true);
			expect(BundledPromptRegistry.has('summarize-selection')).toBe(true);
			expect(BundledPromptRegistry.has('fix-grammar')).toBe(true);
			expect(BundledPromptRegistry.has('convert-to-bullets')).toBe(true);
		});

		it('should return false for unknown IDs', () => {
			expect(BundledPromptRegistry.has('nonexistent')).toBe(false);
		});
	});
});
