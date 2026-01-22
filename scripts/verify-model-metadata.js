const API_KEY = process.env.GEMINI_API_KEY;

if (!API_KEY) {
	console.error('Error: GEMINI_API_KEY environment variable is not set.');
	console.error('Usage: GEMINI_API_KEY=your_key node scripts/verify-model-metadata.js');
	process.exit(1);
}

async function fetchModels() {
	try {
		const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`);
		if (!response.ok) {
			throw new Error(`HTTP error! status: ${response.status}`);
		}
		const data = await response.json();

		console.log('Successfully fetched models from Google API:');
		console.log('----------------------------------------');

		if (data.models) {
			data.models.forEach((model) => {
				console.log(`Name: ${model.name}`);
				console.log(`Display Name: ${model.displayName || '(none)'}`);
				console.log(`Description: ${model.description || '(none)'}`);
				console.log(`Supported Generation Methods: ${JSON.stringify(model.supportedGenerationMethods)}`);
				console.log('----------------------------------------');
			});
			console.log(`Total models found: ${data.models.length}`);
		} else {
			console.log('No models found in response.');
		}
	} catch (error) {
		console.error('Error fetching models:', error);
		process.exit(1);
	}
}

fetchModels();
