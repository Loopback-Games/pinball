/**
 * Where every line on the attract card sits.
 *
 * Kept apart from the drawing code, and pure, because this is layout
 * arithmetic and layout arithmetic is exactly what went wrong: the card used
 * to mix a running cursor with absolute offsets, and the `FINAL` line that
 * only appears on game over was drawn straight through the machine name below
 * it. Nothing in the test suite touches the renderer, so nothing could catch
 * it.
 *
 * Everything here is in unscaled table-card units, measured from the card's
 * anchor. The renderer multiplies by its own scale.
 */

/** One line of text on the card, with enough to know the room it needs. */
export interface AttractLine {
  kind:
    | 'title-1'
    | 'title-2'
    | 'final'
    | 'machine'
    | 'tagline'
    | 'prompt'
    | 'board-head'
    | 'board-row'
    | 'help';
  /** Baseline offset from the card anchor. */
  y: number;
  /** Font size, in the same units. */
  size: number;
}

export interface AttractLayout {
  /** Top edge of the card, relative to the anchor. */
  top: number;
  height: number;
  lines: AttractLine[];
  /** Baseline of the machine name, which the picker arrows centre on. */
  pickerY: number;
  /** Baseline the scoreboard block starts at. */
  boardY: number;
  /** Baseline of the first help line. */
  helpY: number;
}

/**
 * Vertical extent of a line's ink, as a fraction of its font size.
 *
 * Deliberately generous: a cap-height box would let two lines touch and still
 * pass. These are the numbers the overlap test measures against.
 */
export const INK_ABOVE = 0.78;
export const INK_BELOW = 0.24;

/** Top and bottom of the ink a line puts on the card. */
export function inkExtent(line: AttractLine): { top: number; bottom: number } {
  return {
    top: line.y - line.size * INK_ABOVE,
    bottom: line.y + line.size * INK_BELOW,
  };
}

const TOP = -120;
/** Space left below the last line before the card ends. */
const BOTTOM_PAD = 16;

export function attractLayout(o: { gameOver: boolean; boardRows: number }): AttractLayout {
  const lines: AttractLine[] = [];

  // The two title lines and their spacing are what the attract screen has
  // always been; keeping them exact means the common case is unchanged.
  let y = -82;
  lines.push({ kind: 'title-1', y, size: 40 });
  y += 44;
  lines.push({ kind: 'title-2', y, size: 40 });

  // The final score only exists on game over, and it takes its own room
  // rather than sharing the machine name's.
  if (o.gameOver) {
    y += 42;
    lines.push({ kind: 'final', y, size: 20 });
    y += 30;
  } else {
    y += 52;
  }

  const pickerY = y;
  lines.push({ kind: 'machine', y, size: 19 });
  y += 18;
  lines.push({ kind: 'tagline', y, size: 10 });
  y += 34;
  lines.push({ kind: 'prompt', y, size: 18 });

  y += 40;
  const boardY = y;
  if (o.boardRows > 0) {
    lines.push({ kind: 'board-head', y, size: 11 });
    // The heading, the rule under it, then a row apiece.
    y += 31;
    for (let i = 0; i < o.boardRows; i += 1) {
      lines.push({ kind: 'board-row', y, size: 13 });
      y += 22;
    }
    y += 10;
  }

  const helpY = y;
  for (let i = 0; i < 4; i += 1) {
    lines.push({ kind: 'help', y, size: 13 });
    y += 20;
  }
  // The loop leaves the cursor a line past the last one drawn.
  y -= 20;

  const last = lines[lines.length - 1];
  const bottom = last ? inkExtent(last).bottom : y;
  return { top: TOP, height: bottom - TOP + BOTTOM_PAD, lines, pickerY, boardY, helpY };
}
