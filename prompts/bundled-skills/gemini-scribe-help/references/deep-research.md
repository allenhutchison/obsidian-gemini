# Deep Research

Deep Research lets the AI agent conduct comprehensive, multi-source research on any topic — combining web sources, your vault notes, or both — and produce a structured markdown report with citations.

> **Note:** Deep Research is not instant. A single research request typically takes several minutes as the API performs multiple rounds of searching, reading, and synthesizing information.

## How It Works

1. You ask the agent to research a topic
2. The agent invokes the `deep_research` tool (with your confirmation)
3. Google's Deep Research API performs multiple search rounds, analyzing and synthesizing sources
4. A structured markdown report is generated with inline citations
5. Optionally, the report is saved to a file in your vault and added to the session context

This is fundamentally different from the regular Google Search tool, which returns quick single-query results. Deep Research performs iterative, multi-turn investigation — more like a research assistant spending time in a library than a quick web search.

## Getting Started

Deep Research is always available as long as you have a valid API key configured. No additional setup is required for web-only research.

To include your vault notes in research, you'll need [Semantic Vault Search](/guide/semantic-search) enabled and your vault indexed.

## Research Scopes

The tool supports three research scopes:

| Scope              | What it searches  | When to use                                                                       |
| ------------------ | ----------------- | --------------------------------------------------------------------------------- |
| **both** (default) | Web + vault notes | Best for most research — combines external knowledge with your existing notes     |
| **web_only**       | Web only          | When your topic is outside your vault's scope                                     |
| **vault_only**     | Vault notes only  | When you want to synthesize purely from your own notes (requires Semantic Search) |

If you request `both` but Semantic Search isn't configured, the tool automatically falls back to web-only research.

## Usage

Just ask the agent naturally. It will decide when to use Deep Research based on your request:

```
You: Research the latest developments in quantum error correction
     and save it to Research/quantum-error-correction.md

Agent: I'll conduct deep research on this topic. This may take a few minutes.
[Requests confirmation]
[Researches across multiple web sources]

Here's what I found: [structured report with citations]
The report has been saved to Research/quantum-error-correction.md
```

### Example Prompts

**Web + vault research (default):**

```
Research how RAG architectures compare to fine-tuning for domain-specific tasks
```

**Web only:**

```
Do web-only deep research on the 2024 Nobel Prize in Physics
```

**Vault synthesis:**

```
Using only my vault notes, research and synthesize my findings on project management methodologies
```

**With output file:**

```
Research the history of the Zettelkasten method and save it to Reference/zettelkasten-history.md
```

## Output Format

Research reports are structured as markdown:

```markdown
# [Your Research Topic]

_Generated on [Date]_

---

[Synthesized findings organized into sections...]

Sources are cited inline with links to original URLs.
```

When you specify an output file:

- The report is saved to that path in your vault
- A `.md` extension is added automatically if missing
- The file is added to your current session context, so the agent can reference the findings in follow-up messages
- Protected folders (`.obsidian`, plugin state folder) cannot be used as output paths

## How It Differs from Google Search

|                  | Deep Research                          | Google Search          |
| ---------------- | -------------------------------------- | ---------------------- |
| **Depth**        | Multi-turn, iterative investigation    | Single query           |
| **Time**         | Several minutes                        | Instant                |
| **Output**       | Structured report with citations       | Search result snippets |
| **Vault access** | Can search vault via Semantic Search   | No vault access        |
| **Best for**     | Comprehensive understanding of a topic | Quick factual lookups  |

The agent has both tools available and will choose the right one based on your request. A question like "what year was Python created?" gets a quick Google Search, while "research the evolution of Python's type system" triggers Deep Research.

## Limitations

- **Takes time** — Expect several minutes per research request. The API performs multiple rounds of searching and analysis.
- **Rate limits** — Subject to Google API rate limits. If you hit a quota, you'll get a clear error message.
- **Vault scope requires Semantic Search** — The `vault_only` and vault portion of `both` scope require Semantic Vault Search to be enabled and your vault indexed.
- **Citation accuracy** — Citations come from Google's API. While generally reliable, always verify critical facts against original sources.
- **No individual file deletion** — Research reports saved to your vault are regular markdown files you can edit or delete freely.

## Troubleshooting

### "Deep research service not available"

The service failed to initialize. Check that your API key is valid in [Google AI Studio](https://aistudio.google.com).

### "Research quota exceeded"

You've hit Google's API rate limit. Wait a few minutes and try again, or enable billing on your API key for higher quotas.

### "vault_only scope requires RAG indexing"

You requested vault-only research but Semantic Vault Search isn't configured. Either:

- Enable and configure [Semantic Vault Search](/guide/semantic-search), or
- Use `web_only` or `both` scope instead

### Research takes very long or seems stuck

Deep Research is inherently slow — it's performing thorough multi-source investigation. If it takes more than 10 minutes, there may be an API issue. Check the developer console (Ctrl/Cmd + Shift + I) with Debug Mode enabled for details.

### Report was generated but file wasn't saved

The research succeeded but saving failed. Check that:

- The output path isn't in a protected folder (`.obsidian`, plugin state folder)
- You have write permissions to the target directory
- The research results are still available in the chat — you can copy them manually
