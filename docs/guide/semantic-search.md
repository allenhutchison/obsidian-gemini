# Semantic Vault Search

Semantic Vault Search lets you search your vault by _meaning_, not just keywords. Powered by Google's File Search API, it indexes your notes in the background so the AI agent can find relevant content even when you don't remember exact words.

> **This feature is experimental.** It works well for most vaults, but the underlying Google API has some limitations documented below.

## How It Works

1. **Indexing** — The plugin uploads your vault files to a private Google File Search Store tied to your API key
2. **Change tracking** — File creates, edits, and deletes are automatically synced (with a 2-second debounce)
3. **Semantic search** — When the agent needs to find relevant notes, it queries the store using meaning-based search rather than keyword matching
4. **Results** — The agent receives text excerpts from matching files along with an AI-generated summary

The agent has access to this as the `vault_semantic_search` tool. You don't need to invoke it directly — just ask questions like "find my notes about project planning" and the agent will use it automatically.

## Getting Started

### Enable Vault Indexing

1. Open Settings → Gemini Scribe
2. Scroll to **Vault Indexing (Experimental)**
3. Toggle **Enable vault indexing** to ON
4. The initial indexing starts automatically with a progress modal

Initial indexing time depends on vault size. A vault with 1,000 notes typically takes a few minutes.

### Configuration Options

| Setting                   | Default        | Description                                                                                                                     |
| ------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **Enable vault indexing** | Off            | Master toggle for the feature                                                                                                   |
| **Search index name**     | Auto-generated | Google File Search Store identifier (auto-set to `obsidian-{vault-name}`)                                                       |
| **Auto-sync changes**     | On             | Automatically update the index when files change                                                                                |
| **Include attachments**   | Off            | Index PDFs, Office documents, and other supported file types beyond markdown                                                    |
| **Exclude folders**       | None           | Folders to skip during indexing (one per line). System folders like `.obsidian` and the plugin state folder are always excluded |

### Index Management

In the settings panel you'll find two action buttons:

- **Reindex Vault** — Performs a full re-index. Smart sync skips files that haven't changed, so this is safe to run anytime.
- **Delete Index** — Permanently removes your data from Google Cloud. Use this if you want a fresh start or are done with the feature.

## Commands

Access these from the command palette (Ctrl/Cmd + P):

| Command             | Description                                                              |
| ------------------- | ------------------------------------------------------------------------ |
| **Pause RAG Sync**  | Pauses auto-sync. File changes still queue up but aren't sent to Google. |
| **Resume RAG Sync** | Resumes auto-sync and processes any queued changes.                      |
| **Show RAG Status** | Opens a detailed status modal with indexed files, failures, and actions. |

## Status Tracking

### Status Bar

A small icon appears in the bottom-right status bar:

| Icon             | State        | Meaning                                    |
| ---------------- | ------------ | ------------------------------------------ |
| Database         | Idle         | Index is up to date, shows file count      |
| Upload (pulsing) | Indexing     | Files are being uploaded, shows percentage |
| Clock            | Rate limited | Waiting for API cooldown, shows countdown  |
| Triangle         | Error        | Something went wrong — click for details   |

Click the status bar icon anytime to open the full status modal.

### Status Modal

The status modal has three tabs:

- **Overview** — Current status, file counts, pending changes, last sync time, and action buttons (Sync Now, Reindex All)
- **Files** — Searchable list of all indexed files with timestamps
- **Failures** — Any files that failed to index with error details

### Interrupted Indexing

If Obsidian closes during indexing, the plugin detects this on next startup and asks whether to **resume** where you left off or **start fresh**. Smart sync means resuming is efficient — already-indexed files are skipped.

## How the Agent Uses It

The agent has a `vault_semantic_search` tool with these parameters:

- **query** (required) — The search question or topic
- **maxResults** (optional) — Number of results, 1–20 (default: 5)
- **folder** (optional) — Filter results to a specific folder path
- **tags** (optional) — Filter results by Obsidian tags

### Example Interactions

```
You: Find my notes about machine learning algorithms

Agent: I'll search your vault semantically for notes about machine learning.
[Uses vault_semantic_search with query "machine learning algorithms"]
I found 5 relevant notes:
- "Neural Networks Overview" — discusses backpropagation and gradient descent...
- "ML Study Guide" — covers supervised vs unsupervised learning...
```

```
You: What did I write about project deadlines in my work folder?

Agent: [Uses vault_semantic_search with query "project deadlines", folder="work"]
```

## Supported File Types

**Markdown only** (default):

- `.md` files

**With "Include attachments" enabled:**

- PDFs (`.pdf`)
- Office documents (`.docx`, `.xlsx`, `.pptx`)
- Text files (`.txt`, `.json`, `.yaml`, `.csv`)
- Code files (`.js`, `.ts`, `.py`, `.sh`, etc.)
- HTML, XML, and other text-based formats

## Privacy & Data Storage

### Where does my data go?

Files are uploaded to Google Cloud via the File Search API. Each API key has its own isolated set of File Search Stores — your data is private to your API key and is not shared with other users or used for model training.

### What metadata is stored?

Along with file content, the plugin sends metadata for filtering:

- Folder path
- Tags (from frontmatter)
- Aliases (from frontmatter)
- File path

### Local cache

A cache file (`rag-index-cache.json`) is stored in your plugin state folder. It tracks content hashes and timestamps to enable smart sync — only changed files are re-uploaded.

### Protecting sensitive content

- System folders (`.obsidian`, plugin state folder) are always excluded
- Use **Exclude folders** in settings to skip sensitive directories (e.g., `private/`, `journal/`)
- Keep **Include attachments** off if you don't want PDFs/documents indexed

### Data deletion

When you disable vault indexing, a cleanup dialog asks whether to:

- **Keep data** — Faster if you re-enable later
- **Delete from Google Cloud** — Permanently removes the File Search Store

You can also use **Delete Index** in settings at any time.

> **Note:** If you uninstall the plugin without deleting the index first, the data persists in Google Cloud. You can clean it up by re-enabling the plugin and using Delete Index, or by managing stores directly in [Google AI Studio](https://aistudio.google.com).

## Known Limitations

- **No individual file deletion from the index** — When you delete a vault file, it may remain as an orphan in Google Cloud. Use **Reindex Vault** or **Delete Index** for a clean state.
- **Search results don't include file paths** — The Google API returns text excerpts but not source file paths. The agent may not always be able to link results back to specific files.
- **Rate limits during indexing** — Large vaults may hit API rate limits. The plugin handles this automatically with exponential backoff (30s base, up to 5 minutes). The status bar shows a countdown.
- **Concurrent upload limit** — Files are uploaded 5 at a time to balance speed with rate limit avoidance.

## Troubleshooting

### Indexing is very slow

- Large vaults take time on the first index. Subsequent syncs are much faster due to smart sync (only changed files).
- If you're hitting rate limits frequently, consider enabling billing on your API key for higher quotas.
- Excluding large folders you don't need indexed helps significantly.

### "File already exists" errors

This was fixed in v4.2+. Update to the latest version. The fix includes deferred initialization and improved cache handling.

### Search results seem incomplete

- Verify the file is actually indexed — open the status modal (Files tab) and search for it
- Check that the file's folder isn't in the exclude list
- If you recently enabled **Include attachments**, run **Reindex Vault** to pick up non-markdown files
- Try increasing `maxResults` by asking the agent: "Search for X with more results"

### Status shows errors

Click the status bar icon to see the Failures tab. Common causes:

- **Rate limits** — Wait and retry, or enable billing for higher quotas
- **Invalid API key** — Verify your key in [Google AI Studio](https://aistudio.google.com)
- **Network issues** — Check your internet connection

For persistent issues, try **Delete Index** followed by **Reindex Vault** for a clean start.

## Further Reading

- [Gemini Scribe Update: Chat History Supercharged](https://allen.hutchison.org/2025/03/29/gemini-scribe-update-lets-talk-about-how-your-chat-history-is-now-supercharged/) — The evolution of data storage in Gemini Scribe, from databases to markdown
