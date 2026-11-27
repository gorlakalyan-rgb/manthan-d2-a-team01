import { defineConfig } from '@playwright/test';

// PW_EXECUTABLE lets CI or a machine without Edge point at any Chromium build.
const executablePath = process.env.PW_EXECUTABLE || undefined;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  workers: 1,
  reporter: [['list'], ['junit', { outputFile: '../submission/test-evidence/playwright-junit.xml' }]],
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:8080',
    channel: executablePath ? undefined : (process.env.PW_CHANNEL || 'msedge'),   // installed Edge (prereq guide fallback)
    launchOptions: executablePath ? { executablePath } : {},
    // Evidence screenshots: desktop size that fits the login hero and the full audit table,
    // and reduced motion so staggered fade-ins and rolling digits settle immediately.
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
  },
});
