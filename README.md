# Gemini Plugin for Obsidian

This plugin integrates Google's Gemini AI with Obsidian, providing intelligent assistance for note-taking and content generation.

## Features

- **Context-Aware Chat**: Interact with Gemini AI based on your current active note's content
- **Smart Summarization**: Generate one-sentence summaries of your notes and store them in the document's frontmatter
- **AI-Assisted Writing**: Collaborate with Gemini to write and refine your documents (experimental feature)
- **IDE Style completions**: When enabled will provide IDE style text completions with the context of your note.

## Installation

1. Install from Obsidian Community Plugins:
   - Open Settings → Community plugins
   - Search for "Gemini"
   - Click Install and Enable

2. Manual installation:
   - Download the latest release from GitHub
   - Extract files to your vault's `.obsidian/plugins/obsidian-gemini/` directory
   - Enable the plugin in Obsidian settings

## Configuration

1. Get a Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey)
2. Open plugin settings and enter your API key
3. Configure optional settings:
   - Select preferred Gemini model
   - Customize system prompts
   - Set summarization preferences
   - Configure frontmatter key for summaries

## Usage

### Chat Interface
- Use the command palette to open "Gemini Chat"
- The chat will use your current note as context
- Type messages to interact with Gemini
- Copy bot responses using the copy button

### Document Summarization
1. Open the document you want to summarize
2. Run the "Summarize Active File" command
3. A one-sentence summary will be added to your document's frontmatter

### AI-Assisted Writing (Experimental)
- Enable "Rewrite Files" in settings
- Use the chat interface to collaborate with Gemini on document writing
- The model will update your current document based on the conversation

### Completions
- From the command palette select Gemini Scribe: Toggle Completions
- You'll now see IDE style completions whenever you pause in your writing
- Hit Tab to accept the completion or any other key to dismiss.
- Turn off by using the same command.

## License

MIT License - see [LICENSE](LICENSE) for details

## Support

- Report issues on [GitHub](https://github.com/your-username/obsidian-gemini/issues)
- Visit [author's website](https://allen.hutchison.org) for more information

## Credits

Created by Allen Hutchison
