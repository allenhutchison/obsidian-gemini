import type ObsidianGemini from '../main';

/**
 * Logger service that respects debug mode settings.
 *
 * Usage:
 * - logger.log() and logger.debug() are filtered based on debug mode
 * - logger.error() and logger.warn() are always visible
 *
 * This is preferred over global console patching in plugin environments
 * to avoid conflicts with other plugins and Obsidian's debugging tools.
 */
export class Logger {
	private plugin: ObsidianGemini;
	private prefix: string;

	constructor(plugin: ObsidianGemini, prefix: string = '[Gemini Scribe]') {
		this.plugin = plugin;
		this.prefix = prefix;
	}

	/**
	 * Debug log - only shown when debug mode is enabled
	 */
	log(...args: any[]): void {
		if (this.plugin.settings?.debugMode) {
			// eslint-disable-next-line obsidianmd/rule-custom-message -- central console wrapper; see AGENTS.md
			console.log(this.prefix, ...args);
			this.plugin.fileLogWriter?.write('LOG', this.prefix, args);
		}
	}

	/**
	 * Debug log - only shown when debug mode is enabled
	 */
	debug(...args: any[]): void {
		if (this.plugin.settings?.debugMode) {
			console.debug(this.prefix, ...args);
			this.plugin.fileLogWriter?.write('DEBUG', this.prefix, args);
		}
	}

	/**
	 * Error log - always shown
	 */
	error(...args: any[]): void {
		console.error(this.prefix, ...args);
		this.plugin.fileLogWriter?.write('ERROR', this.prefix, args);
	}

	/**
	 * Warning log - always shown
	 */
	warn(...args: any[]): void {
		console.warn(this.prefix, ...args);
		this.plugin.fileLogWriter?.write('WARN', this.prefix, args);
	}

	/**
	 * Create a child logger with a more specific prefix
	 */
	child(childPrefix: string): Logger {
		return new Logger(this.plugin, `${this.prefix} ${childPrefix}`);
	}
}
