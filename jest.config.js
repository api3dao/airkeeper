/** @type {import('ts-jest/dist/types').InitialOptionsTsJest} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  clearMocks: true,
  moduleNameMapper: {
    "src/(.*)": "<rootDir>/src/$1",
  },
  modulePathIgnorePatterns: ["<rootDir>/dist/"],
  collectCoverage: true,
  coverageDirectory: "coverage",
  coverageProvider: "v8",
};
