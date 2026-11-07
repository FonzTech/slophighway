import type { RsArrangement, RsChordTemplate } from "../songsterr/rocksmith";

/**
 * Built-in fingerings for chords whose chart data is broken (a named chord
 * reduced to a single note, so the chord-shape box draws a degenerate shape).
 * The source JSON cannot be edited, so when "chord override" is on we
 * substitute one of these correct shapes.
 *
 * Shapes are high-e-first (index 0 = high E, index 5 = low E), matching the
 * renderer's chord-template convention: -1 = unused/muted, 0 = open, n>0 = fret.
 * Slash chords (e.g. "D/F#") are normalized to their root before lookup.
 */

/** Maps a normalized chord name (root + accidental + quality) to a 6-string shape. */
const FINGERINGS: Record<string, number[]> = {
  a: [-1, 0, 2, 2, 2, -1],
  am: [-1, 0, 2, 2, 1, -1],
  asus2: [-1, 0, 2, 2, 0, -1],
  asus4: [-1, 0, 2, 2, 3, -1],
  a7: [-1, 0, 2, 0, 2, -1],
  am7: [-1, 0, 2, 0, 1, -1],
  amaj7: [-1, 0, 2, 1, 2, -1],
  b: [-1, 2, 4, 4, 4, -1],
  bm: [-1, 2, 4, 4, 3, -1],
  bsus4: [-1, 2, 4, 4, 4, 2],
  b7: [-1, 2, 1, 2, 2, -1],
  bm7: [-1, 2, 0, 2, 3, -1],
  c: [-1, 3, 2, 0, 1, -1],
  cm: [-1, 3, 5, 5, 4, -1],
  csus2: [-1, 3, 0, 0, 1, -1],
  csus4: [-1, 3, 3, 0, 1, -1],
  c7: [-1, 3, 2, 3, 1, -1],
  cmaj7: [-1, 3, 2, 0, 0, -1],
  db: [-1, 4, 3, 1, 1, 4],
  d: [-1, -1, 0, 2, 3, 2],
  dm: [-1, -1, 0, 2, 3, 1],
  dsus2: [-1, -1, 0, 2, 3, 0],
  dsus4: [-1, -1, 0, 2, 3, 3],
  d7: [-1, -1, 0, 2, 1, 2],
  dmaj7: [-1, -1, 0, 2, 2, 2],
  eb: [-1, -1, 3, 3, 3, 1],
  e: [0, 2, 2, 1, 0, 0],
  em: [0, 2, 2, 0, 0, 0],
  esus4: [0, 2, 2, 2, 0, 0],
  e7: [0, 2, 0, 1, 0, 0],
  em7: [0, 2, 0, 0, 0, 0],
  emaj7: [0, 2, 1, 1, 0, 0],
  f: [-1, -1, 3, 2, 1, 1],
  fm: [-1, -1, 3, 3, 1, 1],
  fsus4: [-1, -1, 3, 3, 1, 1],
  f7: [-1, -1, 3, 2, 1, 1],
  fmaj7: [-1, -1, 3, 2, 1, 0],
  g: [3, 2, 0, 0, 0, 3],
  "g/b": [-1, -1, 0, 0, 0, 2],
  gm: [3, 5, 5, 3, 3, 3],
  gsus4: [3, 3, 0, 0, 1, 3],
  g7: [3, 2, 0, 0, 0, 1],
  gmaj7: [3, 2, 0, 0, 0, 2],
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

/**
 * Returns a corrected chordTemplates array for the arrangement when `enabled`.
 * Any template whose name matches the table AND carries at most one played
 * note is replaced with the table's shape (fitted to the arrangement's string
 * count). Non-matching or healthy templates are returned unchanged.
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
    const shape = FINGERINGS[key] ?? FINGERINGS[chordRoot(key)];
    if (!shape) return tmpl;
    if (playedCount(tmpl.frets) > 1) return tmpl;
    return { ...tmpl, frets: fitShape(shape, arrangement.strings) };
  });
}
