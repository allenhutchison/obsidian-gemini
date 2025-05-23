import { GeminiApiNew } from './gemini-api-new';
import { GoogleGenAI } from '@google/genai'; // Ensure this is imported for mocking
import ObsidianGemini from '../../../main'; // Adjust path as necessary
import { BaseModelRequest } from '../interfaces/model-api'; // Adjust path as necessary

// Mock @google/genai
jest.mock('@google/genai', () => {
  const mockGenerateContent = jest.fn();
  return {
    GoogleGenAI: jest.fn().mockImplementation(() => ({
      models: { // Using 'models' as per the subtask's example
        generateContent: mockGenerateContent,
      },
    })),
    mockGenerateContent, // Export for test manipulation
  };
});

// Mock ObsidianGemini plugin
jest.mock('../../../main', () => {
  return jest.fn().mockImplementation(() => ({
    settings: {
      apiKey: 'test-api-key',
      chatModelName: 'gemini-pro', // chatModelName is used by GeminiApiNew
      debugMode: false,
      userName: 'TestUser', 
      // ... other settings
    },
    prompts: { 
      systemPrompt: jest.fn().mockReturnValue('System Instruction Text'),
    },
    gfile: { 
      getCurrentFileContent: jest.fn().mockResolvedValue(null),
    }
  }));
});


describe('GeminiApiNew', () => {
  let geminiApiNew: GeminiApiNew;
  let mockPluginInstance: ObsidianGemini;
  // Get the mockGenerateContent function from the mocked @google/genai
  const { mockGenerateContent } = require('@google/genai');

  beforeEach(() => {
    mockPluginInstance = new (ObsidianGemini as any)();
    // When GeminiApiNew is instantiated, it will try to get the generative model.
    // The mock for GoogleGenAI needs to correctly provide 'models.generateContent' if that's what GeminiApiNew expects,
    // or 'getGenerativeModel().generateContent' if it expects that.
    // The actual code in gemini-api-new.ts uses:
    // const genAI = new GoogleGenAI(this.plugin.settings.apiKey);
    // this.model = genAI.getGenerativeModel({ model: chatModelName });
    // So, the GoogleGenAI mock should be:
    // getGenerativeModel: jest.fn().mockImplementation(() => ({ generateContent: mockGenerateContent }))
    // However, the subtask strictly provides the 'models.generateContent' structure.
    // For this step, I will adhere to the subtask's provided mock structure.
    // This might mean the test won't pass if GeminiApiNew isn't aligned with this mock.
    geminiApiNew = new GeminiApiNew(mockPluginInstance); 
    mockGenerateContent.mockClear(); 
  });

  describe('generateModelResponse and parseModelResult', () => {
    it('should correctly decode HTML entities in the markdown response', async () => {
      // mockApiResponse structure as per the subtask's example (direct text method on the object returned by generateContent)
      const mockApiResponse = {
        // This mock structure implies that the object returned by `generateContent`
        // (which is `result` in `gemini-api-new.ts`) has a `text()` method directly.
        // The actual `gemini-api-new.ts` uses `result.response.text()`.
        // Adhering to the subtask's example for `mockApiResponse` for now.
        text: () => 'This is a &quot;test&quot; with an apostrophe &#x27;s and another &amp;amp; entity.',
      };
      mockGenerateContent.mockResolvedValue(mockApiResponse);

      const request: BaseModelRequest = {
        prompt: 'Tell me about quotes.',
      };

      const response = await geminiApiNew.generateModelResponse(request);
      
      expect(response.markdown).toBe('This is a "test" with an apostrophe \'s and another &amp; entity.');
    });

    it('should handle responses with no HTML entities', async () => {
      const mockApiResponse = {
        text: () => 'This is a plain sentence.',
      };
      mockGenerateContent.mockResolvedValue(mockApiResponse);

      const request: BaseModelRequest = { prompt: 'A plain prompt.' };
      const response = await geminiApiNew.generateModelResponse(request);
      expect(response.markdown).toBe('This is a plain sentence.');
    });
    
    it('should correctly decode mixed content with HTML entities', async () => {
      const mockApiResponse = {
        text: () => 'Text &quot;One&quot; and text &#x27;Two&#x27; plus &lt;tag&gt;.',
      };
      mockGenerateContent.mockResolvedValue(mockApiResponse);
      const request: BaseModelRequest = { prompt: 'Test mixed content' };
      const response = await geminiApiNew.generateModelResponse(request);
      expect(response.markdown).toBe('Text "One" and text \'Two\' plus <tag>.');
    });

    it('should return empty string for markdown if text is not present in response', async () => {
      // This mock implies that the object returned by generateContent might not have a text() method,
      // or text() might return undefined/null.
      const mockApiResponse = {
        // no text field or text() method.
        // parseModelResult in GeminiApiNew should handle this.
      };
      mockGenerateContent.mockResolvedValue(mockApiResponse);
      const request: BaseModelRequest = { prompt: 'Test no text' };
      const response = await geminiApiNew.generateModelResponse(request);
      expect(response.markdown).toBe(''); 
    });
  });
});
