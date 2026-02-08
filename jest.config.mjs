// jest.config.mjs
export default {
	preset: 'ts-jest/presets/default-esm',
	testEnvironment: 'jsdom', // Changed 'node' to 'jsdom'
	transform: {
		'^.+\\.tsx?$': [
			'ts-jest',
			{
				useESM: true,
			},
		],
		'\\.txt$': './text-transformer.mjs',
		'\\.hbs$': './text-transformer.mjs',
	},
	// This pattern will find .test.ts or .spec.ts (and .js) files in the test directory.
	testMatch: ['<rootDir>/test/**/?(*.)+(spec|test).[tj]s'],
	moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node', 'txt', 'hbs'],
	// Path aliases mapping (must match tsconfig.json paths)
	moduleNameMapper: {
		'^@/(.*)$': '<rootDir>/src/$1',
	},
};
