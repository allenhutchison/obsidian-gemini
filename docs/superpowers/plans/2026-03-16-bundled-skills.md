# Bundled Skills Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship built-in skills (gemini-scribe-help, obsidian-bases) with the plugin so the agent can answer questions about itself and guide Obsidian Bases usage.

**Architecture:** Build-time text imports of SKILL.md and reference files via esbuild. A static `BundledSkillRegistry` serves content to `SkillManager`, which merges bundled and vault skills with vault taking priority.

**Tech Stack:** TypeScript, esbuild text loader, Jest

**Spec:** `docs/superpowers/specs/2026-03-16-bundled-skills-design.md`

---

## File Structure

| Action | File                                                        | Responsibility                                       |
| ------ | ----------------------------------------------------------- | ---------------------------------------------------- |
| Create | `src/services/bundled-skills.ts`                            | Static registry of build-time imported skill content |
| Create | `test/services/bundled-skills.test.ts`                      | Unit tests for the registry                          |
| Modify | `src/services/skill-manager.ts`                             | Merge vault + bundled skills, fallback logic         |
| Modify | `test/services/skill-manager.test.ts`                       | Tests for merge/fallback behavior                    |
| Modify | `esbuild.config.mjs`                                        | Add `.md` to loader config                           |
| Create | `prompts/bundled-skills/gemini-scribe-help/SKILL.md`        | Help skill routing instructions                      |
| Create | `prompts/bundled-skills/gemini-scribe-help/references/*.md` | Doc files (copied from docs/)                        |
| Create | `prompts/bundled-skills/obsidian-bases/SKILL.md`            | Bases syntax and usage guide                         |

---

## Chunk 1: Build Infrastructure + Bundled Skill Registry

### Task 1: Add .md loader to esbuild config

**Files:**

- Modify: `esbuild.config.mjs:65-68`

- [ ] **Step 1: Add .md to the loader config**

In `esbuild.config.mjs`, add `'.md': 'text'` to the `loader` object:

```javascript
loader: {
    '.hbs': 'text',
    '.json': 'json',
    '.md': 'text',
},
```

- [ ] **Step 2: Verify build still works**

Run: `npm run build`
Expected: Clean build with no errors.

- [ ] **Step 3: Commit**

```bash
git add esbuild.config.mjs
git commit -m "chore: Add .md text loader to esbuild config"
```

---

### Task 2: Create BundledSkillRegistry with tests (TDD)

**Files:**

- Create: `src/services/bundled-skills.ts`
- Create: `test/services/bundled-skills.test.ts`

- [ ] **Step 1: Write failing tests for BundledSkillRegistry**

Create `test/services/bundled-skills.test.ts`:

```typescript
import { BundledSkillRegistry } from '../../src/services/bundled-skills';

describe('BundledSkillRegistry', () => {
	describe('getSummaries', () => {
		it('should return summaries for all bundled skills', () => {
			const summaries = BundledSkillRegistry.getSummaries();
			expect(summaries.length).toBeGreaterThan(0);
			for (const summary of summaries) {
				expect(summary.name).toBeTruthy();
				expect(summary.description).toBeTruthy();
			}
		});

		it('should include gemini-scribe-help skill', () => {
			const summaries = BundledSkillRegistry.getSummaries();
			const help = summaries.find((s) => s.name === 'gemini-scribe-help');
			expect(help).toBeDefined();
			expect(help!.description).toBeTruthy();
		});

		it('should include obsidian-bases skill', () => {
			const summaries = BundledSkillRegistry.getSummaries();
			const bases = summaries.find((s) => s.name === 'obsidian-bases');
			expect(bases).toBeDefined();
			expect(bases!.description).toBeTruthy();
		});
	});

	describe('loadSkill', () => {
		it('should return body content for gemini-scribe-help', () => {
			const content = BundledSkillRegistry.loadSkill('gemini-scribe-help');
			expect(content).not.toBeNull();
			expect(content).toContain('Gemini Scribe');
		});

		it('should return body content for obsidian-bases', () => {
			const content = BundledSkillRegistry.loadSkill('obsidian-bases');
			expect(content).not.toBeNull();
			expect(content).toContain('Bases');
		});

		it('should return null for unknown skill', () => {
			expect(BundledSkillRegistry.loadSkill('nonexistent')).toBeNull();
		});
	});

	describe('readResource', () => {
		it('should return content for a valid help skill reference', () => {
			const content = BundledSkillRegistry.readResource('gemini-scribe-help', 'references/agent-mode.md');
			expect(content).not.toBeNull();
			expect(content!.length).toBeGreaterThan(0);
		});

		it('should return null for unknown resource', () => {
			expect(BundledSkillRegistry.readResource('gemini-scribe-help', 'references/nonexistent.md')).toBeNull();
		});

		it('should return null for unknown skill', () => {
			expect(BundledSkillRegistry.readResource('nonexistent', 'references/foo.md')).toBeNull();
		});
	});

	describe('listResources', () => {
		it('should list references for gemini-scribe-help', () => {
			const resources = BundledSkillRegistry.listResources('gemini-scribe-help');
			expect(resources.length).toBeGreaterThan(0);
			expect(resources).toContain('references/agent-mode.md');
			expect(resources).toContain('references/settings.md');
		});

		it('should return empty array for skill with no resources', () => {
			const resources = BundledSkillRegistry.listResources('obsidian-bases');
			expect(resources).toEqual([]);
		});

		it('should return empty array for unknown skill', () => {
			expect(BundledSkillRegistry.listResources('nonexistent')).toEqual([]);
		});
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/services/bundled-skills.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the bundled skill content files**

Create `prompts/bundled-skills/gemini-scribe-help/SKILL.md` with a concise routing guide that lists available references and tells the agent how to use them.

Create `prompts/bundled-skills/gemini-scribe-help/references/` and copy the doc files from `docs/guide/` and `docs/reference/` (the files listed in the spec: getting-started.md, agent-mode.md, agent-skills.md, context-system.md, custom-prompts.md, completions.md, summarization.md, ai-writing.md, deep-research.md, mcp-servers.md, semantic-search.md, settings.md, advanced-settings.md, faq.md).

Create `prompts/bundled-skills/obsidian-bases/SKILL.md` with Obsidian Bases syntax, property types, views, and formulas. Research the current Bases documentation at https://help.obsidian.md/bases to write this accurately.

- [ ] **Step 4: Implement BundledSkillRegistry**

Create `src/services/bundled-skills.ts`:

```typescript
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
```

Note: The `.md` imports require a TypeScript declaration. Add to `src/types/text-imports.d.ts` (or an existing declarations file):

```typescript
declare module '*.md' {
	const content: string;
	export default content;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- test/services/bundled-skills.test.ts`
Expected: All tests PASS.

- [ ] **Step 6: Run full build and test suite**

Run: `npm run build && npm test`
Expected: Clean build, all tests pass.

- [ ] **Step 7: Commit**

```bash
git add esbuild.config.mjs src/services/bundled-skills.ts test/services/bundled-skills.test.ts prompts/bundled-skills/ src/types/
git commit -m "feat: Add BundledSkillRegistry with gemini-scribe-help and obsidian-bases skills"
```

---

## Chunk 2: SkillManager Integration

### Task 3: Modify SkillManager to merge bundled skills (TDD)

**Files:**

- Modify: `src/services/skill-manager.ts`
- Modify: `test/services/skill-manager.test.ts`

- [ ] **Step 1: Write failing tests for bundled skill integration**

Add to `test/services/skill-manager.test.ts`, inside the top-level `describe('SkillManager')` block:

```typescript
// Add mock for BundledSkillRegistry at top of file, after other imports
jest.mock('../../src/services/bundled-skills', () => ({
	BundledSkillRegistry: {
		getSummaries: jest.fn().mockReturnValue([
			{ name: 'gemini-scribe-help', description: 'Help with plugin features' },
			{ name: 'obsidian-bases', description: 'Create Obsidian Bases' },
		]),
		loadSkill: jest.fn().mockImplementation((name: string) => {
			if (name === 'gemini-scribe-help') return '# Help\n\nInstructions';
			if (name === 'obsidian-bases') return '# Bases\n\nSyntax guide';
			return null;
		}),
		readResource: jest.fn().mockImplementation((name: string, path: string) => {
			if (name === 'gemini-scribe-help' && path === 'references/agent-mode.md') return 'Agent mode docs';
			return null;
		}),
		listResources: jest.fn().mockImplementation((name: string) => {
			if (name === 'gemini-scribe-help') return ['references/agent-mode.md', 'references/settings.md'];
			return [];
		}),
		has: jest.fn().mockImplementation((name: string) => {
			return name === 'gemini-scribe-help' || name === 'obsidian-bases';
		}),
	},
}));

// Add these test blocks inside the existing describe('SkillManager') block:

describe('bundled skill integration', () => {
	describe('discoverSkills', () => {
		it('should include bundled skills when no vault skills exist', async () => {
			mockVault.getAbstractFileByPath.mockReturnValue(null);

			const skills = await manager.discoverSkills();

			expect(skills).toHaveLength(2);
			expect(skills.map((s) => s.name)).toContain('gemini-scribe-help');
			expect(skills.map((s) => s.name)).toContain('obsidian-bases');
		});

		it('should let vault skills override bundled skills with same name', async () => {
			const skillFile = new TFile('gemini-scribe/skills/gemini-scribe-help/SKILL.md');
			const skillFolder = new TFolder('gemini-scribe/skills/gemini-scribe-help', [skillFile]);
			const skillsRoot = new TFolder('gemini-scribe/skills', [skillFolder]);

			mockVault.getAbstractFileByPath.mockImplementation((path: string) => {
				if (path === 'gemini-scribe/skills') return skillsRoot;
				if (path === 'gemini-scribe/skills/gemini-scribe-help/SKILL.md') return skillFile;
				return null;
			});

			mockMetadataCache.getFileCache.mockReturnValue({
				frontmatter: {
					name: 'gemini-scribe-help',
					description: 'My custom help',
				},
			});

			const skills = await manager.discoverSkills();

			const helpSkill = skills.find((s) => s.name === 'gemini-scribe-help');
			expect(helpSkill).toBeDefined();
			expect(helpSkill!.description).toBe('My custom help');

			// obsidian-bases should still come from bundled
			expect(skills.map((s) => s.name)).toContain('obsidian-bases');
		});
	});

	describe('loadSkill', () => {
		it('should fall back to bundled skill when vault skill not found', async () => {
			mockVault.getAbstractFileByPath.mockReturnValue(null);

			const content = await manager.loadSkill('gemini-scribe-help');

			expect(content).toBe('# Help\n\nInstructions');
		});

		it('should prefer vault skill over bundled skill', async () => {
			const file = new TFile('gemini-scribe/skills/gemini-scribe-help/SKILL.md');
			mockVault.getAbstractFileByPath.mockReturnValue(file);
			mockVault.read.mockResolvedValue('---\nname: gemini-scribe-help\n---\n\n# Custom Help');
			mockMetadataCache.getFileCache.mockReturnValue({
				frontmatterPosition: { end: { offset: 35 } },
			});

			const content = await manager.loadSkill('gemini-scribe-help');

			expect(content).toBe('# Custom Help');
		});
	});

	describe('readSkillResource', () => {
		it('should fall back to bundled resource when vault resource not found', async () => {
			mockVault.getAbstractFileByPath.mockReturnValue(null);

			const content = await manager.readSkillResource('gemini-scribe-help', 'references/agent-mode.md');

			expect(content).toBe('Agent mode docs');
		});
	});

	describe('listSkillResources', () => {
		it('should fall back to bundled resources when vault skill not found', async () => {
			mockVault.getAbstractFileByPath.mockReturnValue(null);

			const resources = await manager.listSkillResources('gemini-scribe-help');

			expect(resources).toContain('references/agent-mode.md');
			expect(resources).toContain('references/settings.md');
		});
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/services/skill-manager.test.ts`
Expected: FAIL — bundled skills not merged yet.

- [ ] **Step 3: Modify SkillManager to integrate bundled skills**

In `src/services/skill-manager.ts`, add the import at the top:

```typescript
import { BundledSkillRegistry } from './bundled-skills';
```

Modify `discoverSkills()` — after the existing vault discovery loop, before the return, add:

```typescript
// Merge bundled skills (vault takes priority)
const vaultNames = new Set(skills.map((s) => s.name));
for (const summary of BundledSkillRegistry.getSummaries()) {
	if (!vaultNames.has(summary.name)) {
		skills.push({
			name: summary.name,
			description: summary.description,
			path: 'bundled',
		});
	}
}
```

Modify `loadSkill()` — after the existing `return fullContent;` at the end, the method currently returns `fullContent`. Change it so that when the vault file is not found, we fall back:

Replace the early `return null` (when file not found) with a bundled fallback:

```typescript
if (!(file instanceof TFile)) {
	return BundledSkillRegistry.loadSkill(name);
}
```

Modify `readSkillResource()` — after the vault file check, fall back:

```typescript
if (!(file instanceof TFile)) {
	return BundledSkillRegistry.readResource(skillName, relativePath);
}
```

Modify `listSkillResources()` — after the vault folder check, fall back:

```typescript
if (!(folder instanceof TFolder)) {
	return BundledSkillRegistry.listResources(skillName);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/services/skill-manager.test.ts`
Expected: All tests PASS (both existing and new).

- [ ] **Step 5: Run full build and test suite**

Run: `npm run build && npm test`
Expected: Clean build, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/services/skill-manager.ts test/services/skill-manager.test.ts
git commit -m "feat: Integrate bundled skills into SkillManager with vault-priority fallback"
```

---

## Chunk 3: Skill Content + Documentation

### Task 4: Research and write obsidian-bases skill content

**Files:**

- Create: `prompts/bundled-skills/obsidian-bases/SKILL.md`

This was started in Task 2 Step 3 but may need refinement. Research the Bases documentation at https://help.obsidian.md/bases and ensure the SKILL.md covers:

- What Bases are and when to use them
- How to create a Base from notes with frontmatter properties
- SQL-like filter/sort syntax
- Property types supported
- View types (table, board, etc.)
- Formulas and calculated fields
- Common patterns (task tracking, project management, etc.)

- [ ] **Step 1: Research Bases documentation and write/refine SKILL.md**

- [ ] **Step 2: Verify build still works**

Run: `npm run build`
Expected: Clean build.

- [ ] **Step 3: Commit**

```bash
git add prompts/bundled-skills/obsidian-bases/
git commit -m "feat: Add obsidian-bases bundled skill content"
```

---

### Task 5: Update documentation

**Files:**

- Modify: `docs/guide/agent-skills.md` — mention bundled skills
- Modify: `README.md` — mention bundled skills in feature list if applicable

- [ ] **Step 1: Update agent-skills guide to document bundled skills**

Add a section explaining that the plugin ships with built-in skills, what they are, and that users can override them by creating vault skills with the same name.

- [ ] **Step 2: Update README if bundled skills warrant a feature mention**

- [ ] **Step 3: Run format check**

Run: `npm run format-check`
If it fails: `npm run format`

- [ ] **Step 4: Commit**

```bash
git add docs/ README.md
git commit -m "docs: Document bundled skills in agent-skills guide"
```

---

### Task 6: Final verification

- [ ] **Step 1: Run full pre-flight checks**

```bash
npm run format-check
npm run build
npm test
```

All must pass.

- [ ] **Step 2: Manual smoke test**

Load the plugin in Obsidian. Open agent mode. Ask "how do I use completions?" and verify:

1. The agent sees gemini-scribe-help and obsidian-bases in its available skills
2. It activates gemini-scribe-help and loads the completions reference
3. It provides an accurate answer based on the reference content

Also verify: creating a vault skill named `gemini-scribe-help` overrides the bundled one.
