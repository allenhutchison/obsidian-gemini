---
name: deep-research
description: Conduct comprehensive, multi-source research and generate cited reports. Activate this skill when users want in-depth research on a topic, need synthesis across web and vault sources, or want a structured research report saved to their vault.
---

# Deep Research

Conduct comprehensive, multi-round research using the `deep_research` tool. This produces structured markdown reports with citations by iteratively searching, reading, and synthesizing multiple sources.

## When to Use Deep Research vs Google Search

| Use `deep_research` when...                                | Use `google_search` when...                 |
| ---------------------------------------------------------- | ------------------------------------------- |
| The topic requires synthesis across multiple sources       | A quick factual answer is needed            |
| The user wants a structured report or overview             | The user asks for a single data point       |
| Research should combine vault notes with web sources       | The user wants current news or events       |
| The question is broad or exploratory                       | The question is specific and narrow         |
| The user explicitly asks for "deep research" or "a report" | The user asks "what is..." or "when did..." |

**Default to `google_search` for simple questions.** Only use `deep_research` when the scope genuinely warrants multi-source synthesis.

## How to Use

Call the `deep_research` tool with these parameters:

- **`topic`** (required) — The research question or topic. Be specific and descriptive.
- **`scope`** (optional) — Where to search:
  - `both` (default) — Web sources + vault notes. Best for most research.
  - `web_only` — Internet sources only. Use when the topic is outside the vault's scope.
  - `vault_only` — Vault notes only. Use to synthesize the user's own notes. Requires Semantic Vault Search to be enabled.
- **`outputFile`** (optional) — Path to save the report (e.g., `Research/topic-name.md`). A `.md` extension is added automatically if missing.

If `both` is requested but Semantic Vault Search isn't configured, the tool gracefully falls back to web-only research.

## Best Practices

- **Always suggest an `outputFile`** — Research reports are valuable artifacts. Suggest saving to a logical location like `Research/` or a project folder.
- **Warn the user about timing** — Deep research takes several minutes. Let the user know before invoking the tool.
- **Choose the right scope**:
  - User wants to understand a new external topic → `web_only` or `both`
  - User wants to synthesize their own notes → `vault_only`
  - User wants to combine personal knowledge with external research → `both`
- **Write a clear topic** — Frame the topic as a research question or focused description. "The evolution of transformer architectures in NLP" is better than "transformers".

## Output Format

The tool generates a markdown report with:

- A title and generation date
- Synthesized findings organized into logical sections
- Inline citations linking to source URLs
- Source count summary

When `outputFile` is specified, the report is saved to the vault and added to the session context for follow-up discussion.

## Tips

- After receiving a research report, offer to help the user extract action items, create summary notes, or link findings to existing vault content.
- For iterative research, suggest running multiple focused queries rather than one broad one.
- If the user wants to research something related to their existing notes, suggest `both` scope to combine external knowledge with their personal context.
