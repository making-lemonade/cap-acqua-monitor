import {defineConfig,devices} from '@playwright/test';

export default defineConfig({
 testDir:'./tests',
 timeout:45_000,
 expect:{timeout:12_000},
 fullyParallel:false,
 retries:0,
 reporter:process.env.CI?'github':'list',
 use:{baseURL:'http://127.0.0.1:4173',trace:'retain-on-failure'},
 projects:[
  {name:'chromium-desktop',use:{...devices['Desktop Chrome']}},
  {name:'chromium-mobile',use:{...devices['Desktop Chrome'],viewport:{width:390,height:844},isMobile:true,hasTouch:true}}
 ],
 webServer:{
  command:'npm run preview -- --host 127.0.0.1 --port 4173',
  url:'http://127.0.0.1:4173/cap-acqua-monitor/',
  reuseExistingServer:!process.env.CI,
  timeout:60_000
 }
});
