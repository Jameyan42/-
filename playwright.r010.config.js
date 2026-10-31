import {defineConfig} from '@playwright/test';
import base from './playwright.config.js';
// Local model service owns its port/lifetime; do not borrow a Vite server from another test run.
export default defineConfig({...base,testMatch:'r010.spec.js',fullyParallel:false,workers:1,webServer:undefined,outputDir:'test-results/r010-native'});
