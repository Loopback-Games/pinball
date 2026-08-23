# Loopback Pinball — Design

Date: 2026-08-23
Status: Approved for implementation

## Goal

A pinball game that runs in a browser on both phones and desktops, hosted on
GitHub Pages, built entirely from free or procedurally generated assets, with
depth comparable to *3D Pinball for Windows — Space Cadet*.

"Comparable to Space Cadet" is the bar for scope, not for art style. It means:
a single well-populated table, a mission/rank progression, multiball, bonus
multipliers, tilt, and sound — not a one-screen bumper demo.

## Constraints

- Static hosting only. GitHub Pages serves files; there is no server.
- No binary assets. Every pixel and every sample is generated at runtime.
- Touch and keyboard must both be first-class. Neither is an afterthought.
- Zero runtime dependencies.

## Architecture

Four layers, each usable and testable without the ones above it.

```
input/        keyboard, touch, pointer, device motion  -> intent flags
engine/       vectors, colliders, swept solver, flippers -> pure simulation
game/         table geometry, rules, scoring, modes, audio
render/       canvas painting, HUD, effects
```

`engine/` knows nothing about the table, the score, or the canvas. It
integrates a ball against a list of colliders and reports the collisions it
resolved. `game/` owns what those collisions *mean*. `render/` reads state and
never writes it. This is what makes the physics unit-testable in Vitest with no
DOM.

### engine/

- `vec2.ts` — immutable 2D vector helpers.
- `shapes.ts` — the three collider primitives the whole table is built from:
  `Segment` (a line with a normal), `Arc` (circular wall section), and
  `Circle` (posts, bumpers). Every table feature reduces to these.
- `physics.ts` — the solver. Fixed timestep, gravity, per-substep swept
  collision detection, positional correction, restitution and friction.
- `flipper.ts` — a kinematic body: a capsule (two circles plus two segments)
  rotating between rest and active angles, transferring angular velocity to the
  ball as an impulse at the contact point.

**Why swept collision:** a ball leaving the plunger moves far enough per frame
to cross a wall completely. Discrete overlap tests miss that and the ball
escapes the table. Each substep advances the ball along its velocity ray, finds
the earliest time-of-impact against every collider, resolves at that point, and
continues with the remaining time. At 240 Hz with time-of-impact resolution the
ball cannot tunnel.

**Why not Matter.js:** it is a general rigid-body engine solving a problem we do
not have (many interacting bodies) while being weak at the one we do have (a
single very fast body against static geometry, plus flippers whose feel depends
on precise impulse control). Rolling the solver is smaller than fighting it, and
it keeps the dependency count at zero.

### game/

- `table.ts` — the playfield as data: collider list, feature placement, lamp
  positions. Declarative, so the table can be tuned without touching the solver.
- `gameplay.ts` — the rule state machine. Ball state (in-plunger, in-play,
  drained), scoring, mission progression, rank, multiball, bonus multiplier,
  extra ball, tilt.
- `audio.ts` — a small WebAudio synthesizer. Oscillators, noise bursts and
  envelopes for each event class. Created lazily on first user gesture, because
  browsers block audio until then.

### render/

- `renderer.ts` — paints the frame. The static playfield art is rendered once
  into an offscreen canvas at startup and blitted each frame; only dynamic
  elements (ball, flippers, lamps, targets, effects, HUD) are drawn live. This
  keeps the per-frame cost low enough for mid-range phones.

### input/

Maps every input device onto the same small set of intents: left flipper, right
flipper, plunger, nudge-left, nudge-right, start, pause.

- Desktop: arrow keys or `Z`/`/` for flippers, `Space` for the plunger,
  `X`/`.` for nudge.
- Touch: the left half of the screen is the left flipper and the right half is
  the right flipper, regardless of where the flippers are drawn. The plunger is
  a pull-down-and-release drag. A device shake nudges.

## Data flow

```
rAF tick
  -> input.sample()          intents
  -> for each fixed substep:
       flippers.step()       kinematic update
       physics.step()        integrate + resolve, emit collision events
       gameplay.consume()    events -> score, lamps, modes, sounds
  -> renderer.draw()         state -> pixels
```

Rendering is decoupled from simulation. A dropped frame changes how much
simulation runs in one tick, never the size of a simulation step, so physics
behaviour does not vary with framerate.

## Responsive layout

The playfield is defined in fixed virtual units. The canvas is sized to the
viewport in CSS pixels, scaled by `devicePixelRatio`, and the playfield is
fitted with a uniform scale so aspect ratio never distorts.

- Portrait / phone: the table fills the screen, HUD overlaid at the top.
- Landscape / desktop: the table is centred with the HUD beside it.

## Error handling

The game is a closed system with no network and no user data, so error handling
is about not stranding the player:

- A ball that escapes the table geometry (should be impossible, but physics
  bugs happen) is detected by an out-of-bounds check and returned to the
  plunger lane rather than lost.
- A ball whose speed stays near zero in a region it should not rest in is
  nudged free after a timeout, so the game cannot deadlock.
- `AudioContext` creation failing (or being blocked) disables sound and leaves
  the game playable.
- Missing `DeviceMotionEvent` permission simply means no shake-to-nudge.

## Testing

Vitest, no DOM required for the layers that matter.

- Physics: a ball fired into a wall at extreme speed does not pass through it;
  restitution conserves the expected fraction of energy; a ball at rest on a
  slope accelerates down it; flipper contact adds energy in the expected
  direction.
- Geometry: every collider in the table is well-formed (non-zero length, normal
  facing into the playfield).
- Scoring: each event class awards the documented value; multipliers compose;
  tilt suppresses scoring; mission progression advances and resets correctly.
- Rendering and input are verified by running the real game in a browser via
  Playwright rather than by unit test.

## Deployment

GitHub Actions builds with Vite and publishes to GitHub Pages via the official
Pages actions, pinned by commit SHA. Pages source is set to "GitHub Actions",
not a branch, so no build output is ever committed. `vite.config.ts` sets the
base path to the repository name so asset URLs resolve under the project-pages
subpath.

## Non-goals

- Multiple tables. One table done well beats three done badly.
- Persistence beyond a local high-score list in `localStorage`.
- Networked leaderboards, accounts, or multiplayer.
- 3D rendering.
