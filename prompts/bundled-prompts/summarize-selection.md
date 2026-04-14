---
name: 'Summarize Selection'
description: 'Get a concise summary of the selected text'
version: 1
override_system_prompt: false
tags: ['gemini-scribe/selection-prompt']
---

Please provide a concise summary of the following text:

- Capture the main points, key takeaways, and action items if applicable
- Keep it brief but comprehensive
- Preserve the essential meaning
- Use bullet points if appropriate

{{selection}}
