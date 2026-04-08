---
name: vault-semantic-search
description: Search vault notes by meaning using semantic search (RAG). Activate this skill when users want to find notes by concept or topic rather than exact keywords, or when keyword search tools return poor results.
---

# Vault Semantic Search

Find vault content by meaning rather than exact keywords using the `vault_semantic_search` tool. This uses RAG (Retrieval-Augmented Generation) to search indexed vault files semantically.

## When to Use Semantic Search

| Use `vault_semantic_search` when...                          | Use keyword tools (`search_vault`) when... |
| ------------------------------------------------------------ | ------------------------------------------ |
| The user asks about concepts or topics                       | The user wants an exact filename or string |
| The query is "find notes about..." or "what do I have on..." | The query is "find the file called..."     |
| The user doesn't remember exact words                        | The user knows the exact term to search    |
| You need to discover related content across the vault        | You need to find a specific known file     |
| Keyword search returned poor or no results                   | You know the exact path or filename        |

**Try semantic search first for concept-based queries.** Fall back to keyword tools if semantic search isn't available or returns insufficient results.

## How to Use

Call the `vault_semantic_search` tool with these parameters:

- **`query`** (required) — The search question, topic, or concept. Natural language queries work best.
- **`maxResults`** (optional) — Number of results to return, 1-20. Default is 5. Increase for broad surveys.
- **`folder`** (optional) — Limit results to files within a specific folder path.
- **`tags`** (optional) — Filter results by Obsidian tags. Uses OR logic — any matching tag qualifies.

## Search Strategies

- **Broad discovery** — Use a conceptual query with higher `maxResults` (10-15): `vault_semantic_search("project management methodologies", maxResults=10)`
- **Focused search** — Narrow with `folder` when the user mentions a specific area: `vault_semantic_search("meeting notes about budget", folder="Work/Meetings")`
- **Tag-filtered search** — Use `tags` when the user references tagged content: `vault_semantic_search("design patterns", tags=["programming", "architecture"])`
- **Follow-up reading** — After finding relevant results, use `read_file` on promising matches to get full note content

## Combining with Keyword Search

For comprehensive results, use both search approaches:

1. Start with `vault_semantic_search` for concept-based discovery
2. If results are insufficient, try `search_vault` with specific keywords
3. Use `read_file` on the most relevant results from either approach

## Limitations

- **Requires vault indexing** — Semantic search only works when the user has enabled vault indexing in settings. If it's not available, fall back to keyword tools.
- **File paths may be missing** — The Google API sometimes doesn't return source file paths in results. Excerpts are still useful for answering questions.
- **Only indexed files are searchable** — Files in excluded folders or newly created files that haven't been indexed yet won't appear in results.

## Tips

- Frame queries as natural language questions or topic descriptions for the best semantic matching.
- When the user asks "what do I know about X" or "find everything related to X", this is the ideal tool to use.
- If results mention relevant content but lack file paths, suggest the user check the RAG status modal to verify indexing is complete.
