# Bundled Skills Design

**Issue**: #431
**Date**: 2026-03-16

## Summary

Ship built-in skills with the Gemini Scribe plugin so the agent can answer questions about itself and guide users through Obsidian features like Bases. Bundled skills use the same progressive disclosure model as vault skills but are imported at build time rather than discovered from the filesystem.

## Skills to Bundle

### `gemini-scribe-help`

A routing skill with a concise SKILL.md and a `references/` directory containing the plugin's documentation files verbatim. The SKILL.md acts as a table of contents that tells the agent which reference to load for a given question.

**References** (from `docs/guide/` and `docs/reference/`):

- getting-started.md, agent-mode.md, agent-skills.md, context-system.md
- custom-prompts.md, completions.md, summarization.md, ai-writing.md
- deep-research.md, mcp-servers.md, semantic-search.md
- settings.md, advanced-settings.md, faq.md

### `obsidian-bases`

A self-contained SKILL.md covering Obsidian Bases syntax, property types, views, formulas, and how to structure notes for use with Bases. No references directory needed — all content fits in a single file.

## Architecture

### File Structure

```
prompts/bundled-skills/
  gemini-scribe-help/
    SKILL.md
    references/
      getting-started.md
      agent-mode.md
      agent-skills.md
      context-system.md
      custom-prompts.md
      completions.md
      summarization.md
      ai-writing.md
      deep-research.md
      mcp-servers.md
      semantic-search.md
      settings.md
      advanced-settings.md
      faq.md
  obsidian-bases/
    SKILL.md
```

### Build Integration

Add `.md` to esbuild's loader config so markdown files can be imported as text strings. Each bundled skill file gets a static import in `src/services/bundled-skills.ts`.

### Bundled Skill Registry

New file: `src/services/bundled-skills.ts`

A static registry that holds bundled skill content imported at build time. Exposes four methods mirroring `SkillManager`:

- `getSummaries(): SkillSummary[]` — name + description for system prompt injection
- `loadSkill(name: string): string | null` — full SKILL.md body content
- `readResource(name: string, path: string): string | null` — specific reference file
- `listResources(name: string): string[]` — available resource paths

```typescript
interface BundledSkill {
	name: string;
	description: string;
	content: string;
	resources: Map<string, string>;
}
```

All imports and registration happen in this file, keeping the wiring centralized.

### SkillManager Changes

`SkillManager` is modified to merge vault and bundled skills. Vault skills take priority — if a user creates a skill with the same name as a bundled one, the vault version wins.

**Modified methods:**

- `discoverSkills()` — After vault discovery, appends bundled skills whose names don't collide with vault skills. Bundled skills use `path: 'bundled'` as a sentinel.
- `loadSkill(name)` — Tries vault first (existing logic), falls back to `BundledSkillRegistry.loadSkill()`.
- `readSkillResource(name, path)` — Tries vault first, falls back to `BundledSkillRegistry.readResource()`.
- `listSkillResources(name)` — Tries vault first, falls back to `BundledSkillRegistry.listResources()`.
- `createSkill(name)` — No changes. Users can override bundled skills by creating vault skills with the same name.

### Unchanged

- `ActivateSkillTool` and `CreateSkillTool` in `src/tools/skill-tools.ts` — no changes needed. They call `SkillManager` which handles the fallback internally.
- System prompt template in `prompts/agentToolsPrompt.txt` — no changes. Bundled skills appear in the same `availableSkills` list.

## Design Decisions

1. **Build-time imports over vault copies** — Avoids polluting the user's vault with plugin-managed files and eliminates upgrade/sync headaches.
2. **Vault overrides bundled** — Power users can customize built-in behavior by creating a vault skill with the same name.
3. **Verbatim doc references** — The help skill's references are the actual doc files, avoiding maintenance burden of keeping two copies in sync. Updated when docs change.
4. **Single registry file** — All import wiring in one place rather than scattered through the codebase.

## Testing Strategy

- Unit test `BundledSkillRegistry` methods (getSummaries, loadSkill, readResource, listResources)
- Unit test `SkillManager` merge logic — vault priority over bundled
- Unit test that `loadSkill` falls back to bundled when vault skill doesn't exist
- Unit test that vault skill with same name overrides bundled
- Manual test: ask the agent "how do I use completions?" and verify it activates the help skill and loads the correct reference
