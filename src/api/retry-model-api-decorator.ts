import { ModelApi, BaseModelRequest, ExtendedModelRequest, ModelResponse } from './interfaces/model-api';
import ObsidianGemini from '../../main';
import { Notice } from 'obsidian';

export class RetryModelApiDecorator implements ModelApi {
    private decoratedApi: ModelApi;
    private plugin: ObsidianGemini;

    constructor(decoratedApi: ModelApi, plugin: ObsidianGemini) {
        this.decoratedApi = decoratedApi;
        this.plugin = plugin;
    }

    async generateModelResponse(request: BaseModelRequest | ExtendedModelRequest): Promise<ModelResponse> {
        let attempts = 0;
        const maxRetries = this.plugin.settings.maxRetries ?? 3; // Default to 3 if not set
        const initialBackoffDelay = this.plugin.settings.initialBackoffDelay ?? 1000; // Default to 1000ms if not set

        while (attempts < maxRetries) {
            try {
                // Add a small delay before the first attempt if it's a retry,
                // but not for the very first attempt (attempts === 0)
                if (attempts > 0) {
                    const backoffDelay = initialBackoffDelay * (2 ** (attempts -1)); // Exponential backoff for subsequent retries
                    new Notice(`Model request failed. Retrying in ${backoffDelay / 1000}s... (Attempt ${attempts + 1}/${maxRetries})`);
                    await new Promise(resolve => setTimeout(resolve, backoffDelay));
                }
                const response = await this.decoratedApi.generateModelResponse(request);
                return response;
            } catch (error) {
                attempts++;
                if (attempts >= maxRetries) {
                    new Notice(`Model request failed after ${maxRetries} attempts. Please try again later.`);
                    throw error; // Re-throw the error after max retries
                }
                // Notice for the next retry is handled at the beginning of the loop if attempts > 0
            }
        }
        // This part should ideally not be reached if maxRetries is >= 1,
        // as the loop either returns a response or throws an error.
        // However, to satisfy TypeScript's need for a return path:
        throw new Error('Retry loop finished without success or definitive error.');
    }
}
