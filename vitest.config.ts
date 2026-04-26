import { defineConfig } from 'vitest/config';
import path from 'path';
import fs from 'fs';

// Mirrors esbuild's `text` loader for .hbs/.md and the legacy ts-jest text-transformer.mjs
// that handled .txt — bare `import content from './foo.hbs'` returns the file's contents
// as a default-exported string.
function rawTextPlugin() {
	const exts = new Set(['.hbs', '.md', '.txt']);
	return {
		name: 'gemini-scribe-raw-text',
		enforce: 'pre' as const,
		async load(id: string) {
			const cleanId = id.split('?')[0];
			const ext = path.extname(cleanId).toLowerCase();
			if (!exts.has(ext)) return null;
			const source = await fs.promises.readFile(cleanId, 'utf-8');
			return `export default ${JSON.stringify(source)};`;
		},
	};
}

export default defineConfig({
	plugins: [rawTextPlugin()],
	test: {
		globals: true,
		environment: 'jsdom',
		include: ['test/**/?(*.)+(spec|test).[tj]s'],
		setupFiles: ['./test/vitest-setup.ts'],
		coverage: {
			provider: 'v8',
			reporter: ['text', 'lcov', 'html'],
			reportsDirectory: './coverage',
			include: ['src/**/*.ts'],
			exclude: ['src/**/*.d.ts', 'src/**/*.test.ts', 'src/**/*.spec.ts', 'src/services/generated-help-references.ts'],
		},
	},
	resolve: {
		alias: {
			'@': path.resolve(__dirname, './src'),
			obsidian: path.resolve(__dirname, './__mocks__/obsidian.js'),
			'@modelcontextprotocol/sdk/client/streamableHttp.js': path.resolve(
				__dirname,
				'./test/__mocks__/@modelcontextprotocol/sdk/client/streamableHttp.js'
			),
			'@modelcontextprotocol/sdk/client/auth.js': path.resolve(
				__dirname,
				'./test/__mocks__/@modelcontextprotocol/sdk/client/auth.js'
			),
		},
	},
});
