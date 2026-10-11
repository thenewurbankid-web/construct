// The app's own test runner (jest + React Testing Library), so Line Import v2's characterizer can pin src/alerts with
// generated tests before anything moves (packages/engine/line/characterize.mjs). The dependencies are the devDependencies
// in package.json; Construct's tests link a node_modules that has them (test-utils/jestHome.mjs).
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
  transform: { '^.+\\.tsx?$': ['ts-jest', { tsconfig: { jsx: 'react-jsx', module: 'commonjs', esModuleInterop: true, resolveJsonModule: true }, diagnostics: false }] },
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
};
