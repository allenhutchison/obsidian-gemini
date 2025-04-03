export interface BasicGeminiConversationEntry {
    role: 'user' | 'model';
    message: string;
    userMessage?: string;
    model?: string;
}

export interface GeminiConversationEntry extends BasicGeminiConversationEntry {
    id?: number;
    notePath: string;
    created_at: Date;
    metadata?: Record<string, any>;
} 