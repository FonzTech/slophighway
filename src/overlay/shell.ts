import type { RsArrangement } from "../songsterr/rocksmith";
import type { TrackSummary } from "../shared/detached";
import { PlaybackClock, type HighwayView } from "./clock";
import { Highway2D } from "./highway";
import {
  Highway3D,
  parseCameraDistance,
  parseChordShapeSize,
  parseNextChords,
  parseQuality,
  webgl2Available,
} from "./host3d";
import { defaultSettings, loadSettings, patchStored, watchSettings, type SharedSettings } from "./settings";
import { panelHtml, type ShellMode } from "./toolbar";
import {
  mountControlsLegend,
  SongInfoBox,
  TrackBadge,
  trackHotkey,
  trackLabel,
  type BarReadout,
  type SongInfo,
} from "./tracks";

type Arrow = "ArrowLeft" | "ArrowRight";

/** Hold time before a held side tap starts auto-repeating. */
const TOUCH_REPEAT_DELAY_MS = 300;
/** Fixed interval between auto-repeat presses while a side tap is held. */
const TOUCH_REPEAT_INTERVAL_MS = 100;
/** Tap zones as 0–1 fractions of the stage: the centre cell is play/pause, its left/right neighbours seek. */
const TOUCH_ZONE_MIN = 0.333;
const TOUCH_ZONE_MAX = 0.666;

/** What the shell needs from whoever owns the song data (the Songsterr tab, or a port to it). */
export interface ShellSource {
  selectTrack(partId: number): void;
  setStandard(enabled: boolean): void;
  togglePlay(): void;
  sendArrow(key: Arrow): void;
}

export type ShellOptions = {
  /** Background style of the attached overlay; the detached window is always solid. */
  transparent?: () => boolean;
  /** Extra rows for the controls legend. */
  legendExtra?: [string, string][];
};

/** The highway toolbar, stage widgets, view lifecycle and input handling shared by both hosts. */
export class HighwayShell {
  readonly clock = new PlaybackClock();
  readonly panel: HTMLElement;
  readonly toolbar: HTMLElement;
  readonly stage: HTMLElement;
  settings: SharedSettings = defaultSettings();
  view: HighwayView | null = null;

  private readonly badge: TrackBadge;
  private readonly info: SongInfoBox;
  private readonly barReadout: BarReadout;
  private readonly statusEl: HTMLElement;
  private readonly arrangementSelect: HTMLSelectElement;
  private readonly viewSelect: HTMLSelectElement;
  private readonly qualitySelect: HTMLSelectElement;
  private readonly touchSelect: HTMLSelectElement;
  private readonly chordShapeSelect: HTMLSelectElement;
  private readonly nextChordsSelect: HTMLSelectElement;
  private readonly cameraDistanceSelect: HTMLSelectElement;
  private readonly chordOverrideSelect: HTMLSelectElement;
  private readonly stdBtn: HTMLButtonElement;
  private readonly resizeObserver: ResizeObserver;
  private readonly unwatch: () => void;
  private readonly onKeyDown: (e: KeyboardEvent) => void;
  private tracks: TrackSummary[] = [];
  private arrangement: RsArrangement | null = null;
  private standard = false;
  private suspended = false;
  private readonly optionsToggle: HTMLButtonElement;
  private repeatDelay: number | undefined;
  private repeatTimer: number | undefined;

  constructor(
    private readonly root: HTMLElement,
    private readonly mode: ShellMode,
    private readonly source: ShellSource,
    private readonly options: ShellOptions = {},
  ) {
    root.innerHTML = panelHtml(mode);
    const q = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T;
    this.panel = q(".shh-panel");
    this.toolbar = q(".shh-toolbar");
    this.stage = q(".shh-stage");
    this.statusEl = q(".shh-status");
    this.arrangementSelect = q(".shh-arrangement");
    this.viewSelect = q(".shh-view");
    this.qualitySelect = q(".shh-quality");
    this.touchSelect = q(".shh-touch");
    this.chordShapeSelect = q(".shh-chord-shape");
    this.nextChordsSelect = q(".shh-next-chords");
    this.cameraDistanceSelect = q(".shh-camera-distance");
    this.chordOverrideSelect = q(".shh-chord-override");
    this.stdBtn = q(".shh-std");
    this.optionsToggle = q(".shh-options-toggle");
    this.optionsToggle.addEventListener("click", () => {
      this.applySettings({ ...this.settings, optionsShown: !this.settings.optionsShown }, true);
    });

    if (!webgl2Available()) this.viewSelect.querySelector('option[value="3d"]')?.setAttribute("disabled", "");

    this.badge = new TrackBadge(this.stage);
    this.info = new SongInfoBox(this.stage);
    this.barReadout = mountControlsLegend(this.stage, this.clock, options.legendExtra);

    this.bindControls();
    this.bindTouchZones();
    this.onKeyDown = (e) => this.handleKey(e);
    window.addEventListener("keydown", this.onKeyDown, true);
    this.resizeObserver = new ResizeObserver(() => this.view?.resize());
    this.resizeObserver.observe(this.stage);

    this.syncControls();
    this.createView();
    void loadSettings().then((loaded) => this.applySettings(loaded, false));
    this.unwatch = watchSettings((next) => this.applySettings(next, false));
  }

  /** Re-applies the shared control state; hosts that reset `root.className` must call this afterwards. */
  syncControls(): void {
    const s = this.settings;
    this.viewSelect.value = s.view;
    this.qualitySelect.value = s.quality;
    this.touchSelect.value = s.touchControls ? "yes" : "no";
    this.chordShapeSelect.value = s.chordShape;
    this.nextChordsSelect.value = String(s.nextChords);
    this.cameraDistanceSelect.value = s.cameraDistance;
    this.chordOverrideSelect.value = s.chordOverride ? "yes" : "no";
    this.stdBtn.textContent = this.standard ? "E Std: on" : "E Std: off";
    this.stdBtn.classList.toggle("shh-on", this.standard);
    this.root.classList.toggle("shh-touch-controls", s.touchControls);
    this.root.classList.toggle("shh-options-hidden", !s.optionsShown);
    this.optionsToggle.textContent = s.optionsShown ? "Hide Options" : "Show Options";
  }

  /** Applies new shared settings to the controls and the live view; `persist` writes them to storage. */
  applySettings(next: SharedSettings, persist: boolean): void {
    const prev = this.settings;
    const changed = (Object.keys(next) as (keyof SharedSettings)[]).filter((k) => next[k] !== prev[k]);
    if (!changed.length) return;
    this.settings = next;
    this.syncControls();
    if (changed.includes("view")) this.createView();
    else if (this.view instanceof Highway3D) {
      if (changed.includes("quality")) this.view.setQuality(next.quality);
      if (changed.includes("chordShape")) this.view.setChordShapeSize(next.chordShape);
      if (changed.includes("nextChords")) this.view.setNextChordCount(next.nextChords);
      if (changed.includes("cameraDistance")) this.view.setCameraDistance(next.cameraDistance);
    }
    if (persist) void patchStored(Object.fromEntries(changed.map((k) => [k, next[k]])));
  }

  setStatus(text: string): void {
    this.statusEl.textContent = text;
  }

  setStandard(enabled: boolean): void {
    this.standard = enabled;
    this.syncControls();
  }

  setSong(song: SongInfo | null): void {
    this.info.setSong(song);
  }

  setPlayback(timeMs: number, playing: boolean, speed: number): void {
    this.clock.set(timeMs, playing, speed);
  }

  setTracks(tracks: TrackSummary[]): void {
    this.tracks = tracks;
    this.arrangementSelect.innerHTML = "";
    tracks.forEach((t, i) => {
      const opt = document.createElement("option");
      opt.value = String(t.partId);
      opt.textContent = trackLabel(i, t.name, t.noteCount);
      this.arrangementSelect.appendChild(opt);
    });
    if (this.arrangement) this.arrangementSelect.value = String(this.arrangement.partId);
  }

  /** Selects a track in the dropdown without notifying the source. */
  selectTrackSilently(partId: number): void {
    this.arrangementSelect.value = String(partId);
  }

  /** Shows `arrangement` (already converted for E standard when that is on) everywhere. */
  setArrangement(arrangement: RsArrangement | null, flash = false): void {
    this.arrangement = arrangement;
    if (arrangement) {
      this.arrangementSelect.value = String(arrangement.partId);
      this.badge.show(
        this.tracks.findIndex((t) => t.partId === arrangement.partId),
        arrangement.name,
        flash,
      );
    } else {
      this.badge.clear();
    }
    this.info.setArrangement(arrangement);
    this.barReadout.setArrangement(arrangement);
    this.view?.setArrangement(arrangement);
  }

  /** While suspended there is no view at all (the other window does the rendering). */
  setSuspended(suspended: boolean): void {
    if (suspended === this.suspended) return;
    this.suspended = suspended;
    this.createView();
  }

  createView(): void {
    this.view?.destroy();
    this.view = null;
    if (this.suspended) return;
    const s = this.settings;
    const transparent = this.options.transparent?.() ?? false;
    try {
      this.view =
        s.view === "3d" && webgl2Available()
          ? new Highway3D(
              this.stage,
              this.clock,
              (text) => this.setStatus(text),
              transparent,
              s.quality,
              s.chordShape,
              s.nextChords,
              s.cameraDistance,
            )
          : new Highway2D(this.stage, this.clock, transparent);
    } catch (err) {
      console.error("[slophighway] view init failed", err);
      this.setStatus(`view failed: ${String(err)}`);
      return;
    }
    this.view.setArrangement(this.arrangement);
    this.view.resize();
  }

  destroy(): void {
    this.stopRepeat();
    this.resizeObserver.disconnect();
    this.unwatch();
    window.removeEventListener("keydown", this.onKeyDown, true);
    this.view?.destroy();
    this.view = null;
    this.barReadout.destroy();
  }

  private bindControls(): void {
    const on = (el: HTMLElement, fn: () => void) => el.addEventListener("change", fn);
    const set = (patch: Partial<SharedSettings>) => this.applySettings({ ...this.settings, ...patch }, true);
    on(this.arrangementSelect, () => this.source.selectTrack(Number(this.arrangementSelect.value)));
    on(this.viewSelect, () => set({ view: this.viewSelect.value === "2d" ? "2d" : "3d" }));
    on(this.qualitySelect, () => set({ quality: parseQuality(this.qualitySelect.value) }));
    on(this.touchSelect, () => set({ touchControls: this.touchSelect.value === "yes" }));
    on(this.chordShapeSelect, () => set({ chordShape: parseChordShapeSize(this.chordShapeSelect.value) }));
    on(this.nextChordsSelect, () => set({ nextChords: parseNextChords(this.nextChordsSelect.value) }));
    on(this.cameraDistanceSelect, () => set({ cameraDistance: parseCameraDistance(this.cameraDistanceSelect.value) }));
    on(this.chordOverrideSelect, () => set({ chordOverride: this.chordOverrideSelect.value === "yes" }));
    this.stdBtn.addEventListener("click", () => this.source.setStandard(!this.standard));
  }

  private handleKey(e: KeyboardEvent): void {
    if (this.mode === "detached" && e.code === "Space" && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
      // a focused toolbar button would otherwise be "clicked" by Space as well
      e.preventDefault();
      (document.activeElement as HTMLElement | null)?.blur();
      if (!e.repeat) this.source.togglePlay();
      return;
    }
    const index = trackHotkey(e);
    if (index == null || !this.tracks[index]) return;
    if (this.mode === "detached") e.preventDefault();
    this.source.selectTrack(this.tracks[index].partId);
  }

  private bindTouchZones(): void {
    const stage = this.stage;
    stage.addEventListener("pointerdown", (e) => {
      if (!this.settings.touchControls) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      const w = stage.clientWidth;
      const h = stage.clientHeight;
      if (!w || !h) return;
      const rect = stage.getBoundingClientRect();
      const nx = e.clientX - rect.left;
      const ny = e.clientY - rect.top;
      if (ny < h * TOUCH_ZONE_MIN || ny > h * TOUCH_ZONE_MAX) return;
      if (nx < w * TOUCH_ZONE_MIN) this.startRepeat("ArrowLeft");
      else if (nx > w * TOUCH_ZONE_MAX) this.startRepeat("ArrowRight");
      else this.source.togglePlay();
    });
    for (const stop of ["pointerup", "pointerleave", "pointercancel"]) {
      stage.addEventListener(stop, () => this.stopRepeat());
    }
    stage.addEventListener("contextmenu", (e) => {
      if (this.settings.touchControls) e.preventDefault();
    });
  }

  private startRepeat(key: Arrow): void {
    this.stopRepeat();
    this.source.sendArrow(key);
    this.repeatDelay = window.setTimeout(() => {
      this.repeatDelay = undefined;
      this.repeatTimer = window.setInterval(() => this.source.sendArrow(key), TOUCH_REPEAT_INTERVAL_MS);
    }, TOUCH_REPEAT_DELAY_MS);
  }

  private stopRepeat(): void {
    if (this.repeatDelay !== undefined) clearTimeout(this.repeatDelay);
    if (this.repeatTimer !== undefined) clearInterval(this.repeatTimer);
    this.repeatDelay = this.repeatTimer = undefined;
  }
}
