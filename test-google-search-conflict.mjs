// Test if Google Search conflicts with function calling

import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import path from 'path';
import os from 'os';

console.log('Testing Google Search + function calling compatibility');
console.log('Node version:', process.version);

// Try to load API key from ~/.env
let apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
try {
  const envPath = path.join(os.homedir(), '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    const match = envContent.match(/(?:GEMINI_API_KEY|GOOGLE_API_KEY)=(.+)/);
    if (match) {
      apiKey = match[1].trim();
    }
  }
} catch (e) {}

if (!apiKey) {
  console.error('No API key found. Set GEMINI_API_KEY or GOOGLE_API_KEY');
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });

// Test configurations
const tests = [
  {
    name: 'Only function declarations',
    tools: [{
      functionDeclarations: [{
        name: 'list_files',
        description: 'List files in a directory',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Directory path' }
          },
          required: ['path']
        }
      }]
    }]
  },
  {
    name: 'Only Google Search',
    tools: [{ googleSearch: {} }]
  },
  {
    name: 'Both Google Search and function declarations',
    tools: [
      { googleSearch: {} },
      {
        functionDeclarations: [{
          name: 'list_files',
          description: 'List files in a directory',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'Directory path' }
            },
            required: ['path']
          }
        }]
      }
    ]
  }
];

// Run tests
for (const test of tests) {
  console.log(`\n=== ${test.name} ===`);
  try {
    const result = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      config: {
        systemInstruction: 'You are a helpful assistant. Use tools when appropriate.',
        tools: test.tools
      },
      contents: [{ 
        parts: [{ text: 'List the files in the current directory.' }], 
        role: 'user' 
      }]
    });
    
    console.log('✅ Success');
    console.log('Response:', result.candidates?.[0]?.content?.parts?.[0]?.text || 'No text response');
  } catch (error) {
    console.log('❌ Error:', error.message);
    if (error.message.includes('400')) {
      console.log('Details:', error.response?.data || error);
    }
  }
}