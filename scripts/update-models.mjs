#!/usr/bin/env node

/**
 * Fetches available Gemini models from Google's API and updates src/data/models.json
 * with any new models not already in the list.
 *
 * Usage: GOOGLE_API_KEY=... node scripts/update-models.mjs
 *
 * Exit codes:
 *   0 — models.json was updated with new models
 *   1 — no new models found (or error)
 */

import { readFileSync, writeFileSync } from 'fs';
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

		const newModels = [];
		for (const model of candidateModels) {
			const modelId = extractModelId(model.name);
			if (existingIds.has(modelId)) continue;

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

			newModels.push(entry);
		}

		if (newModels.length === 0) {
			console.log('No new models found.');
			process.exit(1);
		}

		console.log(`Found ${newModels.length} new model(s):`);
		for (const model of newModels) {
			console.log(`  - ${model.value} (${model.label})${model.supportsImageGeneration ? ' [image]' : ''}`);
		}

		// Append new models and update metadata
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
		process.exit(0);
	});
}

main().catch((err) => {
	console.error('Error:', err.message);
	process.exit(1);
});
