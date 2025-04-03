# Gemini Scribe for Obsidian

Gemini Scribe is an Obsidian plugin that integrates Google's Gemini AI models, providing powerful AI-driven assistance for note-taking, writing, and knowledge management directly within Obsidian. It leverages your notes as context for AI interactions, making it a highly personalized and integrated experience.

## Features

*   **Context-Aware Chat:** Engage in conversations with Gemini AI, with the ability to include the content of your current active note and its linked notes (up to a configurable depth) as context. This ensures highly relevant and personalized responses.
*   **Smart Summarization:** Quickly generate concise, one-sentence summaries of your notes and automatically store them in the document's frontmatter, using a dedicated Gemini model optimized for summarization.
*   **AI-Assisted Writing (with File Rewriting):** Collaborate with Gemini to draft, refine, and enhance your documents.  When enabled, Gemini can directly modify your current note based on the conversation, providing a seamless writing experience.
*   **IDE-Style Completions:** Get real-time, context-aware text completions as you type, similar to IDEs. Accept completions with `Tab` or dismiss with any other key. This feature uses a dedicated Gemini model for optimized completion generation.
*   **Markdown-Based Chat History:** Store your chat history directly in your vault as markdown files. Each note's chat history is stored in a separate file in the `gemini-scribe` folder, making it easy to backup, version control, and manage your AI interactions.
*   **Configurable Models:** Choose different Gemini models for chat, summarization, and completions, allowing you to tailor the AI's behavior to each task.
*   **Search Grounding (Optional):** Enhance responses with Google Search results, improving the accuracy and relevance of the information provided by the AI.  A configurable threshold controls how likely search grounding is to be triggered.
*   **Customizable Prompts:** While not directly exposed in the settings, the plugin uses carefully crafted Handlebars templates for system prompts, general chat prompts, summarization prompts, rewrite prompts, completion prompts, and prompts to include the current date and time. These ensure consistent and effective AI interaction.
*   **Data Privacy:** All interactions with the Gemini API are done directly from your machine.  No data is sent to any third-party servers other than Google's.  Chat history is stored locally in your Obsidian vault as markdown files.
*   **Robust History Management:** 
    *   Per-note history files with automatic linking
    *   Automatic handling of file renames and moves
    *   Easy backup and version control of chat history
    *   Commands to manage and clear history

## Installation

1.  **Community Plugins (Recommended):**
    *   Open Obsidian Settings.
    *   Navigate to "Community plugins".
    *   Ensure "Restricted mode" is OFF.
    *   Click "Browse" and search for "Gemini Scribe".
    *   Click "Install" and then "Enable".

2.  **Manual Installation:**
    *   Download the latest release from the [GitHub Releases](https://github.com/your-username/obsidian-gemini/releases) page (you'll need `main.js`, `manifest.json`, and `styles.css`).
    *   Create a folder named `obsidian-gemini` inside your vault's `.obsidian/plugins/` directory.
    *   Copy the downloaded files into the `obsidian-gemini` folder.
    *   In Obsidian, go to Settings → Community plugins and enable "Gemini Scribe".

## Configuration

1.  **Obtain a Gemini API Key:**
    *   Visit the [Google AI Studio](https://aistudio.google.com/apikey).
    *   Create a new API key.

2.  **Configure Plugin Settings:**
    *   Open Obsidian Settings.
    *   Go to "Gemini Scribe" under "Community plugins".
    *   **API Key:** Paste your Gemini API key here.
    *   **Chat Model:** Select the preferred Gemini model for chat interactions (e.g., `gemini-1.5-pro`).
    *   **Summary Model:** Select the preferred Gemini model for generating summaries (e.g., `gemini-1.5-flash`).
    *   **Completion Model:** Select the preferred model for IDE-style completions (e.g., `gemini-1.5-flash-8b`).
    *   **Context Depth:**
        *   **Send Context:** Toggle whether to send the current file's content as context to the AI.
        *   **Max Context Depth:** Control how many levels of linked notes to include as context (0 for only the current file, 1 for direct links, etc.).
    *  **Search Grounding:**
        *    **Search Grounding:** Toggle the use of Google Search results to improve responses.
        *   **Search Grounding Threshold:** Adjust the threshold for triggering search grounding (higher values make it more likely).
    *   **Summary Frontmatter Key:**  Specify the key to use when storing summaries in the frontmatter (default: `summary`).
    *   **Your Name:**  Enter your name, which the AI will use when addressing you.
    *   **Rewrite Files:** Enable this option to allow Gemini to *directly modify* your current document during chat.  This is powerful but should be used with caution.
    * **Chat History:**
        *   **Enable Chat History:** Toggle whether to save chat history.
        *   **History Folder:** Choose the folder within your vault to store chat history files.

## Usage

### Chat Interface

1.  **Open Chat:**
    *   Use the command palette (Ctrl/Cmd + P) and search for "Gemini Scribe: Open Gemini Chat".
    *   Click the Gemini Scribe icon in the ribbon (if enabled).

2.  **Interact:**
    *   Type your message in the input box.
    *   Press Enter (or click the Send button) to send your message.  Shift+Enter creates a newline.
    *   The AI's responses will appear in the chatbox.  Model responses include a "Copy" button to easily copy the text.

3. **Grounding Information:**
    * If Search Grounding is enabled and the threshold is met, the AI will include a "grounding" section in its response, displaying the raw HTML from relevant search results.

### Document Summarization

1.  **Open the Note:** Open the Markdown file you want to summarize.
2.  **Run Command:** Use the command palette (Ctrl/Cmd + P) and select "Gemini Scribe: Summarize Active File".
3.  **Summary Added:** A one-sentence summary will be added to the document's frontmatter using the configured `summaryFrontmatterKey`.

### AI-Assisted Writing (File Rewriting)

1.  **Enable Rewrite Files:**  In the plugin settings, ensure "Rewrite Files" is toggled ON.
2.  **Open Chat:** Open the Gemini Chat view.
3.  **Open a File:**  Open the Markdown file you want to edit.
4.  **Toggle Rewrite:** In the chat view, check the "Rewrite file" checkbox.
5.  **Interact:**  Use the chat interface to collaborate with Gemini.  The AI will *replace* the content of your file below a `# Draft` heading (or create the heading if it doesn't exist) with its generated text.  Content *above* the `# Draft` heading is preserved.
6.  **Caution:** Be mindful when using this feature, as it directly modifies your file. Review changes carefully.

### Completions

1.  **Toggle Completions:** Use the command palette (Ctrl/Cmd + P) and select "Gemini Scribe: Toggle Completions".  A notice will confirm whether completions are enabled or disabled.
2.  **Write:** Begin typing in a Markdown file.
3.  **Suggestions:** After a short pause in typing (default: 750ms), Gemini will provide an inline suggestion.
4.  **Accept/Dismiss:**
    *   Press `Tab` to accept the suggestion.
    *   Press any other key to dismiss the suggestion and continue typing.

### Chat History

*   **Per-Note History:** Each note's chat history is stored in a separate markdown file in the configured history folder, making it easy to manage and backup.
*   **History Management Commands:**
    *   **Clear All Chat History:** Remove all chat history files
*   **Automatic File Handling:** The plugin automatically:
    *   Creates history files when needed
    *   Updates history files when notes are renamed or moved
    *   Maintains proper linking between notes and their history files
    *   Cleans up orphaned history files

## Troubleshooting

*   **API Key Errors:** Ensure your API key is correct and has the necessary permissions.
*   **No Responses:** Check your internet connection and make sure your API key is valid.
*   **Slow Responses:** The speed of responses depends on the Gemini model and the complexity of your request.  Larger context windows will take longer.
*   **Completions Not Showing:**  Ensure completions are enabled via the command palette.  If they are, try typing a few words and pausing to trigger the suggestion.
*  **History Not Loading:** Ensure "Enable Chat History" is enabled and the "History Folder" is correctly set.

## License

MIT License - see [LICENSE](LICENSE) for details.

## Support

*   Report issues or suggest features on [GitHub](https://github.com/your-username/obsidian-gemini/issues).
*   Visit [author's website](https://allen.hutchison.org) for more information.

## Credits

Created by Allen Hutchison
