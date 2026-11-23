import { parseFrontmatterList, parseFrontmatterProperty, stripFrontmatter } from '../../src/utils/bundled-frontmatter';
import { BundledPromptRegistry } from '../../src/prompts/bundled-prompts';
import { BundledSkillRegistry } from '../../src/services/bundled-skills';

// Pins the contract of the hand-rolled frontmatter reader used for markdown
// inlined at build time (#1721). These files never become TFiles, so this is
// the one frontmatter path that can't lean on Obsidian's metadataCache, and a
// silent parse regression would ship empty skill descriptions into the system
// prompt. The "limitation" tests describe today's contract, not an aspiration:
// change them deliberately, together with the parser.

describe('stripFrontmatter', () => {
	test('strips a leading block and trims the body', () => {
		expect(stripFrontmatter('---\nname: x\n---\n\n  Body text\n')).toBe('Body text');
	});

	test('passes a body with no frontmatter through, trimmed', () => {
		expect(stripFrontmatter('  Just a body\n')).toBe('Just a body');
	});

	test('keeps a --- line that appears inside the body', () => {
		expect(stripFrontmatter('---\nname: x\n---\nIntro\n---\nMore')).toBe('Intro\n---\nMore');
	});

	test('handles CRLF fences without leaving a stray \\r', () => {
		const out = stripFrontmatter('---\r\nname: x\r\n---\r\nBody');
		expect(out).toBe('Body');
		expect(out).not.toContain('\r');
	});

	test('does not treat a --- block that is not at the start as frontmatter', () => {
		expect(stripFrontmatter('Body\n---\nname: x\n---')).toBe('Body\n---\nname: x\n---');
	});
});

describe('parseFrontmatterProperty', () => {
	const md = '---\nname: Fix Grammar\ndescription: Fixes grammar\nempty:\n---\nBody';

	test('reads a scalar value', () => {
		expect(parseFrontmatterProperty(md, 'name')).toBe('Fix Grammar');
		expect(parseFrontmatterProperty(md, 'description')).toBe('Fixes grammar');
	});

	test("absent key → ''", () => {
		expect(parseFrontmatterProperty(md, 'tags')).toBe('');
	});

	test("absent frontmatter block → ''", () => {
		expect(parseFrontmatterProperty('name: Fix Grammar\nBody', 'name')).toBe('');
	});

	test("present-but-empty value → ''", () => {
		expect(parseFrontmatterProperty(md, 'empty')).toBe('');
	});

	test('strips one pair of surrounding single or double quotes', () => {
		expect(parseFrontmatterProperty("---\nname: 'Fix Grammar'\n---", 'name')).toBe('Fix Grammar');
		expect(parseFrontmatterProperty('---\nname: "Fix Grammar"\n---', 'name')).toBe('Fix Grammar');
	});

	test('matches a key containing regex metacharacters literally', () => {
		const dotted = '---\nmodelXname: wrong\nmodel.name: right\n---';
		expect(parseFrontmatterProperty(dotted, 'model.name')).toBe('right');
		expect(parseFrontmatterProperty('---\nmodelXname: wrong\n---', 'model.name')).toBe('');
	});

	test('reads keys from the frontmatter only, not the body', () => {
		expect(parseFrontmatterProperty('---\nname: a\n---\ndescription: in body', 'description')).toBe('');
	});

	test('limitation: a wrapped multi-line scalar yields only its first line', () => {
		const wrapped = '---\ndescription: first line\n  continues here\n---';
		expect(parseFrontmatterProperty(wrapped, 'description')).toBe('first line');
	});

	test('limitation: a folded block scalar yields only its indicator', () => {
		const folded = '---\ndescription: >\n  folded text\n---';
		expect(parseFrontmatterProperty(folded, 'description')).toBe('>');
	});
});

describe('parseFrontmatterList', () => {
	test('reads an inline list with and without quotes', () => {
		expect(parseFrontmatterList('---\ntags: [\'a\', "b", c]\n---', 'tags')).toEqual(['a', 'b', 'c']);
	});

	test('absent key → []', () => {
		expect(parseFrontmatterList('---\nname: x\n---', 'tags')).toEqual([]);
	});

	test('absent frontmatter → []', () => {
		expect(parseFrontmatterList('tags: [a, b]', 'tags')).toEqual([]);
	});

	test('drops whitespace-only items', () => {
		expect(parseFrontmatterList('---\ntags: [a, , b,  ]\n---', 'tags')).toEqual(['a', 'b']);
	});

	test('limitation: a block-sequence list returns []', () => {
		expect(parseFrontmatterList('---\ntags:\n  - a\n  - b\n---', 'tags')).toEqual([]);
	});

	test('limitation: an apostrophe inside an item is stripped', () => {
		expect(parseFrontmatterList('---\ntags: ["don\'t"]\n---', 'tags')).toEqual(['dont']);
	});

	test('limitation: a comma inside a quoted item splits it', () => {
		expect(parseFrontmatterList('---\ntags: ["a, b"]\n---', 'tags')).toEqual(['a', 'b']);
	});
});

// Guard over the files that actually ship: a regex edit that stops matching
// would otherwise only surface as an agent that picks skills worse.
describe('bundled content parses', () => {
	test('every bundled prompt has a non-empty name and description', () => {
		const prompts = BundledPromptRegistry.getPrompts();
		expect(prompts.length).toBeGreaterThan(0);
		for (const p of prompts) {
			expect(p.name.trim()).not.toBe('');
			expect(p.description.trim()).not.toBe('');
		}
	});

	test('every bundled skill has a non-empty description', () => {
		const skills = BundledSkillRegistry.getSummaries();
		expect(skills.length).toBeGreaterThan(0);
		for (const s of skills) {
			expect(s.description.trim()).not.toBe('');
		}
	});
});
