import { isBaseModelRequest, isExtendedModelRequest, formatBaseModelRequest, formatExtendedModelRequest, logDebugInfo, stripFileContextNode, stripLinkedFileContents, redactLinkedFileSections } from './debug';

describe('isBaseModelRequest', () => {
  it('should return true for a valid BaseModelRequest', () => {
    const req = { prompt: 'test prompt' };
    expect(isBaseModelRequest(req)).toBe(true);
  });

  it('should return false if prompt is missing', () => {
    const req = { someOtherProp: 'value' };
    expect(isBaseModelRequest(req)).toBe(false);
  });

  it('should return false if prompt is not a string', () => {
    const req = { prompt: 123 };
    expect(isBaseModelRequest(req)).toBe(false);
  });

  it('should return false for null or undefined', () => {
    expect(isBaseModelRequest(null)).toBe(false);
    expect(isBaseModelRequest(undefined)).toBe(false);
  });

  it('should return false for non-object types', () => {
    expect(isBaseModelRequest('string')).toBe(false);
    expect(isBaseModelRequest(123)).toBe(false);
    expect(isBaseModelRequest([])).toBe(false); // Arrays are objects, but not what we expect
  });
});

describe('logDebugInfo', () => {
  let consoleLogSpy: jest.SpyInstance;

  beforeEach(() => {
    // Mock console.log before each test
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    // Restore console.log after each test
    consoleLogSpy.mockRestore();
  });

  it('should not log anything if debugMode is false', () => {
    logDebugInfo(false, 'Test Title', { data: 'some data' });
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });

  it('should log formatted ExtendedModelRequest if data is an ExtendedModelRequest', () => {
    const extendedReq = {
      prompt: 'system prompt',
      conversationHistory: [],
      userMessage: 'hello',
      model: 'gemini-pro-extended',
    };
    logDebugInfo(true, 'Extended Test', extendedReq);
    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('[GeminiAPI Debug] Extended Test (ExtendedModelRequest):')
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining(formatExtendedModelRequest(extendedReq))
    );
  });

  it('should log formatted BaseModelRequest if data is a BaseModelRequest (and not Extended)', () => {
    const baseReq = {
      prompt: 'simple prompt',
      model: 'gemini-pro-base',
    };
    logDebugInfo(true, 'Base Test', baseReq);
    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('[GeminiAPI Debug] Base Test (BaseModelRequest):')
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining(formatBaseModelRequest(baseReq))
    );
  });

  it('should log redacted string if data is a string containing "File Label:"', () => {
    const fileLabelString = "===\nFile Label: Test File\nFile Name: test.md\nWikiLink: [[test]]\n===\n\nSome content here.";
    const title = 'File Label Test';
    // No need to spy on redactLinkedFileSections, we check its effect via console.log
    // and redactLinkedFileSections is already tested separately.
    logDebugInfo(true, title, fileLabelString);
    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    expect(consoleLogSpy).toHaveBeenCalledWith(
      `[GeminiAPI Debug] ${title}:\n${redactLinkedFileSections(fileLabelString)}`
    );
  });

  it('should log stripped and stringified data for other object types', () => {
    const otherData = { key: 'value', nested: { data: 'secret' } };
    const title = 'Other Object Test';
    // No need to spy on stripLinkedFileContents, we check its effect via console.log
    // and stripLinkedFileContents is already tested separately.
    logDebugInfo(true, title, otherData);
    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    // The expected output will be JSON stringified, so we compare against that
    const expectedStrippedData = stripLinkedFileContents(otherData);
    expect(consoleLogSpy).toHaveBeenCalledWith(
      `[GeminiAPI Debug] ${title}:`,
      JSON.stringify(expectedStrippedData, null, 2)
    );
  });

  it('should log stripped and stringified data for simple strings not containing "File Label:"', () => {
    const simpleString = "This is a simple string without file labels.";
    const title = 'Simple String Test';
    logDebugInfo(true, title, simpleString);
    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    const expectedStrippedData = stripLinkedFileContents(simpleString); // which is the string itself
    expect(consoleLogSpy).toHaveBeenCalledWith(
      `[GeminiAPI Debug] ${title}:`,
      JSON.stringify(expectedStrippedData, null, 2) // simple strings are also stringified
    );
  });
});

describe('isExtendedModelRequest', () => {
  const basePrompt = { prompt: 'base prompt' };
  const validExtendedReq = {
    ...basePrompt,
    conversationHistory: [],
    userMessage: 'hello',
  };

  it('should return true for a valid ExtendedModelRequest', () => {
    expect(isExtendedModelRequest(validExtendedReq)).toBe(true);
  });

  it('should return false if it is not a BaseModelRequest', () => {
    const req = { conversationHistory: [], userMessage: 'hello' };
    expect(isExtendedModelRequest(req)).toBe(false);
  });

  it('should return false if conversationHistory is missing', () => {
    const req = { ...basePrompt, userMessage: 'hello' };
    expect(isExtendedModelRequest(req)).toBe(false);
  });

  it('should return false if conversationHistory is not an array', () => {
    const req = { ...basePrompt, conversationHistory: {}, userMessage: 'hello' };
    expect(isExtendedModelRequest(req)).toBe(false);
  });

  it('should return false if userMessage is missing', () => {
    const req = { ...basePrompt, conversationHistory: [] };
    expect(isExtendedModelRequest(req)).toBe(false);
  });

  it('should return false if userMessage is not a string', () => {
    const req = { ...basePrompt, conversationHistory: [], userMessage: 123 };
    expect(isExtendedModelRequest(req)).toBe(false);
  });

  it('should return false for null or undefined', () => {
    expect(isExtendedModelRequest(null)).toBe(false);
    expect(isExtendedModelRequest(undefined)).toBe(false);
  });
});

describe('formatBaseModelRequest', () => {
  it('should format a basic request correctly', () => {
    const req = { prompt: 'Hello\nWorld' };
    // Using stringContaining because JSON.stringify might have OS-dependent newline for prompt
    // and the order of properties in the stringified prompt object isn't guaranteed.
    expect(formatBaseModelRequest(req)).toContain('Model: [default]');
    expect(formatBaseModelRequest(req)).toContain('Prompt: "Hello\\nWorld"');
  });

  it('should include model name if provided', () => {
    const req = { model: 'gemini-pro', prompt: 'test' };
    expect(formatBaseModelRequest(req)).toContain('Model: gemini-pro');
    expect(formatBaseModelRequest(req)).toContain('Prompt: "test"');
  });
});

describe('formatExtendedModelRequest', () => {
  const req = {
    model: 'gemini-1.5-pro',
    prompt: 'System prompt here',
    userMessage: 'User says hi',
    conversationHistory: [{ role: 'user', parts: 'Past message' }],
    renderContent: true,
  };

  it('should format an extended request correctly', () => {
    const result = formatExtendedModelRequest(req);
    expect(result).toContain('Model: gemini-1.5-pro');
    expect(result).toContain('Prompt: "System prompt here"');
    expect(result).toContain('User Message: "User says hi"');
    expect(result).toContain('Conversation History:');
    expect(result).toContain(JSON.stringify([{ role: 'user', parts: 'Past message' }], null, 2));
    expect(result).toContain('Render Content: true');
  });

  it('should omit renderContent if not provided', () => {
    const { renderContent, ...basicReq } = req;
    const result = formatExtendedModelRequest(basicReq);
    expect(result).not.toContain('Render Content:');
  });

  it('should use [default] for model if not provided', () => {
    const { model, ...noModelReq } = req;
    const result = formatExtendedModelRequest(noModelReq);
    expect(result).toContain('Model: [default]');
  });
});

describe('stripFileContextNode', () => {
  const baseNode = {
    path: '/path/to/file.md',
    content: 'File content here',
    wikilink: '[[file]]',
    links: {},
    aliases: [],
    tags: [],
    blockId: undefined,
    relativeFile: undefined,
    custom: {},
  };

  it('should return non-object/array types as is', () => {
    expect(stripFileContextNode('string')).toBe('string');
    expect(stripFileContextNode(123)).toBe(123);
    expect(stripFileContextNode(null)).toBe(null);
    expect(stripFileContextNode(undefined)).toBe(undefined);
  });

  it('should process a simple node with no links (isRoot = true)', () => {
    const result = stripFileContextNode(baseNode, true);
    expect(result.content).toBe('File content here');
    expect(result.path).toBe('/path/to/file.md');
    expect(result.links).toEqual({});
  });

  it('should process a simple node with no links (isRoot = false)', () => {
    const result = stripFileContextNode(baseNode, false);
    expect(result.content).toBe('[Linked file: [[file]]]');
    expect(result.path).toBe('/path/to/file.md');
    expect(result.links).toEqual({});
  });

  it('should use node.path for content if wikilink is missing (isRoot = false)', () => {
    const nodeWithoutWikilink = { ...baseNode, wikilink: undefined };
    const result = stripFileContextNode(nodeWithoutWikilink, false);
    expect(result.content).toBe('[Linked file: /path/to/file.md]');
  });

  it('should recursively process nested links (plain object)', () => {
    const nestedNode = {
      ...baseNode,
      links: {
        link1: {
          ...baseNode,
          path: '/path/to/link1.md',
          wikilink: '[[link1]]',
          content: 'Link 1 content',
          links: {
            nestedLink: {
              ...baseNode,
              path: '/path/to/nested.md',
              wikilink: '[[nested]]',
              content: 'Nested link content',
              links: {},
            },
          },
        },
        link2: {
          ...baseNode,
          path: '/path/to/link2.md',
          wikilink: '[[link2]]',
          content: 'Link 2 content',
          links: {},
        },
      },
    };
    const result = stripFileContextNode(nestedNode, true);
    expect(result.content).toBe('File content here');
    expect(result.links.link1.content).toBe('[Linked file: [[link1]]]');
    expect(result.links.link1.links.nestedLink.content).toBe('[Linked file: [[nested]]]');
    expect(result.links.link2.content).toBe('[Linked file: [[link2]]]');
  });

  it('should recursively process nested links (Map)', () => {
    const nestedMapNode = {
      ...baseNode,
      links: new Map([
        [
          'link1',
          {
            ...baseNode,
            path: '/path/to/link1.md',
            wikilink: '[[link1]]',
            content: 'Link 1 content',
            links: new Map([
              [
                'nestedLink',
                {
                  ...baseNode,
                  path: '/path/to/nested.md',
                  wikilink: '[[nested]]',
                  content: 'Nested link content',
                  links: new Map(),
                },
              ],
            ]),
          },
        ],
        [
          'link2',
          {
            ...baseNode,
            path: '/path/to/link2.md',
            wikilink: '[[link2]]',
            content: 'Link 2 content',
            links: new Map(),
          },
        ],
      ]),
    };
    const result = stripFileContextNode(nestedMapNode, true);
    expect(result.content).toBe('File content here');
    expect(result.links.link1.content).toBe('[Linked file: [[link1]]]');
    expect(result.links.link1.links.nestedLink.content).toBe('[Linked file: [[nested]]]');
    expect(result.links.link2.content).toBe('[Linked file: [[link2]]]');
  });

  it('should handle non-FileContextNode objects by recursively processing their properties', () => {
    const otherObject = {
      prop1: 'value1',
      prop2: baseNode, // This should be processed
      prop3: { nested: 'value3', anotherNode: { ...baseNode, path: '/another.md', content: 'Another' } },
    };
    const result = stripFileContextNode(otherObject, true);
    expect(result.prop1).toBe('value1');
    // prop2 is a FileContextNode, but since otherObject is not, isRoot will be true for baseNode here
    expect(result.prop2.content).toBe('File content here');
    expect(result.prop3.nested).toBe('value3');
    // Same for anotherNode
    expect(result.prop3.anotherNode.content).toBe('Another');
  });

  it('should handle arrays by recursively processing their elements', () => {
    const arr = [
      baseNode, // Processed as root because it's the direct element
      { ...baseNode, path: '/path/to/file2.md', content: 'Content 2' },
      'stringInArray',
      {
        someProp: 'val',
        nestedNodeInArray: { ...baseNode, path: '/path/to/nestedInArray.md', content: 'Nested Array Content' }
      }
    ];
    const result = stripFileContextNode(arr, true);
    expect(result[0].content).toBe('File content here');
    expect(result[1].content).toBe('Content 2');
    expect(result[2]).toBe('stringInArray');
    expect(result[3].someProp).toBe('val');
    expect(result[3].nestedNodeInArray.content).toBe('Nested Array Content');
  });

  it('should not modify the original node', () => {
    const originalNode = {
      ...baseNode,
      links: {
        link1: { ...baseNode, content: 'Original Link Content' },
      },
    };
    stripFileContextNode(originalNode, true);
    expect(originalNode.content).toBe('File content here');
    expect(originalNode.links.link1.content).toBe('Original Link Content');
  });
});

describe('stripLinkedFileContents', () => {
  const baseNode = {
    path: '/path/to/file.md',
    content: 'File content here',
    wikilink: '[[file]]',
    links: {},
    aliases: [],
    tags: [],
    blockId: undefined,
    relativeFile: undefined,
    custom: {},
  };

  it('should use stripFileContextNode if the object is a FileContextNode', () => {
    const result = stripLinkedFileContents(baseNode);
    // Check a specific transformation of stripFileContextNode to confirm it was called
    expect(result.content).toBe('File content here'); // isRoot = true by default for the root call
    expect(result.path).toBe('/path/to/file.md');
  });

  it('should recursively process arrays', () => {
    const arr = [
      baseNode, // This will be processed by stripFileContextNode
      { prop: 'value', nested: { ...baseNode, content: 'Nested Content' } },
      'stringInArray'
    ];
    const result = stripLinkedFileContents(arr);
    expect(result[0].content).toBe('File content here');
    expect(result[1].prop).toBe('value');
    // Since the parent of nested is not a FileContextNode, stripFileContextNode is not directly called on it by stripLinkedFileContents
    // Instead, stripLinkedFileContents recursively calls itself. When it hits baseNode, it then calls stripFileContextNode.
    expect(result[1].nested.content).toBe('Nested Content');
    expect(result[2]).toBe('stringInArray');
  });

  it('should recursively process plain objects that are not FileContextNodes', () => {
    const obj = {
      someKey: 'someValue',
      fileNode: baseNode, // This will be processed by stripFileContextNode
      nestedObj: {
        anotherKey: 'anotherValue',
        anotherNode: { ...baseNode, wikilink: '[[another]]', content: 'Another Content' }
      }
    };
    const result = stripLinkedFileContents(obj);
    expect(result.someKey).toBe('someValue');
    expect(result.fileNode.content).toBe('File content here');
    expect(result.nestedObj.anotherKey).toBe('anotherValue');
    expect(result.nestedObj.anotherNode.content).toBe('Another Content');
  });

  it('should return primitive types as is', () => {
    expect(stripLinkedFileContents('a string')).toBe('a string');
    expect(stripLinkedFileContents(12345)).toBe(12345);
    expect(stripLinkedFileContents(null)).toBe(null);
    expect(stripLinkedFileContents(undefined)).toBe(undefined);
  });

  it('should handle an object that has a FileContextNode deeply nested', () => {
    const deepObject = {
      level1: {
        level2: {
          node: {
            ...baseNode,
            links: {
              nestedLink: { ...baseNode, wikilink: '[[nested]]', content: 'Nested Content' }
            }
          }
        }
      }
    };
    const result = stripLinkedFileContents(deepObject);
    expect(result.level1.level2.node.content).toBe('File content here');
    expect(result.level1.level2.node.links.nestedLink.content).toBe('[Linked file: [[nested]]]');
  });
});

describe('redactLinkedFileSections', () => {
  const currentFileHeader = '===\nFile Label: Current File\nFile Name: current.md\nWikiLink: [[current]]\n===\n\n';
  const linkedFileHeader1 = '===\nFile Label: Linked File 1\nFile Name: linked1.md\nWikiLink: [[linked1]]\n===\n\n';
  const linkedFileHeader2 = '===\nFile Label: Linked File 2\nFile Name: linked2.md\nWikiLink: [[linked2]]\n===\n\n';

  it('should return the prompt as is if only current file content is present', () => {
    const prompt = `${currentFileHeader}This is the current file content.`;
    expect(redactLinkedFileSections(prompt)).toBe(prompt);
  });

  it('should redact linked file content and keep current file content', () => {
    const prompt = `${currentFileHeader}Current file content.
${linkedFileHeader1}This is linked file 1 content that should be redacted.
${linkedFileHeader2}This is linked file 2 content, also redacted.`;
    const expected = `${currentFileHeader}Current file content.
${linkedFileHeader1}[Linked file: [[linked1]]]\n\n${linkedFileHeader2}[Linked file: [[linked2]]]\n\n`;
    expect(redactLinkedFileSections(prompt)).toBe(expected);
  });

  it('should correctly extract WikiLink for the redaction message', () => {
    const prompt = `${currentFileHeader}Current content.
${linkedFileHeader1}Redacted linked content.`;
    const expected = `${currentFileHeader}Current content.
${linkedFileHeader1}[Linked file: [[linked1]]]\n\n`;
    expect(redactLinkedFileSections(prompt)).toBe(expected);
  });

  it('should handle prompts with no valid WikiLink in linked file header', () => {
    const faultyHeader = '===\nFile Label: Linked File Faulty\nFile Name: faulty.md\nWikiLink: faulty-no-brackets\n===\n\n';
    const prompt = `${currentFileHeader}Current content.
${faultyHeader}This content will be redacted.`;
    const expected = `${currentFileHeader}Current content.
${faultyHeader}[Linked file: [[Unknown]]]\n\n`;
    expect(redactLinkedFileSections(prompt)).toBe(expected);
  });

  it('should handle multiple linked files correctly', () => {
    const prompt = `${currentFileHeader}Content A
${linkedFileHeader1}Content B
${linkedFileHeader2}Content C`;
    const expected = `${currentFileHeader}Content A
${linkedFileHeader1}[Linked file: [[linked1]]]\n\n${linkedFileHeader2}[Linked file: [[linked2]]]\n\n`;
    expect(redactLinkedFileSections(prompt)).toBe(expected);
  });

    it('should preserve trailing newlines after current file content if present', () => {
    const prompt = `${currentFileHeader}Current file content.\n\n\n${linkedFileHeader1}This is linked file 1 content that should be redacted.`;
    const expected = `${currentFileHeader}Current file content.\n\n\n${linkedFileHeader1}[Linked file: [[linked1]]]\n\n`;
    expect(redactLinkedFileSections(prompt)).toBe(expected);
  });

  it('should work correctly if there is no content after the last linked file header', () => {
    const prompt = `${currentFileHeader}Current file content.
${linkedFileHeader1}`; 
    const expected = `${currentFileHeader}Current file content.
${linkedFileHeader1}[Linked file: [[linked1]]]\n\n`;
    expect(redactLinkedFileSections(prompt)).toBe(expected);
  });
});

