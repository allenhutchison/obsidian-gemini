# Tool Development Guide

This guide explains how to create custom tools for the Obsidian Gemini Scribe agent mode.

## Overview

Tools are functions that the AI agent can call to interact with your vault and external services. Each tool has:
- A unique name
- Parameters it accepts
- A category (for permissions)
- An execution function

## Tool Interface

All tools must implement the `Tool` interface:

```typescript
interface Tool {
    name: string;                    // Unique identifier (e.g., "read_file")
    displayName: string;             // Human-readable name
    category: ToolCategory;          // Permission category
    description: string;             // What the tool does
    parameters: {                    // JSON Schema for parameters
        type: 'object';
        properties: Record<string, any>;
        required?: string[];
    };
    execute(params: any, context: ToolExecutionContext): Promise<ToolResult>;
}
```

## Tool Categories

Tools are grouped into categories for permission control:

```typescript
enum ToolCategory {
    READ_ONLY = 'read_only',           // Reading files, searching
    VAULT_OPERATIONS = 'vault_operations', // Creating, modifying, deleting
    WEB_OPERATIONS = 'web_operations'      // Web search, URL fetching
}
```

## Creating a Simple Tool

Here's a basic example of a word count tool:

```typescript
import { Tool, ToolResult, ToolExecutionContext } from '../tools/types';
import { ToolCategory } from '../types/agent';

export class WordCountTool implements Tool {
    name = 'word_count';
    displayName = 'Word Count';
    category = ToolCategory.READ_ONLY;
    description = 'Count words in a file';
    
    parameters = {
        type: 'object' as const,
        properties: {
            path: {
                type: 'string' as const,
                description: 'Path to the file'
            }
        },
        required: ['path']
    };
    
    async execute(
        params: { path: string }, 
        context: ToolExecutionContext
    ): Promise<ToolResult> {
        const plugin = context.plugin;
        
        try {
            // Get the file
            const file = plugin.app.vault.getAbstractFileByPath(params.path);
            if (!file || !(file instanceof TFile)) {
                return {
                    success: false,
                    error: 'File not found'
                };
            }
            
            // Read content
            const content = await plugin.app.vault.read(file);
            const wordCount = content.split(/\s+/).filter(w => w.length > 0).length;
            
            return {
                success: true,
                data: {
                    path: params.path,
                    wordCount: wordCount,
                    message: `File contains ${wordCount} words`
                }
            };
        } catch (error) {
            return {
                success: false,
                error: `Error counting words: ${error.message}`
            };
        }
    }
}
```

## Registering Your Tool

Add your tool to the registry in your plugin:

```typescript
// In your plugin's onload method
const wordCountTool = new WordCountTool();
this.toolRegistry.registerTool(wordCountTool);
```

## Best Practices

### 1. **Parameter Validation**
Always validate parameters before using them:

```typescript
if (!params.path || typeof params.path !== 'string') {
    return {
        success: false,
        error: 'Invalid path parameter'
    };
}
```

### 2. **Error Handling**
Wrap operations in try-catch blocks:

```typescript
try {
    // Your tool logic
} catch (error) {
    return {
        success: false,
        error: `Tool failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
}
```

### 3. **System Folder Protection**
Check for protected paths:

```typescript
import { shouldExcludePath } from '../tools/vault-tools';

if (shouldExcludePath(params.path, plugin)) {
    return {
        success: false,
        error: 'Cannot access protected system folder'
    };
}
```

### 4. **Permissions**
Respect the context permissions:

```typescript
// Check if tool category is enabled
const session = context.session;
if (!session.context.enabledTools.includes(this.category)) {
    return {
        success: false,
        error: 'Tool category not enabled for this session'
    };
}
```

### 5. **Return Meaningful Data**
Provide clear, structured responses:

```typescript
return {
    success: true,
    data: {
        // Include relevant information
        processedFiles: 5,
        results: [...],
        summary: 'Processed 5 files successfully'
    }
};
```

## Advanced Example: Batch File Processor

Here's a more complex tool that processes multiple files:

```typescript
export class BatchProcessorTool implements Tool {
    name = 'batch_process';
    displayName = 'Batch Process Files';
    category = ToolCategory.READ_ONLY;
    description = 'Process multiple files matching a pattern';
    
    parameters = {
        type: 'object' as const,
        properties: {
            pattern: {
                type: 'string' as const,
                description: 'File pattern (e.g., "*.md")'
            },
            operation: {
                type: 'string' as const,
                enum: ['count_words', 'find_todos', 'list_headers'],
                description: 'Operation to perform'
            }
        },
        required: ['pattern', 'operation']
    };
    
    async execute(params: any, context: ToolExecutionContext): Promise<ToolResult> {
        const plugin = context.plugin;
        const results = [];
        
        try {
            // Get all markdown files
            const files = plugin.app.vault.getMarkdownFiles();
            
            // Filter by pattern
            const regex = new RegExp(params.pattern.replace('*', '.*'));
            const matchingFiles = files.filter(f => regex.test(f.path));
            
            // Process each file
            for (const file of matchingFiles) {
                const content = await plugin.app.vault.read(file);
                
                switch (params.operation) {
                    case 'count_words':
                        const words = content.split(/\s+/).length;
                        results.push({ file: file.path, words });
                        break;
                        
                    case 'find_todos':
                        const todos = content.match(/- \[ \].*/g) || [];
                        if (todos.length > 0) {
                            results.push({ file: file.path, todos });
                        }
                        break;
                        
                    case 'list_headers':
                        const headers = content.match(/^#+\s+.*/gm) || [];
                        results.push({ file: file.path, headers });
                        break;
                }
            }
            
            return {
                success: true,
                data: {
                    pattern: params.pattern,
                    operation: params.operation,
                    filesProcessed: matchingFiles.length,
                    results: results
                }
            };
            
        } catch (error) {
            return {
                success: false,
                error: `Batch processing failed: ${error.message}`
            };
        }
    }
}
```

## Testing Your Tool

Create a test file for your tool:

```typescript
import { WordCountTool } from './word-count-tool';

describe('WordCountTool', () => {
    let tool: WordCountTool;
    let mockPlugin: any;
    
    beforeEach(() => {
        tool = new WordCountTool();
        mockPlugin = {
            app: {
                vault: {
                    getAbstractFileByPath: jest.fn(),
                    read: jest.fn()
                }
            }
        };
    });
    
    it('should count words correctly', async () => {
        const mockFile = { path: 'test.md' };
        mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(mockFile);
        mockPlugin.app.vault.read.mockResolvedValue('Hello world test');
        
        const result = await tool.execute(
            { path: 'test.md' },
            { plugin: mockPlugin, session: {} as any }
        );
        
        expect(result.success).toBe(true);
        expect(result.data.wordCount).toBe(3);
    });
});
```

## Tool Ideas

Here are some ideas for custom tools:

1. **Template Inserter**: Insert templates at specific locations
2. **Link Validator**: Check for broken internal links
3. **Tag Manager**: Add/remove tags from multiple files
4. **Note Archiver**: Move old notes to an archive folder
5. **Statistics Generator**: Generate vault statistics
6. **Backup Creator**: Create timestamped backups
7. **Format Checker**: Validate markdown formatting
8. **Reference Updater**: Update references when files move

## Contributing Tools

If you create a useful tool:

1. Ensure it follows the coding standards
2. Add comprehensive tests
3. Document the parameters clearly
4. Submit a pull request with examples

## Security Considerations

- Never expose sensitive information in tool results
- Always validate user input
- Respect vault permissions and protected folders
- Use the permission system appropriately
- Test edge cases thoroughly