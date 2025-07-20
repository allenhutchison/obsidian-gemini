// Simple Node.js script to test the tools formatting
// Run with: node test-tools-api.js

const testTools = [
    {
        name: 'read_file',
        category: 'read_only',
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
        }
    },
    {
        name: 'list_files',
        category: 'vault_ops',
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
        }
    }
];

// Simulate the API formatting logic
function formatToolsForGemini(availableTools) {
    let tools = [];
    
    // Add Google Search if enabled
    tools.push({ googleSearch: {} });
    
    // Add available custom tools if provided
    if (availableTools && availableTools.length > 0) {
        console.log('Available tools:', availableTools.length);
        
        // Convert tools to function declarations format
        const functionDeclarations = availableTools.map(tool => ({
            name: tool.name,
            description: tool.description,
            parameters: {
                type: 'object',
                properties: tool.parameters.properties || {},
                required: tool.parameters.required || []
            }
        }));
        
        console.log('Function declarations:', JSON.stringify(functionDeclarations, null, 2));
        
        // Add function declarations as a single tool entry
        if (functionDeclarations.length > 0) {
            tools.push({
                function_declarations: functionDeclarations
            });
        }
    }
    
    console.log('Final tools array:', JSON.stringify(tools, null, 2));
    return tools;
}

// Test the formatting
const formattedTools = formatToolsForGemini(testTools);
console.log('\nExpected tools array to have', 2, 'items');
console.log('Actual tools array has', formattedTools.length, 'items');

// Check for empty objects
formattedTools.forEach((tool, index) => {
    const keys = Object.keys(tool);
    if (keys.length === 0) {
        console.error(`ERROR: Tool at index ${index} is an empty object!`);
    } else {
        console.log(`Tool at index ${index} has keys:`, keys);
    }
});