import type { RsArrangement } from "../songsterr/rocksmith";
import { tuningOffsets, stringNoteLetters } from "../songsterr/tuning";
import { applyChordOverride } from "./chordOverride";
import type { HighwayView, PlaybackClock } from "./clock";

type SlopsmithRenderer = {
  init(canvas: HTMLCanvasElement, bundle: Record<string, unknown>): void;
  draw(bundle: Record<string, unknown>): void;
  resize(w: number, h: number): void;
  destroy(): void;
  readyPromise?: Promise<void>;
};

declare global {
  interface Window {
    slopsmithViz_highway_3d?: () => SlopsmithRenderer;
  }
  // read by the build-time patches in scripts/build.mjs when the renderer initialises
  // eslint-disable-next-line no-var
  var __shhHighway: { transparent: boolean; antialias: boolean } | undefined;
}

export type Quality = "high" | "balanced" | "performance";

type QualitySpec = {
  /** Device pixels per CSS pixel to render at; null = the renderer's own choice (up to 2x). */
  pixelRatio: number | null;
  antialias: boolean;
  /** Frame-rate cap; 0 = every display refresh. */
  fps: number;
};

const QUALITY: Record<Quality, QualitySpec> = {
  high: { pixelRatio: null, antialias: true, fps: 0 },
  balanced: { pixelRatio: 1, antialias: true, fps: 60 },
  performance: { pixelRatio: 0.75, antialias: false, fps: 60 },
};

export const QUALITY_LABELS: Record<Quality, string> = {
  high: "Quality: High",
  balanced: "Quality: Balanced",
  performance: "Quality: Performance",
};

export function qualityOptions(): string {
  return (Object.keys(QUALITY_LABELS) as Quality[])
    .map((q) => `<option value="${q}">${QUALITY_LABELS[q]}</option>`)
    .join("");
}

export function parseQuality(value: unknown): Quality {
  return value === "high" || value === "performance" ? value : "balanced";
}

export type ChordShapeSize = "normal" | "big" | "bigger" | "biggest";

/** Scale applied to the chord shape diagram (top left) for each size option; 1 is the renderer's own size. */
export const CHORD_SHAPE_SCALE: Record<ChordShapeSize, number> = {
  normal: 1,
  big: 1.5,
  bigger: 2,
  biggest: 3,
};

export const CHORD_SHAPE_LABELS: Record<ChordShapeSize, string> = {
  normal: "Chord shape size: Normal",
  big: "Chord shape size: Big",
  bigger: "Chord shape size: Bigger",
  biggest: "Chord shape size: Biggest",
};

export function chordShapeOptions(): string {
  return (Object.keys(CHORD_SHAPE_LABELS) as ChordShapeSize[])
    .map((c) => `<option value="${c}">${CHORD_SHAPE_LABELS[c]}</option>`)
    .join("");
}

export function parseChordShapeSize(value: unknown): ChordShapeSize {
  return value === "big" || value === "bigger" || value === "biggest" ? value : "normal";
}

export type ChordOrientation = "normal" | "90" | "180" | "270";

/** Rotation (degrees clockwise) applied to the chord-shape box, per drop-down value. */
export const CHORD_ORIENTATION_DEG: Record<ChordOrientation, number> = {
  normal: 0,
  "90": 90,
  "180": 180,
  "270": 270,
};

export const CHORD_ORIENTATION_LABELS: Record<ChordOrientation, string> = {
  normal: "Chord shape orientation: Normal",
  "90": "Chord shape orientation: 90 degrees",
  "180": "Chord shape orientation: 180 degrees",
  "270": "Chord shape orientation: 270 degrees",
};

export function chordOrientationOptions(): string {
  return (Object.keys(CHORD_ORIENTATION_LABELS) as ChordOrientation[])
    .map((c) => `<option value="${c}">${CHORD_ORIENTATION_LABELS[c]}</option>`)
    .join("");
}

export function parseChordOrientation(value: unknown): ChordOrientation {
  return value === "90" || value === "180" || value === "270" ? value : "normal";
}

export type CameraDistance = "farthest" | "farther" | "far" | "normal" | "near" | "nearer" | "nearest";

/** Multiplier on the renderer's camera distance for each option; 1 is the renderer's own distance. */
export const CAMERA_DISTANCE_FACTOR: Record<CameraDistance, number> = {
  farthest: 1.6,
  farther: 1.4,
  far: 1.2,
  normal: 1,
  near: 0.85,
  nearer: 0.7,
  nearest: 0.55,
};

export const CAMERA_DISTANCE_LABELS: Record<CameraDistance, string> = {
  farthest: "Camera distance: Farthest",
  farther: "Camera distance: Farther",
  far: "Camera distance: Far",
  normal: "Camera distance: Normal",
  near: "Camera distance: Near",
  nearer: "Camera distance: Nearer",
  nearest: "Camera distance: Nearest",
};

export function cameraDistanceOptions(): string {
  return (Object.keys(CAMERA_DISTANCE_LABELS) as CameraDistance[])
    .map((c) => `<option value="${c}">${CAMERA_DISTANCE_LABELS[c]}</option>`)
    .join("");
}

export function parseCameraDistance(value: unknown): CameraDistance {
  return typeof value === "string" && value in CAMERA_DISTANCE_FACTOR ? (value as CameraDistance) : "normal";
}

export const MAX_NEXT_CHORDS = 5;

export function nextChordsOptions(): string {
  return Array.from({ length: MAX_NEXT_CHORDS + 1 }, (_, n) => `<option value="${n}">Number of next chords: ${n}</option>`).join("");
}

export function parseNextChords(value: unknown): number {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.max(0, Math.min(MAX_NEXT_CHORDS, n)) : 0;
}

export function webgl2Available(): boolean {
  try {
    return !!document.createElement("canvas").getContext("webgl2");
  } catch {
    return false;
  }
}

export function hasTouchSupport(): boolean {
  return navigator.maxTouchPoints > 0;
}

export class Highway3D implements HighwayView {
  private stage: HTMLElement;
  private canvas: HTMLCanvasElement;
  private clock: PlaybackClock;
  private renderer: SlopsmithRenderer | null = null;
  private bundle: Record<string, unknown> | null = null;
  private raf = 0;
  private ready = false;
  private onStatus: (text: string) => void;
  private transparent: boolean;
  private quality: QualitySpec;
  private chordShape: ChordShapeSize;
  private nextChords: number;
  private cameraDistance: CameraDistance;
  private chordOverride: boolean;
  private showStringOpenNotes: boolean;
  private chordOrientation: ChordOrientation;
  private arrangement: RsArrangement | null = null;
  private lastFrame = 0;
  private frameBudget = 0;

  constructor(
    stage: HTMLElement,
    clock: PlaybackClock,
    onStatus: (text: string) => void,
    transparent = false,
    quality: Quality = "balanced",
    chordShape: ChordShapeSize = "normal",
    nextChords = 0,
    cameraDistance: CameraDistance = "normal",
    chordOverride = false,
    showStringOpenNotes = false,
    chordOrientation: ChordOrientation = "normal",
  ) {
    this.stage = stage;
    this.clock = clock;
    this.onStatus = onStatus;
    this.transparent = transparent;
    this.quality = QUALITY[quality];
    this.chordShape = chordShape;
    this.nextChords = nextChords;
    this.cameraDistance = cameraDistance;
    this.chordOverride = chordOverride;
    this.showStringOpenNotes = showStringOpenNotes;
    this.chordOrientation = chordOrientation;
    this.canvas = document.createElement("canvas");
    this.canvas.className = "shh-canvas shh-canvas-3d";
    stage.appendChild(this.canvas);
    this.syncCanvasSize();
  }

  setArrangement(arr: RsArrangement | null): void {
    if (!arr) {
      this.stopRenderer();
      this.bundle = null;
      return;
    }
    // The renderer re-reads notes, string count and tuning from the bundle every frame and keys its
    // caches on array identity, so swapping the data in place switches tracks without rebuilding the scene.
    this.arrangement = arr;
    if (this.renderer && this.bundle) {
      Object.assign(this.bundle, this.makeBundle(arr), { currentTime: this.bundle.currentTime });
      return;
    }
    this.bundle = this.makeBundle(arr);
    this.start();
  }

  setQuality(quality: Quality): void {
    const next = QUALITY[quality];
    const restart = next.antialias !== this.quality.antialias && !!this.renderer;
    this.quality = next;
    if (!this.bundle) return;
    this.bundle.renderScale = this.renderScale();
    if (restart) {
      this.stopRenderer();
      this.start();
    }
  }

  setChordShapeSize(size: ChordShapeSize): void {
    this.chordShape = size;
    if (this.bundle) this.bundle.chordDiagramScale = CHORD_SHAPE_SCALE[size];
  }

  setCameraDistance(distance: CameraDistance): void {
    this.cameraDistance = distance;
    if (this.bundle) this.bundle.cameraDistanceMul = CAMERA_DISTANCE_FACTOR[distance];
  }

  setNextChordCount(count: number): void {
    this.nextChords = count;
    if (this.bundle) this.bundle.nextChordCount = count;
  }

  setChordOverride(enabled: boolean): void {
    this.chordOverride = enabled;
    // Chord templates are resolved at bundle build time; re-emit the current
    // bundle so the corrected fingerings reach the renderer.
    if (this.bundle && this.arrangement) {
      Object.assign(this.bundle, this.makeBundle(this.arrangement), { currentTime: this.bundle.currentTime });
    }
  }

  setShowStringOpenNotes(enabled: boolean): void {
    this.showStringOpenNotes = enabled;
    if (this.bundle) this.bundle.showStringOpenNotes = enabled;
  }

  setChordOrientation(orientation: ChordOrientation): void {
    this.chordOrientation = orientation;
    if (this.bundle) this.bundle.chordDiagramRotation = CHORD_ORIENTATION_DEG[orientation];
  }

  /** The renderer multiplies this by min(devicePixelRatio, 2). */
  private renderScale(): number {
    const { pixelRatio } = this.quality;
    if (pixelRatio == null) return 1;
    return pixelRatio / Math.min(window.devicePixelRatio || 1, 2);
  }

  private stopRenderer(): void {
    cancelAnimationFrame(this.raf);
    this.ready = false;
    try {
      this.renderer?.destroy();
    } catch {
      // renderer teardown is best-effort
    }
    this.renderer = null;
    this.stage.querySelectorAll(".h3d-wrap").forEach((el) => el.remove());
  }

  private makeBundle(arr: RsArrangement): Record<string, unknown> {
    const tuning = tuningOffsets(arr);
    return {
      currentTime: 0,
      isReady: true,
      songInfo: { title: arr.name, arrangement: arr.name, tuning, capo: arr.capo },
      notes: arr.notes,
      chords: arr.chords,
      anchors: [],
      beats: arr.beats,
      sections: arr.sections,
      chordTemplates: applyChordOverride(arr, arr.chordTemplates, this.chordOverride),
      stringCount: arr.strings,
      tuning,
      capo: arr.capo,
      lyrics: [],
      toneChanges: [],
      toneBase: null,
      drumTab: null,
      mastery: 1,
      hasPhraseData: false,
      handShapes: [],
      inverted: false,
      lefty: false,
      renderScale: this.renderScale(),
      chordDiagramScale: CHORD_SHAPE_SCALE[this.chordShape],
      nextChordCount: this.nextChords,
      cameraDistanceMul: CAMERA_DISTANCE_FACTOR[this.cameraDistance],
      showStringOpenNotes: this.showStringOpenNotes,
      chordDiagramRotation: CHORD_ORIENTATION_DEG[this.chordOrientation],
      stringNoteLetters: stringNoteLetters(arr),
      lyricsVisible: false,
      getNoteState: () => null,
    };
  }

  private start(): void {
    const factory = window.slopsmithViz_highway_3d;
    if (typeof factory !== "function") {
      this.onStatus("3D renderer not loaded");
      return;
    }
    if (!this.bundle) return;
    globalThis.__shhHighway = { transparent: this.transparent, antialias: this.quality.antialias };
    this.renderer = factory();
    this.renderer.init(this.canvas, this.bundle);
    this.renderer.readyPromise
      ?.then(() => {
        this.ready = true;
        this.resize();
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.message === "superseded") return;
        console.error("[slophighway] 3D renderer failed", err);
        this.onStatus(`3D failed: ${String(err)}`);
      });
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      if (!this.ready || !this.renderer || !this.bundle) return;
      if (!this.dueForFrame(now)) return;
      this.bundle.currentTime = this.clock.nowMs() / 1000;
      try {
        this.renderer.draw(this.bundle);
      } catch (err) {
        console.error("[slophighway] 3D draw error", err);
      }
    };
    this.raf = requestAnimationFrame(loop);
  }

  /** Spreads draws evenly so a 144/165 Hz display renders ~60 frames a second instead of every refresh. */
  private dueForFrame(now: number): boolean {
    const { fps } = this.quality;
    const dt = Math.min(now - this.lastFrame, 250);
    this.lastFrame = now;
    if (!fps) return true;
    const interval = 1000 / fps;
    this.frameBudget += dt;
    if (this.frameBudget < interval) return false;
    this.frameBudget = Math.min(this.frameBudget - interval, interval);
    return true;
  }

  private syncCanvasSize(): { w: number; h: number } {
    const w = Math.max(1, this.stage.clientWidth);
    const h = Math.max(1, this.stage.clientHeight);
    this.canvas.width = w;
    this.canvas.height = h;
    return { w, h };
  }

  resize(): void {
    const { w, h } = this.syncCanvasSize();
    if (this.ready) this.renderer?.resize(w, h);
  }

  destroy(): void {
    this.stopRenderer();
    this.canvas.remove();
  }
}
