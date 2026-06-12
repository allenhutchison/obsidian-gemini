#!/usr/bin/env node

/**
 * Generates and maintains the AI-bootstrapped UI translations in src/i18n/.
 *
 * Reads the English source strings from src/i18n/en.ts, translates them with Gemini,
 * and writes one TypeScript file per language plus a hash manifest
 * (src/i18n/translation-state.json) recording the English source each translation
 * was generated from. Re-runs only retranslate keys whose English message/context
 * changed — hand-refined translations are preserved as long as their English source
 * is unchanged. Keys removed from en.ts are pruned from all language files.
 *
 * Usage:
 *   GOOGLE_API_KEY=... npm run translate                  # update all languages
 *   GOOGLE_API_KEY=... npm run translate -- --langs ru,de # subset of languages
 *   GOOGLE_API_KEY=... npm run translate -- --force       # retranslate everything
 *   npm run translate -- --check                          # dry run: list stale keys (no API key needed)
 *
 * Exit codes:
 *   0 — everything up to date (or successfully updated)
 *   1 — stale keys remain (--check), some translations failed, or error
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createHash } from 'crypto';
import { parseArgs } from 'util';
import { spawnSync } from 'child_process';
import { transform } from 'esbuild';
import { GoogleGenAI } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const I18N_DIR = join(__dirname, '..', 'src', 'i18n');
const STATE_PATH = join(I18N_DIR, 'translation-state.json');

const DEFAULT_MODEL = process.env.GEMINI_TRANSLATE_MODEL || 'gemini-3.5-flash';
const CHUNK_SIZE = 50;
const MAX_API_RETRIES = 2;
const RETRY_DELAY_MS = 2000;

/**
 * Shipped languages, aligned with Obsidian's UI locale codes.
 * Adding a language: add a row here, register the export in src/i18n/index.ts,
 * then run `npm run translate -- --langs <code>`.
 */
const LANGUAGES = [
	{ code: 'cs', name: 'Czech', file: 'cs.ts', exportName: 'cs' },
	{ code: 'da', name: 'Danish', file: 'da.ts', exportName: 'da' },
	{ code: 'de', name: 'German', file: 'de.ts', exportName: 'de' },
	{ code: 'es', name: 'Spanish', file: 'es.ts', exportName: 'es' },
	{ code: 'fr', name: 'French', file: 'fr.ts', exportName: 'fr' },
	{ code: 'id', name: 'Indonesian', file: 'id.ts', exportName: 'id' },
	{ code: 'it', name: 'Italian', file: 'it.ts', exportName: 'it' },
	{ code: 'ja', name: 'Japanese', file: 'ja.ts', exportName: 'ja' },
	{ code: 'ko', name: 'Korean', file: 'ko.ts', exportName: 'ko' },
	{ code: 'nl', name: 'Dutch', file: 'nl.ts', exportName: 'nl' },
	{ code: 'no', name: 'Norwegian', file: 'no.ts', exportName: 'no' },
	{ code: 'pl', name: 'Polish', file: 'pl.ts', exportName: 'pl' },
	{ code: 'pt', name: 'European Portuguese', file: 'pt.ts', exportName: 'pt' },
	{ code: 'pt-BR', name: 'Brazilian Portuguese', file: 'pt-br.ts', exportName: 'ptBR' },
	{ code: 'ru', name: 'Russian', file: 'ru.ts', exportName: 'ru' },
	{ code: 'tr', name: 'Turkish', file: 'tr.ts', exportName: 'tr' },
	{ code: 'uk', name: 'Ukrainian', file: 'uk.ts', exportName: 'uk' },
	{ code: 'vi', name: 'Vietnamese', file: 'vi.ts', exportName: 'vi' },
	{ code: 'zh', name: 'Simplified Chinese', file: 'zh.ts', exportName: 'zh' },
	{ code: 'zh-TW', name: 'Traditional Chinese', file: 'zh-tw.ts', exportName: 'zhTW' },
];

/** Load a TypeScript module by transpiling it in-memory and importing it as a data URL. */
async function importTsModule(path) {
	const source = readFileSync(path, 'utf-8');
	const { code } = await transform(source, { loader: 'ts', format: 'esm' });
	return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}

function hashSource(entry) {
	return createHash('sha256')
		.update(entry.message + '\u0000' + (entry.context ?? ''))
		.digest('hex');
}

function placeholders(message) {
	return [...message.matchAll(/\{(\w+)\}/g)].map((m) => m[0]);
}

function loadState() {
	if (!existsSync(STATE_PATH)) return {};
	return JSON.parse(readFileSync(STATE_PATH, 'utf-8'));
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildPrompt(language, entries) {
	const items = entries.map(([key, entry]) => ({
		key,
		message: entry.message,
		...(entry.context ? { context: entry.context } : {}),
	}));
	return `You are translating user-interface strings for "Gemini Scribe", a community plugin for Obsidian (a note-taking app). Translate each string from English to ${language.name} (${language.code}).

Rules:
- These are short UI labels. Keep translations concise and natural for software UI.
- Follow the official Obsidian ${language.name} UI conventions for app terms ("vault", "note", "plugin", "tab"). If Obsidian's own UI leaves a term untranslated in this language (commonly "vault"), leave it untranslated too.
- Never translate product names: Obsidian, Gemini, Gemini Scribe, AGENTS.md.
- Preserve placeholders like {name} exactly as written.
- Preserve emoji and leading/trailing punctuation (e.g. a trailing colon).
- The "context" field tells you where the string appears. Use it for disambiguation; do not translate it.

Strings to translate (JSON):
${JSON.stringify(items, null, 2)}

Return a JSON array of objects {"key": ..., "translation": ...} covering every input key exactly once.`;
}

async function callGemini(client, model, prompt) {
	let lastError;
	for (let attempt = 0; attempt <= MAX_API_RETRIES; attempt++) {
		try {
			const response = await client.models.generateContent({
				model,
				contents: prompt,
				config: {
					temperature: 0,
					responseMimeType: 'application/json',
					responseSchema: {
						type: 'array',
						items: {
							type: 'object',
							properties: {
								key: { type: 'string' },
								translation: { type: 'string' },
							},
							required: ['key', 'translation'],
						},
					},
				},
			});
			const text =
				(typeof response?.text === 'string' && response.text) ||
				response?.candidates?.[0]?.content?.parts?.map((p) => p?.text || '').join('') ||
				'';
			return JSON.parse(text);
		} catch (err) {
			lastError = err;
			if (attempt < MAX_API_RETRIES) {
				console.warn(`  API call failed (${err.message}), retrying in ${RETRY_DELAY_MS / 1000}s...`);
				await sleep(RETRY_DELAY_MS);
			}
		}
	}
	throw lastError;
}

/**
 * Translate the given [key, SourceString] entries. Returns a Map of key -> translation
 * for every entry that passed validation; invalid/missing keys are simply absent.
 */
async function translateEntries(client, model, language, entries) {
	const results = new Map();
	for (let i = 0; i < entries.length; i += CHUNK_SIZE) {
		let chunk = entries.slice(i, i + CHUNK_SIZE);
		// One validation-driven retry: re-request only the keys that came back invalid.
		for (let round = 0; round < 2 && chunk.length > 0; round++) {
			const requested = new Map(chunk);
			const items = await callGemini(client, model, buildPrompt(language, chunk));
			for (const item of Array.isArray(items) ? items : []) {
				const source = requested.get(item?.key);
				if (!source) continue;
				const translation = typeof item.translation === 'string' ? item.translation.trim() : '';
				if (translation === '') continue;
				// The translation must carry exactly the source's placeholders — a missing one
				// would lose data at render time, an invented one would surface literally in the UI.
				const expected = new Set(placeholders(source.message));
				const actual = new Set(placeholders(translation));
				if (expected.size !== actual.size || ![...expected].every((ph) => actual.has(ph))) continue;
				results.set(item.key, translation);
			}
			chunk = chunk.filter(([key]) => !results.has(key));
			if (chunk.length > 0 && round === 0) {
				console.warn(`  ${chunk.length} translation(s) failed validation, retrying those keys...`);
			}
		}
		for (const [key] of chunk) {
			console.warn(`  FAILED: ${language.code} ${key} — will be retried on the next run`);
		}
	}
	return results;
}

function serializeLanguageFile(language, en, translations) {
	const lines = [
		'// AI-generated translations — created by `npm run translate` (scripts/translate.mjs).',
		'// Hand-refinements are welcome and PRESERVED: a key is only regenerated when its',
		'// English source string in src/i18n/en.ts changes (tracked in translation-state.json).',
		"import type { TranslationKey } from './en';",
		'',
		`export const ${language.exportName}: Partial<Record<TranslationKey, string>> = {`,
	];
	for (const key of Object.keys(en)) {
		const translation = translations.get(key);
		if (translation === undefined) continue;
		lines.push(`\t${JSON.stringify(key)}: ${JSON.stringify(translation)},`);
	}
	lines.push('};', '');
	return lines.join('\n');
}

function sortedObject(obj) {
	return Object.fromEntries(
		Object.keys(obj)
			.sort()
			.map((k) => [k, obj[k]])
	);
}

async function main() {
	const { values } = parseArgs({
		options: {
			langs: { type: 'string' },
			force: { type: 'boolean', default: false },
			check: { type: 'boolean', default: false },
			model: { type: 'string', default: DEFAULT_MODEL },
		},
	});

	const requestedCodes = values.langs ? values.langs.split(',').map((s) => s.trim()) : null;
	if (requestedCodes) {
		const known = new Set(LANGUAGES.map((l) => l.code));
		const unknown = requestedCodes.filter((c) => !known.has(c));
		if (unknown.length > 0) {
			console.error(`Unknown language code(s): ${unknown.join(', ')}. Known: ${[...known].join(', ')}`);
			process.exit(1);
		}
	}
	const targets = requestedCodes ? LANGUAGES.filter((l) => requestedCodes.includes(l.code)) : LANGUAGES;

	const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
	if (!apiKey && !values.check) {
		console.error('Error: GOOGLE_API_KEY (or GEMINI_API_KEY) environment variable is required.');
		console.error('Usage: GOOGLE_API_KEY=... npm run translate [-- --langs ru,de] [-- --force] [-- --check]');
		process.exit(1);
	}

	const { en } = await importTsModule(join(I18N_DIR, 'en.ts'));
	const currentHashes = Object.fromEntries(Object.entries(en).map(([key, entry]) => [key, hashSource(entry)]));
	const state = loadState();

	// Compute per-language work: existing translations + the set of stale keys.
	const work = [];
	for (const language of targets) {
		const filePath = join(I18N_DIR, language.file);
		let existing = new Map();
		if (existsSync(filePath)) {
			const mod = await importTsModule(filePath);
			existing = new Map(Object.entries(mod[language.exportName] ?? {}));
		}
		const langState = state[language.code] ?? {};
		const stale = Object.entries(en).filter(([key]) => {
			if (values.force) return true;
			const translation = existing.get(key);
			if (typeof translation !== 'string' || translation.trim() === '') return true;
			return langState[key] !== currentHashes[key];
		});
		work.push({ language, filePath, existing, stale });
	}

	if (values.check) {
		let totalStale = 0;
		for (const { language, stale } of work) {
			totalStale += stale.length;
			console.log(
				`${language.code}: ${stale.length} stale key(s)${stale.length ? ' — ' + stale.map(([k]) => k).join(', ') : ''}`
			);
		}
		console.log(totalStale === 0 ? 'All translations up to date.' : `${totalStale} stale key(s) total.`);
		process.exit(totalStale === 0 ? 0 : 1);
	}

	const client = new GoogleGenAI({ apiKey });
	const writtenFiles = [];
	let anyFailed = false;

	for (const { language, filePath, existing, stale } of work) {
		console.log(`${language.code} (${language.name}): ${stale.length} key(s) to translate`);
		const fresh = stale.length > 0 ? await translateEntries(client, values.model, language, stale) : new Map();
		if (fresh.size < stale.length) anyFailed = true;

		// Merge: fresh translation wins, otherwise keep what's already there.
		// Keys absent from en.ts are pruned by iterating en's keys only.
		const merged = new Map();
		for (const key of Object.keys(en)) {
			const value = fresh.get(key) ?? existing.get(key);
			if (typeof value === 'string' && value.trim() !== '') {
				merged.set(key, value);
			}
		}
		writeFileSync(filePath, serializeLanguageFile(language, en, merged), 'utf-8');
		writtenFiles.push(filePath);

		// Manifest: record the English hash for every key now present in the file,
		// except keys whose translation failed this run (so the next run retries them).
		const langState = {};
		for (const key of merged.keys()) {
			const failedThisRun = stale.some(([k]) => k === key) && !fresh.has(key);
			if (!failedThisRun) {
				langState[key] = currentHashes[key];
			}
		}
		state[language.code] = sortedObject(langState);
		// Persist the manifest after every language so an interrupted run
		// (timeout, ctrl-C) keeps the completed languages' progress.
		writeFileSync(STATE_PATH, JSON.stringify(sortedObject(state), null, '\t') + '\n', 'utf-8');
	}

	// Prune manifest entries for languages no longer shipped.
	const shipped = new Set(LANGUAGES.map((l) => l.code));
	for (const code of Object.keys(state)) {
		if (!shipped.has(code)) delete state[code];
	}

	writeFileSync(STATE_PATH, JSON.stringify(sortedObject(state), null, '\t') + '\n', 'utf-8');
	writtenFiles.push(STATE_PATH);

	const prettier = spawnSync('npx', ['prettier', '--write', ...writtenFiles], { stdio: 'inherit' });
	if (prettier.status !== 0) {
		console.error('Error: prettier failed on generated files');
		process.exit(1);
	}

	console.log(`Done. Updated ${writtenFiles.length - 1} language file(s) + manifest.`);
	process.exit(anyFailed ? 1 : 0);
}

main().catch((err) => {
	console.error('Error:', err.message);
	process.exit(1);
});
