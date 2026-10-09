import { defineConfig } from '@playwright/test';

export default defineConfig({
 outputDir:'./test-results-local',
 testDir:'./e2e',testMatch:'community.local.spec.js',workers:1,timeout:45000,
 use:{baseURL:process.env.GBOXEUR_LOCAL_URL||'http://192.168.50.123:4173',browserName:'chromium',channel:process.env.PLAYWRIGHT_CHANNEL||'chrome',timezoneId:'America/Toronto',locale:'fr-CA',screenshot:'only-on-failure',trace:'retain-on-failure'},
 projects:[{name:'phone',use:{viewport:{width:390,height:844},isMobile:true,hasTouch:true}},{name:'desktop',use:{viewport:{width:1440,height:900}}}],
});
