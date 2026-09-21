#!/usr/bin/env node
/**
 * check-unread-fields.mjs — per-field read-reachability check over `src/`
 * (#1469).
 *
 * The rule this enforces is `.claude/guidelines/coding.md`'s "Wiring
 * interfaces carry only what is read": a field declared on an interface or
 * type alias and populated at its construction site, but never read anywhere,
 * is born dead and stays dead with every check green (knip resolves exported
 * symbols, not per-field reachability through an object literal). Four
 * instances landed before the check existed (#1436, #1457, #1458, #1467).
 *
 * For every property declared on an interface or type-alias object type in
 * `src/`, this scan searches `src/` + `test/` for a **read**:
 *   - `.name` member access
 *   - `['name']` element access with a string-literal argument
 *   - a destructuring bind of `name` (`{ name }` or `{ name: alias }`)
 * Object-literal keys (`name:`) count as **writes**, not reads.
 *
 * Known false-positive shapes and how they are handled:
 *   - destructuring binds count as reads (they are reads)
 *   - object-literal keys never count as reads (PropertyAssignment names are
 *     Identifiers, not PropertyAccessExpressions, so the `.name` branch
 *     cannot match them)
 *   - same-named function parameters are not reads (only the three shapes
 *     above are counted)
 *   - event-map string-literal keys are only counted as reads when the *same
 *     file* also calls `emit('<name>'` — the key is then its own read site.
 *     The same-file restriction keeps this from masking an unrelated dead
 *     field in a file that does not use event literals.
 *
 * Suppression: a field whose declaration carries `wiring:keep` in an
 * immediately-preceding comment is skipped. Use it for a genuinely
 * write-only field — e.g. a serialized payload the *model* reads, or a
 * setting the settings UI consumes by key.
 *
 * Advisorial by design (the maintainer's call on #1469): the script always
 * exits 0; a workflow job uploads the report as an artifact. Flip it to a
 * blocking gate once the real noise rate has been measured for a release.
 *
 * A standalone script rather than an ESLint rule: a whole-program cross-file
 * question does not fit ESLint's per-file model, and the repo has the
 * `lint:cycles` precedent for exactly this kind of standalone graph check.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const TEST = join(ROOT, 'test');

/** The suppression comment marker. */
export const KEEP_MARKER = 'wiring:keep';

/** Recursively collect every .ts file under a directory. */
function collectTsFiles(dir) {
	const out = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) {
			out.push(...collectTsFiles(full));
		} else if (entry.endsWith('.ts')) {
			out.push(full);
		}
	}
	return out;
}

const parseOptions = { target: ts.ScriptTarget.Latest, module: ts.ModuleKind.ESNext };
const parse = (file) => ts.createSourceFile(file, readFileSync(file, 'utf-8'), parseOptions, true);

const srcFiles = collectTsFiles(SRC);
const testFiles = statSync(TEST).isDirectory() ? collectTsFiles(TEST) : [];
const srcSources = new Map(srcFiles.map((f) => [f, parse(f)]));
const testSources = new Map(testFiles.map((f) => [f, parse(f)]));

/** Whether an interface/type member carries a `wiring:keep` suppression. */
function isSuppressed(member) {
	const source = member.getSourceFile();
	const text = source.getFullText();
	// Comments immediately preceding the member (its leading trivia range) —
	// single-line comments above the member ARE leading trivia, so this is
	// the documented suppression position. No wider search: a `wiring:keep`
	// further back belongs to an earlier field and must not suppress this one.
	const leading = text.slice(member.getFullStart(), member.getStart());
	return leading.includes(KEEP_MARKER);
}

/**
 * Collect every plain field declared on an interface or type-alias object
 * type in src/. Returns [{ rel, line, name, typeName, source, member }].
 */
function collectFields() {
	const fields = [];
	for (const [file, source] of srcSources) {
		const visit = (node) => {
			// TS 6 shapes: an InterfaceDeclaration carries `members` directly
			// (the old TypeLiteralNode wrapper is gone); a TypeAliasDeclaration
			// still wraps them in a TypeLiteral under `type`.
			let typeName;
			let members;
			if (ts.isInterfaceDeclaration(node)) {
				typeName = node.name.text;
				members = node.members;
			} else if (ts.isTypeAliasDeclaration(node) && node.type && ts.isTypeLiteralNode(node.type)) {
				typeName = node.name.text;
				members = node.type.members;
			}
			if (members) {
				for (const member of members) {
					if (!ts.isPropertySignature(member) || !member.name) continue;
					let name;
					if (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)) {
						name = member.name.text;
					} else {
						continue; // computed / union names: not a plain field
					}
					if (isSuppressed(member)) continue;
					const { line } = source.getLineAndCharacterOfPosition(member.getStart());
					fields.push({ rel: relative(ROOT, file), line: line + 1, name, typeName, source, member });
				}
			}
			ts.forEachChild(node, visit);
		};
		ts.forEachChild(source, visit);
	}
	return fields;
}

/** Whether this file contains an emit call with this exact literal name. */
function fileEmitsEventName(source, name) {
	let found = false;
	const visit = (node) => {
		if (found) return;
		if (
			ts.isCallExpression(node) &&
			ts.isPropertyAccessExpression(node.expression) &&
			node.expression.name.text === 'emit' &&
			node.arguments.length >= 1 &&
			ts.isStringLiteral(node.arguments[0]) &&
			node.arguments[0].text === name
		) {
			found = true;
			return;
		}
		ts.forEachChild(node, visit);
	};
	ts.forEachChild(source, visit);
	return found;
}

/**
 * Whether an access sits inside a destructuring pattern that is the
 * left-hand side of an assignment — e.g. `state.phase` in
 * `({ phase: state.phase } = input)`. Such an access is an assignment
 * target (a write), not a read. Walks up through binding containers:
 * access → PropertyAssignment (the binding's value) → ObjectBindingPattern
 * → BindingElement → ObjectBindingPattern/ArrayBindingPattern → … until an
 * AssignmentExpression whose left side is that pattern. A pattern feeding a
 * variable declaration or a function parameter is NOT an assignment target
 * — its contents are reads.
 */
function isInsideDestructuringTarget(node) {
	let current = node.parent;
	while (current) {
		// Two assignment-pattern shapes:
		//  - declared destructuring `const { phase: x } = input` —
		//    BindingElement/ObjectBindingPattern (a pattern can't assign to a
		//    member, so this form is never a target)
		//  - assignment destructuring `({ phase: state.phase } = input)` —
		//    the left side is a plain ObjectLiteralExpression; only when that
		//    object sits on the LEFT of `=` is it a pattern, and its members
		//    are assignment targets.
		if (ts.isObjectLiteralExpression(current)) {
			const parent = current.parent;
			if (
				parent &&
				ts.isBinaryExpression(parent) &&
				parent.left === current &&
				parent.operatorToken.getText() === '='
			) {
				return true;
			}
			// A nested object/array literal inside an outer assignment pattern:
			// keep walking outward — the outer pattern decides.
			current = current.parent;
			continue;
		}
		if (ts.isBindingElement(current) || ts.isObjectBindingPattern(current) || ts.isArrayBindingPattern(current)) {
			// Declared destructuring: walk to the container. A chain topping out
			// at a VariableDeclaration/Parameter is a declaration (reads); a
			// BinaryExpression '=' with the pattern on the left is a target.
			let container = current.parent;
			while (container) {
				if (ts.isVariableDeclaration(container) || ts.isParameter(container)) return false;
				if (ts.isBinaryExpression(container) && container.operatorToken.getText() === '=') {
					return container.left === current || isAncestorOf(container.left, current);
				}
				container = container.parent;
			}
			return false;
		}
		current = current.parent;
	}
	return false;
}

/** Whether `ancestor` contains `node` somewhere in its subtree. */
function isAncestorOf(ancestor, node) {
	let found = false;
	const visit = (n) => {
		if (found) return;
		if (n === node) {
			found = true;
			return;
		}
		ts.forEachChild(n, visit);
	};
	ts.forEachChild(ancestor, visit);
	return found;
}

/** Whether ANY scanned file emits `name` as an event (emit('<name>', ...)). */
function anyFileEmitsEvent(sources, name) {
	for (const source of sources.values()) {
		if (fileEmitsEventName(source, name)) return true;
	}
	return false;
}

/**
 * Count reads of `name` across the given sources. Object-literal keys are
 * writes and never counted; the three read shapes above are.
 *
 * Event-map exception: an interface field whose name is emitted as an event
 * anywhere (`agentEventBus.emit('turnStart', …)`) counts as read — the
 * `AgentEventMap` keys are consumed via the literal, not via `.key`. The
 * interface declares the key; the emit call sites are the reads. (The first
 * draft required the emit in the same file; the map lives in
 * `agent-events.ts` and the emitters are elsewhere, so same-file missed
 * every AgentEventMap key.)
 */
function countReads(name, sources) {
	let anyFileEmits = false;
	for (const source of sources.values()) {
		if (fileEmitsEventName(source, name)) {
			anyFileEmits = true;
			break;
		}
	}
	let reads = 0;
	for (const source of sources.values()) {
		const emitsThisName = anyFileEmits;
		// An access that is the left operand of a simple assignment is a write,
		// not a read (`object.name = v`); a compound assignment (`+=`) still
		// reads the previous value, so it counts. Guards every access branch
		// below.
		const isSimpleAssignmentTarget = (node) => {
			const p = node.parent;
			return !!p && ts.isBinaryExpression(p) && p.left === node && p.operatorToken.getText() === '=';
		};
		const isAssignmentTarget = isSimpleAssignmentTarget;
		const visit = (node) => {
			if (ts.isPropertyAccessExpression(node) && node.name.text === name) {
				if (!isAssignmentTarget(node)) reads++;
				return;
			}
			if (
				ts.isElementAccessExpression(node) &&
				node.argumentExpression &&
				ts.isStringLiteral(node.argumentExpression) &&
				node.argumentExpression.text === name &&
				!isAssignmentTarget(node)
			) {
				reads++;
				return;
			}
			if (ts.isBindingElement(node)) {
				// The property name being bound, in whatever static form:
				// `{ name }` (implicit identifier), `{ 'name': alias }`
				// (string-literal key), `{ ['name']: alias }` (computed static
				// string key).
				const propertyNameText = node.propertyName
					? ts.isIdentifier(node.propertyName) || ts.isStringLiteral(node.propertyName)
						? node.propertyName.text
						: ts.isComputedPropertyName(node.propertyName) && ts.isStringLiteral(node.propertyName.expression)
							? node.propertyName.expression.text
							: undefined
					: ts.isIdentifier(node.name)
						? node.name.text
						: undefined;
				if (propertyNameText === name) {
					reads++;
					return;
				}
			}
			if (emitsThisName && ts.isStringLiteral(node) && node.text === name && isEventMapKey(node)) {
				reads++;
				return;
			}
			ts.forEachChild(node, visit);
		};
		ts.forEachChild(source, visit);
	}
	return reads;
}

/**
 * Whether a string literal sits in key position of an object literal whose
 * shape looks like an event map (values are function-valued). Used with the
 * same-file `emit('name'` heuristic above.
 */
function isEventMapKey(node) {
	const parent = node.parent;
	if (!parent || !ts.isPropertyAssignment(parent) || parent.name !== node) return false;
	const literal = parent.parent;
	if (!literal || !ts.isObjectLiteralExpression(literal)) return false;
	// Event maps map names to callbacks/functions.
	return literal.properties.some(
		(p) => ts.isPropertyAssignment(p) && (ts.isArrowFunction(p.initializer) || ts.isFunctionExpression(p.initializer))
	);
}

// ── Main ─────────────────────────────────────────────────────────────────────

const fields = collectFields();
console.log(
	`#1469 unread-field scan: ${fields.length} fields declared in ${srcFiles.length} src files (scanning src + ${testFiles.length} test files for reads)\n`
);

const allSources = new Map([...srcSources, ...testSources]);
const candidates = [];
for (const field of fields) {
	let reads = countReads(field.name, allSources);
	if (reads === 0 && anyFileEmitsEvent(allSources, field.name)) {
		// Event-map key: the interface declares `name` and the emit sites
		// consume the literal — the declaration is the write, the emitters
		// are the reads.
		reads = 1;
	}
	if (reads === 0) candidates.push(field);
}

if (candidates.length === 0) {
	console.log('No unread fields found.');
} else {
	console.log(`Unread-field candidates: ${candidates.length}\n`);
	for (const c of candidates) {
		console.log(`  ${c.rel}:${c.line}  ${c.typeName}.${c.name}`);
	}
	console.log(
		`\nAdvisory: these are write-only candidates, not proven dead. Suppress a genuinely write-only field with '${KEEP_MARKER}' in a comment on its declaration line.`
	);
}

// Persist the report for the workflow artifact (always — even when empty —
// so `if-no-files-found` never hides a genuinely clean run).
const report = [
	`#1469 unread-field scan — ${new Date().toISOString()}`,
	`${fields.length} fields declared across ${srcFiles.length} src files; reads searched in src + ${testFiles.length} test files.`,
	'',
	...(candidates.length === 0
		? ['No unread fields found.']
		: [
				`Unread-field candidates: ${candidates.length}`,
				'',
				...candidates.map((c) => `  ${c.rel}:${c.line}  ${c.typeName}.${c.name}`),
			]),
	'',
	`Advisory: write-only candidates, not proven dead. Suppress with '${KEEP_MARKER}' on the declaration line.`,
].join('\n');
writeFileSync(join(ROOT, 'unread-fields-report.txt'), report + '\n');
process.exit(0);
