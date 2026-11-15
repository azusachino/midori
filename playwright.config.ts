// Headless Chromium verification, cloned from the playwright-verify skill.
// scripts/e2e/run.ts starts the app (fixture db + built web shell + real server)
// and exports E2E_BASE_URL; this config starts no server of its own.
import { defineConfig, devices } from "@playwright/test";

const external = process.env.E2E_BASE_URL;
const CI = !!process.env.CI;
const chrome = devices["Desktop Chrome"];

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  // Playwright's recommended CI settings: no stray test.only, retries that
  // expose flaky tests instead of hiding them, one worker.
  forbidOnly: CI,
  retries: CI ? 2 : 0,
  failOnFlakyTests: CI,
  ...(CI ? { workers: 1 } : {}),
  // A text reporter, because agents read the terminal; the html report needs a browser.
  reporter: "list",
  use: {
    baseURL: external,
    // Local runs do not retry, so keep a trace of every failure rather than of the first retry.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  // `make e2e` runs the checks; `make e2e-probe` runs only the probe.
  projects: [
    { name: "chromium", use: chrome, testIgnore: /probe\.spec\.ts$/ },
    { name: "probe", use: chrome, testMatch: /probe\.spec\.ts$/ },
  ],
  // The lifecycle belongs to scripts/e2e/run.ts; without it there is no server.
  ...(external
    ? {}
    : {
        webServer: {
          command: "echo 'run via: make e2e (E2E_BASE_URL not set)'; exit 1",
          url: "http://127.0.0.1:1",
          reuseExistingServer: false,
          timeout: 1_000,
        },
      }),
});
