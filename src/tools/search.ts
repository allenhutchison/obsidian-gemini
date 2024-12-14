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
        switch (this.modelName) {
            case 'gemini-2.0-flash-exp':
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