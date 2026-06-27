export interface BasicGeminiConversationEntry {
	role: 'user' | 'model' | 'system';
	message: string;
	userMessage?: string;
	model?: string;
	metadata?: Record<string, any>;
}

export interface GeminiConversationEntry extends BasicGeminiConversationEntry {
	id?: number;
	notePath: string;
	created_at: Date;
	metadata?: Record<string, any>;
	/**
	 * Model reasoning ("thinking") captured for this turn, when the model is a
	 * thinking model and emitted thought summaries. Persisted to session history
	 * as a collapsed `[!reasoning]` callout and rendered as a collapsible section
	 * below the message. A model entry may carry `thoughts` with an empty
	 * `message` — that represents reasoning the model produced before deciding to
	 * call tools (a "reasoning-only" turn).
	 */
	thoughts?: string;
	/**
	 * When true, this entry is an agent-generated implementation plan awaiting
	 * approval. Plan entries use a `[!plan]+` callout in history and render
	 * distinctly in the UI. The plan is persisted to history before the execution
	 * loop starts so it participates in Gemini's implicit prefix cache.
	 */
	isPlan?: boolean;
}
