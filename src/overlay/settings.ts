import {
  hasTouchSupport,
  parseCameraDistance,
  parseChordShapeSize,
  parseNextChords,
  parseQuality,
  webgl2Available,
  type CameraDistance,
  type ChordShapeSize,
  type Quality,
} from "./host3d";

export type ViewMode = "3d" | "2d";

/** Settings shared by the attached overlay and the detached window; changes sync live between them. */
export type SharedSettings = {
  view: ViewMode;
  quality: Quality;
  /** Enable on-screen touch controls. */
  touchControls: boolean;
  chordShape: ChordShapeSize;
  nextChords: number;
  cameraDistance: CameraDistance;
  /** Whether the toolbar's advanced options group is expanded. */
  optionsShown: boolean;
  /** Whether the "Chord override" feature for the chord shape box is enabled. */
  chordOverride: boolean;
};

/** Storage key holding the shared settings plus the attached overlay's layout preferences. */
export const PREFS_KEY = "shh-prefs";

export function defaultSettings(): SharedSettings {
  return {
    view: webgl2Available() ? "3d" : "2d",
    quality: "balanced",
    touchControls: hasTouchSupport(),
    chordShape: "normal",
    nextChords: 0,
    cameraDistance: "normal",
    optionsShown: true,
    chordOverride: false,
  };
}

export function parseSettings(stored: Partial<Record<keyof SharedSettings, unknown>> | undefined): SharedSettings {
  const base = defaultSettings();
  const view = stored?.view === "2d" || (stored?.view === "3d" && webgl2Available()) ? stored.view : base.view;
  return {
    view,
    quality: parseQuality(stored?.quality),
    touchControls: typeof stored?.touchControls === "boolean" ? stored.touchControls : base.touchControls,
    chordShape: parseChordShapeSize(stored?.chordShape),
    nextChords: parseNextChords(stored?.nextChords),
    cameraDistance: parseCameraDistance(stored?.cameraDistance),
    optionsShown: typeof stored?.optionsShown === "boolean" ? stored.optionsShown : base.optionsShown,
    chordOverride: typeof stored?.chordOverride === "boolean" ? stored.chordOverride : base.chordOverride,
  };
}

export async function loadStored<T extends object>(): Promise<Partial<T> | undefined> {
  try {
    return (await chrome.storage.local.get(PREFS_KEY))[PREFS_KEY] as Partial<T> | undefined;
  } catch {
    return undefined;
  }
}

/** Merges `patch` into the stored preferences, so each window only writes the keys it owns. */
export async function patchStored(patch: object): Promise<void> {
  try {
    const stored = (await chrome.storage.local.get(PREFS_KEY))[PREFS_KEY] as object | undefined;
    await chrome.storage.local.set({ [PREFS_KEY]: { ...stored, ...patch } });
  } catch {
    // extension context can disappear after a reload; preferences are optional
  }
}

export async function loadSettings(): Promise<SharedSettings> {
  return parseSettings(await loadStored<SharedSettings>());
}

/** Calls `onChange` whenever another window (or this one) writes the stored preferences. */
export function watchSettings(onChange: (settings: SharedSettings) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    const change = changes[PREFS_KEY];
    if (area === "local" && change) onChange(parseSettings(change.newValue));
  };
  try {
    chrome.storage.onChanged.addListener(listener);
  } catch {
    return () => {};
  }
  return () => chrome.storage.onChanged.removeListener(listener);
}
