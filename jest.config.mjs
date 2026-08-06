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
      transform: { '^.+\\.tsx?$': ['ts-jest', {}] },
      moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
      setupFiles: ['<rootDir>/tests/setup/dbGuard.ts'],
    },
    {
      displayName: 'components',
      testEnvironment: 'jsdom',
      testMatch: ['<rootDir>/tests/components/**/*.test.tsx'],
      transform: { '^.+\\.tsx?$': ['ts-jest', { tsconfig: { jsx: 'react-jsx' } }] },
      moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
      setupFiles: ['<rootDir>/tests/setup/dbGuard.ts'],
      setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
    },
  ],
}

export default config
