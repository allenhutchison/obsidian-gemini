// Test camelCase vs snake_case for function declarations

import { GoogleGenAI } from '@google/genai';

const mockApiKey = 'test-key-123';
const ai = new GoogleGenAI({ apiKey: mockApiKey });

// Intercept fetch
const originalFetch = global.fetch;
global.fetch = async (url, options) => {
  if (options && options.body) {
    const body = JSON.parse(options.body);
    console.log('Tools in request:', JSON.stringify(body.tools, null, 2));
  }
  
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
    })
  };
};

// Test snake_case
console.log('\n=== Testing function_declarations (snake_case) ===');
try {
  await ai.models.generateContent({
    model: 'gemini-2.0-flash',
    config: {
      tools: [{
        function_declarations: [{
          name: 'test',
          description: 'Test function',
          parameters: { type: 'object', properties: {}, required: [] }
        }]
      }]
    },
    contents: [{ parts: [{ text: 'Hello' }], role: 'user' }]
  });
} catch (e) {
  console.error('Error:', e.message);
}

// Test camelCase
console.log('\n=== Testing functionDeclarations (camelCase) ===');
try {
  await ai.models.generateContent({
    model: 'gemini-2.0-flash',
    config: {
      tools: [{
        functionDeclarations: [{
          name: 'test',
          description: 'Test function',
          parameters: { type: 'object', properties: {}, required: [] }
        }]
      }]
    },
    contents: [{ parts: [{ text: 'Hello' }], role: 'user' }]
  });
} catch (e) {
  console.error('Error:', e.message);
}

global.fetch = originalFetch;