module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  testRegex: '(/__tests__/.*|(\\.|/)(test|spec))\\.(jsx?|tsx?)$',
  moduleDirectories: ["node_modules", "src"], // Keep "src" for resolving non-relative paths
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      // ts-jest configuration options
      tsconfig: 'tsconfig.json', // or your specific tsconfig file for tests
    }],
  },
  moduleNameMapper: {
    // Maps imports starting with 'api/' to the correct path under '<rootDir>/src/api/'
    "^api/(.*)$": "<rootDir>/src/api/$1",
    // Add other mappings if you have other top-level directories in src you want to import from directly
    // e.g., "^components/(.*)$": "<rootDir>/src/components/$1"
    // Mock .txt files
    "\\.(txt)$": "<rootDir>/__mocks__/fileMock.js"
  },
  // Automatically clear mock calls and instances between every test
  clearMocks: true,
  // Indicates whether the coverage information should be collected while executing the test
  collectCoverage: true,
  // The directory where Jest should output its coverage files
  coverageDirectory: 'coverage',
  // An array of glob patterns indicating a set of files for which coverage information should be collected
  collectCoverageFrom: ['src/**/*.ts'],
  // A list of paths to modules that run some code to configure or set up the testing framework before each test
  // setupFilesAfterEnv: ['./jest.setup.js'], // if you have a setup file
  globals: {
    // 'ts-jest': {
    //   // ts-jest specific options
    // }
  }
};
