---
name: 'Translate Selection'
description: 'Translate the selected text to a target language'
version: 1
override_system_prompt: false
tags: ['gemini-scribe/selection-prompt']
---

Please translate the following text to the requested language (or English if not specified). Maintain the original tone and meaning:

{{selection}}
