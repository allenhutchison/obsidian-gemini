#!/usr/bin/env node

/**
 * Fetches available Gemini models from Google's API and updates src/data/models.json
 * with any new models not already in the list.
 *
 * Usage: GOOGLE_API_KEY=... node scripts/update-models.mjs
 *
 * Exit codes:
 *   0 — success (whether or not new models were found)
 *   1 — error (missing API key, API failure, validation failure)
 *
 * When run inside GitHub Actions, writes `updated=true|false` to $GITHUB_OUTPUT
 * so the workflow can gate the PR-creation steps. Errors must exit non-zero so
 * a broken API key or schema change fails the run loudly instead of looking
 * like a quiet "no new models" week.
 */

import { readFileSync, writeFileSync, appendFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const MODELS_PATH = join(__dirname, '..', 'src', 'data', 'models.json');
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

// Model name substrings to exclude
const EXCLUDE_PATTERNS = [
	'embedding',
	'aqa',
	'learnlm',
	'gemma',
	'imagen',
	'veo',
	'tts',
	'vision',
	'computer',
	'robotics',
	'gemini-2.0',
	// Retired by Google 2026-07 (API returns 404 "no longer available"); keep it
	// out even if ListModels still advertises it. Settings migration lives in
	// RETIRED_MODEL_SUCCESSORS in src/models.ts.
	'gemini-3-pro-preview',
];

async function fetchAllModels(apiKey) {
	let allModels = [];
	let pageToken;

	do {
		const url = new URL(`${API_BASE}/models`);
		url.searchParams.set('pageSize', '50');
		if (pageToken) {
			url.searchParams.set('pageToken', pageToken);
		}

		const response = await fetch(url.toString(), {
			headers: { 'x-goog-api-key': apiKey },
			signal: AbortSignal.timeout(30000), // 30 second timeout
		});
		if (!response.ok) {
			throw new Error(`API request failed: ${response.status} ${response.statusText}`);
		}

		const data = await response.json();
		allModels = allModels.concat(data.models || []);
		pageToken = data.nextPageToken;
	} while (pageToken);

	return allModels;
}

function shouldIncludeModel(model) {
	const name = (model.name || '').toLowerCase();
	const methods = model.supportedGenerationMethods || [];

	// Must be a Gemini model
	if (!name.includes('gemini')) return false;

	// Must support content generation
	if (!methods.includes('generateContent')) return false;

	// Exclude known non-generative model types
	for (const pattern of EXCLUDE_PATTERNS) {
		if (name.includes(pattern)) return false;
	}

	return true;
}

function extractModelId(fullName) {
	return fullName.replace(/^models\//, '');
}

function generateLabel(model) {
	const displayName = model.displayName || extractModelId(model.name);
	return displayName;
}

function inferImageSupport(modelId) {
	// Only infer for models with "image" in the name (but not "imagen" which is already excluded)
	return modelId.includes('image');
}

function isPreviewModel(modelId) {
	return modelId.includes('-preview');
}

// The GA (stable) equivalent of a preview model id. Per Google's naming
// convention, preview models are `<base>-preview` optionally followed by a
// date suffix (e.g. `gemini-2.5-flash-preview-09-2025` -> `gemini-2.5-flash`,
// `gemini-3-pro-image-preview` -> `gemini-3-pro-image`). Strip `-preview` and
// everything after it to recover the base id.
function gaModelId(modelId) {
	return modelId.replace(/-preview.*$/, '');
}

// Report whether models.json changed to the calling workflow (no-op outside CI).
function setUpdatedOutput(updated) {
	if (process.env.GITHUB_OUTPUT) {
		appendFileSync(process.env.GITHUB_OUTPUT, `updated=${updated}\n`, 'utf-8');
	}
}

function main() {
	const apiKey = process.env.GOOGLE_API_KEY;
	if (!apiKey) {
		console.error('Error: GOOGLE_API_KEY environment variable is required');
		process.exit(1);
	}

	return fetchAllModels(apiKey).then((apiModels) => {
		// Load existing models.json
		const modelsFile = JSON.parse(readFileSync(MODELS_PATH, 'utf-8'));
		const existingIds = new Set(modelsFile.models.map((m) => m.value));

		// Filter and map API models
		const candidateModels = apiModels.filter(shouldIncludeModel);

		let newModels = [];
		// Existing preview entries that a newly-arrived GA model supersedes;
		// keyed by preview value -> the new GA entry that replaces it.
		const retiredPreviews = new Map();
		for (const model of candidateModels) {
			const modelId = extractModelId(model.name);
			if (existingIds.has(modelId)) continue;

			// Skip preview models once we've adopted the GA (stable) version
			// of the same model. Google keeps listing the preview aliases
			// indefinitely, but offering both shows duplicate options (often
			// with identical labels) in the model dropdowns.
			if (isPreviewModel(modelId) && existingIds.has(gaModelId(modelId))) {
				console.log(`Skipping ${modelId}: superseded by adopted GA model ${gaModelId(modelId)}`);
				continue;
			}

			const entry = {
				value: modelId,
				label: generateLabel(model),
			};

			if (inferImageSupport(modelId)) {
				entry.supportsImageGeneration = true;
			}

			// Include maxTemperature if the API provides it
			if (model.maxTemperature !== undefined) {
				entry.maxTemperature = model.maxTemperature;
			} else {
				entry.maxTemperature = 2;
			}

			// When a new GA (stable) model arrives, retire any existing preview
			// entries it supersedes so the GA "replaces" rather than duplicates
			// them. Carry over curated default-role assignments to the GA entry
			// so we don't silently drop a configured default.
			if (!isPreviewModel(modelId)) {
				for (const existing of modelsFile.models) {
					if (isPreviewModel(existing.value) && gaModelId(existing.value) === modelId) {
						retiredPreviews.set(existing.value, entry);
						if (existing.defaultForRoles && !entry.defaultForRoles) {
							entry.defaultForRoles = existing.defaultForRoles;
						}
					}
				}
			}

			newModels.push(entry);
		}

		// Same-run guard: if both a preview and its GA arrived in this batch,
		// keep only the GA — mirroring the already-adopted-GA skip above.
		const newGaIds = new Set(newModels.filter((m) => !isPreviewModel(m.value)).map((m) => m.value));
		newModels = newModels.filter((m) => {
			if (isPreviewModel(m.value) && newGaIds.has(gaModelId(m.value))) {
				console.log(`Skipping ${m.value}: superseded by new GA model ${gaModelId(m.value)}`);
				return false;
			}
			return true;
		});

		if (newModels.length === 0) {
			console.log('No new models found.');
			setUpdatedOutput(false);
			process.exit(0);
		}

		console.log(`Found ${newModels.length} new model(s):`);
		for (const model of newModels) {
			console.log(`  - ${model.value} (${model.label})${model.supportsImageGeneration ? ' [image]' : ''}`);
		}

		// Retire superseded preview entries, then append the new models.
		if (retiredPreviews.size > 0) {
			for (const [previewId, gaEntry] of retiredPreviews) {
				console.log(`Retiring ${previewId}: superseded by new GA model ${gaEntry.value}`);
			}
			modelsFile.models = modelsFile.models.filter((m) => !retiredPreviews.has(m.value));
		}
		modelsFile.models.push(...newModels);
		modelsFile.lastUpdated = new Date().toISOString();

		// Validate the resulting structure before writing
		if (modelsFile.version !== 1 || !Array.isArray(modelsFile.models) || modelsFile.models.length === 0) {
			console.error('Validation failed: invalid models.json schema after update');
			process.exit(1);
		}
		for (const m of modelsFile.models) {
			if (typeof m.value !== 'string' || typeof m.label !== 'string') {
				console.error(`Validation failed: model entry missing required fields: ${JSON.stringify(m)}`);
				process.exit(1);
			}
		}

		// Write with tab indentation to match Prettier's output for this repo
		writeFileSync(MODELS_PATH, JSON.stringify(modelsFile, null, '\t') + '\n', 'utf-8');
		console.log(`Updated ${MODELS_PATH}`);
		setUpdatedOutput(true);
		process.exit(0);
	});
}

main().catch((err) => {
	console.error('Error:', err.message);
	process.exit(1);
});
