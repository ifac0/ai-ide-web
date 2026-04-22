import type { Config } from "jest";

const config: Config = {
  preset: "jest-preset-angular",
  testEnvironment: "jsdom",
  setupFilesAfterEnv: ["<rootDir>/src/test-setup.ts"],
  testMatch: ["<rootDir>/**/*.spec.ts"],
  moduleFileExtensions: ["ts", "js", "mjs", "html", "json"],
  transform: {
    "^.+\\.(ts|mjs|js|html)$": [
      "jest-preset-angular",
      {
        tsconfig: "<rootDir>/tsconfig.spec.json",
        stringifyContentPathRegex: "\\.(html|svg)$",
      },
    ],
  },
  collectCoverageFrom: [
    "<rootDir>/src/**/*.ts",
    "!<rootDir>/src/main.ts",
    "!<rootDir>/src/polyfills.ts",
    "!<rootDir>/src/**/*.d.ts",
  ],
  coveragePathIgnorePatterns: [
    "/node_modules/",
    "/dist/",
    "/src/environments/",
  ],
  testPathIgnorePatterns: ["/node_modules/", "/dist/", "/e2e/"],
  reporters: ["default"],
};

export default config;
