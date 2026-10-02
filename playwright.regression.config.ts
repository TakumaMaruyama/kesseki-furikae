import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/regression", testMatch: "parent.e2e.ts",
  workers: 1, fullyParallel: false, retries: 0, timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["json", { outputFile: "test-results/regression-results.json" }]],
  use: { timezoneId: "Asia/Tokyo", locale: "ja-JP", serviceWorkers: "block", trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } } },
  ],
});
