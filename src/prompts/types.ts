export interface CustomPrompt {
	name: string;
	description: string;
	version: number;
	overrideSystemPrompt: boolean;
	tags: string[];
	content: string;
}

export interface PromptInfo {
	path: string;
	name: string;
	description: string;
	tags: string[];
}