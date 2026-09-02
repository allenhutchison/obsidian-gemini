import { describe, expect, it } from 'vitest';
import { load as parseYaml } from 'js-yaml';
import { yamlScalar } from '../../src/services/yaml-scalar';

/**
 * These tests parse with **js-yaml**, the parser Obsidian's `metadataCache`
 * uses, rather than a decoder written alongside the emitter. That distinction
 * caught a real bug: an earlier version of this suite used a hand-rolled
 * single-quoted reader, which shared the emitter's blind spot and happily
 * "round-tripped" a newline that real YAML folds into a space.
 */
const ctrl = (code: number) => String.fromCharCode(code);

/** Every position these writers emit into, assembled as one block. */
function roundTrip(value: string): { scalar: unknown; key: string; mapValue: unknown; seqItem: unknown } {
	const doc = [
		`scalar: ${yamlScalar(value)}`,
		'map:',
		`  ${yamlScalar(value)}: ${yamlScalar(value)}`,
		'seq:',
		`  - ${yamlScalar(value)}`,
	].join('\n');
	const parsed = parseYaml(doc) as {
		scalar: unknown;
		map: Record<string, unknown>;
		seq: unknown[];
	};
	return {
		scalar: parsed.scalar,
		key: Object.keys(parsed.map)[0],
		mapValue: Object.values(parsed.map)[0],
		seqItem: parsed.seq[0],
	};
}

describe('yamlScalar', () => {
	it('wraps a plain value in single quotes', () => {
		expect(yamlScalar('daily')).toBe("'daily'");
	});

	it('doubles an embedded apostrophe (the #1347 failure)', () => {
		expect(yamlScalar("Allen's Notes/{date}.md")).toBe("'Allen''s Notes/{date}.md'");
	});

	it('quotes unconditionally rather than only when needed', () => {
		// A conditional emitter is a second rule to get wrong; an always-quoted
		// scalar is valid YAML for every string.
		expect(yamlScalar('')).toBe("''");
		expect(yamlScalar('42')).toBe("'42'");
	});

	it.each([
		['plain', 'Daily/**/*.md'],
		['empty', ''],
		['single apostrophe', "it's"],
		['repeated apostrophes', "a''b'c"],
		['leading apostrophe', "'lead"],
		['trailing apostrophe', "trail'"],
		['only apostrophes', "'''"],
		['double quote', 'say "hi"'],
		['colon-space (would nest a map)', 'type: journal'],
		['leading hash (would comment out)', '#tag'],
		['leading bracket (flow sequence)', '[a, b]'],
		['leading brace (flow map)', '{a: b}'],
		['leading ampersand (anchor)', '&anchor'],
		['leading asterisk (alias)', '*alias'],
		['leading dash', '- item'],
		['backslash', 'C:\\path\\to'],
		['tab', 'a\tb'],
		['leading space', ' pad'],
		['trailing space', 'pad '],
		['unicode', 'héllo — ✅'],
		['non-breaking space', `a${ctrl(0x00a0)}b`],
	])('round-trips %s as a single-quoted scalar', (_label, value) => {
		expect(yamlScalar(value).startsWith("'")).toBe(true);
		const r = roundTrip(value);
		expect(r.scalar).toBe(value);
		expect(r.key).toBe(value);
		expect(r.mapValue).toBe(value);
		expect(r.seqItem).toBe(value);
	});

	// A single-quoted scalar has no escape but `''`, so it cannot carry these.
	// YAML *folds* a line break inside a flow scalar into a space — `a\nb` would
	// come back as `a b`, silent content loss — and js-yaml rejects a raw control
	// character outright, which takes the whole block down. Regression net for
	// the defect CodeRabbit caught on #1450.
	it.each([
		['newline', 'line1\nline2'],
		['CRLF', 'line1\r\nline2'],
		['lone carriage return', 'line1\rline2'],
		['blank line', 'a\n\nb'],
		['trailing newline', 'trailing\n'],
		['NUL', `a${ctrl(0x00)}b`],
		['bell', `a${ctrl(0x07)}b`],
		['backspace', `a${ctrl(0x08)}b`],
		['form feed', `a${ctrl(0x0c)}b`],
		['escape', `a${ctrl(0x1b)}b`],
		['newline beside an apostrophe', "it's\nfine"],
	])('falls back to a double-quoted scalar for %s', (_label, value) => {
		expect(yamlScalar(value).startsWith('"')).toBe(true);
		const r = roundTrip(value);
		expect(r.scalar).toBe(value);
		expect(r.key).toBe(value);
		expect(r.mapValue).toBe(value);
		expect(r.seqItem).toBe(value);
	});

	it('keeps tab on the single-quoted path', () => {
		// Tab survives a single-quoted scalar intact in both parsers, so there is
		// no reason to change how it is written.
		expect(yamlScalar('a\tb')).toBe("'a\tb'");
	});
});
