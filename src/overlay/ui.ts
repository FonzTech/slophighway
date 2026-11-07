import { DETACHED_PORT, OPEN_DETACHED, type FromDetached, type ToDetached } from "../shared/detached";
import type { RsArrangement } from "../songsterr/rocksmith";
import { retuneToStandard } from "../songsterr/tuning";
import { patchStored, loadStored } from "./settings";
import { HighwayShell } from "./shell";
import type { SongInfo } from "./tracks";

export type OverlayController = {
  /** `preferredPartId` is the part Songsterr is showing; a manual pick in the overlay wins over it. */
  setArrangements: (items: RsArrangement[], preferredPartId?: number) => void;
  setSongInfo: (song: SongInfo | null) => void;
  setPlayback: (timeMs: number, playing: boolean, speed: number, source?: string) => void;
  setStatus: (text: string) => void;
  destroy: () => void;
};

type DockMode = "bottom" | "top" | "float";
type FloatRect = { x: number; y: number; w: number; h: number };

/** Preferences only the attached overlay has; the shared ones live in `settings.ts`. */
type LayoutPrefs = {
  dock: DockMode;
  /** Stage height when docked at the top or bottom. */
  height: number;
  float: FloatRect;
  maximized: boolean;
  collapsed: boolean;
  transparent: boolean;
  /** Show every track re-fretted for E standard. */
  standard: boolean;
};

const MIN_HEIGHT = 120;
const MIN_FLOAT_WIDTH = 360;

function defaultFloat(): FloatRect {
  const w = Math.round(window.innerWidth * 0.6);
  const h = Math.round(window.innerHeight * 0.4);
  return { x: Math.round((window.innerWidth - w) / 2), y: 80, w, h };
}

function defaultPrefs(): LayoutPrefs {
  return {
    dock: "top",
    height: Math.round(window.innerHeight * 0.4),
    float: defaultFloat(),
    maximized: false,
    collapsed: false,
    transparent: false,
    standard: false,
  };
}

async function loadPrefs(): Promise<LayoutPrefs> {
  const base = defaultPrefs();
  const stored = await loadStored<LayoutPrefs>();
  return { ...base, ...stored, float: { ...base.float, ...stored?.float } };
}

function savePrefs(prefs: LayoutPrefs): void {
  void patchStored(prefs);
}

/** Cache of E-standard conversions so toggling or re-sending doesn't rebuild the chart. */
const retuned = new WeakMap<RsArrangement, RsArrangement>();
export function displayArrangement(arr: RsArrangement | null, standard: boolean): RsArrangement | null {
  if (!arr || !standard) return arr;
  let out = retuned.get(arr);
  if (!out) {
    out = retuneToStandard(arr);
    retuned.set(arr, out);
  }
  return out;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

export function mountOverlay(): OverlayController {
  const root = document.createElement("div");
  root.id = "shh-root";
  document.documentElement.appendChild(root);

  let prefs = defaultPrefs();
  let arrangements: RsArrangement[] = [];
  let current: RsArrangement | null = null;
  let song: SongInfo | null = null;
  let userPick: number | null = null;
  const ports = new Set<chrome.runtime.Port>();
  let lastPlayback: ToDetached | null = null;
  const detached = () => ports.size > 0;

  const dispatchArrow = (key: "ArrowLeft" | "ArrowRight") => {
    const keyCode = key === "ArrowRight" ? 39 : 37;
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key, code: key, keyCode, which: keyCode, bubbles: true, cancelable: true }),
    );
  };

  const togglePlayback = () => {
    const play = document.getElementById("control-play");
    if (play) play.click();
    else shell.setStatus("play button not found on this page");
  };

  const shell: HighwayShell = new HighwayShell(
    root,
    "attached",
    {
      selectTrack: (partId) => pickTrack(partId),
      setStandard: (enabled) => setStandard(enabled),
      togglePlay: togglePlayback,
      sendArrow: dispatchArrow,
    },
    { transparent: () => prefs.transparent },
  );

  const { panel, toolbar, stage } = shell;
  const handle = root.querySelector(".shh-resize") as HTMLDivElement;
  const dockSelect = root.querySelector(".shh-dock") as HTMLSelectElement;
  const detachBtn = root.querySelector(".shh-detach") as HTMLButtonElement;
  const bgBtn = root.querySelector(".shh-bg") as HTMLButtonElement;
  const maxBtn = root.querySelector(".shh-max") as HTMLButtonElement;
  const collapseBtn = root.querySelector(".shh-collapse") as HTMLButtonElement;
  const sync = root.querySelector(".shh-sync") as HTMLSpanElement;

  const sendDetached = (msg: ToDetached, only?: chrome.runtime.Port) => {
    for (const port of only ? [only] : ports) {
      try {
        port.postMessage(msg);
      } catch {
        ports.delete(port);
      }
    }
  };

  const update = (patch: Partial<LayoutPrefs>, persist = true) => {
    prefs = { ...prefs, ...patch };
    if (persist) savePrefs(prefs);
    applyLayout();
  };

  const applyLayout = () => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const dock = prefs.maximized ? "max" : prefs.dock;
    const collapsed = prefs.collapsed || detached();
    root.className = `shh-dock-${dock}`;
    root.classList.toggle("shh-collapsed", collapsed);
    root.classList.toggle("shh-is-detached", detached());
    root.classList.toggle("shh-transparent", prefs.transparent);
    const s = root.style;
    s.left = s.right = s.top = s.bottom = s.width = "";

    const toolbarH = toolbar.offsetHeight || 44;
    let stageH: number;
    if (dock === "max") {
      s.left = s.right = s.top = s.bottom = "0";
      stageH = vh - toolbarH;
    } else if (dock === "float") {
      const f = prefs.float;
      const w = clamp(f.w, MIN_FLOAT_WIDTH, vw);
      const h = clamp(f.h, MIN_HEIGHT, vh - toolbarH);
      const x = clamp(f.x, 0, vw - w);
      const y = clamp(f.y, 0, vh - toolbarH);
      prefs.float = { x, y, w, h };
      s.left = `${x}px`;
      s.top = `${y}px`;
      s.width = `${w}px`;
      stageH = Math.min(h, vh - y - toolbarH);
    } else {
      s.left = s.right = "0";
      if (dock === "top") s.top = "0";
      else s.bottom = "0";
      stageH = clamp(prefs.height, MIN_HEIGHT, vh - toolbarH - 40);
    }
    stage.style.height = collapsed ? "0px" : `${Math.max(0, stageH)}px`;

    dockSelect.value = prefs.dock;
    detachBtn.textContent = detached() ? "Attach" : "Detach";
    bgBtn.textContent = prefs.transparent ? "BG: Clear" : "BG: Solid";
    maxBtn.textContent = prefs.maximized ? "Exit fullscreen" : "Fullscreen";
    collapseBtn.textContent = prefs.collapsed ? "Show Highway" : "Hide Highway";
    shell.syncControls();
    shell.view?.resize();
  };

  const shown = () => displayArrangement(current, prefs.standard);

  /** Pushes the displayed chart to the view, the on-stage labels and any detached window. */
  const publishCurrent = (flash: boolean) => {
    const arr = shown();
    shell.setArrangement(arr, flash);
    sendDetached({ type: "arrangement", arrangement: arr });
  };

  const applySelection = (partId: number | undefined, flash = false) => {
    const next = arrangements.find((a) => a.partId === partId) ?? arrangements[0] ?? null;
    if (next === current) return;
    current = next;
    publishCurrent(flash);
  };

  const setStandard = (enabled: boolean) => {
    if (enabled === prefs.standard) return;
    update({ standard: enabled });
    shell.setStandard(enabled);
    publishCurrent(false);
    sendDetached({ type: "settings", standard: enabled });
  };

  const pickTrack = (partId: number) => {
    if (!arrangements.some((a) => a.partId === partId)) return;
    userPick = partId;
    applySelection(partId, true);
  };

  const trackSummaries = (): ToDetached => ({
    type: "tracks",
    tracks: arrangements.map(({ partId, name, noteCount }) => ({ partId, name, noteCount })),
  });

  dockSelect.addEventListener("change", () => {
    const dock = dockSelect.value as DockMode;
    update({ dock, maximized: false, collapsed: false });
  });
  bgBtn.addEventListener("click", () => {
    update({ transparent: !prefs.transparent });
    shell.createView();
  });
  detachBtn.addEventListener("click", () => {
    if (detached()) {
      sendDetached({ type: "close" });
      return;
    }
    try {
      void chrome.runtime.sendMessage({ type: OPEN_DETACHED });
    } catch (err) {
      shell.setStatus(`detach failed: ${String(err)} (reload the page)`);
    }
  });

  const onConnect = (port: chrome.runtime.Port) => {
    if (port.name !== DETACHED_PORT) return;
    const wasDetached = detached();
    ports.add(port);
    sendDetached(trackSummaries(), port);
    sendDetached({ type: "song", song }, port);
    sendDetached({ type: "settings", standard: prefs.standard }, port);
    sendDetached({ type: "arrangement", arrangement: shown() }, port);
    if (lastPlayback) sendDetached(lastPlayback, port);
    port.onMessage.addListener((msg: FromDetached) => {
      if (msg?.type === "select") pickTrack(msg.partId);
      else if (msg?.type === "set-standard") setStandard(msg.enabled);
      else if (msg?.type === "toggle-play") togglePlayback();
      else if (msg?.type === "arrow") dispatchArrow(msg.key);
    });
    port.onDisconnect.addListener(() => {
      ports.delete(port);
      if (detached()) return;
      applyLayout();
      shell.setSuspended(false);
    });
    if (!wasDetached) {
      // the detached window does the rendering; keep the tab's GPU idle meanwhile
      shell.setSuspended(true);
      applyLayout();
    }
  };
  chrome.runtime.onConnect.addListener(onConnect);

  maxBtn.addEventListener("click", () => update({ maximized: !prefs.maximized, collapsed: false }));
  collapseBtn.addEventListener("click", () => update({ collapsed: !prefs.collapsed }));

  /** Pointer drag helper: `onMove` gets the offset from the press point. */
  const dragWith = (el: HTMLElement, down: PointerEvent, onMove: (dx: number, dy: number) => void) => {
    down.preventDefault();
    el.setPointerCapture(down.pointerId);
    const move = (e: PointerEvent) => onMove(e.clientX - down.clientX, e.clientY - down.clientY);
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      savePrefs(prefs);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };

  handle.addEventListener("pointerdown", (down) => {
    if (prefs.maximized || prefs.collapsed) return;
    if (prefs.dock === "float") {
      const start = { ...prefs.float, h: stage.clientHeight };
      dragWith(handle, down, (dx, dy) => update({ float: { ...start, w: start.w + dx, h: start.h + dy } }, false));
      return;
    }
    const startH = stage.clientHeight;
    const sign = prefs.dock === "top" ? 1 : -1;
    dragWith(handle, down, (_dx, dy) => update({ height: startH + sign * dy }, false));
  });

  toolbar.addEventListener("pointerdown", (down) => {
    if (prefs.dock !== "float" || prefs.maximized) return;
    if ((down.target as HTMLElement).closest("select, button")) return;
    const start = { ...prefs.float };
    dragWith(toolbar, down, (dx, dy) => update({ float: { ...start, x: start.x + dx, y: start.y + dy } }, false));
  });

  let toolbarH = 0;
  const toolbarObserver = new ResizeObserver(() => {
    if (toolbar.offsetHeight === toolbarH) return;
    toolbarH = toolbar.offsetHeight;
    applyLayout();
  });
  toolbarObserver.observe(toolbar);
  const onWindowResize = () => applyLayout();
  window.addEventListener("resize", onWindowResize);

  applyLayout();
  void loadPrefs().then((loaded) => {
    const rebuild = loaded.transparent !== prefs.transparent;
    const restandard = loaded.standard !== prefs.standard;
    prefs = loaded;
    shell.setStandard(prefs.standard);
    applyLayout();
    if (rebuild) shell.createView();
    if (restandard) publishCurrent(false);
  });

  panel.addEventListener("keydown", (e) => e.stopPropagation());

  return {
    setArrangements(items, preferredPartId) {
      arrangements = items
        .filter(
          (a) => a.strings > 0 && a.noteCount > 0 && !/drum|vocal|voice/i.test(`${a.instrument} ${a.name}`),
        )
        .sort((a, b) => a.partId - b.partId);

      const summaries = trackSummaries();
      if (summaries.type === "tracks") shell.setTracks(summaries.tracks);
      sendDetached(summaries);

      const byId = (id: number | null | undefined) =>
        id == null ? undefined : arrangements.find((a) => a.partId === id);
      const chosen =
        byId(userPick) ??
        byId(preferredPartId) ??
        byId(current?.partId) ??
        arrangements.find((a) => /guit/i.test(`${a.instrument} ${a.name}`)) ??
        arrangements[0];
      if (chosen) shell.selectTrackSilently(chosen.partId);
      applySelection(chosen?.partId);
      if (!arrangements.length) {
        current = null;
        if (!items.length) userPick = null;
        publishCurrent(false);
      }
    },
    setSongInfo(next) {
      song = next;
      shell.setSong(song);
      sendDetached({ type: "song", song });
    },
    setPlayback(timeMs, playing, speed, source) {
      shell.setPlayback(timeMs, playing, speed);
      lastPlayback = { type: "playback", timeMs, playing, speed, sentAt: Date.now() };
      sendDetached(lastPlayback);
      if (source) sync.textContent = `sync:${source}`;
    },
    setStatus(text) {
      shell.setStatus(text);
    },
    destroy() {
      toolbarObserver.disconnect();
      chrome.runtime.onConnect.removeListener(onConnect);
      for (const port of ports) port.disconnect();
      ports.clear();
      window.removeEventListener("resize", onWindowResize);
      shell.destroy();
      root.remove();
    },
  };
}
