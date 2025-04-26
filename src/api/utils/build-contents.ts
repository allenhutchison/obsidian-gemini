// Utility to build Gemini chat contents for both GeminiApi and GeminiApiNew
import { ExtendedModelRequest } from '../interfaces/model-api';

export interface GeminiContextBuilderOptions {
  prompt: string;
  userMessage: string;
  conversationHistory?: any[];
  datePrompt?: string;
  timePrompt?: string;
  fileContext?: string | null;
  sendContext?: boolean;
  debugFn?: (title: string, data: any) => void;
}

export async function buildGeminiChatContents(opts: GeminiContextBuilderOptions): Promise<any[]> {
  const contents: any[] = [];

  // Base prompt
  if (opts.prompt != null) {
    contents.push({
      role: 'user',
      parts: [{ text: opts.prompt }],
    });
  }

  // Date
  if (opts.datePrompt) {
    contents.push({
      role: 'user',
      parts: [{ text: opts.datePrompt }],
    });
  }

  // File context
  if (opts.sendContext && opts.fileContext) {
    if (opts.debugFn) opts.debugFn('File context', opts.fileContext);
    contents.push({
      role: 'user',
      parts: [{ text: opts.fileContext }],
    });
  } else if (opts.sendContext && opts.debugFn) {
    opts.debugFn('File context', 'Context sending enabled but no context provided');
  }

  // Conversation history
  const history = opts.conversationHistory ?? [];
  history.forEach((entry) => {
    let role = entry.role === 'model' ? 'model' : 'user';
    contents.push({
      role: role,
      parts: [{ text: entry.message }],
    });
  });

  // Time
  if (opts.timePrompt) {
    contents.push({
      role: 'user',
      parts: [{ text: opts.timePrompt }],
    });
  }

  // Latest user message
  if (opts.userMessage) {
    contents.push({
      role: 'user',
      parts: [{ text: opts.userMessage }],
    });
  }

  return contents;
}
