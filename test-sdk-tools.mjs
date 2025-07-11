// Test the Google AI SDK's handling of tools
// Run with: node test-sdk-tools.mjs

import { GoogleGenAI } from '@google/genai';

// Mock API key
const mockApiKey = 'test-key-123';

const tools = [
  {
    googleSearch: {}
  },
  {
    function_declarations: [
      {
        name: 'read_file',
        description: 'Read a file',
        parameters: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'File path'
            }
          },
          required: ['path']
        }
      }
    ]
  }
];

console.log('Original tools:', JSON.stringify(tools, null, 2));

// Create AI instance
const ai = new GoogleGenAI({ apiKey: mockApiKey });

// Intercept the fetch call to see what's being sent
const originalFetch = global.fetch;
global.fetch = async (url, options) => {
  console.log('\nIntercepted fetch call:');
  console.log('URL:', url);
  if (options && options.body) {
    const body = JSON.parse(options.body);
    console.log('Request body:', JSON.stringify(body, null, 2));
  }
  
  // Return a mock response
  return {
    ok: true,
    status: 200,
    json: async () => ({
      candidates: [{
        content: {
          parts: [{ text: 'Mock response' }],
          role: 'model'
        }
      }]
    }),
    text: async () => JSON.stringify({
      candidates: [{
        content: {
          parts: [{ text: 'Mock response' }],
          role: 'model'
        }
      }]
    })
  };
};

try {
  // Try to make a request with tools
  const result = await ai.models.generateContent({
    model: 'gemini-2.0-flash',
    config: {
      systemInstruction: 'You are a helpful assistant',
      tools: tools
    },
    contents: [{ parts: [{ text: 'Hello' }], role: 'user' }]
  });
  
  console.log('\nResponse received');
} catch (error) {
  console.error('Error:', error.message);
} finally {
  // Restore original fetch
  global.fetch = originalFetch;
}