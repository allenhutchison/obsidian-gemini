import { extractAccessedPaths, pathToWikilink } from '../../src/utils/accessed-files';

describe('extractAccessedPaths', () => {
	it('should extract path from read_file result', () => {
		const results = [
			{
				toolName: 'read_file',
				toolArguments: { path: 'notes/test.md' },
				result: { success: true, data: { path: 'notes/test.md' } },
			},
		];
		expect(extractAccessedPaths(results)).toEqual(['notes/test.md']);
	});

	it('should extract path from write_file result', () => {
		const results = [
			{
				toolName: 'write_file',
				toolArguments: { path: 'notes/new.md' },
				result: { success: true, data: { path: 'notes/new.md', action: 'created' } },
			},
		];
		expect(extractAccessedPaths(results)).toEqual(['notes/new.md']);
	});

	it('should extract path from delete_file result', () => {
		const results = [
			{
				toolName: 'delete_file',
				toolArguments: { path: 'old.md' },
				result: { success: true, data: { path: 'old.md', action: 'deleted' } },
			},
		];
		expect(extractAccessedPaths(results)).toEqual(['old.md']);
	});

	it('should extract path from create_folder result', () => {
		const results = [
			{
				toolName: 'create_folder',
				toolArguments: { path: 'new-folder' },
				result: { success: true, data: { path: 'new-folder', action: 'created' } },
			},
		];
		expect(extractAccessedPaths(results)).toEqual(['new-folder']);
	});

	it('should extract path from update_frontmatter result', () => {
		const results = [
			{
				toolName: 'update_frontmatter',
				toolArguments: { path: 'note.md' },
				result: { success: true, data: { path: 'note.md', key: 'tags' } },
			},
		];
		expect(extractAccessedPaths(results)).toEqual(['note.md']);
	});

	it('should extract path from append_content result', () => {
		const results = [
			{
				toolName: 'append_content',
				toolArguments: { path: 'log.md' },
				result: { success: true, data: { path: 'log.md', action: 'appended' } },
			},
		];
		expect(extractAccessedPaths(results)).toEqual(['log.md']);
	});

	it('should extract both paths from move_file result', () => {
		const results = [
			{
				toolName: 'move_file',
				toolArguments: { sourcePath: 'old/note.md', targetPath: 'new/note.md' },
				result: { success: true, data: { sourcePath: 'old/note.md', targetPath: 'new/note.md', action: 'moved' } },
			},
		];
		expect(extractAccessedPaths(results)).toEqual(['old/note.md', 'new/note.md']);
	});

	it('should skip failed results', () => {
		const results = [
			{
				toolName: 'read_file',
				toolArguments: { path: 'missing.md' },
				result: { success: false, error: 'File not found' },
			},
		];
		expect(extractAccessedPaths(results)).toEqual([]);
	});

	it('should skip non-tracked tools', () => {
		const results = [
			{
				toolName: 'search_files',
				toolArguments: { pattern: '*.md' },
				result: { success: true, data: { matches: [] } },
			},
			{ toolName: 'list_files', toolArguments: { path: '/' }, result: { success: true, data: { files: [] } } },
			{
				toolName: 'search_file_contents',
				toolArguments: { query: 'test' },
				result: { success: true, data: { results: [] } },
			},
			{ toolName: 'list_folders', toolArguments: { path: '/' }, result: { success: true, data: { folders: [] } } },
			{ toolName: 'get_active_file', toolArguments: {}, result: { success: true, data: { path: 'active.md' } } },
			{ toolName: 'read_memory', toolArguments: {}, result: { success: true, data: { path: 'AGENTS.md' } } },
			{
				toolName: 'update_memory',
				toolArguments: { content: 'test' },
				result: { success: true, data: { path: 'AGENTS.md' } },
			},
		];
		expect(extractAccessedPaths(results)).toEqual([]);
	});

	it('should handle missing data gracefully', () => {
		const results = [
			{ toolName: 'read_file', toolArguments: { path: 'test.md' }, result: { success: true } },
			{ toolName: 'read_file', toolArguments: { path: 'test.md' }, result: { success: true, data: {} } },
			{ toolName: 'read_file', toolArguments: { path: 'test.md' }, result: { success: true, data: null } },
		];
		expect(extractAccessedPaths(results)).toEqual([]);
	});

	it('should extract paths from a mixed batch', () => {
		const results = [
			{ toolName: 'read_file', toolArguments: { path: 'a.md' }, result: { success: true, data: { path: 'a.md' } } },
			{
				toolName: 'search_files',
				toolArguments: { pattern: '*.md' },
				result: { success: true, data: { matches: [] } },
			},
			{ toolName: 'write_file', toolArguments: { path: 'b.md' }, result: { success: true, data: { path: 'b.md' } } },
			{ toolName: 'read_file', toolArguments: { path: 'c.md' }, result: { success: false, error: 'Not found' } },
		];
		expect(extractAccessedPaths(results)).toEqual(['a.md', 'b.md']);
	});
});

describe('pathToWikilink', () => {
	it('should convert markdown file path to wikilink', () => {
		expect(pathToWikilink('folder/My Note.md')).toBe('[[My Note]]');
	});

	it('should handle root-level files', () => {
		expect(pathToWikilink('Note.md')).toBe('[[Note]]');
	});

	it('should handle deeply nested paths', () => {
		expect(pathToWikilink('a/b/c/Deep Note.md')).toBe('[[Deep Note]]');
	});

	it('should keep extension for non-md files', () => {
		expect(pathToWikilink('images/photo.png')).toBe('[[photo.png]]');
	});

	it('should handle files without extension', () => {
		expect(pathToWikilink('folder/README')).toBe('[[README]]');
	});

	it('should handle folder paths', () => {
		expect(pathToWikilink('my-folder')).toBe('[[my-folder]]');
	});
});
