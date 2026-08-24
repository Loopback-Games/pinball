# Loopback Pinball

A pinball table that runs in the browser on a phone or a desktop, with no
runtime dependencies, no image files and no audio files. Every pixel is drawn
and every sound is synthesised as the game runs.

**Play it: <https://loopback-games.github.io/pinball/>**

## Controls

| Action               | Desktop                       | Touch                                  |
| -------------------- | ----------------------------- | -------------------------------------- |
| Left flipper         | `Z`, `←`, or left `Shift`     | Tap the left half of the screen        |
| Right flipper        | `/`, `→`, or right `Shift`    | Tap the right half                     |
| Plunger              | Hold `Space`, release to fire | Hold anywhere, release to fire         |
| Nudge                | `X` and `.`                   | Tap the top strip, or shake the device |
| New game             | `Enter`                       | Tap the attract screen                 |
| Sound effects on/off | `S`                           | Speaker button, top right              |
| Music on/off         | `M`                           | Note button, top right                 |

Both audio settings are remembered between visits.

While the ball is in the air the flipper buttons also work as **lane change**,
sliding the lit rollover lanes and the flashing skill lane sideways so you can
line up the one you still need.

Nudging too often tilts the table and kills the flippers until the ball drains,
exactly as it should.

## The table

Three pop bumpers under the dome, two slingshots, a three-bank of drop targets,
five standup targets, a spinner in the left orbit lane, three rollover lanes
across the top of the orbit, a mission saucer, a kickback guarding the right
outlane, and a plastic ramp that returns the ball to the left inlane.

The two sides are deliberately different. The left orbit is the safe shot: a
one-way gate at the foot of its lane feeds returning balls back to the flippers.
The right side keeps a live outlane, which is what the kickback is there for.

## Scoring

Nothing on the table is worth a fixed amount for long.

- **Ball save** — the first eight seconds of every ball are free. Drain inside
  them and the ball comes straight back.
- **Skill shot** — one rollover lane flashes after each launch. The first lane
  the ball takes settles it: the right one pays 25,000, the wrong one loses it.
  Lane change on the plunge is how you line it up.
- **Combos** — ramp, orbit, saucer and the two target banks chain. Each link in
  the chain multiplies every shot until the chain lapses.
- **Frenzy** — clearing the standup targets doubles everything for eighteen
  seconds.
- **Kickback** — lit at the start of each ball and relit by clearing the drop
  bank, it throws a ball back out of the right outlane once.
- **Pop bumpers** get more valuable the more you work them, and the **spinner**
  climbs while you keep it moving and cools off when you don't.
- **Multiball jackpots** — every bumper hit during multiball grows the jackpot,
  which the ramp or the saucer collects.

Missions start at the saucer, and clearing either target bank launches one too,
once per ball. The saucer stays the faster route: no once-a-ball limit, and it
banks a step of progress every time you hit it during a mission.

Completing a mission promotes you a rank, from Cadet to Admiral, and each
mission runs straight into the next. Every second rank lights multiball at the
saucer, where it waits until you go and collect it. Clearing the drop targets or
the rollover lanes raises the bonus multiplier, which is paid out when the ball
drains.

## The scoreboard

The best five games are kept, with the rank reached and the date, and shown on
the attract screen. It is a local scoreboard in the strict sense: it lives in
this browser's storage, it is never sent anywhere, and clearing site data
clears it.

## Sound

Both the effects and the score are synthesised at runtime; there are no audio
files. The music is a four-bar progression in A minor played by a pad, a bass,
an arpeggio and a drum kit, and the sequencer picks a tempo and a set of layers
from what is happening on the table — calm in attract, driving in play, faster
during a mission, flat out in multiball.

Notes are scheduled against the audio clock rather than fired from the frame
loop, so the beat does not wobble when a frame runs long. Effects and music have
separate gain buses, which is what lets either be silenced on its own.

## Running it

```sh
just setup     # install dependencies
just run       # dev server with hot reload
just fmt       # format everything
just lint      # typecheck and check formatting
just test      # unit tests
just security  # audit the toolchain, twice
just check     # everything CI runs
just smoke     # build, then drive the real game in a browser
```

Without `just`, the same commands are `npm install`, `npm run dev`, `npm test`,
and `npm run build`.

## How it is built

TypeScript, Vite and Vitest for tooling; Canvas 2D and WebAudio at runtime.
Nothing else. The bundle is about 15 kB gzipped.

The design and the reasoning behind it are in
[`docs/superpowers/specs/2026-08-23-pinball-design.md`](docs/superpowers/specs/2026-08-23-pinball-design.md).
The short version:

**The physics solver is custom.** Pinball is one very fast ball against static
geometry plus a couple of kinematic flippers. General-purpose 2D engines are
built for the opposite problem and let the ball tunnel through walls at plunger
speed. The solver here runs a fixed 480 Hz substep and resolves each collision
at its exact time of impact, so tunnelling is not possible; a fuzz test fires
balls around the table at up to 3800 units per second to prove it.

**The table is data.** Every wall, guide and target is a collider in
`src/game/table.ts`, and the rule layer reacts to collider ids. The solver knows
nothing about scoring and the renderer never writes state.

**The lower playfield has invariants.** The gap between the flipper tips has to
be wider than the ball, or the centre drain silently does not exist and only an
outlane can ever end a ball. Nothing on the table may sustain a ball on its own
either: two slingshots facing each other will rally forever unless each goes
dead for a moment after firing. Both are asserted in the tests, because both are
invisible in a screenshot and both change the entire feel of the game.

**Shots are tested, not eyeballed.** `tests/playability.test.ts` fans a ball out
from each flipper across every angle and speed and asserts that every feature is
reachable. This caught a post standing in the ramp mouth that had made the ramp
reachable by one shot in 288 — invisible in a screenshot, obvious to the sweep.

**So are the gaps between things.** The same file seeds a ball across the whole
playfield in four directions and fails if it gets stuck. A gap a shade narrower
than the ball is not a gap, it is a trap, and the table had three of them: a
standup beside the foot of the ramp funnel, the slot between that funnel and the
standup bank, and a post with twenty-six units of clearance either side against
a twenty-seven unit ball. Each one held the ball for nine seconds while the
stuck-ball recovery counted down.

**Switches are swept, not sampled.** A ball leaves the plunger at around two
thousand units a second. Testing where it is once a frame steps clean over a
thirty-unit lane switch on a device running at thirty hertz, so the same shot
scored on a desktop and not on a phone. The sensors test the whole span the ball
travelled instead.

**A game replays exactly.** The only dice the table rolls are the shove that
frees a wedged ball, and they used to come from `Math.random()`, which made a
failing playtest impossible to reproduce. The simulation takes a seed now. That
bought a suite that plays two dozen games of random flips, nudges and plunger
pulls and asserts only what can never be false — the score never falls, nothing
is ever NaN, no ball ever moves faster than anything on the table can throw it —
which is how you find the states nobody thought to aim at.

**Most of the rulebook used to be unreachable.** Every mission, every rank and
the multiball behind them were gated on one shot at the saucer, which unskilled
play found 0.06 times a ball: fifty-seven games in sixty ended without a single
mission. Clearing a target bank now opens the same door once a ball, and a test
plays twelve games and fails if the missions stop showing up. Balance is
measured here, not guessed at.

**The page fetches nothing.** No fonts, no analytics, no CDN, so the content
security policy can say `default-src 'none'` and mean it, and scripts are
restricted to the page's own origin with no inline allowance. The favicon is an
inline SVG like everything else the game draws.

## Licence

MIT. See [LICENSE](LICENSE).
