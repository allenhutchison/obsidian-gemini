import { defineConfig } from 'vitepress';

export default defineConfig({
	title: 'Gemini Scribe',
	description: 'AI-powered assistant for Obsidian using Google Gemini',
	base: '/obsidian-gemini/',
	cleanUrls: true,
	lastUpdated: true,

	themeConfig: {
		nav: [
			{ text: 'Guide', link: '/guide/getting-started' },
			{ text: 'Reference', link: '/reference/settings' },
			{ text: 'Contributing', link: '/contributing/tool-development' },
		],

		sidebar: {
			'/guide/': [
				{
					text: 'Getting Started',
					items: [
						{ text: 'Introduction', link: '/guide/getting-started' },
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
						{ text: 'Migration Guide', link: '/reference/migration' },
					],
				},
			],
			'/contributing/': [
				{
					text: 'Contributing',
					items: [{ text: 'Tool Development', link: '/contributing/tool-development' }],
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
