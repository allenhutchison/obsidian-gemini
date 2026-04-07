// jest.config.mjs
export default {
	preset: 'ts-jest/presets/default-esm',
	testEnvironment: 'jsdom', // Changed 'node' to 'jsdom'
	transform: {
		'^.+\\.tsx?$': [
			'ts-jest',
			{
				useESM: true,
				tsconfig: 'tsconfig.test.json',
			},
		],
		'\\.txt$': './text-transformer.mjs',
		'\\.hbs$': './text-transformer.mjs',
		'\\.md$': './text-transformer.mjs',
	},
	// This pattern will find .test.ts or .spec.ts (and .js) files in the test directory.
	testMatch: ['<rootDir>/test/**/?(*.)+(spec|test).[tj]s'],
	moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node', 'txt', 'hbs', 'md'],
	// Path aliases mapping (must match tsconfig.json paths)
	moduleNameMapper: {
		'^@/(.*)$': '<rootDir>/src/$1',
		'@modelcontextprotocol/sdk/client/streamableHttp\\.js':
			'<rootDir>/test/__mocks__/@modelcontextprotocol/sdk/client/streamableHttp.js',
		'@modelcontextprotocol/sdk/client/auth\\.js': '<rootDir>/test/__mocks__/@modelcontextprotocol/sdk/client/auth.js',
	},
};
