import { TFile } from 'obsidian';
import { FeatureToolPolicy } from './tool-policy';

/**
 * Tag that identifies a markdown file as a project definition.
 */
export const PROJECT_TAG = 'gemini-scribe/project';

/**
 * Configuration parsed from a project file's frontmatter.
 */
export interface ProjectConfig {
	/** Display name for the project */
	name: string;

	/** Skill names to auto-activate for this project */
	skills: string[];

	/**
	 * Project-scoped tool policy (preset + per-tool overrides).
	 * When unset, the project inherits the global plugin tool policy.
	 */
	toolPolicy?: FeatureToolPolicy;
}

/**
 * A fully resolved project, combining frontmatter config with parsed body content.
 */
export interface Project {
	/** The TFile of the project definition file */
	file: TFile;

	/** Parsed configuration from frontmatter */
	config: ProjectConfig;

	/** The project root directory path (parent dir of the project file) */
	rootPath: string;

	/** System prompt instructions extracted from the file body */
	instructions: string;

	/** Resolved context files from [[wikilinks]] in the body */
	contextFiles: TFile[];

	/** Resolved embed files from ![[embeds]] in the body */
	embedFiles: TFile[];
}

/**
 * Lightweight project summary for listings (no body parsing).
 */
export interface ProjectSummary {
	/** Display name */
	name: string;

	/** Path to the project definition file */
	filePath: string;

	/** Project root directory path */
	rootPath: string;
}
