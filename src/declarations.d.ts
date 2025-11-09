/**
 * Type declarations for non-TypeScript modules
 */

// Declare .txt files as string modules
declare module '*.txt' {
	const content: string;
	export default content;
}

// Declare .hbs (Handlebars) files as string modules
declare module '*.hbs' {
	const content: string;
	export default content;
}
