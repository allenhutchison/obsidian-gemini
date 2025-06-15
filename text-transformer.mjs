import fs from 'fs';
import path from 'path';

export default {
	process(sourceText, sourcePath, options) {
		return {
			code: `module.exports = ${JSON.stringify(sourceText)};`,
		};
	},
};
