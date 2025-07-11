// Test to understand how the Google AI SDK processes tools
// This simulates what might be happening in the SDK

const tools = [
    { googleSearch: {} },
    {
        function_declarations: [
            {
                name: 'read_file',
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
            }
        ]
    }
];

console.log('Original tools:', JSON.stringify(tools, null, 2));

// Simulate what might happen during JSON serialization
const serialized = JSON.stringify(tools);
console.log('\nSerialized:', serialized);

const parsed = JSON.parse(serialized);
console.log('\nParsed back:', JSON.stringify(parsed, null, 2));

// Check if the SDK might be doing something weird with the tools
console.log('\nChecking each tool:');
tools.forEach((tool, index) => {
    console.log(`Tool ${index}:`, tool);
    console.log('  Type:', typeof tool);
    console.log('  Constructor:', tool.constructor.name);
    console.log('  Keys:', Object.keys(tool));
    console.log('  Is plain object:', tool.constructor === Object);
});

// Test what happens if we pass non-plain objects
class CustomTool {
    constructor() {
        this.name = 'test';
    }
}

const customTools = [
    { googleSearch: {} },
    new CustomTool()
];

console.log('\nCustom tools test:');
console.log('Serialized custom:', JSON.stringify(customTools));

// Test if empty objects are added somewhere
const testArray = [{ a: 1 }];
testArray.push(...[]);  // This shouldn't add anything
console.log('\nTest array after push empty:', testArray);

const testArray2 = [{ a: 1 }];
testArray2.push(...[undefined, null, {}, { b: 2 }].filter(Boolean));
console.log('Test array after push with filter:', testArray2);