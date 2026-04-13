---
name: 'Explain Code'
description: 'Get a detailed walkthrough of selected code'
version: 1
override_system_prompt: false
tags: ['gemini-scribe/selection-prompt']
---

Please provide a detailed explanation of this code:

- Identify the programming language and framework if applicable
- Explain what the code does step by step
- Describe the purpose of key variables and functions
- Note any patterns or techniques being used
- Analyze the time and space complexity (Big O notation)
- Mention potential edge cases or considerations
- Suggest improvements if appropriate

{{selection}}
