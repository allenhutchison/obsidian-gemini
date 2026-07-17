import { setIcon, TFile } from 'obsidian';
import type { ObsidianGemini } from '../../types/plugin';
import { ToolResult } from '../../tools/types';
import { formatFileSize } from '../../utils/format-utils';
import { t } from '../../i18n';
import { TOOL_ICONS } from './tool-icons';
import { setCollapsibleExpanded, wireCollapsibleToggle } from './collapsible';

/** Citation entry rendered for google_search / google_maps results. */
interface SearchCitation {
	title?: string;
	url: string;
	snippet?: string;
}

/** A search/maps tool result carrying a grounded answer plus citations. */
interface CitationAnswerResult {
	answer: string;
	citations: SearchCitation[];
}

/** A generate_image tool result. */
interface GeneratedImageResult {
	path: string;
	wikilink: string;
	prompt?: string;
}

/** A file-content tool result (e.g. read_file). */
interface FileContentResult {
	content: string;
	path: string;
	size?: number;
}

/** Narrow an unknown value to a plain (non-null) object with string-keyed members. */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function isCitationAnswerResult(
	value: Record<string, unknown>
): value is Record<string, unknown> & CitationAnswerResult {
	return typeof value.answer === 'string' && Array.isArray(value.citations);
}

function isGeneratedImageResult(
	value: Record<string, unknown>
): value is Record<string, unknown> & GeneratedImageResult {
	return typeof value.path === 'string' && typeof value.wikilink === 'string';
}

function isFileContentResult(value: Record<string, unknown>): value is Record<string, unknown> & FileContentResult {
	return typeof value.content === 'string' && typeof value.path === 'string';
}

/**
 * Handles all tool-related UI rendering: tool groups, execution rows, and result display.
 */
export class AgentViewToolDisplay {
	constructor(
		private chatContainer: HTMLElement,
		private plugin: ObsidianGemini
	) {}

	/**
	 * Render a tool-detail section header (title + a copy-to-clipboard button).
	 * The button copies the full, untruncated value so users can grab parameters
	 * or results for debugging even when the inline display is truncated (#731).
	 */
	private createSectionHeader(section: HTMLElement, title: string, getCopyText: () => string): void {
		const header = section.createDiv({ cls: 'gemini-agent-tool-section-header' });
		header.createEl('h4', { text: title });

		const copyBtn = header.createEl('button', {
			cls: 'gemini-agent-tool-copy-section',
			attr: { 'aria-label': t('agent.tools.copySectionAria', { section: title }), type: 'button' },
		});
		setIcon(copyBtn, 'copy');
		copyBtn.addEventListener('click', (e) => {
			// Sections live inside the expandable details; don't let the click
			// bubble up and collapse the row.
			e.stopPropagation();
			void (async () => {
				// getCopyText() can throw synchronously (e.g. JSON.stringify on
				// circular data), so keep it inside the try with the clipboard write.
				try {
					const text = getCopyText();
					await navigator.clipboard.writeText(text);
					setIcon(copyBtn, 'check');
					window.setTimeout(() => setIcon(copyBtn, 'copy'), 1500);
				} catch (err) {
					this.plugin.logger.error('Failed to copy tool detail to clipboard:', err);
				}
			})();
		});
	}

	/**
	 * Render text into a `<pre><code>` block, truncating to the first 500 chars
	 * with a "Show full content" button when it's longer. Used for both raw string
	 * results and file-read `content` payloads, which rendered this identically.
	 */
	private renderTruncatableCode(container: HTMLElement, text: string): void {
		if (text.length > 500) {
			const codeBlock = container.createEl('pre', { cls: 'gemini-agent-tool-code-result' });
			const code = codeBlock.createEl('code');
			code.textContent = text.substring(0, 500) + '\n\n' + t('agent.tools.truncatedSuffix');

			const expandBtn = container.createEl('button', {
				text: t('agent.tools.showFullContent'),
				cls: 'gemini-agent-tool-expand-content',
			});
			expandBtn.addEventListener('click', () => {
				code.textContent = text;
				expandBtn.remove();
			});
		} else {
			container.createEl('pre', { cls: 'gemini-agent-tool-code-result' }).createEl('code', { text });
		}
	}

	/**
	 * The full, untruncated text to copy for a tool result: the error message on
	 * failure, the raw string for string data, otherwise pretty-printed JSON.
	 */
	private getResultCopyText(result: ToolResult): string {
		if (result.success === false || result.success === undefined) {
			return result.error || t('agent.tools.failedDefault');
		}
		if (result.data === undefined || result.data === null) {
			return t('agent.tools.completedDefault');
		}
		return typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2);
	}

	/**
	 * Get a brief parameter summary for a tool row (e.g. file path or query)
	 */
	public getToolParamSummary(_toolName: string, parameters: Record<string, unknown> | undefined): string {
		if (!parameters) return '';
		// Pick the most meaningful parameter for each tool type
		if (typeof parameters.path === 'string' && parameters.path) return parameters.path;
		if (typeof parameters.query === 'string' && parameters.query) return parameters.query;
		if (typeof parameters.url === 'string' && parameters.url) return parameters.url;
		if (typeof parameters.name === 'string' && parameters.name) return parameters.name;
		// Fallback: show first key's value
		const keys = Object.keys(parameters);
		if (keys.length > 0) {
			const val = parameters[keys[0]];
			const str = typeof val === 'string' ? val : JSON.stringify(val);
			return str.length > 40 ? str.substring(0, 40) + '…' : str;
		}
		return '';
	}

	/**
	 * Create a grouped tool activity container for a batch of tool calls.
	 * Returns the group container element.
	 */
	public createToolGroup(totalToolCount: number): HTMLElement {
		// Remove empty state if it exists
		const emptyState = this.chatContainer.querySelector('.gemini-agent-empty-chat');
		if (emptyState) {
			emptyState.remove();
		}

		const group = this.chatContainer.createDiv({ cls: 'gemini-tool-group' });

		// Summary bar (always visible)
		const summary = group.createDiv({ cls: 'gemini-tool-group-summary' });
		summary.setAttribute('role', 'button');
		summary.setAttribute('tabindex', '0');
		summary.setAttribute('aria-expanded', 'false');

		const summaryIcon = summary.createSpan({ cls: 'gemini-tool-group-icon' });
		setIcon(summaryIcon, 'wrench');

		summary.createSpan({
			text: t('agent.tools.running', { done: 0, total: totalToolCount }),
			cls: 'gemini-tool-group-text',
		});

		summary.createSpan({
			text: t('agent.tools.runningBadge'),
			cls: 'gemini-tool-group-status gemini-tool-group-status-running',
		});

		const chevron = summary.createSpan({ cls: 'gemini-tool-group-chevron' });
		setIcon(chevron, 'chevron-right');

		// Body (hidden by default)
		const body = group.createDiv({ cls: 'gemini-tool-group-body' });
		body.hide();

		// Store counts in dataset
		group.dataset.totalCount = String(totalToolCount);
		group.dataset.completedCount = '0';
		group.dataset.failedCount = '0';

		// Toggle expand/collapse — derive state from DOM to stay in sync with programmatic expansion
		wireCollapsibleToggle({
			control: summary,
			body,
			chevron,
			host: group,
			expandedClass: 'gemini-tool-group-expanded',
		});

		return group;
	}

	/**
	 * Update the group summary bar with current counts and status.
	 */
	public updateGroupSummary(group: HTMLElement): void {
		const total = parseInt(group.dataset.totalCount || '0', 10);
		const completed = parseInt(group.dataset.completedCount || '0', 10);
		const failed = parseInt(group.dataset.failedCount || '0', 10);
		const allDone = completed + failed >= total;

		// Update text
		const textEl = group.querySelector('.gemini-tool-group-text') as HTMLElement;
		if (textEl) {
			if (allDone) {
				if (failed > 0) {
					textEl.textContent =
						total === 1
							? t('agent.tools.completedOneFailed', { failed })
							: t('agent.tools.completedManyFailed', { count: total, failed });
				} else {
					textEl.textContent =
						total === 1 ? t('agent.tools.completedOne') : t('agent.tools.completedMany', { count: total });
				}
			} else {
				textEl.textContent = t('agent.tools.running', { done: completed + failed, total });
			}
		}

		// Update status badge
		const statusEl = group.querySelector('.gemini-tool-group-status') as HTMLElement;
		if (statusEl) {
			statusEl.classList.remove(
				'gemini-tool-group-status-running',
				'gemini-tool-group-status-success',
				'gemini-tool-group-status-error'
			);
			if (allDone) {
				if (failed > 0) {
					statusEl.textContent = '⚠️';
					statusEl.classList.add('gemini-tool-group-status-error');
				} else {
					statusEl.textContent = '✅';
					statusEl.classList.add('gemini-tool-group-status-success');
				}
			} else {
				statusEl.textContent = t('agent.tools.runningBadge');
				statusEl.classList.add('gemini-tool-group-status-running');
			}
		}

		// Auto-expand immediately if there's a failure (don't wait for all tools)
		if (failed > 0) {
			const body = group.querySelector('.gemini-tool-group-body') as HTMLElement;
			const chevron = group.querySelector('.gemini-tool-group-chevron') as HTMLElement;
			const summaryEl = group.querySelector('.gemini-tool-group-summary') as HTMLElement;
			if (body && chevron && summaryEl && body.style.display === 'none') {
				setCollapsibleExpanded(
					{ control: summaryEl, body, chevron, host: group, expandedClass: 'gemini-tool-group-expanded' },
					true
				);
			}
		}
	}

	/**
	 * Show tool execution in the UI as a compact row inside a group container.
	 * If no group container is active, creates a standalone fallback.
	 */
	/**
	 * Render a compact "permission granted" row into the tool group, next to the
	 * tool it authorized. Falls back to the main flow only if no group is active.
	 */
	public showPermissionGranted(toolName: string, groupContainer?: HTMLElement | null): void {
		const body = groupContainer?.querySelector('.gemini-tool-group-body') as HTMLElement | null;
		const target = body || this.chatContainer;

		const row = target.createDiv({ cls: 'gemini-tool-row gemini-permission-row' });
		const header = row.createDiv({ cls: 'gemini-tool-row-header' });

		const icon = header.createSpan({ cls: 'gemini-tool-row-icon gemini-permission-row-icon' });
		setIcon(icon, 'shield-check');

		header.createSpan({
			text: t('agent.tools.permissionGranted', { name: toolName }),
			cls: 'gemini-tool-row-name',
		});
	}

	public async showToolExecution(
		toolName: string,
		parameters: Record<string, unknown>,
		executionId?: string,
		groupContainer?: HTMLElement | null
	): Promise<void> {
		// Determine where to add the tool row
		let targetContainer: HTMLElement;

		if (groupContainer) {
			// Add row inside the group body
			const body = groupContainer.querySelector('.gemini-tool-group-body') as HTMLElement;
			targetContainer = body || groupContainer;
		} else {
			// Fallback: standalone message (backward compatibility for external callers)
			const emptyState = this.chatContainer.querySelector('.gemini-agent-empty-chat');
			if (emptyState) emptyState.remove();
			targetContainer = this.chatContainer;
		}

		// Create compact tool row
		const toolRow = targetContainer.createDiv({ cls: 'gemini-tool-row' });

		// Row header (always visible)
		const rowHeader = toolRow.createDiv({ cls: 'gemini-tool-row-header' });
		rowHeader.setAttribute('role', 'button');
		rowHeader.setAttribute('tabindex', '0');
		rowHeader.setAttribute('aria-expanded', 'false');

		const icon = rowHeader.createSpan({ cls: 'gemini-tool-row-icon' });
		setIcon(icon, TOOL_ICONS[toolName] || 'wrench');

		// Get display name
		const tool = this.plugin.toolRegistry.getTool(toolName);
		const displayName = tool?.displayName || toolName;

		rowHeader.createSpan({
			text: displayName,
			cls: 'gemini-tool-row-name',
		});

		// Brief parameter summary (e.g. file path)
		const paramSummary = this.getToolParamSummary(toolName, parameters);
		if (paramSummary) {
			rowHeader.createSpan({
				text: paramSummary,
				cls: 'gemini-tool-row-param',
			});
		}

		rowHeader.createSpan({
			text: t('agent.tools.runningStatus'),
			cls: 'gemini-tool-row-status gemini-tool-row-status-running',
		});

		const rowChevron = rowHeader.createSpan({ cls: 'gemini-tool-row-chevron' });
		setIcon(rowChevron, 'chevron-right');

		// Row details (hidden by default, contains parameters and later results)
		const rowDetails = toolRow.createDiv({ cls: 'gemini-tool-row-details' });
		rowDetails.hide();

		// Parameters section inside details
		if (parameters && Object.keys(parameters).length > 0) {
			const paramsSection = rowDetails.createDiv({ cls: 'gemini-agent-tool-section' });
			this.createSectionHeader(paramsSection, t('agent.tools.parametersHeader'), () =>
				JSON.stringify(parameters, null, 2)
			);

			const paramsList = paramsSection.createDiv({ cls: 'gemini-agent-tool-params-list' });
			for (const [key, value] of Object.entries(parameters)) {
				const paramItem = paramsList.createDiv({ cls: 'gemini-agent-tool-param-item' });
				paramItem.createSpan({
					text: key,
					cls: 'gemini-agent-tool-param-key',
				});

				const valueStr = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
				const valueEl = paramItem.createEl('code', {
					text: valueStr,
					cls: 'gemini-agent-tool-param-value',
				});

				if (valueStr.length > 100) {
					valueEl.textContent = valueStr.substring(0, 100) + '...';
					valueEl.title = valueStr;
				}
			}
		}

		// Toggle row details — derive state from DOM to stay in sync with programmatic expansion
		wireCollapsibleToggle({
			control: rowHeader,
			body: rowDetails,
			chevron: rowChevron,
			host: toolRow,
			expandedClass: 'gemini-tool-row-expanded',
		});

		// Store references for result updates
		toolRow.dataset.toolName = toolName;
		if (executionId) {
			toolRow.dataset.executionId = executionId;
		}

		// Auto-scroll
		this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
	}

	/**
	 * Show tool execution result in the UI, updating the tool row and group summary.
	 */
	public async showToolResult(toolName: string, result: ToolResult, executionId?: string): Promise<void> {
		// Find the existing tool row (in group body or standalone)
		const toolRows = this.chatContainer.querySelectorAll('.gemini-tool-row');
		let toolRow: HTMLElement | null = null;

		if (executionId) {
			for (const row of Array.from(toolRows)) {
				if ((row as HTMLElement).dataset.executionId === executionId) {
					toolRow = row as HTMLElement;
					break;
				}
			}
		} else {
			for (const row of Array.from(toolRows)) {
				if ((row as HTMLElement).dataset.toolName === toolName) {
					toolRow = row as HTMLElement;
					break;
				}
			}
		}

		if (!toolRow) {
			this.plugin.logger.warn(`Tool row not found for ${toolName}`);
			return;
		}

		// Update row status badge
		const statusEl = toolRow.querySelector('.gemini-tool-row-status') as HTMLElement;
		if (statusEl) {
			statusEl.textContent = result.success ? t('agent.tools.completedStatus') : t('agent.tools.failedStatus');
			statusEl.classList.remove('gemini-tool-row-status-running');
			statusEl.classList.add(result.success ? 'gemini-tool-row-status-success' : 'gemini-tool-row-status-error');
		}

		// Update row icon on completion
		const iconEl = toolRow.querySelector('.gemini-tool-row-icon') as HTMLElement;
		if (iconEl) {
			setIcon(iconEl, result.success ? 'check-circle' : 'x-circle');
		}

		// Add result to row details
		const details = toolRow.querySelector('.gemini-tool-row-details');
		if (details) {
			const resultSection = details.createDiv({ cls: 'gemini-agent-tool-section' });
			this.createSectionHeader(resultSection, t('agent.tools.resultHeader'), () => this.getResultCopyText(result));

			if (result.success === false || result.success === undefined) {
				const errorContent = resultSection.createDiv({ cls: 'gemini-agent-tool-error-content' });
				const errorMessage = result.error || t('agent.tools.failedDefault');
				errorContent.createEl('p', {
					text: errorMessage,
					cls: 'gemini-agent-tool-error-message',
				});
			} else if (result.data) {
				const resultContent = resultSection.createDiv({ cls: 'gemini-agent-tool-result-content' });
				const data: unknown = result.data;

				if (typeof data === 'string') {
					this.renderTruncatableCode(resultContent, data);
				} else if (Array.isArray(data)) {
					if (data.length === 0) {
						resultContent.createEl('p', {
							text: t('agent.tools.noResults'),
							cls: 'gemini-agent-tool-empty-result',
						});
					} else {
						const list = resultContent.createEl('ul', { cls: 'gemini-agent-tool-result-list' });
						data.slice(0, 10).forEach((item: unknown) => {
							list.createEl('li', { text: String(item) });
						});
						if (data.length > 10) {
							resultContent.createEl('p', {
								text: t('agent.tools.moreItems', { count: data.length - 10 }),
								cls: 'gemini-agent-tool-more-items',
							});
						}
					}
				} else if (isRecord(data)) {
					this.plugin.logger.log('Tool result is object for:', toolName);
					this.plugin.logger.log('Result data keys:', Object.keys(data));

					if (
						isCitationAnswerResult(data) &&
						data.answer &&
						data.citations &&
						(toolName === 'google_search' || toolName === 'google_maps')
					) {
						this.plugin.logger.log(`Handling ${toolName} result with citations`);
						const answerDiv = resultContent.createDiv({ cls: 'gemini-agent-tool-search-answer' });
						answerDiv.createEl('h5', { text: t('agent.tools.answerHeader') });

						const answerPara = answerDiv.createEl('p');
						const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
						let lastIndex = 0;
						let match;

						while ((match = linkRegex.exec(data.answer)) !== null) {
							if (match.index > lastIndex) {
								answerPara.appendText(data.answer.substring(lastIndex, match.index));
							}
							const link = answerPara.createEl('a', {
								text: match[1],
								href: match[2],
							});
							link.setAttribute('target', '_blank');
							lastIndex = linkRegex.lastIndex;
						}
						if (lastIndex < data.answer.length) {
							answerPara.appendText(data.answer.substring(lastIndex));
						}

						if (data.citations.length > 0) {
							const citationsDiv = resultContent.createDiv({ cls: 'gemini-agent-tool-citations' });
							citationsDiv.createEl('h5', { text: t('agent.tools.sourcesHeader') });
							const citationsList = citationsDiv.createEl('ul', {
								cls: 'gemini-agent-tool-citations-list',
							});
							for (const citation of data.citations) {
								const citationItem = citationsList.createEl('li');
								const link = citationItem.createEl('a', {
									text: citation.title || citation.url,
									href: citation.url,
									cls: 'gemini-agent-tool-citation-link',
								});
								link.setAttribute('target', '_blank');
								if (citation.snippet) {
									citationItem.createEl('p', {
										text: citation.snippet,
										cls: 'gemini-agent-tool-citation-snippet',
									});
								}
							}
						}
					} else if (isGeneratedImageResult(data) && data.path && data.wikilink && toolName === 'generate_image') {
						const imageDiv = resultContent.createDiv({ cls: 'gemini-agent-tool-image-result' });
						imageDiv.createEl('h5', { text: t('agent.tools.generatedImageHeader') });

						const imageFile = this.plugin.app.vault.getAbstractFileByPath(data.path);
						if (imageFile instanceof TFile) {
							const imgContainer = imageDiv.createDiv({ cls: 'gemini-agent-tool-image-container' });
							const img = imgContainer.createEl('img', { cls: 'gemini-agent-tool-image' });

							img.onloadstart = () => imgContainer.addClass('loading');
							img.onload = () => imgContainer.removeClass('loading');
							img.onerror = () => {
								img.hide();
								imgContainer.removeClass('loading');
								imgContainer.createEl('p', {
									text: t('agent.tools.imagePreviewFailed'),
									cls: 'gemini-agent-tool-image-error',
								});
							};

							try {
								img.src = this.plugin.app.vault.getResourcePath(imageFile);
								img.alt = data.prompt || t('agent.tools.generatedImageAlt');
							} catch (error) {
								this.plugin.logger.error('Failed to get resource path for image:', error);
								img.onerror?.(new Event('error'));
							}

							const imageInfo = imageDiv.createDiv({ cls: 'gemini-agent-tool-image-info' });
							imageInfo.createEl('strong', { text: t('agent.tools.pathLabel') + ' ' });
							imageInfo.createSpan({ text: data.path });
							imageInfo.createEl('br');
							imageInfo.createEl('strong', { text: t('agent.tools.wikilinkLabel') + ' ' });
							imageInfo.createEl('code', {
								text: data.wikilink,
								cls: 'gemini-agent-tool-wikilink',
							});
							const copyBtn = imageInfo.createEl('button', {
								text: t('agent.tools.copyButton'),
								cls: 'gemini-agent-tool-copy-wikilink',
							});
							copyBtn.addEventListener('click', () => {
								// Fire-and-forget: clipboard write is a UI convenience; failures are logged, not fatal.
								void navigator.clipboard
									.writeText(data.wikilink)
									.then(() => {
										copyBtn.textContent = t('agent.tools.copiedButton');
										window.setTimeout(() => {
											copyBtn.textContent = t('agent.tools.copyButton');
										}, 2000);
									})
									.catch((err) => {
										this.plugin.logger.error('Failed to copy wikilink to clipboard:', err);
									});
							});
						} else {
							imageDiv.createEl('p', {
								text: t('agent.tools.imageSavedTo', { path: data.path }),
								cls: 'gemini-agent-tool-image-path',
							});
						}
					} else if (isFileContentResult(data) && data.content && data.path) {
						const fileInfo = resultContent.createDiv({ cls: 'gemini-agent-tool-file-info' });
						fileInfo.createEl('strong', { text: t('agent.tools.fileLabel') + ' ' });
						fileInfo.createSpan({ text: data.path });

						if (data.size) {
							fileInfo.createSpan({
								text: ` (${formatFileSize(data.size)})`,
								cls: 'gemini-agent-tool-file-size',
							});
						}

						this.renderTruncatableCode(resultContent, data.content);
					} else {
						const resultList = resultContent.createDiv({ cls: 'gemini-agent-tool-result-object' });
						for (const [key, value] of Object.entries(data)) {
							if (value === undefined || value === null) continue;
							if (key === 'content' && typeof value === 'string' && value.length > 100) continue;

							const item = resultList.createDiv({ cls: 'gemini-agent-tool-result-item' });
							item.createSpan({ text: key + ':', cls: 'gemini-agent-tool-result-key' });
							const valueStr =
								typeof value === 'string' ? value : JSON.stringify(value) || Object.prototype.toString.call(value);
							item.createSpan({
								text: valueStr.length > 100 ? valueStr.substring(0, 100) + '...' : valueStr,
								cls: 'gemini-agent-tool-result-value',
							});
						}
					}
				}
			} else {
				const resultContent = resultSection.createDiv({ cls: 'gemini-agent-tool-result-content' });
				resultContent.createEl('p', {
					text: `${toolName}: ${t('agent.tools.completedDefault')}`,
					cls: 'gemini-agent-tool-success-message',
				});
			}
		}

		// Auto-expand row details if there was an error
		if (!result.success) {
			const rowDetails = toolRow.querySelector('.gemini-tool-row-details') as HTMLElement;
			const rowChevron = toolRow.querySelector('.gemini-tool-row-chevron') as HTMLElement;
			const rowHeader = toolRow.querySelector('.gemini-tool-row-header') as HTMLElement;
			if (rowDetails && rowChevron && rowHeader && rowDetails.style.display === 'none') {
				setCollapsibleExpanded(
					{
						control: rowHeader,
						body: rowDetails,
						chevron: rowChevron,
						host: toolRow,
						expandedClass: 'gemini-tool-row-expanded',
					},
					true
				);
			}
		}

		// Update group summary if this row is inside a group
		const parentGroup = toolRow.closest('.gemini-tool-group') as HTMLElement;
		if (parentGroup) {
			const currentCompleted = parseInt(parentGroup.dataset.completedCount || '0', 10);
			const currentFailed = parseInt(parentGroup.dataset.failedCount || '0', 10);
			if (result.success) {
				parentGroup.dataset.completedCount = String(currentCompleted + 1);
			} else {
				parentGroup.dataset.failedCount = String(currentFailed + 1);
			}
			this.updateGroupSummary(parentGroup);
		}
	}
}
