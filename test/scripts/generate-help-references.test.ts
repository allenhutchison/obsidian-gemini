import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const GENERATED_FILE = path.resolve(ROOT, 'src/services/generated-help-references.ts');

describe('generate-help-references script', () => {
	it('should generate the references file', () => {
		execSync('node scripts/generate-help-references.mjs', { cwd: ROOT });
		expect(fs.existsSync(GENERATED_FILE)).toBe(true);
	});

	it('should include all docs/guide/*.md files', () => {
		const content = fs.readFileSync(GENERATED_FILE, 'utf-8');
		const guideDir = path.resolve(ROOT, 'docs/guide');
		const guideFiles = fs.readdirSync(guideDir).filter((f) => f.endsWith('.md'));

		for (const file of guideFiles) {
			expect(content).toContain(`references/${file}`);
		}
	});

	it('should include all docs/reference/*.md files', () => {
		const content = fs.readFileSync(GENERATED_FILE, 'utf-8');
		const refDir = path.resolve(ROOT, 'docs/reference');
		const refFiles = fs.readdirSync(refDir).filter((f) => f.endsWith('.md'));

		for (const file of refFiles) {
			expect(content).toContain(`references/${file}`);
		}
	});

	it('should export helpResources and helpReferencesTable', () => {
		const content = fs.readFileSync(GENERATED_FILE, 'utf-8');
		expect(content).toContain('export const helpResources');
		expect(content).toContain('export const helpReferencesTable');
	});

	it('should be idempotent (running twice produces same output)', () => {
		execSync('node scripts/generate-help-references.mjs', { cwd: ROOT });
		const first = fs.readFileSync(GENERATED_FILE, 'utf-8');
		execSync('node scripts/generate-help-references.mjs', { cwd: ROOT });
		const second = fs.readFileSync(GENERATED_FILE, 'utf-8');
		expect(first).toBe(second);
	});
});
