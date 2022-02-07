/** @type {import('ts-jest/dist/types').InitialOptionsTsJest} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  clearMocks: true,
  modulePathIgnorePatterns: ["<rootDir>/dist/"],
  collectCoverage: true,
  coverageDirectory: "coverage",
  coverageProvider: "v8",
};
