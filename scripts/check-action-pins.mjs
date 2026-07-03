#!/usr/bin/env node
// Enforce that every third-party GitHub Action referenced in .github/workflows/*
// is pinned to an immutable 40-character commit SHA (not a mutable tag or
// branch). Tags can be silently re-pointed upstream, so a tag pin lets a
// compromised or retargeted action run in CI with our GITHUB_TOKEN and secrets
// in scope. This gate keeps the repo-wide SHA-pinning policy (issue #1052) from
// regressing the next time a workflow is added or edited.
//
// A pinned reference looks like:  owner/repo@<40-hex-sha>  # v1.2.3
// Local (`./…`) and Docker (`docker://…`) references are exempt.
//
// Usage: node scripts/check-action-pins.mjs
// Exits 0 when every reference is pinned, 1 (listing violations) otherwise.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const WORKFLOWS_DIR = '.github/workflows';
const SHA_RE = /^[0-9a-f]{40}$/;
// Capture the value after `uses:` up to whitespace, a comment, or a quote.
const USES_RE = /^\s*(?:-\s*)?uses:\s*['"]?([^'"\s#]+)/;

function listWorkflowFiles(dir) {
	let entries;
	try {
		entries = readdirSync(dir);
	} catch {
		return [];
	}
	return entries
		.filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
		.map((name) => join(dir, name))
		.filter((p) => statSync(p).isFile());
}

const violations = [];
const files = listWorkflowFiles(WORKFLOWS_DIR);

for (const file of files) {
	const lines = readFileSync(file, 'utf8').split('\n');
	lines.forEach((line, i) => {
		const match = line.match(USES_RE);
		if (!match) return;
		const ref = match[1];

		// Exempt local composite/reusable references and Docker image refs.
		if (ref.startsWith('./') || ref.startsWith('docker://')) return;

		const atIndex = ref.lastIndexOf('@');
		if (atIndex === -1) {
			violations.push({ file, line: i + 1, ref, reason: 'no version/SHA pin' });
			return;
		}
		const gitRef = ref.slice(atIndex + 1);
		if (!SHA_RE.test(gitRef)) {
			violations.push({ file, line: i + 1, ref, reason: `pinned to "${gitRef}" (not a 40-char commit SHA)` });
		}
	});
}

if (files.length === 0) {
	console.warn(`No workflow files found in ${WORKFLOWS_DIR}/ — nothing to check.`);
	process.exit(0);
}

if (violations.length > 0) {
	console.error('❌ Unpinned GitHub Action reference(s) detected:\n');
	for (const v of violations) {
		console.error(`  ${v.file}:${v.line}  ${v.ref}  — ${v.reason}`);
	}
	console.error(
		'\nPin each action to a full commit SHA with a version comment, e.g.:\n' +
			'  uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0\n\n' +
			'Resolve the SHA for a tag with:  git ls-remote https://github.com/<owner>/<repo> <tag>\n' +
			'Tags are mutable; SHAs are not. See .github/workflows and issue #1052 for context.'
	);
	process.exit(1);
}

console.log(
	`✅ All GitHub Action references in ${WORKFLOWS_DIR}/ are pinned to commit SHAs (${files.length} workflow file(s) checked).`
);
process.exit(0);
