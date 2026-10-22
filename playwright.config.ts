import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  reporter: 'list',
  webServer: [
    {
      command: 'node mock-server/server.js',
      port: 4000,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'node mock-web/serve.js',
      port: 5000,
      reuseExistingServer: !process.env.CI,
    },
  ],
  projects: [
    {
      name: 'api',
      testDir: './tests/api',
      use: { baseURL: 'http://localhost:4000' },
    },
    {
      name: 'web',
      testDir: './tests/web',
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:5000' },
    },
  ],
});
