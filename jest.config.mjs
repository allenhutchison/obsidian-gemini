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
  },
  // This pattern will find .test.ts or .spec.ts (and .js) files in any directory.
  // It will correctly find your src/models.test.ts file.
  testMatch: ['**/?(*.)+(spec|test).[tj]s'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node', 'txt'],
  // If you have path aliases in tsconfig.json (like "@/*"), configure moduleNameMapper here.
  // For example:
  // moduleNameMapper: {
  //   '^@/(.*)$': '<rootDir>/src/$1',
  // },
}; 