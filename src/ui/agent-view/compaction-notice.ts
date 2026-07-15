import { GeminiConversationEntry } from '../../types/conversation';

/**
 * Build the "Context Compacted" conversation entry that is displayed and
 * persisted to session history when older turns are summarized to stay within
 * the token budget.
 *
 * Both compaction paths surface the identical notice — the pre-turn path in
 * `agent-view-send.ts` and the mid-loop `onMidLoopCompaction` hook in
 * `agent-view-tools.ts` (#662) — so the callout markup and entry shape live
 * here to keep the two in lockstep.
 *
 * The message is persisted to the session markdown as an `[!info]` callout, so
 * it stays English (not routed through `t()`) per the repo string invariant.
 */
export function buildCompactionEntry(summaryText: string, model: string): GeminiConversationEntry {
	return {
		role: 'model',
		message: `> [!info] Context Compacted\n> Older conversation turns have been summarized to maintain performance.\n\n${summaryText}`,
		notePath: '',
		created_at: new Date(),
		model,
	};
}
