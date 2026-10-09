import { defineConfig } from '@playwright/test';

export default defineConfig({
 outputDir:'./test-results-calendar',
  testDir: './e2e',
  testIgnore:['*.local.spec.js','*.preprod.spec.js'],
  fullyParallel: true,
  workers: 2,
  timeout: 30000,
  expect: { timeout: 5000 },
  use: {
    baseURL: 'http://127.0.0.1:4173',
    browserName: 'chromium',
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    timezoneId: 'America/Toronto',
    locale: 'fr-CA',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: { command: 'npm run dev -- --port 4173 --strictPort', url: 'http://127.0.0.1:4173', reuseExistingServer: !process.env.CI },
  projects: [
    { name: 'phone-320', use: { viewport: { width:320, height:720 }, isMobile:true, hasTouch:true } },
    { name: 'phone-390', use: { viewport: { width:390, height:844 }, isMobile:true, hasTouch:true } },
    { name: 'landscape', use: { viewport: { width:844, height:390 }, isMobile:true, hasTouch:true } },
    { name: 'tablet', use: { viewport: { width:768, height:1024 }, hasTouch:true } },
    { name: 'laptop', use: { viewport: { width:1024, height:768 } } },
    { name: 'desktop', use: { viewport: { width:1440, height:900 } } },
  ],
});
