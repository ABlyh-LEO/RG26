import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/domain/**/*.test.ts', 'tests/support/**/*.test.ts', 'tests/operator/**/*.test.ts'],
    environment: 'node',
    globals: false,
  },
});
