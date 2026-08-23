/**
 * Drives the real game in a browser and reports what happened.
 *
 * Unit tests cover the solver and the rules; this covers the parts they cannot
 * reach: that the page boots, the canvas paints, input reaches the table and
 * nothing throws. Screenshots are written so the layout can be eyeballed at
 * several sizes.
 *
 * Usage: node scripts/smoke.mjs [url] [outputDir]
 */
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:4173/';
const outDir = process.argv[3] ?? 'screenshots';

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'laptop', width: 1180, height: 760 },
  { name: 'phone-portrait', width: 390, height: 844 },
  { name: 'tablet-portrait', width: 820, height: 1180 },
];

await mkdir(outDir, { recursive: true });

const browser = await chromium.launch();
const problems = [];
let failed = false;

for (const vp of VIEWPORTS) {
  const page = await browser.newPage({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 2,
  });
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`[${vp.name}] console: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`[${vp.name}] pageerror: ${e.message}`));

  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${outDir}/${vp.name}-attract.png` });

  // Start a game, launch the ball, then flip for a while.
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  await page.keyboard.down('Space');
  await page.waitForTimeout(700);
  await page.keyboard.up('Space');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${outDir}/${vp.name}-play.png` });

  for (let i = 0; i < 24; i += 1) {
    await page.keyboard.down(i % 2 === 0 ? 'KeyZ' : 'Slash');
    await page.waitForTimeout(90);
    await page.keyboard.up(i % 2 === 0 ? 'KeyZ' : 'Slash');
    await page.waitForTimeout(150);
  }
  await page.screenshot({ path: `${outDir}/${vp.name}-later.png` });

  // Frame rate with a ball in play, which is the case that matters.
  const fps = await page.evaluate(async () => {
    let frames = 0;
    const start = performance.now();
    await new Promise((resolve) => {
      const tick = () => {
        frames += 1;
        if (performance.now() - start > 2000) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    return Math.round((frames * 1000) / (performance.now() - start));
  });
  if (fps < 45) problems.push(`[${vp.name}] only ${fps} fps with a ball in play`);

  const state = await page.evaluate(() => {
    const g = globalThis.pinball;
    return {
      phase: g.phase,
      score: g.score,
      ballsInPlay: g.ballsInPlay,
      positions: g.balls
        .filter((b) => b.mode !== 'idle')
        .map((b) => ({ mode: b.mode, x: Math.round(b.ball.pos.x), y: Math.round(b.ball.pos.y) })),
    };
  });
  console.log(`${vp.name}: ${fps}fps ${JSON.stringify(state)}`);

  // A ball outside the table means the solver let one escape in a real run.
  for (const p of state.positions) {
    if (p.x < -20 || p.x > 620 || p.y < -20 || p.y > 1020) {
      problems.push(`[${vp.name}] ball escaped the table at ${p.x},${p.y}`);
    }
  }
  if (state.phase === 'attract') {
    problems.push(`[${vp.name}] game never started`);
  }
  await page.close();
}

// Audio has to survive the browser's autoplay policy: it may only start from a
// real user gesture, and the game must stay playable if it never starts.
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  page.on('pageerror', (e) => problems.push(`audio: pageerror: ${e.message}`));
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(300);
  await page.mouse.click(640, 500);
  await page.waitForTimeout(600);
  const audioState = await page.evaluate(() => {
    const ctx = globalThis.pinball?.audioContextState?.();
    return ctx ?? 'unknown';
  });
  console.log(`audio after a click: ${audioState}`);
  if (audioState !== 'running') {
    problems.push(`audio never started (state: ${audioState})`);
  }
  await page.close();
}

await browser.close();

if (problems.length) {
  failed = true;
  console.error('\nProblems:');
  for (const p of problems) console.error('  ' + p);
} else {
  console.log('\nNo console errors, no escaped balls, game started at every size.');
}
process.exit(failed ? 1 : 0);
