---
name: 'Explain Selection'
description: 'Get a clear explanation of the selected text'
version: 1
override_system_prompt: false
tags: ['gemini-scribe/selection-prompt']
---

Please explain the following text in a clear and accessible way:

- Break down any complex concepts
- Define technical terms if present
- Provide relevant context if helpful
- Use examples to illustrate key points

{{selection}}
