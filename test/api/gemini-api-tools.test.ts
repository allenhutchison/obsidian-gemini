import { Tool } from '../../src/tools/types';
import { ToolCategory } from '../../src/types/agent';

describe('Gemini API Tools Formatting', () => {
	test('should format tools correctly for Gemini API', () => {
		// Define test tools similar to what we have
		const testTools: Tool[] = [
			{
				name: 'read_file',
				category: ToolCategory.READ_ONLY,
				description: 'Read the contents of a file in the vault',
				parameters: {
					type: 'object',
					properties: {
						path: {
							type: 'string',
							description: 'Path to the file to read'
						}
					},
					required: ['path']
				},
				execute: async () => ({ success: true, data: 'test' })
			},
			{
				name: 'list_files',
				category: ToolCategory.VAULT_OPERATIONS,
				description: 'List files and folders in a directory',
				parameters: {
					type: 'object',
					properties: {
						path: {
							type: 'string',
							description: 'Path to the directory to list'
						},
						recursive: {
							type: 'boolean',
							description: 'Whether to list files recursively'
						}
					},
					required: ['path']
				},
				execute: async () => ({ success: true, data: [] })
			}
		];

		// Simulate what happens in the Gemini API implementation
		let tools: any[] = [];
		
		// Add Google Search if enabled
		tools.push({ googleSearch: {} });
		
		// Convert tools to function declarations format
		const functionDeclarations = testTools.map(tool => ({
			name: tool.name,
			description: tool.description,
			parameters: {
				type: 'object' as const,
				properties: tool.parameters.properties || {},
				required: tool.parameters.required || []
			}
		}));
		
		// Add function declarations as a single tool entry
		if (functionDeclarations.length > 0) {
			tools.push({
				function_declarations: functionDeclarations
			});
		}

		// Check the result
		console.log('Tools array:', JSON.stringify(tools, null, 2));
		
		expect(tools).toHaveLength(2);
		expect(tools[0]).toEqual({ googleSearch: {} });
		expect(tools[1]).toHaveProperty('function_declarations');
		expect(tools[1].function_declarations).toHaveLength(2);
		
		// Ensure no empty objects
		tools.forEach((tool, index) => {
			expect(Object.keys(tool).length).toBeGreaterThan(0);
		});
	});

	test('should handle empty tools array', () => {
		const testTools: Tool[] = [];
		
		let tools: any[] = [];
		
		// Add Google Search if enabled
		tools.push({ googleSearch: {} });
		
		// Convert tools to function declarations format
		const functionDeclarations = testTools.map(tool => ({
			name: tool.name,
			description: tool.description,
			parameters: {
				type: 'object' as const,
				properties: tool.parameters.properties || {},
				required: tool.parameters.required || []
			}
		}));
		
		// Add function declarations as a single tool entry
		if (functionDeclarations.length > 0) {
			tools.push({
				function_declarations: functionDeclarations
			});
		}

		// Check the result
		console.log('Tools array with no custom tools:', JSON.stringify(tools, null, 2));
		
		// Should only have Google Search
		expect(tools).toHaveLength(1);
		expect(tools[0]).toEqual({ googleSearch: {} });
	});
});