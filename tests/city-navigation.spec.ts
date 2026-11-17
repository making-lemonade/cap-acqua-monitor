import {test,expect} from '@playwright/test';

test('city selection reveals real values and opens related cluster on mobile and desktop',async({page})=>{
 await page.goto('/cap-acqua-monitor/');
 await expect(page).toHaveTitle(/Aqua Intelligence/);
 await page.getByRole('button',{name:/Segnali & Cluster/}).click();
 const firstCity=page.locator('.city-chip').first();
 await expect(firstCity).toBeVisible();
 const city=(await firstCity.locator('b').innerText()).trim();
 await firstCity.click();
 const detail=page.locator('#dettaglio-comune');
 await expect(detail).toBeVisible();
 await expect(detail.getByRole('heading',{name:city})).toBeVisible();
 const card=detail.locator('.city-result-card').first();
 await expect(card).toBeVisible();
 await expect(card).toContainText('Limite CAP:');
 await expect(detail).toBeInViewport({ratio:.1});
 await card.click();
 const cluster=page.locator('#esplora-cluster');
 await expect(cluster).toBeInViewport({ratio:.1});
 await expect(cluster.getByText('Cluster tematici selezionati')).toBeVisible();
 await cluster.getByRole('button',{name:'PFAS · indicatori principali'}).click();
 await expect(cluster).toContainText('Somma di PFAS');
});

test('city details are loaded by shard rather than an 8MB global download',async({page})=>{
 const loaded:string[]=[];
 page.on('request',req=>loaded.push(req.url()));
 await page.goto('/cap-acqua-monitor/');
 await page.getByRole('button',{name:/Segnali & Cluster/}).click();
 await expect(page.locator('.city-chip').first()).toBeVisible();
 await page.locator('.city-chip').first().click();
 await expect(page.locator('#dettaglio-comune .city-result-card').first()).toBeVisible();
 expect(loaded.some(url=>url.includes('/data/city_latest/'))).toBeTruthy();
 expect(loaded.some(url=>url.includes('/data/latest_signals.json'))).toBeTruthy();
 expect(loaded.some(url=>url.endsWith('/data/city_latest.json'))).toBeFalsy();
});
