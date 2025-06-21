# Gemini Scribe for Obsidian

Gemini Scribe is an Obsidian plugin that integrates Google's Gemini AI models, providing powerful AI-driven assistance for note-taking, writing, and knowledge management directly within Obsidian. It leverages your notes as context for AI interactions, making it a highly personalized and integrated experience.

> **Note:** This plugin requires a Google Gemini API key. Free tier available at [Google AI Studio](https://aistudio.google.com/apikey).

## Features

- **Context-Aware Chat:** Engage in conversations with Gemini AI, with the ability to include the content of your current active note and its linked notes (up to a configurable depth) as context. This ensures highly relevant and personalized responses.
- **Smart Summarization:** Quickly generate concise, one-sentence summaries of your notes and automatically store them in the document's frontmatter, using a dedicated Gemini model optimized for summarization.
- **AI-Assisted Writing (with File Rewriting):** Collaborate with Gemini to draft, refine, and enhance your documents. When enabled, Gemini can directly modify your current note based on the conversation, providing a seamless writing experience.
- **IDE-Style Completions:** Get real-time, context-aware text completions as you type, similar to IDEs. Accept completions with `Tab` or dismiss with any other key. This feature uses a dedicated Gemini model for optimized completion generation.
- **Markdown-Based Chat History:** Store your chat history directly in your vault as markdown files. Each note's chat history is stored in a separate file in the `gemini-scribe` folder, making it easy to backup, version control, and manage your AI interactions.
- **Configurable Models:** Choose different Gemini models for chat, summarization, and completions, allowing you to tailor the AI's behavior to each task.
- **Search Grounding (Optional):** Enhance responses with Google Search results, improving the accuracy and relevance of the information provided by the AI. A configurable threshold controls how likely search grounding is to be triggered.
- **Custom Prompt System:** Create reusable AI instruction templates that can be applied to individual notes, allowing you to customize the AI's behavior for different types of content (e.g., technical documentation, creative writing, tutoring).
- **Built-in Prompt Templates:** The plugin uses carefully crafted Handlebars templates for system prompts, general chat prompts, summarization prompts, rewrite prompts, completion prompts, and prompts to include the current date and time. These ensure consistent and effective AI interaction.
- **Data Privacy:** All interactions with the Gemini API are done directly from your machine. No data is sent to any third-party servers other than Google's. Chat history is stored locally in your Obsidian vault as markdown files.
- **Robust History Management:**
  - Per-note history files with automatic linking
  - Automatic handling of file renames and moves
  - Easy backup and version control of chat history
  - Commands to manage and clear history

## Quick Start

1. Install the plugin from Community Plugins
2. Get your free API key from [Google AI Studio](https://aistudio.google.com/apikey)
3. Add the API key in plugin settings
4. Open chat with the ribbon icon or command palette
5. Start chatting with your notes as context!

## Installation

1.  **Community Plugins (Recommended):**

    - Open Obsidian Settings.
    - Navigate to "Community plugins".
    - Ensure "Restricted mode" is OFF.
    - Click "Browse" and search for "Gemini Scribe".
    - Click "Install" and then "Enable".

2.  **Manual Installation:**
    - Download the latest release from the [GitHub Releases](https://github.com/allenhutchison/obsidian-gemini/releases) page (you'll need `main.js`, `manifest.json`, and `styles.css`).
    - Create a folder named `obsidian-gemini` inside your vault's `.obsidian/plugins/` directory.
    - Copy the downloaded files into the `obsidian-gemini` folder.
    - In Obsidian, go to Settings → Community plugins and enable "Gemini Scribe".

## Configuration

1.  **Obtain a Gemini API Key:**

    - Visit the [Google AI Studio](https://aistudio.google.com/apikey).
    - Create a new API key.

2.  **Configure Plugin Settings:**
    - Open Obsidian Settings.
    - Go to "Gemini Scribe" under "Community plugins".
    - **API Key:** Paste your Gemini API key here.
    - **Chat Model:** Select the preferred Gemini model for chat interactions (e.g., `gemini-1.5-pro`).
    - **Summary Model:** Select the preferred Gemini model for generating summaries (e.g., `gemini-1.5-flash`).
    - **Completion Model:** Select the preferred model for IDE-style completions (e.g., `gemini-1.5-flash-8b`).
    - **Context Depth:**
      - **Send Context:** Toggle whether to send the current file's content as context to the AI.
      - **Max Context Depth:** Control how many levels of linked notes to include as context (0 for only the current file, 1 for direct links, etc.).
    - **Search Grounding:**
      - **Search Grounding:** Toggle the use of Google Search results to improve responses.
      - **Search Grounding Threshold:** Adjust the threshold for triggering search grounding (higher values make it more likely).
    - **Summary Frontmatter Key:** Specify the key to use when storing summaries in the frontmatter (default: `summary`).
    - **Your Name:** Enter your name, which the AI will use when addressing you.
    - **Rewrite Files:** Enable this option to allow Gemini to _directly modify_ your current document during chat. This is powerful but should be used with caution.
    - **Chat History:**
      - **Enable Chat History:** Toggle whether to save chat history.
      - **History Folder:** Choose the folder within your vault to store chat history files.
    - **Custom Prompts:**
      - **Enable Custom Prompts:** Toggle the custom prompt system on/off.
      - **Allow System Prompt Override:** Allow custom prompts to completely replace the system prompt (use with caution).

## Usage

### Custom Prompts

Create reusable AI instruction templates to customize behavior for different types of content.

**Quick Start:**
1. Create a prompt file in `[History Folder]/Prompts/`
2. Add to your note's frontmatter: `gemini-scribe-prompt: "[[Prompt Name]]"`
3. The AI will use your custom instructions for that note

**Learn More:** See the comprehensive [Custom Prompts Guide](docs/custom-prompts-guide.md) for detailed instructions, examples, and best practices.

### Documentation

For detailed guides on all features, visit the [Documentation Hub](docs/README.md):
- [Chat Interface Guide](docs/chat-interface-guide.md)
- [Custom Prompts Guide](docs/custom-prompts-guide.md)
- [AI-Assisted Writing Guide](docs/ai-writing-guide.md)
- [Completions Guide](docs/completions-guide.md)
- [Summarization Guide](docs/summarization-guide.md)
- [Chat History Guide](docs/chat-history-guide.md)
- [Context System Guide](docs/context-system-guide.md)

### Chat Interface

1.  **Open Chat:**

    - Use the command palette (Ctrl/Cmd + P) and search for "Gemini Scribe: Open Gemini Chat".
    - Click the Gemini Scribe icon in the ribbon (if enabled).

2.  **Chat with Context:**
    - Type your message in the input box
    - Press Enter to send (Shift+Enter for new line)
    - The AI automatically includes your current note as context
    - Linked notes are included based on your context depth setting

3.  **AI Responses:**
    - Responses appear in the chat with a "Copy" button
    - If Search Grounding is enabled, web search results may be included
    - Custom prompts modify how the AI responds (if configured)

### Document Summarization

1.  **Open a Note:** Navigate to the Markdown file you want to summarize
2.  **Generate Summary:** Press Ctrl/Cmd + P and run "Gemini Scribe: Summarize Active File"
3.  **View Result:** The summary is added to your note's frontmatter (default key: `summary`)

**Tip:** Great for creating quick overviews of long notes or generating descriptions for note indexes.

### AI-Assisted Writing (File Rewriting)

1.  **Enable Rewrite Files:** In the plugin settings, ensure "Rewrite Files" is toggled ON.
2.  **Open Chat:** Open the Gemini Chat view.
3.  **Open a File:** Open the Markdown file you want to edit.
4.  **Toggle Rewrite:** In the chat view, check the "Rewrite file" checkbox.
5.  **Interact:** Use the chat interface to collaborate with Gemini. The AI will _replace_ the content of your file below a `# Draft` heading (or create the heading if it doesn't exist) with its generated text. Content _above_ the `# Draft` heading is preserved.
6.  **Caution:** Be mindful when using this feature, as it directly modifies your file. Review changes carefully.

### IDE-Style Completions

1.  **Toggle Completions:** Use the command palette (Ctrl/Cmd + P) and select "Gemini Scribe: Toggle Completions". A notice will confirm whether completions are enabled or disabled.
2.  **Write:** Begin typing in a Markdown file.
3.  **Suggestions:** After a short pause in typing (750ms), Gemini will provide an inline suggestion based on your current context.
4.  **Accept/Dismiss:**
    - Press `Tab` to accept the suggestion.
    - Press any other key to dismiss the suggestion and continue typing.
5.  **Context-Aware:** Completions consider the surrounding text and document structure for more relevant suggestions.

### Chat History

- **Per-Note History:** Each note's chat history is stored in a separate markdown file in the configured history folder, making it easy to manage and backup.
- **View History:** Open the history file from the chat interface or navigate to `[History Folder]/[Note Name] - Gemini History.md`
- **Clear History:** Use the command palette to run "Gemini Scribe: Clear All Chat History" to remove all history files
- **Automatic Management:** The plugin automatically:
  - Creates history files when you start chatting about a note
  - Updates links when notes are renamed or moved
  - Preserves history across Obsidian sessions

## Troubleshooting

- **API Key Errors:** Ensure your API key is correct and has the necessary permissions. Get a new key at [Google AI Studio](https://aistudio.google.com/apikey).
- **No Responses:** Check your internet connection and make sure your API key is valid.
- **Slow Responses:** The speed of responses depends on the Gemini model and the complexity of your request. Larger context windows will take longer.
- **Completions Not Showing:** 
  - Ensure completions are enabled via the command palette
  - Try typing a few words and pausing to trigger the suggestion
  - Check that you're in a Markdown file
  - Disable other completion plugins that might conflict
- **History Not Loading:** Ensure "Enable Chat History" is enabled and the "History Folder" is correctly set.
- **Custom Prompts Not Working:**
  - Verify the prompt file exists in the Prompts folder
  - Check that the wikilink syntax is correct: `[[Prompt Name]]`
  - Ensure "Enable Custom Prompts" is toggled on in settings

## License

MIT License - see [LICENSE](LICENSE) for details.

## Support

- Report issues or suggest features on [GitHub](https://github.com/allenhutchison/obsidian-gemini/issues).
- Visit [author's website](https://allen.hutchison.org) for more information.

## Development

Contributions are welcome! See [CLAUDE.md](CLAUDE.md) for development guidelines and architecture details.

```bash
npm install     # Install dependencies
npm run dev     # Development build with watch
npm run build   # Production build
npm test        # Run tests
```

## Credits

Created by Allen Hutchison
