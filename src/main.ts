import { Audio } from './game/audio.js';
import { Game } from './game/game.js';
import { Input } from './input/input.js';
import { Renderer } from './render/renderer.js';

const element = document.getElementById('table');
if (!(element instanceof HTMLCanvasElement)) {
  throw new Error('The page is missing its canvas element.');
}
const canvas: HTMLCanvasElement = element;

const game = new Game();
const renderer = new Renderer(canvas);
const audio = new Audio();
game.onSound = (name, intensity) => audio.play(name, intensity);

const input = new Input(canvas, {
  isReady: () => game.phase === 'ready',
  isIdle: () => game.phase === 'attract' || game.phase === 'gameOver',
  onFirstGesture: () => audio.resume(),
});

function fit(): void {
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  renderer.resize(game.table);
}

fit();
window.addEventListener('resize', fit);
window.addEventListener('orientationchange', () => setTimeout(fit, 120));

let last = performance.now();
let elapsed = 0;

function frame(now: number): void {
  // A backgrounded tab can hand back an enormous delta; cap it so the table
  // does not fast-forward when the player comes back.
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  elapsed += dt;

  game.update(dt, input.sample(dt));
  renderer.draw(game, elapsed);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

// Expose the game for debugging without pulling in a dev-only bundle.
Object.assign(globalThis, {
  pinball: Object.assign(game, { audioContextState: () => audio.state() }),
});
