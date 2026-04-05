/**
 * Type declarations for non-TypeScript modules
 */

// Declare .hbs (Handlebars) files as string modules
declare module '*.hbs' {
	const content: string;
	export default content;
}
