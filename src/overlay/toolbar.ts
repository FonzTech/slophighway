import { cameraDistanceOptions, chordShapeOptions, nextChordsOptions, qualityOptions } from "./host3d";

export type ShellMode = "attached" | "detached";

const VERSION = "0.6.2";

/** The single toolbar + stage markup used by both the in-page overlay and the detached window. */
export function panelHtml(mode: ShellMode): string {
  const attached = mode === "attached";
  return `
    <div class="shh-panel">
      <div class="shh-toolbar">
        <div class="shh-brand">Slophighway v${VERSION}</div>
        ${attached ? `<span class="shh-sync"></span>` : ""}
        <span class="shh-status"></span>
        <button type="button" class="shh-btn shh-options-toggle" title="Show or hide the toolbar options"></button>
        <div class="shh-options">
        <select class="shh-select shh-arrangement" aria-label="Arrangement" title="Switch tracks with keys 1–9"></select>
        <select class="shh-select shh-view" aria-label="View">
          <option value="3d">3D</option>
          <option value="2d">2D (light)</option>
        </select>
        <select class="shh-select shh-quality" aria-label="Quality" title="Lower quality renders fewer pixels and caps the frame rate at 60">
          ${qualityOptions()}
        </select>
        <select class="shh-select shh-touch" aria-label="Touch controls" title="Enable on-screen touch controls">
          <option value="yes">Touch controls: yes</option>
          <option value="no">Touch controls: no</option>
        </select>
        <select class="shh-select shh-chord-shape" aria-label="Chord shape size" title="Size of the chord shape diagram at the top left">
          ${chordShapeOptions()}
        </select>
        <select class="shh-select shh-next-chords" aria-label="Number of next chords" title="How many upcoming chords to list under the chord shape diagram">
          ${nextChordsOptions()}
        </select>
        <select class="shh-select shh-camera-distance" aria-label="Camera distance" title="How far the 3D camera sits from the fretboard">
          ${cameraDistanceOptions()}
        </select>
        <button type="button" class="shh-btn shh-std" title="Re-fret every track for E standard tuning"></button>
        ${
          attached
            ? `<select class="shh-select shh-dock" aria-label="Position">
          <option value="top">Dock top</option>
          <option value="bottom">Dock bottom</option>
          <option value="float">Floating</option>
        </select>
        <button type="button" class="shh-btn shh-detach" title="Open the highway in its own window (second monitor, full screen)">Detach</button>
        <button type="button" class="shh-btn shh-bg" title="Toggle the highway background"></button>
        <button type="button" class="shh-btn shh-max" title="Full screen highway">Full</button>
        <button type="button" class="shh-btn shh-collapse" title="Hide the highway">Hide</button>`
            : `<button type="button" class="shh-btn shh-full" title="Full screen (or double-click the highway)">Full screen</button>`
        }
        </div>
      </div>
      <div class="shh-stage"></div>
      ${attached ? `<div class="shh-resize" title="Drag to resize"></div>` : ""}
    </div>
  `;
}
