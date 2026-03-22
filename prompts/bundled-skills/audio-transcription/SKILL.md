---
name: audio-transcription
description: Transcribe audio and video files into structured notes. Activate this skill when users want to transcribe recordings, meetings, podcasts, voice memos, or any audio/video content in their vault.
---

# Audio & Video Transcription

Transcribe audio and video files from the vault into structured Obsidian notes using `read_file` to send binary media directly to the model.

## Supported Formats

Audio: `.wav`, `.mp3`, `.aac`, `.flac`, `.webm` (audio-only)
Video: `.mp4`, `.mpeg`, `.mov`, `.flv`, `.mpg`, `.webm`, `.wmv`, `.3gp`

**Size limit:** 20 MB per file (Gemini inline data limit).

## How to Transcribe

1. Use `read_file` with the path to the audio/video file — the binary data is sent directly to the model for processing.
2. Listen to/watch the content and produce a transcription.
3. Use `write_file` to save the transcription as a markdown note.

## Transcription Format

Structure transcriptions as follows:

```markdown
---
tags:
  - transcription
source: "[[original-file.mp3]]"
date: YYYY-MM-DD
duration: "MM:SS" (estimate if possible)
---

# Transcription: [Title]

## Summary

Brief 2-3 sentence summary of the content.

## Transcript

[00:00] Speaker 1: Opening remarks...

[00:45] Speaker 2: Response...

[01:30] Speaker 1: Follow-up...
```

### Guidelines

- **Timestamps**: Include approximate timestamps in `[MM:SS]` format at natural breaks (new speakers, topic changes, pauses).
- **Speaker identification**: Label distinct speakers as "Speaker 1", "Speaker 2", etc. If names are mentioned, use them after first identification.
- **Filler words**: Omit excessive filler words (um, uh, like) unless they carry meaning.
- **Inaudible sections**: Mark unclear audio as `[inaudible]` or `[unclear]`.
- **Non-speech sounds**: Note significant sounds like `[laughter]`, `[applause]`, `[music]`.
- **Summary**: Always include a brief summary at the top for quick reference.
- **Frontmatter**: Link back to the source file using a wikilink.

## Tips

- For long recordings, let the user know the transcription may be partial due to the 20 MB size limit. Suggest splitting large files with an external tool.
- If the user asks to "transcribe the recording in this note", use `read_file` on the current note first to find embedded audio/video links (e.g., `![[recording.mp3]]`), then `read_file` on the linked file.
- For meeting notes, suggest adding attendees and action items sections after the transcript.
- For podcasts or interviews, suggest adding a "Key Topics" section with timestamps.
