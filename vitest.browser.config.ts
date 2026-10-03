import { defineConfig } from 'vitest/config';

/**
 * The browser suites in test/browser/: each drives the extension's pages in a real Chromium, so they
 * are kept out of `npm test` and run with `npm run test:browser`.
 */
export default defineConfig({
    test: {
        include: ['test/browser/*.browser.ts'],
        testTimeout: 300_000,
        hookTimeout: 60_000,
    },
});
