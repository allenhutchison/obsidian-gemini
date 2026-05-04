import { defineConfig } from 'vitepress';

export default defineConfig({
	title: 'Gemini Scribe',
	description: 'AI-powered assistant for Obsidian using Google Gemini',
	base: '/obsidian-gemini/',
	cleanUrls: true,
	lastUpdated: true,
	vite: {
		build: {
			target: 'es2022',
		},
	},
	// CONTRIBUTING.md and AI_POLICY.md are symlinked from the repo root and
	// contain relative links (./CONTRIBUTING, ./LICENSE) that are valid on
	// GitHub but don't resolve within the docs directory.
	ignoreDeadLinks: [/\.\/CONTRIBUTING/, /\.\/LICENSE/],

	head: [['link', { rel: 'icon', type: 'image/png', href: '/obsidian-gemini/favicon.png' }]],

	themeConfig: {
		nav: [
			{ text: 'Guide', link: '/guide/getting-started' },
			{ text: 'FAQ', link: '/guide/faq' },
			{ text: 'Reference', link: '/reference/settings' },
			{ text: 'Contributing', link: '/contributing/contributing' },
			{ text: 'Changelog', link: '/changelog' },
		],

		sidebar: {
			'/guide/': [
				{
					text: 'Getting Started',
					items: [
						{ text: 'Introduction', link: '/guide/getting-started' },
						{ text: 'Ollama (Local Models)', link: '/guide/ollama-setup' },
						{ text: 'FAQ', link: '/guide/faq' },
					],
				},
				{
					text: 'Core Features',
					items: [
						{ text: 'Agent Mode', link: '/guide/agent-mode' },
						{ text: 'Custom Prompts', link: '/guide/custom-prompts' },
						{ text: 'AI Writing', link: '/guide/ai-writing' },
						{ text: 'Completions', link: '/guide/completions' },
						{ text: 'Summarization', link: '/guide/summarization' },
						{ text: 'Context System', link: '/guide/context-system' },
						{ text: 'Semantic Search', link: '/guide/semantic-search' },
						{ text: 'Deep Research', link: '/guide/deep-research' },
						{ text: 'MCP Servers', link: '/guide/mcp-servers' },
						{ text: 'Agent Skills', link: '/guide/agent-skills' },
						{ text: 'Projects', link: '/guide/projects' },
						{ text: 'Lifecycle Hooks', link: '/guide/lifecycle-hooks' },
					],
				},
			],
			'/reference/': [
				{
					text: 'Reference',
					items: [
						{ text: 'Settings', link: '/reference/settings' },
						{ text: 'Advanced Settings', link: '/reference/advanced-settings' },
						{ text: 'Loop Detection', link: '/reference/loop-detection' },
					],
				},
			],
			'/contributing/': [
				{
					text: 'Contributing',
					items: [
						{ text: 'Contributing Guide', link: '/contributing/contributing' },
						{ text: 'AI Policy', link: '/contributing/ai-policy' },
						{ text: 'Testing', link: '/contributing/testing' },
						{ text: 'Tool Development', link: '/contributing/tool-development' },
					],
				},
			],
		},

		socialLinks: [{ icon: 'github', link: 'https://github.com/allenhutchison/obsidian-gemini' }],

		editLink: {
			pattern: 'https://github.com/allenhutchison/obsidian-gemini/edit/master/docs/:path',
			text: 'Edit this page on GitHub',
		},

		search: {
			provider: 'local',
		},

		footer: {
			message: 'Released under the MIT License.',
			copyright: 'Copyright © 2024-present <a href="https://allen.hutchison.org">Allen Hutchison</a>',
		},
	},
});
