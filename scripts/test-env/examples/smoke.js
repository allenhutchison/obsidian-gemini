// Example live check for cdp.mjs:
//   node scripts/test-env/cdp.mjs eval scripts/test-env/examples/smoke.js
//
// The file body runs inside an async function in the Obsidian renderer, so it can
// `await` and must `return` a JSON-serialisable value.
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A fresh vault opens with a "Do you trust the author of this vault?" modal, and
// community plugins stay off until it is accepted. Accept it if it is showing.
const trust = [...activeDocument.querySelectorAll('.modal button')].find((button) =>
	button.innerText.startsWith('Trust author')
);
if (trust) {
	trust.click();
}
// Wait for the plugin to load and register its commands.
const commandCount = () => Object.keys(app.commands.commands).filter((id) => id.startsWith('gemini-scribe:')).length;
for (let i = 0; i < 50 && commandCount() === 0; i++) await sleep(200);
// Close anything else left open (welcome or release notes modals).
activeDocument.querySelectorAll('.modal-container .modal-close-button').forEach((button) => button.click());

const plugin = app.plugins.plugins['gemini-scribe'];
return {
	vault: app.vault.getName(),
	trustedNow: Boolean(trust),
	pluginLoaded: Boolean(plugin),
	pluginVersion: plugin?.manifest.version,
	enabledPlugins: [...app.plugins.enabledPlugins],
	hasApiKey: Boolean(plugin?.apiKey),
	isMobile: app.isMobile,
	commands: commandCount(),
};
