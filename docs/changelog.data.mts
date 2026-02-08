import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface ReleaseNote {
	title: string;
	highlights: string[];
	details?: string;
}

export default {
	watch: ['../src/release-notes.json'],
	load(): Record<string, ReleaseNote> {
		const filePath = path.resolve(__dirname, '../src/release-notes.json');
		const raw = fs.readFileSync(filePath, 'utf-8');
		return JSON.parse(raw);
	},
};
