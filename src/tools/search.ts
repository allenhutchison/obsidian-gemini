import { DynamicRetrievalMode, GenerativeModel, GoogleGenerativeAI } from '@google/generative-ai';

export class GeminiSearchTool {
	private gemini: GoogleGenerativeAI;
	private searchModel: GenerativeModel;
	private apiKey: string;
	private modelName: string;
	private searchGroundingThreshold: number;

	constructor(systemInstruction: string, apiKey: string, modelName: string, searchGroundingThreshold: number) {
		this.apiKey = apiKey;
		this.modelName = modelName;
		this.searchGroundingThreshold = searchGroundingThreshold;
		this.gemini = new GoogleGenerativeAI(this.apiKey);
		this.searchModel = this.gemini.getGenerativeModel({
			model: this.modelName,
			systemInstruction: systemInstruction,
			tools: this.getTools(),
		});
	}

	public getSearchModel(): GenerativeModel {
		return this.searchModel;
	}

	private getTools(): any[] {
		let tools: any[] = [];
		switch (true) {
			case this.modelName.startsWith('gemini-2.0-flash-lite'):
				// Logic for flash-lite and flash-thinking don't currently support search
				tools = [];
				break;
			case this.modelName.startsWith('gemini-2.0') || this.modelName.startsWith('gemini-2.5'):
				tools = [
					{
						google_search: {},
					},
				];
				break;
			default:
				tools = [
					{
						googleSearchRetrieval: {
							dynamicRetrievalConfig: {
								mode: DynamicRetrievalMode.MODE_DYNAMIC,
								dynamicThreshold: this.searchGroundingThreshold,
							},
						},
					},
				];
				break;
		}
		return tools;
	}
}
