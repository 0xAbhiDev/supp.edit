import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir:'tests/e2e', outputDir:'test-results/playwright', timeout:60000, use:{baseURL:'http://127.0.0.1:1420',viewport:{width:1440,height:940},trace:'retain-on-failure'}, webServer:{command:'npm run dev:web',url:'http://127.0.0.1:1420',reuseExistingServer:true,timeout:60000}, workers:1 });
