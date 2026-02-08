import fs from 'node:fs';
import path from 'node:path';

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
