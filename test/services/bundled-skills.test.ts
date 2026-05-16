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

		it('should include obsidian-properties skill', () => {
			const summaries = BundledSkillRegistry.getSummaries();
			const props = summaries.find((s) => s.name === 'obsidian-properties');
			expect(props).toBeDefined();
			expect(props!.description).toBeTruthy();
		});

		it('should include audio-transcription skill', () => {
			const summaries = BundledSkillRegistry.getSummaries();
			const audio = summaries.find((s) => s.name === 'audio-transcription');
			expect(audio).toBeDefined();
			expect(audio!.description).toBeTruthy();
		});

		it('should include deep-research skill', () => {
			const summaries = BundledSkillRegistry.getSummaries();
			const skill = summaries.find((s) => s.name === 'deep-research');
			expect(skill).toBeDefined();
			expect(skill!.description).toBeTruthy();
		});

		it('should include image-generation skill', () => {
			const summaries = BundledSkillRegistry.getSummaries();
			const skill = summaries.find((s) => s.name === 'image-generation');
			expect(skill).toBeDefined();
			expect(skill!.description).toBeTruthy();
		});

		it('should include vault-semantic-search skill', () => {
			const summaries = BundledSkillRegistry.getSummaries();
			const skill = summaries.find((s) => s.name === 'vault-semantic-search');
			expect(skill).toBeDefined();
			expect(skill!.description).toBeTruthy();
		});

		it('should include recall-sessions skill', () => {
			const summaries = BundledSkillRegistry.getSummaries();
			const skill = summaries.find((s) => s.name === 'recall-sessions');
			expect(skill).toBeDefined();
			expect(skill!.description).toBeTruthy();
		});
	});

	describe('loadSkill', () => {
		it('should return body content for gemini-scribe-help', () => {
			const content = BundledSkillRegistry.loadSkill('gemini-scribe-help');
			expect(content).not.toBeNull();
			expect(content).toContain('Gemini Scribe');
		});

		it('should inject auto-generated references table into help skill', () => {
			const content = BundledSkillRegistry.loadSkill('gemini-scribe-help');
			expect(content).not.toBeNull();
			// Table should be injected (placeholder replaced)
			expect(content).not.toContain('<!-- REFERENCES_TABLE -->');
			// Should contain actual table rows
			expect(content).toContain('references/agent-mode.md');
			expect(content).toContain('references/settings.md');
		});

		it('should leave the STATE_FOLDER placeholder unresolved for runtime substitution', () => {
			const content = BundledSkillRegistry.loadSkill('gemini-scribe-help');
			expect(content).not.toBeNull();
			// <!-- STATE_FOLDER --> is intentionally NOT replaced at module-load time;
			// SkillManager.loadSkill() fills it with the configured folder at runtime.
			expect(content).toContain('<!-- STATE_FOLDER -->');
		});

		it('should return body content for obsidian-bases', () => {
			const content = BundledSkillRegistry.loadSkill('obsidian-bases');
			expect(content).not.toBeNull();
			expect(content).toContain('Bases');
		});

		it('should return body content for obsidian-properties', () => {
			const content = BundledSkillRegistry.loadSkill('obsidian-properties');
			expect(content).not.toBeNull();
			expect(content).toContain('Properties');
		});

		it('should return body content for audio-transcription', () => {
			const content = BundledSkillRegistry.loadSkill('audio-transcription');
			expect(content).not.toBeNull();
			expect(content).toContain('Transcri');
		});

		it('should return body content for deep-research', () => {
			const content = BundledSkillRegistry.loadSkill('deep-research');
			expect(content).not.toBeNull();
			expect(content).toContain('deep_research');
		});

		it('should return body content for image-generation', () => {
			const content = BundledSkillRegistry.loadSkill('image-generation');
			expect(content).not.toBeNull();
			expect(content).toContain('generate_image');
		});

		it('should return body content for vault-semantic-search', () => {
			const content = BundledSkillRegistry.loadSkill('vault-semantic-search');
			expect(content).not.toBeNull();
			expect(content).toContain('vault_semantic_search');
		});

		it('should return body content for recall-sessions', () => {
			const content = BundledSkillRegistry.loadSkill('recall-sessions');
			expect(content).not.toBeNull();
			expect(content).toContain('recall_sessions');
		});

		it('should return null for unknown skill', () => {
			expect(BundledSkillRegistry.loadSkill('nonexistent')).toBeNull();
		});

		it('should not include frontmatter in body content', () => {
			const content = BundledSkillRegistry.loadSkill('gemini-scribe-help');
			expect(content).not.toMatch(/^---\r?\n/);
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
			expect(resources).toContain('references/projects.md');
			expect(resources).toContain('references/loop-detection.md');
		});

		it('should return empty array for skill with no resources', () => {
			const resources = BundledSkillRegistry.listResources('obsidian-bases');
			expect(resources).toEqual([]);
		});

		it('should return empty array for unknown skill', () => {
			expect(BundledSkillRegistry.listResources('nonexistent')).toEqual([]);
		});
	});

	describe('has', () => {
		it('should return true for bundled skills', () => {
			expect(BundledSkillRegistry.has('gemini-scribe-help')).toBe(true);
			expect(BundledSkillRegistry.has('obsidian-bases')).toBe(true);
			expect(BundledSkillRegistry.has('audio-transcription')).toBe(true);
			expect(BundledSkillRegistry.has('deep-research')).toBe(true);
			expect(BundledSkillRegistry.has('image-generation')).toBe(true);
			expect(BundledSkillRegistry.has('vault-semantic-search')).toBe(true);
			expect(BundledSkillRegistry.has('recall-sessions')).toBe(true);
		});

		it('should return false for unknown skills', () => {
			expect(BundledSkillRegistry.has('nonexistent')).toBe(false);
		});
	});
});
