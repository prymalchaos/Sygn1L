// ./js/main.js
import { createSaves } from "./saves.js";
import { recompute as econRecompute } from "./economy.js";
import { createPhaseManager } from "./phaseManager.js";

(() => {
  const $ = (id) => document.getElementById(id);

  /* =======================
     ERROR / SAFETY
  ======================= */
  function showFatal(msg) {
    console.error(msg);
    const host = $("popHost");
    if (!host) return;
    const box = document.createElement("div");
    box.className = "pop";
    box.innerHTML = `<div class="who">SYS</div><div class="msg">JS ERROR: ${String(msg).replaceAll("<","&lt;")}</div><div class="hint">Tap to close</div>`;
    box.onclick = () => box.remove();
    host.prepend(box);
  }
  window.addEventListener("error", (e) => showFatal(e?.message || e));
  window.addEventListener("unhandledrejection", (e) => showFatal(e?.reason || e));

  document.addEventListener("dblclick", (e) => {
    if (e.target?.closest("button")) e.preventDefault();
  }, { passive: false });

  /* =======================
     CONSTANTS
  ======================= */
  const OFFLINE_CAP_SEC = 6 * 60 * 60;
  const ACTIVE_WINDOW_MS = 20_000;

  const DEV_MASTER_UID = "7ac61fd5-1d8a-4c27-95b9-a491f2121380";
  const DEV_MASTER_EMAIL = "cursingstone@gmail.com";

  /* =======================
     ACTIVITY
  ======================= */
  let lastActionAt = 0;
  const markActive = () => lastActionAt = Date.now();
  window.addEventListener("pointerdown", markActive, { passive: true });
  window.addEventListener("keydown", markActive, { passive: true });
  const isActive = () => Date.now() - lastActionAt <= ACTIVE_WINDOW_MS;

  /* =======================
     STATE
  ======================= */
  const state = {
    profile: { name: "GUEST" },
    build: 1,
    relics: 0,
    signal: 0,
    total: 0,
    corruption: 0,
    phase: 1,
    aiOn: true,
    lastAmbientAt: 0,
    lastAiAt: 0,
    up: { dish:0, scan:0, probes:0, auto:0, stabil:0, relicAmp:0 },
    updatedAtMs: Date.now()
  };

  const derived = { sps:0, click:1, bw:1, autoRate:0 };
  const touch = () => state.updatedAtMs = Date.now();

  /* =======================
     SAVES
  ======================= */
  const saves = createSaves();

  function loadIntoState(blob) {
    if (!blob || typeof blob !== "object") return;
    Object.assign(state, blob);
    state.profile.name = (state.profile?.name || "GUEST").toUpperCase().slice(0,18);
  }

  async function saveNow(force=false) {
    touch();
    saves.saveLocal(state);
    if (saves.isSignedIn()) {
      await saves.saveCloud(state, { force });
      $("syncChip").textContent = "SYNC: CLOUD";
    } else {
      $("syncChip").textContent = "SYNC: GUEST";
    }
  }

  /* =======================
     UI HELPERS
  ======================= */
  const fmt = (n)=> n<1000?Math.floor(n):n.toExponential(2);
  function pushLog(id, tag, msg) {
    const h=$(id); if(!h)return;
    const p=document.createElement("p");
    p.innerHTML=`<span class="tag">${tag}</span>${msg}`;
    h.prepend(p);
  }

  /* =======================
     PHASE MANAGER (ISSUE 5)
  ======================= */
  const phaseMgr = createPhaseManager({
    ui: {
      applyPhaseUI: (n) => {
        document.documentElement.dataset.phase = String(n);
        $("phase").textContent = `PHASE ${n}`;
      }
    },
    pushLog
  });

  /* =======================
     OFFLINE
  ======================= */
  function applyOffline() {
    const dt = Math.min(OFFLINE_CAP_SEC, (Date.now()-state.updatedAtMs)/1000);
    if (dt < 3) return;
    econRecompute(state, derived);
    const g = derived.sps * dt;
    state.signal += g;
    state.total += g;
    pushLog("log","SYS",`OFFLINE RECOVERY +${fmt(g)}`);
  }

  /* =======================
     MAIN LOOP
  ======================= */
  let last = performance.now();
  function loop(t) {
    const dt = Math.min(0.05, (t-last)/1000);
    last = t;

    econRecompute(state, derived);

    state.signal += derived.sps * dt;
    state.total  += derived.sps * dt;

    phaseMgr.checkFromTotal(state);

    requestAnimationFrame(loop);
  }

  /* =======================
     BOOT
  ======================= */
  const local = saves.loadLocal();
  if (local) loadIntoState(local);

  applyOffline();
  phaseMgr.enterPhase(state, state.phase, { silent:true });

  saves.initAuth(()=>{}).then(()=>{
    requestAnimationFrame(loop);
  });
})();