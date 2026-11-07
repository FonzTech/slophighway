import { DETACHED_PORT, type FromDetached, type ToDetached } from "../shared/detached";
import type { RsArrangement } from "../songsterr/rocksmith";
import { HighwayShell } from "../overlay/shell";

const RECONNECT_MS = 2000;

const tabId = Number(new URLSearchParams(location.search).get("tab"));
let port: chrome.runtime.Port | null = null;
let arrangement: RsArrangement | null = null;

const send = (msg: FromDetached) => port?.postMessage(msg);

const shell = new HighwayShell(
  document.getElementById("shh-root") as HTMLElement,
  "detached",
  {
    selectTrack: (partId) => send({ type: "select", partId }),
    setStandard: (enabled) => send({ type: "set-standard", enabled }),
    togglePlay: () => send({ type: "toggle-play" }),
    sendArrow: (key) => send({ type: "arrow", key }),
  },
  { legendExtra: [["2× click", "full screen"]] },
);

const fullBtn = shell.toolbar.querySelector(".shh-full") as HTMLButtonElement;

function layout(): void {
  const fullscreen = !!document.fullscreenElement;
  document.body.classList.toggle("shh-fullscreen", fullscreen);
  fullBtn.textContent = fullscreen ? "Exit full screen" : "Full screen";
  shell.stage.style.height = `${window.innerHeight - (fullscreen ? 0 : shell.toolbar.offsetHeight)}px`;
  shell.view?.resize();
}

function onMessage(msg: ToDetached): void {
  switch (msg.type) {
    case "tracks":
      shell.setTracks(msg.tracks);
      break;
    case "song":
      shell.setSong(msg.song);
      break;
    case "settings":
      shell.setStandard(msg.standard);
      break;
    case "arrangement": {
      const switched = !!arrangement && !!msg.arrangement && arrangement.partId !== msg.arrangement.partId;
      arrangement = msg.arrangement;
      document.title = arrangement ? `${arrangement.name} · Slophighway` : "Slophighway";
      shell.setArrangement(arrangement, switched);
      break;
    }
    case "playback": {
      const lag = msg.playing ? Math.max(0, Date.now() - msg.sentAt) * msg.speed : 0;
      shell.setPlayback(msg.timeMs + lag, msg.playing, msg.speed);
      break;
    }
    case "close":
      window.close();
      break;
  }
}

function connect(): void {
  let next: chrome.runtime.Port;
  try {
    next = chrome.tabs.connect(tabId, { name: DETACHED_PORT });
  } catch {
    setTimeout(connect, RECONNECT_MS);
    return;
  }
  port = next;
  next.onMessage.addListener((msg: ToDetached) => {
    if (msg.type === "arrangement") shell.setStatus("synced with the Songsterr tab");
    onMessage(msg);
  });
  next.onDisconnect.addListener(() => {
    void chrome.runtime.lastError;
    if (port === next) port = null;
    shell.setPlayback(shell.clock.nowMs(), false, 1);
    shell.setStatus("waiting for the Songsterr tab…");
    setTimeout(connect, RECONNECT_MS);
  });
}

const toggleFullscreen = () => {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen();
};
fullBtn.addEventListener("click", toggleFullscreen);
shell.stage.addEventListener("dblclick", toggleFullscreen);
document.addEventListener("fullscreenchange", layout);
window.addEventListener("resize", layout);
new ResizeObserver(layout).observe(shell.toolbar);

layout();
if (Number.isFinite(tabId)) connect();
else shell.setStatus("missing Songsterr tab id");
