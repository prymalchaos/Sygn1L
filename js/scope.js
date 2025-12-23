// /js/scope.js
// Self-contained canvas visualiser (noise -> spikes as lock improves).
// No Supabase. No saves. Safe to disable if needed.

import { clamp } from "./state.js";

export function createScope(canvasEl, labelEl) {
  if (!canvasEl) throw new Error("Scope canvas missing");

  const ctx = canvasEl.getContext("2d", { alpha: false });
  let sw = 0,
    sh = 0,
    dpr = 1;

  const sig = { cols: [], vel: [], phase: 0 };
// ✅ ping impulse state (brief sine-burst)
let pingT = 0;     // seconds since last ping
let pingA = 0;     // amplitude 0..1
let pingF = 2.2;   // frequency Hz
let pingDur = 1.6; // duration seconds

function ping(strength = 1, freqHz = 2.2, durationSec = 1.6) {
  pingT = 0;
  pingA = Math.max(0, Math.min(1, strength));
  pingF = freqHz;
  pingDur = Math.max(0.2, durationSec);
}


  
  
  function resize() {
    dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const cssW = canvasEl.clientWidth || 300;
    const cssH = 84;

    canvasEl.style.height = cssH + "px";
    canvasEl.width = Math.floor(cssW * dpr);
    canvasEl.height = Math.floor(cssH * dpr);

    sw = canvasEl.width;
    sh = canvasEl.height;

    const cols = Math.max(120, Math.floor(sw / (2 * dpr)));
    sig.cols = new Array(cols).fill(0);
    sig.vel = new Array(cols).fill(0);
    sig.phase = 0;
  }

  // iOS/Safari sometimes restores pages from bfcache where canvas dimensions
  // come back as 0 until a paint. Re-resize on pageshow/visibility.
  function nudgeResizeSoon() {
    // next frame tends to have correct layout metrics
    requestAnimationFrame(() => {
      try { resize(); } catch {}
    });
  }

  // small deterministic hash noise
  function rand01(seed) {
    seed = (seed ^ 0x6d2b79f5) >>> 0;
    seed = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    seed ^= seed + Math.imul(seed ^ (seed >>> 7), 61 | seed);
    return ((seed ^ (seed >>> 14)) >>> 0) / 4294967296;
  }

  // lock is a “how coherent is the signal” value 0..1
  // caller passes derived values in tick()
  function computeLock(total, bw, corruption) {
    const a = clamp(Math.log10((total || 0) + 1) / 5, 0, 1);
    const b = clamp(((bw || 1) - 1) / 3, 0, 1);
    const raw = 0.6 * a + 0.4 * b;
    return clamp(raw * (1 - 0.55 * (corruption || 0)), 0, 1);
  }

  function updateLabel(lock) {
    if (!labelEl) return;
    labelEl.textContent = "LOCK: " + Math.round(lock * 100) + "%";
  }

  // main draw
  function draw(dt, tMs, total, bw, corruption) {
    if (!sw || !sh) return;

    const lk = computeLock(total, bw, corruption);
    updateLabel(lk);

    const corr = clamp(corruption || 0, 0, 1);

    ctx.fillStyle = "rgb(0,0,0)";
    ctx.fillRect(0, 0, sw, sh);

    const noiseAmt = clamp(0.85 - 0.7 * lk + 0.35 * corr, 0.15, 0.95);
    const spikeProb = clamp(0.05 + 0.35 * lk, 0.05, 0.7);

    const cols = sig.cols.length;
    sig.phase += dt * (0.6 + 1.8 * lk) * (1 + 0.8 * corr);

    for (let i = 0; i < cols; i++) {
      const base = Math.sin(sig.phase + i * 0.07) * 0.25;
      const chaos = (rand01(((tMs | 0) + i * 9973) | 0) - 0.5) * (0.45 + 0.9 * corr);
      const target = base + chaos;

      const stiffness = 0.08 + 0.22 * lk;
      const damping = 0.82 - 0.35 * corr;

      sig.vel[i] = sig.vel[i] * damping + (target - sig.cols[i]) * stiffness;
      sig.cols[i] += sig.vel[i];
    }

    const midY = Math.floor(sh * 0.6);
    const px = Math.max(1, Math.floor(dpr));
    const baseG = 190;

    // background “CRT noise”
    for (let y = 0; y < sh; y += px) {
      const lineFade = 0.72 + 0.28 * Math.sin((y / sh) * Math.PI);
      for (let x = 0; x < sw; x += px) {
        const n = rand01(((x * 131 + y * 977 + (tMs | 0)) | 0) >>> 0);
        if (n < noiseAmt) {
          const v = Math.floor((baseG + 55 * n) * lineFade);
          ctx.fillStyle = `rgb(0,${v},0)`;
          ctx.fillRect(x, y, px, px);
        }
      }
    }

    // ping envelope (0..1), decays quickly
    let pingEnv = 0;
    if (pingA > 0) {
      const k = clamp(pingT / pingDur, 0, 1); // 0..1
      pingEnv = pingA * Math.exp(-5 * k);
    }

    // waveform line
    ctx.lineWidth = Math.max(1, 1 * dpr);
    ctx.strokeStyle = "rgba(60,255,120,0.85)";
    ctx.beginPath();

    for (let i = 0; i < cols; i++) {
      const x = Math.floor((i / (cols - 1)) * (sw - 1));
      const s = sig.cols[i];
      const spike = rand01(((tMs | 0) + i * 71) | 0) < spikeProb ? 1 : 0;

      const spikeH = spike * (0.15 + 0.85 * lk) * (0.75 + 0.25 * Math.abs(s));
      const noiseH = (s * (0.35 + 0.65 * (1 - lk))) * 0.35;
      const echo = corr > 0.28 ? (0.1 + 0.35 * corr) * Math.sin(sig.phase * 2 + i * 0.12) : 0;

      // ✅ sonar ping burst term (brief sine that “travels” across the line)
      // phase is the horizontal phase, travel shifts over time
      const phase = (i / (cols - 1)) * Math.PI * 2;
      const travel = (pingT / Math.max(0.001, pingDur)) * Math.PI * 6;
      const pingTerm = pingEnv > 0 ? pingEnv * Math.sin(phase * pingF + travel) : 0;

      const y = midY - (spikeH + noiseH + echo + pingTerm) * (sh * 0.7);

      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // subtle border
    ctx.strokeStyle = "rgba(60,255,120,0.18)";
    ctx.lineWidth = Math.max(1, 1 * dpr);
    ctx.strokeRect(
      Math.floor(0.5 * dpr),
      Math.floor(0.5 * dpr),
      sw - Math.floor(1 * dpr),
      sh - Math.floor(1 * dpr)
    );
  }

  // public tick API
  function tick(dt, tMs, { total, bw, corruption }) {
    // If layout changed (or page restored), make sure the canvas is correctly sized.
    if (!sw || !sh || canvasEl.width === 0 || canvasEl.height === 0) {
      try { resize(); } catch {}
    }

    // --- advance ping clock / auto-clear
    if (pingA > 0) {
      pingT += dt;
      if (pingT >= pingDur) {
        pingA = 0;
      }
    }

    draw(dt, tMs, total, bw, corruption);
  }

  // init
  resize();
  window.addEventListener("resize", resize, { passive: true });

  window.addEventListener("pageshow", nudgeResizeSoon, { passive: true });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) nudgeResizeSoon();
  }, { passive: true });

return { resize, tick, ping };
}