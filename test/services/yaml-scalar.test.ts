import { describe, expect, it } from 'vitest';
import { yamlScalar } from '../../src/services/yaml-scalar';

/**
 * A minimal single-quoted-scalar reader, used to assert the emitter round-trips
 * without pulling a YAML parser into the test. Mirrors the YAML rule the
 * emitter targets: the scalar runs to the first `'` that is not doubled.
 */
function readSingleQuoted(emitted: string): string {
	expect(emitted.startsWith("'")).toBe(true);
	expect(emitted.endsWith("'")).toBe(true);
	const inner = emitted.slice(1, -1);
	let out = '';
	for (let i = 0; i < inner.length; i++) {
		if (inner[i] === "'") {
			// Inside the scalar every quote must be part of a doubled pair,
			// otherwise the scalar would have terminated early.
			expect(inner[i + 1]).toBe("'");
			out += "'";
			i++;
		} else {
			out += inner[i];
		}
	}
	return out;
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
		['newline', 'line1\nline2'],
		['tab', 'a\tb'],
		['unicode', 'héllo — ✅'],
	])('round-trips %s', (_label, value) => {
		expect(readSingleQuoted(yamlScalar(value))).toBe(value);
	});
});
