import { defineConfig } from '@playwright/test';

// Dedicated fictional database: the LAN database used for manual tests is never reset.
export default defineConfig({
 outputDir:'./test-results-preprod',
 testDir:'./e2e',testMatch:'*.preprod.spec.js',workers:1,timeout:45000,
 use:{baseURL:'http://127.0.0.1:4174',browserName:'chromium',channel:process.env.PLAYWRIGHT_CHANNEL||'chrome',timezoneId:'America/Toronto',locale:'fr-CA',screenshot:'only-on-failure',trace:'retain-on-failure'},
 webServer:{command:'GBOXEUR_LOCAL_DATABASE=/tmp/gboxeur-personal-journal-qa-db VITE_LOCAL_SANDBOX=1 npm run dev -- --host 127.0.0.1 --port 4174 --strictPort',url:'http://127.0.0.1:4174',reuseExistingServer:!process.env.CI},
 projects:[{name:'phone',use:{viewport:{width:390,height:844},isMobile:true,hasTouch:true}},{name:'desktop',use:{viewport:{width:1440,height:900}}}],
});
