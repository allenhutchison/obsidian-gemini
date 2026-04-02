# Agent Skills

Agent Skills let you extend the AI agent with specialized knowledge and workflows. Skills are self-contained instruction packages that the agent can activate on demand, giving it expertise in specific domains without cluttering every conversation.

> Skills follow the open [agentskills.io](https://agentskills.io) specification.

## Skills vs Custom Prompts

Skills and [custom prompts](/guide/custom-prompts) serve different purposes:

|               | Skills                                                      | Custom Prompts                                 |
| ------------- | ----------------------------------------------------------- | ---------------------------------------------- |
| **Purpose**   | Define _what_ the agent does step-by-step                   | Change _how_ the agent talks to you            |
| **Best for**  | Repeatable workflows, multi-step procedures                 | Style, tone, persona, background context       |
| **Activated** | On demand per task (automatic or manual)                    | Applied to a session via session settings      |
| **Example**   | "Read my meetings, create notes for each, add action items" | "Respond as a technical editor using AP style" |

**Rule of thumb:** If you have a specific procedure with discrete steps you want the agent to follow on command, create a skill. If you want to change the agent's personality or give it background knowledge for the whole session, use a custom prompt.

## How Skills Work

Skills use **progressive disclosure** — the agent always knows which skills are available (name and description), but only loads the full instructions when it activates a skill. This keeps conversations focused while making specialized knowledge available when needed.

1. **Discovery** — Skill summaries are included in every agent session
2. **Activation** — When the agent encounters a matching task, it activates the skill to load full instructions
3. **Execution** — The agent follows the skill's instructions to complete the task

## Built-in Skills

Gemini Scribe ships with built-in skills that are always available:

- **gemini-scribe-help** — The agent can answer questions about the plugin itself by loading the relevant documentation on demand. Ask things like "How do I set up completions?" or "What settings are available?"
- **obsidian-bases** — Guides the agent through creating and configuring Obsidian Bases, including filters, formulas, views, and common patterns like task trackers and project dashboards.
- **obsidian-properties** — Helps the agent work with Obsidian note properties (frontmatter), including creating, editing, and querying properties.
- **audio-transcription** — Guides the agent through transcribing audio and video files into structured notes with timestamps, speaker labels, and summaries.

Built-in skills work exactly like custom skills — the agent sees them in its available skills list and activates them when relevant. If you create a custom skill with the same name as a built-in one, your version takes priority.

## Getting Started

### Where Skills Live

Custom skills are stored in your plugin state folder:

```
gemini-scribe/
└── skills/
    └── my-skill/
        ├── SKILL.md          # Required — skill definition
        ├── references/       # Optional — reference documents
        ├── assets/           # Optional — templates, data files
        └── scripts/          # Optional — reference scripts (read-only)
```

### Creating a Skill

You can create skills in two ways:

**Via the agent:**

```
User: Create a skill called "meeting-notes" that helps me process and organize meeting notes
```

The agent will create the skill directory and `SKILL.md` file with appropriate instructions.

**Manually:**

1. Create a folder in `gemini-scribe/Skills/` (e.g., `meeting-notes/`)
2. Add a `SKILL.md` file with frontmatter and instructions

### SKILL.md Format

Each skill has a simple format — YAML frontmatter with metadata, followed by markdown instructions:

```yaml
---
name: meeting-notes
description: >-
  Process raw meeting notes into structured summaries with action items,
  decisions, and follow-ups.
---

# Meeting Notes Processor

When activated, follow these steps:

1. Read the meeting notes provided
2. Extract key discussion points
3. Identify action items with owners and deadlines
4. List decisions made
5. Note follow-up items
6. Format as a structured summary
```

### Naming Rules

Skill names must follow these rules:

- Lowercase letters, numbers, and hyphens only
- 1–64 characters
- No consecutive hyphens (`--`)
- Cannot start or end with a hyphen

**Valid:** `code-review`, `daily-planner`, `research-assistant`
**Invalid:** `Code Review`, `--my-skill`, `my--skill-`

## Using Skills

### Automatic Activation

The agent automatically activates relevant skills based on your request:

```
User: Review the code in my latest note

Agent: I'll activate the code-review skill to help with this...
[Activates code-review skill]
[Follows skill instructions to review code]
```

### Manual Activation

You can also ask the agent to use a specific skill:

```
User: Use the meeting-notes skill to process today's standup notes
```

### Listing Skills

Ask the agent what's available:

```
User: What skills do you have?

Agent: I have the following skills available:
- meeting-notes: Process raw meeting notes into structured summaries
- code-review: Review code for quality, patterns, and potential issues
- daily-planner: Create and manage daily plans from tasks and calendar
```

### Accessing Skill Resources

Skills can include reference documents, templates, and other files. The agent can access these via the `activate_skill` tool:

```
User: Show me the style guide from the code-review skill

Agent: Let me load that resource...
[Loads references/style-guide.md from code-review skill]
```

## Skill Design Tips

### Keep Instructions Focused

Write clear, step-by-step instructions. The agent follows them literally, so be specific about what you want.

### Use Resources for Reference Material

Put lengthy reference documents in the `references/` directory rather than in the main `SKILL.md`. This keeps the core instructions concise while making detailed reference material available when needed.

### Test Iteratively

Start with a simple skill and refine based on results. Ask the agent to activate the skill and observe how it interprets the instructions.

### Example: Research Skill

```yaml
---
name: research-assistant
description: >-
  Conduct structured research on a topic using web search and vault notes,
  producing a comprehensive report with citations.
---

# Research Assistant

## Process

1. **Understand the topic** — Ask clarifying questions if the research scope is unclear
2. **Search the vault** — Look for existing notes related to the topic
3. **Search the web** — Use Google Search for current information
4. **Fetch sources** — Read promising web pages for detailed content
5. **Synthesize** — Combine vault knowledge and web findings
6. **Create report** — Write a structured note with:
   - Executive summary
   - Key findings (with citations)
   - Connections to existing vault notes
   - Suggested follow-up topics
```

## Troubleshooting

### Skill Not Discovered

- Ensure the skill folder is inside `gemini-scribe/Skills/`
- Check that `SKILL.md` exists (exact filename, case-sensitive)
- Verify the frontmatter has both `name` and `description` fields
- Restart the plugin if you just created the skill

### Skill Not Activating

- The agent may not recognize the task matches — try asking it directly: "Use the X skill"
- Check that the skill description clearly explains when to use it
- Ensure the skill name in the frontmatter matches the folder name

### Instructions Not Followed Correctly

- Simplify instructions — shorter, clearer steps work better
- Be explicit rather than implicit in your instructions
- Test with a specific example and iterate

## Further Reading

- [agentskills.io Specification](https://agentskills.io) — The open standard for agent skills
- [Agent Mode Guide](/guide/agent-mode) — Full agent documentation including skill tools
