import { isToolExecutionMessage, parseToolSections } from '../../../src/ui/agent-view/tool-section-parser';

describe('isToolExecutionMessage', () => {
	it('returns true when the entry carries toolName metadata', () => {
		expect(isToolExecutionMessage('just some text', true)).toBe(true);
	});

	it('returns true when the message contains the marker, even without metadata', () => {
		expect(isToolExecutionMessage('Tool Execution Results:\n\n### read_file', false)).toBe(true);
	});

	it('returns false when there is no metadata and no marker', () => {
		expect(isToolExecutionMessage('a normal assistant reply', false)).toBe(false);
	});
});

describe('parseToolSections', () => {
	it('reports no sections for a message without any ### headings', () => {
		const result = parseToolSections('Tool Execution Results:\n\nno headings here');
		expect(result.hasSections).toBe(false);
		expect(result.sections).toEqual([]);
		// intro still holds the trimmed message, but the caller renders the
		// whole message directly when hasSections is false.
		expect(result.intro).toBe('Tool Execution Results:\n\nno headings here');
	});

	it('parses a single section with intro text', () => {
		const message = 'Tool Execution Results:\n\n### read_file\n✅ contents of the file';
		const result = parseToolSections(message);
		expect(result.hasSections).toBe(true);
		expect(result.intro).toBe('Tool Execution Results:');
		expect(result.sections).toEqual([{ toolName: 'read_file', content: '✅ contents of the file' }]);
	});

	it('parses multiple sections and pairs each name with its content', () => {
		const message = 'Intro line\n\n### read_file\n✅ file body\n\n### list_files\n❌ permission denied';
		const result = parseToolSections(message);
		expect(result.hasSections).toBe(true);
		expect(result.intro).toBe('Intro line');
		expect(result.sections).toEqual([
			{ toolName: 'read_file', content: '✅ file body' },
			{ toolName: 'list_files', content: '❌ permission denied' },
		]);
	});

	it('drops a section whose content is empty but still reports hasSections', () => {
		// A ### heading with no following content must not fall back to rendering
		// the whole message — hasSections stays true so the caller renders only
		// the intro, matching the original toolSections.length > 1 behavior.
		const message = 'Tool Execution Results:\n\n### read_file\n';
		const result = parseToolSections(message);
		expect(result.hasSections).toBe(true);
		expect(result.intro).toBe('Tool Execution Results:');
		expect(result.sections).toEqual([]);
	});

	it('keeps intro-only text before the first section separate from the sections', () => {
		const message = 'Here is what I did\n\n### write_file\n✅ saved';
		const result = parseToolSections(message);
		expect(result.intro).toBe('Here is what I did');
		expect(result.sections).toEqual([{ toolName: 'write_file', content: '✅ saved' }]);
	});
});
