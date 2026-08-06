// `setupFiles` (not setupFilesAfterEnv) for the DB guard: it must run before
// the test file's imports are evaluated, so a stray Prisma import cannot
// resolve DATABASE_URL to the manuscript before the guard has repointed it.
// Both projects carry it — `dev.db` is production, and a jsdom test can reach
// it exactly as easily as a node one (LOOM-125).
const config = {
  projects: [
    {
      displayName: 'unit',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/tests/unit/**/*.test.ts'],
      transform: {
        '^.+\\.tsx?$': ['ts-jest', {}],
        // happy-dom is ESM-only JS; without a JS transform the require() of it
        // from @tiptap/html/server throws before any test runs.
        '^.+\\.m?js$': ['ts-jest', { tsconfig: { allowJs: true, module: 'commonjs' } }],
      },
      moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1', '^@shared/(.*)$': '<rootDir>/shared/$1',
        // @tiptap/html/server ships ESM by default; jest runs CJS. Point it at
        // the CommonJS build so publish's prose renderer is testable.
        '^@tiptap/html/server$': '<rootDir>/node_modules/@tiptap/html/dist/server/index.cjs' },
      setupFiles: ['<rootDir>/tests/setup/dbGuard.ts'],
      // happy-dom (the DOM @tiptap/html/server renders into) is ESM-only, and
      // node_modules is untransformed by default. Publish renders prose to
      // HTML, so this is the difference between the publish tests running and
      // the whole suite refusing to start.
      transformIgnorePatterns: ['node_modules/(?!(happy-dom)/)'],
    },
    {
      displayName: 'components',
      testEnvironment: 'jsdom',
      testMatch: ['<rootDir>/tests/components/**/*.test.tsx'],
      transform: { '^.+\\.tsx?$': ['ts-jest', { tsconfig: { jsx: 'react-jsx' } }] },
      moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1', '^@shared/(.*)$': '<rootDir>/shared/$1',
        // @tiptap/html/server ships ESM by default; jest runs CJS. Point it at
        // the CommonJS build so publish's prose renderer is testable.
        '^@tiptap/html/server$': '<rootDir>/node_modules/@tiptap/html/dist/server/index.cjs' },
      setupFiles: ['<rootDir>/tests/setup/dbGuard.ts'],
      setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
    },
  ],
}

export default config
