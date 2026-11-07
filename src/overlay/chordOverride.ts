import type { RsArrangement, RsChordTemplate } from "../songsterr/rocksmith";

/**
 * Built-in fingerings for chords whose chart data is broken (a named chord
 * reduced to a single note, so the chord-shape box draws a degenerate shape).
 * The source JSON cannot be edited, so when "chord override" is on we
 * substitute one of these correct shapes.
 *
 * Shapes are high-e-first (index 0 = high E, index 5 = low E), matching the
 * renderer's chord-template convention: -1 = unused/muted, 0 = open, n>0 = fret.
 * Each chord maps to a set of valid shapes (e.g. an open A and a 5th-fret A
 * shape); the voicing actually used is chosen from that set at override time.
 * Slash chords (e.g. "D/F#") are normalized to their root before lookup.
 */

/** All valid fingerings for one chord, as a hashset of shapes. */
type ChordShapes = Set<number[]>;

/** Build a ChordShapes set from a literal list of shapes. */
function shapes(list: number[][]): ChordShapes {
  return new Set(list);
}

/** Maps a normalized chord name (root + accidental + quality) to its shape(s). */
const FINGERINGS: Record<string, ChordShapes> = {
  // A chords
  a: shapes([[-1, 0, 2, 2, 2, -1]]),
  am: shapes([[-1, 0, 2, 2, 1, -1]]),
  asus2: shapes([[-1, 0, 2, 2, 0, -1]]),
  asus4: shapes([[-1, 0, 2, 2, 3, -1]]),
  a7: shapes([[-1, 0, 2, 0, 2, -1]]),
  am7: shapes([[-1, 0, 2, 0, 1, -1]]),
  amaj7: shapes([[-1, 0, 2, 1, 2, -1]]),

  // B chords
  b: shapes([[-1, 2, 4, 4, 4, -1]]),
  bm: shapes([[-1, 2, 4, 4, 3, -1]]),
  bsus4: shapes([[-1, 2, 4, 4, 5, 2]]),
  b7: shapes([[-1, 2, 1, 2, 0, 2]]),
  bm7: shapes([[-1, 2, 0, 2, 3, -1]]),

  // C chords
  c: shapes([[-1, 3, 2, 0, 1, -1]]),
  cm: shapes([[-1, 3, 5, 5, 4, -1]]),
  csus2: shapes([[-1, 3, 0, 0, 1, -1], [-1, 3, 0, 0, 3, -1]]),
  csus4: shapes([[-1, 3, 3, 0, 1, -1]]),
  c7: shapes([[-1, 3, 2, 3, 1, -1]]),
  cmaj7: shapes([[-1, 3, 2, 0, 0, -1]]),

  // Db chords
  db: shapes([[-1, 4, 3, 1, 2, 1]]),

  // D chords
  d: shapes([[-1, -1, 0, 2, 3, 2]]),
  dm: shapes([[-1, -1, 0, 2, 3, 1]]),
  dsus2: shapes([[-1, -1, 0, 2, 3, 0]]),
  dsus4: shapes([[-1, -1, 0, 2, 3, 3]]),
  d7: shapes([[-1, -1, 0, 2, 1, 2]]),
  dmaj7: shapes([[-1, -1, 0, 2, 2, 2]]),

  // Eb chords
  eb: shapes([[-1, 6, 5, 3, 4, 3]]),

  // E chords
  e: shapes([[0, 2, 2, 1, 0, 0]]),
  em: shapes([[0, 2, 2, 0, 0, 0]]),
  esus4: shapes([[0, 2, 2, 2, 0, 0]]),
  e7: shapes([[0, 2, 0, 1, 0, 0]]),
  em7: shapes([[0, 2, 0, 0, 0, 0]]),
  emaj7: shapes([[0, 2, 1, 1, 0, 0]]),

  // F chords
  f: shapes([[-1, -1, 3, 2, 1, 1]]),
  fm: shapes([[-1, -1, 3, 1, 1, 1]]),
  fsus4: shapes([[-1, -1, 3, 3, 1, 1]]),
  f7: shapes([[-1, -1, 1, 2, 1, 1]]),
  fmaj7: shapes([[-1, -1, 3, 2, 1, 0]]),

  // G chords
  g: shapes([[3, 2, 0, 0, 0, 3]]),
  "g/b": shapes([[-1, 2, 0, 0, 0, 3]]),
  gm: shapes([[3, 5, 5, 3, 3, 3]]),
  gsus4: shapes([[3, 3, 0, 0, 1, 3]]),
  g7: shapes([[3, 2, 0, 0, 0, 1]]),
  gmaj7: shapes([[3, 2, 0, 0, 0, 2]]),
};

/**
 * Turns a chord name into a normalized form: lowercases and removes decorations
 * like "-arp" or whitespace, but keeps slash inversions ("D/F#" stays "D/F#").
 */
function normalizeChordName(name: string): string {
  return name
    .trim()
    .replace(/[-_ ]/g, "")
    .replace(/\\/g, "/")
    .toLowerCase();
}

/** The root of a normalized chord name ("d/f#" -> "d"), for fallback lookup. */
function chordRoot(name: string): string {
  return name.split("/")[0] ?? "";
}

/**
 * Picks the shape whose position (lowest fret) best matches where the chord is
 * being played. `hintFret` is the fret of the single surviving note in a broken
 * template (or -1 when the chart gave no note at all); we choose the shape with
 * the closest position so different voicings of the same chord are recognized.
 * With no usable hint the lowest (open) shape wins.
 */
function pickShape(shapes: ChordShapes, hintFret: number): number[] | undefined {
  if (shapes.size === 0) return undefined;

  let best: number[] | undefined;
  let bestPos = Infinity;
  let bestDist = Infinity;
  for (const shape of shapes) {
    const pos = lowestPlayedFret(shape);
    const dist = hintFret < 0 || !Number.isFinite(hintFret) ? pos : Math.abs(pos - hintFret);
    if (dist < bestDist || (dist === bestDist && pos < bestPos)) {
      best = shape;
      bestPos = pos;
      bestDist = dist;
    }
  }
  return best;
}

/** High-E-first shapes must match the arrangement's string count; pads/truncates to `strings`. */
function fitShape(shape: number[], strings: number): number[] {
  if (strings === 6) return shape;
  const out = new Array<number>(strings).fill(-1);
  for (let i = 0; i < strings; i++) out[i] = shape[i] ?? -1;
  return out;
}

/** Number of strings that carry an open or fretted note (0 or >0), ignoring -1. */
function playedCount(frets: number[]): number {
  return frets.reduce((acc, f) => acc + (f >= 0 ? 1 : 0), 0);
}

/** The lowest fret actually played in a shape (>= 0), or -1 if every string is unused/muted. */
function lowestPlayedFret(frets: number[]): number {
  return frets.reduce((acc, f) => {
    if (f < 0) return acc;
    return acc < 0 || f < acc ? f : acc;
  }, -1);
}

/**
 * Returns a corrected chordTemplates array for the arrangement when `enabled`.
 * Any template whose name matches the table AND carries at most one played
 * note is replaced with a matching shape (fitted to the arrangement's string
 * count). The surviving note's fret selects which voicing of the chord to use,
 * so multiple shapes of the same chord are recognized. Non-matching or healthy
 * templates are returned unchanged.
 */
export function applyChordOverride(
  arrangement: RsArrangement,
  chordTemplates: RsChordTemplate[],
  enabled: boolean,
): RsChordTemplate[] {
  if (!enabled) return chordTemplates;
  return chordTemplates.map((tmpl) => {
    const name = tmpl.name ?? tmpl.displayName ?? "";
    const key = normalizeChordName(name);
    // Prefer an exact slash-inversion entry (e.g. "g/b"), fall back to the root chord.
    const chordShapes = FINGERINGS[key] ?? FINGERINGS[chordRoot(key)];
    if (!chordShapes) return tmpl;
    if (playedCount(tmpl.frets) > 1) return tmpl;
    const shape = pickShape(chordShapes, lowestPlayedFret(tmpl.frets));
    if (!shape) return tmpl;
    return { ...tmpl, frets: fitShape(shape, arrangement.strings) };
  });
}
