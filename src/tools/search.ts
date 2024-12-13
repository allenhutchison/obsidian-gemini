import ObsidianGemini from '../../main';
import { DynamicRetrievalMode, GenerativeModel, GoogleGenerativeAI } from '@google/generative-ai';

export class GeminiSearchTool {
    private plugin: ObsidianGemini;
    private gemini: GoogleGenerativeAI;
    private searchModel: GenerativeModel;


    constructor(plugin: ObsidianGemini, systemInstruction: string) {
        this.plugin = plugin;
        this.gemini = new GoogleGenerativeAI(plugin.settings.apiKey);
        this.searchModel = this.gemini.getGenerativeModel({
            model: plugin.settings.chatModelName,
            systemInstruction: systemInstruction,
            tools: this.getTools(),
        });
    }

    public getSearchModel(): GenerativeModel {
        return this.searchModel;
    }

    private getTools(): any[] {
        const modelName = this.plugin.settings.chatModelName;
        let tools: any[] = [];
        switch (modelName) {
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
                                dynamicThreshold: this.plugin.settings.searchGroundingThreshold,
                            },
                        },
                    },
                ];
            break;
        }
        return tools;
    }
}