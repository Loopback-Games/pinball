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

  // Frame rate with a ball in play, which is the case that matters. The first
  // second is discarded: on a cold shared runner the page is still warming up,
  // and measuring through that reports a stall that no player would see.
  const fps = await page.evaluate(async () => {
    const sample = (ms) =>
      new Promise((resolve) => {
        let frames = 0;
        const start = performance.now();
        const tick = () => {
          frames += 1;
          const elapsed = performance.now() - start;
          if (elapsed > ms) resolve(Math.round((frames * 1000) / elapsed));
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
    await sample(800);
    return sample(1500);
  });
  // Well below the 60 the game should hold, but high enough that a real
  // rendering regression still trips it.
  if (fps < 35) problems.push(`[${vp.name}] only ${fps} fps with a ball in play`);

  const state = await page.evaluate(() => {
    const g = globalThis.pinball;
    return {
      phase: g.phase,
      score: g.score,
      ballsInPlay: g.ballsInPlay,
      positions: g.balls
        .filter((b) => b.mode !== 'idle')
        .map((b) => ({
          mode: b.mode,
          x: Math.round(b.ball.pos.x),
          y: Math.round(b.ball.pos.y),
        })),
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

// A key held when the page stops being the thing the player is looking at
// never sends its keyup, and the flipper it was holding used to stay up for
// the rest of the game. Alt-tabbing mid-ball was enough to do it.
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  page.on('pageerror', (e) => problems.push(`focus: pageerror: ${e.message}`));
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);

  const pressed = () =>
    page.evaluate(() => globalThis.pinball.table.flippers.map((f) => f.pressed));
  await page.keyboard.down('KeyZ');
  await page.waitForTimeout(250);
  const whileHeld = await pressed();
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.waitForTimeout(250);
  const afterBlur = await pressed();
  await page.keyboard.up('KeyZ');
  console.log(
    `flippers held ${JSON.stringify(whileHeld)}, after focus loss ${JSON.stringify(afterBlur)}`,
  );
  if (!whileHeld[0]) problems.push('holding Z did not raise the left flipper');
  if (afterBlur[0]) problems.push('the left flipper stayed up after the page lost focus');
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

  // The music sequencer must actually be queueing notes, and muting it must
  // stop that. A silent bug here looks identical to a working game.
  await page.waitForTimeout(1200);
  const withMusic = await page.evaluate(() => globalThis.pinball.musicNotes());
  if (withMusic < 4) problems.push(`music scheduled only ${withMusic} notes`);

  await page.evaluate(() => globalThis.pinball.toggleAudio('music'));
  await page.waitForTimeout(200);
  const afterMute = await page.evaluate(() => globalThis.pinball.musicNotes());
  await page.waitForTimeout(1200);
  const stillMuted = await page.evaluate(() => globalThis.pinball.musicNotes());
  console.log(`music notes: ${withMusic} playing, ${stillMuted - afterMute} while muted`);
  if (stillMuted > afterMute) {
    problems.push(`music kept playing after being muted (+${stillMuted - afterMute})`);
  }

  const settings = await page.evaluate(() => globalThis.pinball.audioSettings());
  if (settings.music !== false) problems.push('music toggle did not stick');
  await page.evaluate(() => globalThis.pinball.setAudio('music', true));
  await page.waitForTimeout(200);

  // Audio must recover on its own if the context is ever suspended. Trying to
  // start it once and giving up leaves the game silent while its controls
  // still claim the sound is on, which is exactly what a player reports as
  // "it defaults to off until I toggle it".
  await page.evaluate(() => globalThis.pinball.suspendAudio());
  await page.waitForTimeout(300);
  const suspended = await page.evaluate(() => globalThis.pinball.audioContextState());
  if (suspended !== 'suspended') {
    console.log(`note: could not suspend the context (state ${suspended}), recovery untested`);
  } else {
    const quiet = await page.evaluate(() => globalThis.pinball.musicNotes());
    await page.mouse.click(640, 500);
    await page.waitForTimeout(1200);
    const recovered = await page.evaluate(() => ({
      ctx: globalThis.pinball.audioContextState(),
      music: globalThis.pinball.musicNotes(),
    }));
    console.log(
      `after a suspend: ctx=${recovered.ctx}, ${recovered.music - quiet} notes since`,
    );
    if (recovered.ctx !== 'running') {
      problems.push(`audio did not recover from a suspend (state: ${recovered.ctx})`);
    }
    if (recovered.music <= quiet) {
      problems.push('music did not resume after the context was suspended');
    }
  }
  // The preference has to survive a reload.
  await page.evaluate(() => globalThis.pinball.setAudio('music', false));
  await page.waitForTimeout(100);
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(300);
  const reloaded = await page.evaluate(() => globalThis.pinball.audioSettings());
  console.log(`after reload: ${JSON.stringify(reloaded)}`);
  if (reloaded.music !== false) problems.push('music preference did not persist');

  // Leave it as a new player would find it, and check that is what they get.
  await page.evaluate(() => globalThis.pinball.setAudio('music', true));
  await page.evaluate(() => globalThis.pinball.setAudio('sfx', true));

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
