import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const outputDir = path.resolve('output');
await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  deviceScaleFactor: 1,
  recordVideo: { dir: outputDir, size: { width: 1280, height: 720 } },
});
const page = await context.newPage();
page.on('console', message => { if (message.type() === 'error') console.error('browser:', message.text()); });
page.on('pageerror', error => console.error('page error:', error.message));
await page.goto('http://localhost:8000/?demo=1', { waitUntil: 'networkidle' });
await page.waitForTimeout(71000);
const video = page.video();
await context.close();
await browser.close();
const source = await video.path();
const target = path.join(outputDir, 'open-world-streaming-demo.webm');
const { rename } = await import('node:fs/promises');
await rename(source, target);
console.log(`Recorded ${target}`);
