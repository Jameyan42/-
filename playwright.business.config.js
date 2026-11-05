import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./business-e2e',workers:1,timeout:60000,use:{baseURL:process.env.S003_BUSINESS_URL||'http://127.0.0.1:8780',headless:true,launchOptions:{...(process.env.QINGBAO_BROWSER_PATH?{executablePath:process.env.QINGBAO_BROWSER_PATH}:{}),args:['--no-sandbox']}},reporter:'list',outputDir:'test-results/business'});
