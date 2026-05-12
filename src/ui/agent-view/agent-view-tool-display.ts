import { setIcon, TFile } from 'obsidian';
import type ObsidianGemini from '../../main';
import { ToolResult } from '../../tools/types';
import { formatFileSize } from '../../utils/format-utils';

// Tool execution result messages
const TOOL_EXECUTION_FAILED_DEFAULT_MSG = 'Tool execution failed (no error message provided)';
const OPERATION_COMPLETED_SUCCESSFULLY_MSG = 'Operation completed successfully';

// Shared tool icon mapping
const TOOL_ICONS: Record<string, string> = {
	read_file: 'file-text',
	write_file: 'file-edit',
	list_files: 'folder-open',
	create_folder: 'folder-plus',
	delete_file: 'trash-2',
	move_file: 'file-symlink',
	find_files_by_name: 'search',
	google_search: 'globe',
	fetch_url: 'link',
	generate_image: 'image',
};

/**
 * Handles all tool-related UI rendering: tool groups, execution rows, and result display.
 */
export class AgentViewToolDisplay {
	constructor(
		private chatContainer: HTMLElement,
		private plugin: ObsidianGemini
	) {}

	/**
	 * Get a brief parameter summary for a tool row (e.g. file path or query)
	 */
	public getToolParamSummary(_toolName: string, parameters: any): string {
		if (!parameters) return '';
		// Pick the most meaningful parameter for each tool type
		if (parameters.path) return parameters.path;
		if (parameters.query) return parameters.query;
		if (parameters.url) return parameters.url;
		if (parameters.name) return parameters.name;
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
			text: `Running tools... (0 of ${totalToolCount})`,
			cls: 'gemini-tool-group-text',
		});

		summary.createSpan({
			text: 'Running',
			cls: 'gemini-tool-group-status gemini-tool-group-status-running',
		});

		const chevron = summary.createSpan({ cls: 'gemini-tool-group-chevron' });
		setIcon(chevron, 'chevron-right');

		// Body (hidden by default)
		const body = group.createDiv({ cls: 'gemini-tool-group-body' });
		body.style.display = 'none';

		// Store counts in dataset
		group.dataset.totalCount = String(totalToolCount);
		group.dataset.completedCount = '0';
		group.dataset.failedCount = '0';

		// Toggle expand/collapse — derive state from DOM to stay in sync with programmatic expansion
		const toggleGroup = () => {
			const wasExpanded = summary.getAttribute('aria-expanded') === 'true';
			const nowExpanded = !wasExpanded;
			body.style.display = nowExpanded ? 'block' : 'none';
			setIcon(chevron, nowExpanded ? 'chevron-down' : 'chevron-right');
			group.toggleClass('gemini-tool-group-expanded', nowExpanded);
			summary.setAttribute('aria-expanded', String(nowExpanded));
		};
		summary.addEventListener('click', toggleGroup);
		summary.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				toggleGroup();
			}
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
				const toolWord = total === 1 ? 'tool' : 'tools';
				if (failed > 0) {
					textEl.textContent = `${total} ${toolWord} completed — ${failed} failed`;
				} else {
					textEl.textContent = `${total} ${toolWord} completed`;
				}
			} else {
				textEl.textContent = `Running tools... (${completed + failed} of ${total})`;
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
				statusEl.textContent = 'Running';
				statusEl.classList.add('gemini-tool-group-status-running');
			}
		}

		// Auto-expand immediately if there's a failure (don't wait for all tools)
		if (failed > 0) {
			const body = group.querySelector('.gemini-tool-group-body') as HTMLElement;
			const chevron = group.querySelector('.gemini-tool-group-chevron') as HTMLElement;
			const summaryEl = group.querySelector('.gemini-tool-group-summary') as HTMLElement;
			if (body && body.style.display === 'none') {
				body.style.display = 'block';
				if (chevron) setIcon(chevron, 'chevron-down');
				if (summaryEl) summaryEl.setAttribute('aria-expanded', 'true');
				group.classList.add('gemini-tool-group-expanded');
			}
		}
	}

	/**
	 * Show tool execution in the UI as a compact row inside a group container.
	 * If no group container is active, creates a standalone fallback.
	 */
	public async showToolExecution(
		toolName: string,
		parameters: any,
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
			text: 'Running...',
			cls: 'gemini-tool-row-status gemini-tool-row-status-running',
		});

		const rowChevron = rowHeader.createSpan({ cls: 'gemini-tool-row-chevron' });
		setIcon(rowChevron, 'chevron-right');

		// Row details (hidden by default, contains parameters and later results)
		const rowDetails = toolRow.createDiv({ cls: 'gemini-tool-row-details' });
		rowDetails.style.display = 'none';

		// Parameters section inside details
		if (parameters && Object.keys(parameters).length > 0) {
			const paramsSection = rowDetails.createDiv({ cls: 'gemini-agent-tool-section' });
			paramsSection.createEl('h4', { text: 'Parameters' });

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
		const toggleRowDetails = () => {
			const wasExpanded = rowHeader.getAttribute('aria-expanded') === 'true';
			const nowExpanded = !wasExpanded;
			rowDetails.style.display = nowExpanded ? 'block' : 'none';
			setIcon(rowChevron, nowExpanded ? 'chevron-down' : 'chevron-right');
			toolRow.toggleClass('gemini-tool-row-expanded', nowExpanded);
			rowHeader.setAttribute('aria-expanded', String(nowExpanded));
		};
		rowHeader.addEventListener('click', toggleRowDetails);
		rowHeader.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				toggleRowDetails();
			}
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
			statusEl.textContent = result.success ? 'Completed' : 'Failed';
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
			resultSection.createEl('h4', { text: 'Result' });

			if (result.success === false || result.success === undefined) {
				const errorContent = resultSection.createDiv({ cls: 'gemini-agent-tool-error-content' });
				const errorMessage = result.error || TOOL_EXECUTION_FAILED_DEFAULT_MSG;
				errorContent.createEl('p', {
					text: errorMessage,
					cls: 'gemini-agent-tool-error-message',
				});
			} else if (result.data) {
				const resultContent = resultSection.createDiv({ cls: 'gemini-agent-tool-result-content' });

				if (typeof result.data === 'string') {
					if (result.data.length > 500) {
						const codeBlock = resultContent.createEl('pre', { cls: 'gemini-agent-tool-code-result' });
						const code = codeBlock.createEl('code');
						code.textContent = result.data.substring(0, 500) + '\n\n... (truncated)';

						const expandBtn = resultContent.createEl('button', {
							text: 'Show full content',
							cls: 'gemini-agent-tool-expand-content',
						});
						expandBtn.addEventListener('click', () => {
							code.textContent = result.data;
							expandBtn.remove();
						});
					} else {
						resultContent
							.createEl('pre', { cls: 'gemini-agent-tool-code-result' })
							.createEl('code', { text: result.data });
					}
				} else if (Array.isArray(result.data)) {
					if (result.data.length === 0) {
						resultContent.createEl('p', {
							text: 'No results found',
							cls: 'gemini-agent-tool-empty-result',
						});
					} else {
						const list = resultContent.createEl('ul', { cls: 'gemini-agent-tool-result-list' });
						result.data.slice(0, 10).forEach((item: any) => {
							list.createEl('li', { text: String(item) });
						});
						if (result.data.length > 10) {
							resultContent.createEl('p', {
								text: `... and ${result.data.length - 10} more`,
								cls: 'gemini-agent-tool-more-items',
							});
						}
					}
				} else if (typeof result.data === 'object') {
					this.plugin.logger.log('Tool result is object for:', toolName);
					this.plugin.logger.log('Result data keys:', Object.keys(result.data));

					if (result.data.answer && result.data.citations && toolName === 'google_search') {
						this.plugin.logger.log('Handling google_search result with citations');
						const answerDiv = resultContent.createDiv({ cls: 'gemini-agent-tool-search-answer' });
						answerDiv.createEl('h5', { text: 'Answer:' });

						const answerPara = answerDiv.createEl('p');
						const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
						let lastIndex = 0;
						let match;

						while ((match = linkRegex.exec(result.data.answer)) !== null) {
							if (match.index > lastIndex) {
								answerPara.appendText(result.data.answer.substring(lastIndex, match.index));
							}
							const link = answerPara.createEl('a', {
								text: match[1],
								href: match[2],
							});
							link.setAttribute('target', '_blank');
							lastIndex = linkRegex.lastIndex;
						}
						if (lastIndex < result.data.answer.length) {
							answerPara.appendText(result.data.answer.substring(lastIndex));
						}

						if (result.data.citations.length > 0) {
							const citationsDiv = resultContent.createDiv({ cls: 'gemini-agent-tool-citations' });
							citationsDiv.createEl('h5', { text: 'Sources:' });
							const citationsList = citationsDiv.createEl('ul', {
								cls: 'gemini-agent-tool-citations-list',
							});
							for (const citation of result.data.citations) {
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
					} else if (result.data.path && result.data.wikilink && toolName === 'generate_image') {
						const imageDiv = resultContent.createDiv({ cls: 'gemini-agent-tool-image-result' });
						imageDiv.createEl('h5', { text: 'Generated Image:' });

						const imageFile = this.plugin.app.vault.getAbstractFileByPath(result.data.path);
						if (imageFile instanceof TFile) {
							const imgContainer = imageDiv.createDiv({ cls: 'gemini-agent-tool-image-container' });
							const img = imgContainer.createEl('img', { cls: 'gemini-agent-tool-image' });

							img.onloadstart = () => imgContainer.addClass('loading');
							img.onload = () => imgContainer.removeClass('loading');
							img.onerror = () => {
								img.style.display = 'none';
								imgContainer.removeClass('loading');
								imgContainer.createEl('p', {
									text: 'Failed to load image preview',
									cls: 'gemini-agent-tool-image-error',
								});
							};

							try {
								img.src = this.plugin.app.vault.getResourcePath(imageFile);
								img.alt = result.data.prompt || 'Generated image';
							} catch (error) {
								this.plugin.logger.error('Failed to get resource path for image:', error);
								img.onerror?.(new Event('error'));
							}

							const imageInfo = imageDiv.createDiv({ cls: 'gemini-agent-tool-image-info' });
							imageInfo.createEl('strong', { text: 'Path: ' });
							imageInfo.createSpan({ text: result.data.path });
							imageInfo.createEl('br');
							imageInfo.createEl('strong', { text: 'Wikilink: ' });
							imageInfo.createEl('code', {
								text: result.data.wikilink,
								cls: 'gemini-agent-tool-wikilink',
							});
							const copyBtn = imageInfo.createEl('button', {
								text: 'Copy',
								cls: 'gemini-agent-tool-copy-wikilink',
							});
							copyBtn.addEventListener('click', () => {
								navigator.clipboard.writeText(result.data.wikilink).then(() => {
									copyBtn.textContent = 'Copied!';
									window.setTimeout(() => {
										copyBtn.textContent = 'Copy';
									}, 2000);
								});
							});
						} else {
							imageDiv.createEl('p', {
								text: `Image saved to: ${result.data.path}`,
								cls: 'gemini-agent-tool-image-path',
							});
						}
					} else if (result.data.content && result.data.path) {
						const fileInfo = resultContent.createDiv({ cls: 'gemini-agent-tool-file-info' });
						fileInfo.createEl('strong', { text: 'File: ' });
						fileInfo.createSpan({ text: result.data.path });

						if (result.data.size) {
							fileInfo.createSpan({
								text: ` (${formatFileSize(result.data.size)})`,
								cls: 'gemini-agent-tool-file-size',
							});
						}

						const content = result.data.content;
						if (content.length > 500) {
							const codeBlock = resultContent.createEl('pre', {
								cls: 'gemini-agent-tool-code-result',
							});
							const code = codeBlock.createEl('code');
							code.textContent = content.substring(0, 500) + '\n\n... (truncated)';
							const expandBtn = resultContent.createEl('button', {
								text: 'Show full content',
								cls: 'gemini-agent-tool-expand-content',
							});
							expandBtn.addEventListener('click', () => {
								code.textContent = content;
								expandBtn.remove();
							});
						} else {
							resultContent
								.createEl('pre', { cls: 'gemini-agent-tool-code-result' })
								.createEl('code', { text: content });
						}
					} else {
						const resultList = resultContent.createDiv({ cls: 'gemini-agent-tool-result-object' });
						for (const [key, value] of Object.entries(result.data)) {
							if (value === undefined || value === null) continue;
							if (key === 'content' && typeof value === 'string' && value.length > 100) continue;

							const item = resultList.createDiv({ cls: 'gemini-agent-tool-result-item' });
							item.createSpan({ text: key + ':', cls: 'gemini-agent-tool-result-key' });
							const valueStr = typeof value === 'string' ? value : JSON.stringify(value) || String(value);
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
					text: `${toolName}: ${OPERATION_COMPLETED_SUCCESSFULLY_MSG}`,
					cls: 'gemini-agent-tool-success-message',
				});
			}
		}

		// Auto-expand row details if there was an error
		if (!result.success) {
			const rowDetails = toolRow.querySelector('.gemini-tool-row-details') as HTMLElement;
			const rowChevron = toolRow.querySelector('.gemini-tool-row-chevron') as HTMLElement;
			const rowHeader = toolRow.querySelector('.gemini-tool-row-header') as HTMLElement;
			if (rowDetails && rowDetails.style.display === 'none') {
				rowDetails.style.display = 'block';
				if (rowChevron) setIcon(rowChevron, 'chevron-down');
				if (rowHeader) rowHeader.setAttribute('aria-expanded', 'true');
				toolRow.classList.add('gemini-tool-row-expanded');
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
