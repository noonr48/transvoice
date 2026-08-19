import { defineConfig } from 'vitest/config';

// TransVoice standalone frontend test runner.
// ~74 co-located *.test.ts files exercise the voice runtime DOM + logic. Most need a
// browser-like environment (document/window) and the jest-dom matchers (toHaveClass,
// toBeInTheDocument), registered globally via vitest.setup.ts.
export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.ts'],
    // The lesson "pure" suites use Node's built-in `node:test` runner (see their
    // file headers — they run via `node --test` after an esbuild transpile), not
    // vitest, so vitest cannot collect them. Keep them out of this runner.
    exclude: [
      '**/node_modules/**',
      'src/voice/lesson/lesson-pure.test.ts',
      'src/voice/lesson/lesson-v15.test.ts',
    ],
  },
});
