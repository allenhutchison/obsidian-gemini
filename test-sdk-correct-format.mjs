// Test different tool formats with the Google AI SDK
// Based on the SDK examples

import { GoogleGenAI } from '@google/genai';

const mockApiKey = 'test-key-123';

// Try different tool formats
const formats = [
  {
    name: 'Format 1: function_declarations at root',
    tools: {
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
  },
  {
    name: 'Format 2: array with function_declarations',
    tools: [
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
    ]
  },
  {
    name: 'Format 3: mixed array with googleSearch',
    tools: [
      { googleSearch: {} },
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
    ]
  }
];

// Create AI instance
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

// Test each format
for (const format of formats) {
  console.log(`\n=== Testing ${format.name} ===`);
  console.log('Input:', JSON.stringify(format.tools, null, 2));
  
  try {
    await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      config: {
        systemInstruction: 'Test',
        tools: format.tools
      },
      contents: [{ parts: [{ text: 'Hello' }], role: 'user' }]
    });
  } catch (error) {
    console.error('Error:', error.message);
  }
}

// Restore
global.fetch = originalFetch;