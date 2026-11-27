import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  workers: 1,
  reporter: [['list'], ['junit', { outputFile: '../submission/test-evidence/playwright-junit.xml' }]],
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:8080',
    channel: process.env.PW_CHANNEL || 'msedge',   // use the installed Edge (prereq guide fallback)
    trace: 'retain-on-failure',
  },
});
