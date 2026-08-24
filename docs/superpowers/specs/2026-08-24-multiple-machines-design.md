# Multiple machines

A single table is hard-wired through the whole codebase. This turns it into one
of several, so the player can choose a machine with its own layout, its own art
and its own campaign.

## What is hard-wired today

Four things assume there is exactly one table.

- `palette.ts` exports a single `PALETTE` const. The renderer names it 101
  times, and mixes in another two dozen colour literals besides.
- `rules.ts` exports `MISSIONS` and `RANKS` as module consts. Both the rule
  engine and the score panel import them directly.
- `renderer.ts` paints playfield decor from coordinate literals — the spinner
  well at `(51, 568)`, shot arrows at `(404, 624)` and `(51, 616)`, the
  `RANK PROGRESS` caption at `(278, 578)`, the lane chevrons at four fixed
  columns. None of it is derivable from the `Table` it is handed.
- `scores.ts` writes every game to one storage key. Scores from different
  layouts are not comparable, so one board for all of them is wrong.

## Shape

A **machine** is the unit the player picks:

```ts
interface Machine {
  id: string; // storage key, URL parameter, test label
  name: string; // "Orbit Cadet"
  tagline: string; // one line in the picker
  theme: Theme; // the whole palette, per machine
  ranks: readonly string[];
  missions: readonly MissionSpec[];
  buildTable: () => Table;
}
```

`Game` takes a `Machine` instead of calling `buildTable()` itself. `Renderer`
takes one too, and reads every colour from `machine.theme` rather than from a
module const. The scoreboard is keyed by `machine.id`.

### Shared chassis, varying interior

Every machine is built on the same **chassis**: outer boundary, dome, shooter
lane and its one-way gate, apron and drain, flippers, slingshots, inlane and
outlane dividers, rubber guides.

This is deliberate and it is not a shortcut. The lower third of a real pinball
table is near-universal — two flippers, two slingshots, two inlanes, two
outlanes — and the parts of this one are the parts that took the most care to
get right: the drain gap is a function of pivot separation, flipper reach and
bat radius, and the apron, the gate and the lane divider each exist to close a
specific pocket that trapped balls. Re-deriving that per machine would buy
nothing and would reintroduce bugs the table tests were written against.

What varies is everything above the flippers: bumper count and placement,
target banks, orbit guides, rails and tubes, saucer, spinner, posts, rollover
lanes, and every colour on the table.

### Optional features

Not every machine has every feature. `Table` gains optional members, and both
the rule engine and the renderer skip what is absent:

```ts
spinners: SpinnerSpec[];   // zero, one or two
rampPath?: Vec2[];         // no habitrail on a machine without one
warpPath?: Vec2[];
warpFork?: Vec2;
```

The rule engine already keys off sensor ids, so a machine with no `spinner`
sensor simply never runs the spinner branch. The renderer is what needs the
guards.

### Decals

Playfield printing moves out of the renderer and into table data:

```ts
type Decal =
  | { kind: 'arrow'; at: Vec2; angle: number; color: string }
  | { kind: 'label'; at: Vec2; text: string; color: string; size: number }
  | { kind: 'ring'; at: Vec2; radius: number; color: string }
  | { kind: 'chevrons'; at: Vec2; count: number; color: string }
  | { kind: 'well'; at: Vec2; w: number; h: number; color: string };
```

The renderer keeps a painter per kind and paints the list. Each machine
authors its own decals next to the geometry they annotate, which is the only
place they can be kept correct.

## The three machines

|          | Orbit Cadet                 | Molten Core                       | Tidewreck                               |
| -------- | --------------------------- | --------------------------------- | --------------------------------------- |
| Theme    | deep space, cyan and violet | forge, ember and iron             | drowned wreck, teal and coral           |
| Bumpers  | 3, triangle                 | 4, diamond                        | 3, in a row                             |
| Drops    | 3-bank, left                | 3-bank, right                     | none                                    |
| Standups | 3-bank right + 2 low        | 2 low only                        | 5, scattered                            |
| Spinners | 1, left lane                | 2, both lanes                     | 1, right lane                           |
| Rail     | habitrail with warp fork    | short chimney to the right inlane | habitrail, mirrored to the right inlane |
| Saucer   | upper left of centre        | dead centre, low                  | upper right of centre                   |
| Feel     | flowing, one big rail       | fast and target-heavy             | long loops, few targets                 |

Handedness flips between them: Orbit Cadet drops on the left and ramps on the
right, Molten Core is the other way round, and Tidewreck's habitrail mirrors
Orbit Cadet's.

Each machine gets its own six ranks and five missions, written against the
features it actually has. A machine with no habitrail has no ramp mission.

## Selection

The attract screen shows the machine name, its tagline, and a `‹ ›` pair.
Selection uses the existing button-and-hit-test mechanism, which already sits
above every play zone in the input hit order, so choosing a machine can never
launch a ball or nudge the table. Keys `1`..`3` pick directly.

The choice persists in `localStorage`, and `?machine=<id>` overrides it so a
particular table can be linked to.

Switching machines rebuilds the `Game` and the renderer's cached static layer.
That happens only from the attract screen, so no game is ever interrupted.

## Testing

The geometry and playability suites become table-driven: every existing
assertion runs against every machine.

```ts
for (const machine of MACHINES) {
  describe(machine.name, () => {
    /* no degenerate colliders, no ball escapes the table,
       nowhere that keeps hold of a ball, every feature
       reachable from both flippers, a game always ends */
  });
}
```

This is the part that carries the risk. A new layout is a new set of gaps a
shade under one ball wide, and those are invisible in a screenshot. The
reachability sweep is what proves a feature is not decorative, and the trap
sweep is what proves a lane is not a pocket; a machine that fails either is not
finished.

Rules tests stay on one machine, because they test the engine and not the
layout.

## Delivery

1. Refactor to the machine architecture with Orbit Cadet as the only machine.
   Behaviour and pixels unchanged; the existing suite is the proof.
2. Add Molten Core and Tidewreck, iterating each against the geometry and
   playability suites.
3. Add the picker and per-machine scoreboards.
4. Smoke-test every machine in a real browser, then deploy and validate the
   live site.
