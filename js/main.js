// ./js/main.js
import { createSaves } from "./saves.js";

(() => {
  const $ = (id) => document.getElementById(id);

  // --------- Mobile-friendly error catcher (shows crashes on-screen) ---------
  function showFatal(msg) {
    console.error(msg);
    const host = document.getElementById("popHost");
    if (host) {
      const box = document.createElement("div");
      box.className = "pop";
      box.innerHTML = `<div class="who">SYS</div><div class="msg">JS ERROR: ${String(msg).replaceAll("<","&lt;")}</div><div class="hint">Tap to close</div>`;
      box.addEventListener("click", () => box.remove());
      host.prepend(box);
    }
  }
  window.addEventListener("error", (e) => showFatal(e?.message || e));
  window.addEventListener("unhandledrejection", (e) => showFatal(e?.reason?.message || e?.reason || e));

  // Prevent iOS double-tap zoom on buttons
  document.addEventListener("dblclick", (e) => {
    if (e.target && e.target.closest("button")) e.preventDefault();
  }, { passive: false });

  // ----------------------------
  // Tunables
  // ----------------------------
  const OFFLINE_CAP_SEC = 6 * 60 * 60;      // 6 hours max offline gain
  const ACTIVE_WINDOW_MS = 20_000;          // active if interacted in last 20s
  const AMBIENT_EVERY_MS = 300_000;         // 5 minutes
  const EDGE_FUNCTION = "sygn1l-comms";     // Supabase Edge Function name

  // ----------------------------
  // DEV MODE (Master Admin)
  // - Set ONE of these to your own account.
  // - Leave both as-is to disable dev mode entirely.
  // ----------------------------
  const DEV_MASTER_UID = "7ac61fd5-1d8a-4c27-95b9-a491f2121380";     // e.g. "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
  const DEV_MASTER_EMAIL = "cursingstone@gmail.com";   // e.g. "you@domain.com"

  // ----------------------------
  // Activity gating
  // ----------------------------
  let lastActionAt = 0;
  const markActive = () => (lastActionAt = Date.now());
  window.addEventListener("pointerdown", markActive, { passive: true });
  window.addEventListener("keydown", markActive, { passive: true });
  const isActive = () => (Date.now() - lastActionAt) <= ACTIVE_WINDOW_MS;

  // ----------------------------
  // Feedback (haptic/click)
  // ----------------------------
  let feedbackOn = true;
  let audioCtx = null;

  function haptic(ms = 10) {
    if (!feedbackOn) return false;
    if (navigator.vibrate) { navigator.vibrate([ms]); return true; }
    return false;
  }
  function clickSound() {
    if (!feedbackOn) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const ctx = audioCtx;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "square";
      o.frequency.value = 820;
      g.gain.value = 0.00001;
      o.connect(g); g.connect(ctx.destination);
      o.start();
      const t = ctx.currentTime;
      g.gain.setValueAtTime(0.00001, t);
      g.gain.exponentialRampToValueAtTime(0.022, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.00001, t + 0.050);
      o.stop(t + 0.055);
    } catch {}
  }
  function feedback(strong = false) {
    const ok = strong ? haptic(18) : haptic(10);
    if (!ok) clickSound();
  }

  // ----------------------------
  // Utils
  // ----------------------------
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const nowMs = () => Date.now();
  const esc = (s) => String(s)
    .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
    // PATCH: fix quote escaping (was "quot;" which breaks HTML entities)
    .replaceAll('"',"&quot;").replaceAll("'","&#039;");

  function fmt(n) {
    n = Number(n) || 0;
    if (n < 1000) return n.toFixed(0);
    const u = ["K","M","B","T"];
    let i = -1;
    while (n >= 1000 && i < u.length - 1) { n /= 1000; i++; }
    return n.toFixed(n < 10 ? 2 : n < 100 ? 1 : 0) + u[i];
  }

  function pushLog(elId, tag, msg) {
    const host = $(elId);
    if (!host) return;
    const p = document.createElement("p");
    p.innerHTML = `<span class="tag">${String(tag).replaceAll("<","&lt;")}</span>${msg}`;
    host.prepend(p);
  }

  function popup(who, msg) {
    const host = $("popHost");
    if (!host) return;
    const box = document.createElement("div");
    box.className = "pop";
    box.innerHTML = `<div class="who">${String(who).replaceAll("<","&lt;")}</div><div class="msg">${String(msg).replaceAll("<","&lt;")}</div><div class="hint">TAP TO CLOSE</div>`;
    box.addEventListener("click", () => box.remove());
    host.prepend(box);
  }

  // ----------------------------
  // Modal
  // ----------------------------
  function openModal(title, html) {
    $("modalTitle").textContent = title;
    $("modalBody").innerHTML = html;
    $("modalBack").style.display = "flex";
    $("modalBack").setAttribute("aria-hidden","false");
  }
  function closeModal() {
    $("modalBack").style.display = "none";
    $("modalBack").setAttribute("aria-hidden","true");
    $("modalBody").innerHTML = "";
  }
  $("modalClose").onclick = closeModal;
  $("modalBack").addEventListener("click", (e) => {
    if (e.target === $("modalBack")) closeModal();
  });

  // ----------------------------
  // State
  // ----------------------------
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
    up: { dish: 0, scan: 0, probes: 0, auto: 0, stabil: 0, relicAmp: 0 },
    updatedAtMs: 0
  };

  const derived = { sps: 0, click: 1, bw: 1, autoRate: 0 };
  const touch = () => (state.updatedAtMs = nowMs());

  // ----------------------------
  // 6 Phases with tint
  // ----------------------------
  const PHASES = [
    { n:1, at:0,     tint:"--p0", status:"ARRAY: STABLE", sub:"THE ARRAY LISTENS. YOU PING.", obj:"Tap PING VOID. Buy DISH." },
    { n:2, at:500,   tint:"--p1", status:"ARRAY: DRIFT",  sub:"Structure forming. Keep it clean.", obj:"Buy SCAN. Reach 120 total for PROBES." },
    { n:3, at:1800,  tint:"--p2", status:"ARRAY: ACTIVE", sub:"It’s answering. Don’t answer back.", obj:"Unlock AUTO. Boost Signal/sec." },
    { n:4, at:9000,  tint:"--p3", status:"ARRAY: GLITCH", sub:"Containment stutters. Stabilize.", obj:"Buy STABIL. Keep corruption down." },
    { n:5, at:12000, tint:"--p4", status:"ARRAY: RITUAL", sub:"We can reset the Array and keep residue.", obj:"RITE available. Time it." },
    { n:6, at:35000, tint:"--p5", status:"ARRAY: BREACH", sub:"Something is using our signal to arrive.", obj:"Push relic scaling. Corruption bites back." },
  ];

  function setPhase(n) {
    state.phase = clamp(n, 1, 6);
    const ph = PHASES[state.phase - 1];
    document.documentElement.style.setProperty("--accent", `var(${ph.tint})`);
    $("phase").textContent = `PHASE ${state.phase}`;
    $("status").textContent = ph.status;
    $("subtitle").textContent = ph.sub;
    $("objective").textContent = "OBJECTIVE: " + ph.obj;
    $("phaseTint").textContent = "P" + state.phase;
  }

  function phaseCheck() {
    for (let i = PHASES.length - 1; i >= 0; i--) {
      if (state.total >= PHASES[i].at) {
        if (state.phase !== PHASES[i].n) {
          setPhase(PHASES[i].n);
          pushLog("log", "SYS", `PHASE ${state.phase} ENGAGED.`);
        }
        break;
      }
    }
  }

  // ----------------------------
  // Upgrades
  // ----------------------------
  const UPG = [
    { id:"dish",   name:"DISH CALIBRATION", unlock:0,    base:10,   mult:1.18, desc:"+1 Signal/sec.",     buy(){ state.up.dish++; } },
    { id:"scan",   name:"DEEP SCAN",        unlock:100,  base:50,   mult:1.25, desc:"+10% bandwidth.",    buy(){ state.up.scan++; } },
    { id:"probes", name:"PROBE SWARM",      unlock:120,  base:80,   mult:1.22, desc:"+1 click power.",    buy(){ state.up.probes++; } },
    { id:"auto",   name:"AUTO ROUTINE",     unlock:600,  base:520,  mult:1.30, desc:"Auto pings/sec.",    buy(){ state.up.auto++; } },
    { id:"stabil", name:"STABILIZER",       unlock:9500, base:7200, mult:1.33, desc:"Slows corruption.",  buy(){ state.up.stabil++; } },
    { id:"relicAmp", name:"RELIC AMP", unlock:0, base:3, mult:1.65, currency:"relics",
      desc:"Spend relics: +8% mult.", buy(){ state.up.relicAmp++; } },
  ];

  const lvl = (id) => state.up[id] || 0;
  const cost = (u) => Math.floor(u.base * Math.pow(u.mult, lvl(u.id)));

  function recompute() {
    derived.click = 1 + lvl("probes");
    derived.bw = Math.pow(1.10, lvl("scan")) * (1 + 0.08 * lvl("relicAmp"));
    derived.sps = (lvl("dish") * 1.0) * derived.bw;
    derived.autoRate = lvl("auto") > 0 ? (lvl("auto") * 0.65 * (1 + 0.15 * lvl("probes"))) : 0;
  }

  function corruptionLabel(c) {
    if (c < 0.10) return "DORMANT";
    if (c < 0.30) return "WHISPER";
    if (c < 0.60) return "INCIDENT";
    if (c < 0.85) return "BREACH";
    return "OVERRUN";
  }

  function corruptionCreep(dt) {
    const creep = 0.0000025 * Math.log10(state.total + 10);
    const tech = (lvl("scan") + lvl("auto")) * 0.0000012;
    const stabil = clamp(1 - 0.06 * lvl("stabil"), 0.25, 1.0);
    state.corruption = clamp(state.corruption + (creep + tech) * stabil * dt, 0, 1);
  }

  // ----------------------------
  // Rite
  // ----------------------------
  function prestigeGain() {
    const over = Math.max(0, state.total - 12000);
    return 1 + Math.floor(Math.sqrt(over / 6000));
  }
  const canRite = () => state.total >= 12000;

  function doRite() {
    const gain = prestigeGain();
    state.relics += gain;
    state.build += 1;

    pushLog("log","SYS",`RITE COMPLETE. +${gain} RELICS.`);
    pushLog("comms","OPS",`We keep the residue. We pretend it’s control.`);

    state.signal = 0;
    state.total = 0;
    state.corruption = Math.max(0, state.corruption * 0.25);
    state.phase = 1;

    const keep = lvl("relicAmp");
    for (const k in state.up) state.up[k] = 0;
    state.up.relicAmp = keep;

    touch();
    recompute();
    setPhase(1);
  }

  // ----------------------------
  // Saves/Accounts
  // ----------------------------
  const saves = createSaves();

  function loadIntoState(blob) {
    if (!blob || typeof blob !== "object") return;
    state.profile = Object.assign(state.profile, blob.profile || {});
    state.up = Object.assign(state.up, blob.up || {});
    for (const k of ["build","relics","signal","total","corruption","phase","aiOn","lastAmbientAt","lastAiAt","updatedAtMs"]) {
      if (k in blob) state[k] = blob[k];
    }
    state.profile.name = (state.profile.name || "GUEST").toUpperCase().slice(0, 18);
  }

  async function saveNow(forceCloud = false) {
    touch();
    saves.saveLocal(state);
    if (saves.isSignedIn()) {
      await saves.saveCloud(state, { force: forceCloud });
      $("syncChip").textContent = "SYNC: CLOUD";
    } else {
      $("syncChip").textContent = "SYNC: GUEST";
    }
  }

  // ----------------------------
  // OFFLINE EARNINGS (one-time report on boot)
  // ----------------------------
  function applyOfflineEarnings() {
    const last = state.updatedAtMs || 0;
    if (!last) return;

    let dt = (nowMs() - last) / 1000;
    if (!isFinite(dt) || dt < 3) return;
    dt = Math.min(dt, OFFLINE_CAP_SEC);

    recompute();
    const gain = derived.sps * dt;
    if (gain <= 0) return;

    state.signal += gain;
    state.total += gain;

    const mins = Math.max(1, Math.floor(dt / 60));
    popup("CONTROL", `While you were gone: +${fmt(gain)} Signal recovered (${mins}m).`);
    pushLog("log", "SYS", `OFFLINE RECOVERY: +${fmt(gain)} SIGNAL (${mins}m).`);

    touch();
  }

  // ----------------------------
  // Phase 0 Onboarding (auto-injected card)
  // ----------------------------
  const ONBOARD_KEY = "sygn1l_onboarded_v1";

  function injectOnboardCard() {
    if (document.getElementById("onboardCard")) return;
    const wrap = document.querySelector(".wrap");
    if (!wrap) return;

    const card = document.createElement("section");
    card.className = "card";
    card.id = "onboardCard";
    card.innerHTML = `
      <div class="hd">
        <div>CONTROL TRANSMISSION</div>
        <div class="muted" id="onboardStep">STEP 1/4</div>
      </div>
      <div class="pad">
        <div class="muted" id="onboardText"></div>
        <div style="height:12px"></div>
        <div class="grid2">
          <button id="onboardNext">NEXT</button>
          <button id="onboardSkip">SKIP</button>
        </div>
      </div>
    `;
    wrap.prepend(card);
  }

  function shouldShowOnboard() {
    if (localStorage.getItem(ONBOARD_KEY)) return false;
    if (saves.isSignedIn()) return false;

    const local = saves.loadLocal?.();
    const hasMeaningful = local && (Number(local.total) > 50 || Number(local.signal) > 50);
    return !hasMeaningful;
  }

  // PATCH: helper to force username prompt (used by onboarding + sign-in)
  function forceUsernamePrompt(from = "CONTROL") {
    popup(from, "Callsign required. Tap USER to register.");
    try { $("userChip")?.click?.(); } catch {}
  }

  function showOnboard() {
    injectOnboardCard();
    const card = $("onboardCard");
    if (!card) return;

    const script = [
      `CONTROL: Ice Station Relay is live. Welcome, Operative <b>${esc(state.profile.name || "GUEST")}</b>.<br><br>Before Array contact, we need your credentials.`,
      `Enter your <b>EMAIL</b> in the ACCOUNT panel.<br>It binds your work to the cloud archive.`,
      `Set a <b>PASSWORD</b>.<br>Short is fine. Forgotten is fatal.`,
      `Tap <b>USER: …</b> and set your <b>USERNAME</b>.<br>Control prefers callsigns. The void prefers patterns.`
    ];

    let i = 0;
    const setStep = () => {
      $("onboardStep").textContent = `STEP ${i + 1}/${script.length}`;
      $("onboardText").innerHTML = script[i];
      if (i === 1) $("email")?.scrollIntoView?.({ behavior: "smooth", block: "center" });
      if (i === 2) $("pass")?.scrollIntoView?.({ behavior: "smooth", block: "center" });
    };

    card.style.display = "";
    setStep();

    $("onboardNext").onclick = () => {
      feedback(false);

      // PATCH: on final step, do NOT allow completion unless username is set
      if (i === script.length - 1) {
        if ((state.profile.name || "GUEST").toUpperCase() === "GUEST") {
          forceUsernamePrompt("CONTROL");
          return;
        }
        card.style.display = "none";
        localStorage.setItem(ONBOARD_KEY, "1");
        popup("CONTROL", "Clearance granted. Proceed carefully.");
        return;
      }

      i++;
      setStep();
    };

    $("onboardSkip").onclick = () => {
      feedback(false);
      card.style.display = "none";
      localStorage.setItem(ONBOARD_KEY, "1");
    };
  }

  function updateOnboardVisibility() {
    if (saves.isSignedIn()) {
      localStorage.setItem(ONBOARD_KEY, "1");
      const card = $("onboardCard");
      if (card) card.style.display = "none";
      return;
    }
    if (shouldShowOnboard()) showOnboard();
  }

  // ----------------------------
  // DEV MODE (Master Admin) - inject phase jumper panel
  // ----------------------------
  async function checkDevAndMaybeInject() {
    try {
      // Hard-off unless configured
      const hasConfig = (DEV_MASTER_UID && DEV_MASTER_UID.trim()) || (DEV_MASTER_EMAIL && DEV_MASTER_EMAIL.trim());
      if (!hasConfig) return;

      if (!saves?.supabase || !saves.isSignedIn()) return;

      const { data } = await saves.supabase.auth.getUser();
      const u = data?.user;
      if (!u) return;

      const okUid = DEV_MASTER_UID && DEV_MASTER_UID.trim() && u.id === DEV_MASTER_UID.trim();
      const okEmail = DEV_MASTER_EMAIL && DEV_MASTER_EMAIL.trim() &&
        String(u.email || "").toLowerCase() === DEV_MASTER_EMAIL.trim().toLowerCase();

      if (!okUid && !okEmail) return;

      injectDevPanel();
    } catch {}
  }

  function removeDevPanel() {
    const el = document.getElementById("devPanel");
    if (el) el.remove();
  }

  // DEV: phase snapshots for realistic playtesting
  const PHASE_SNAPSHOTS = {
    1: {
      phase: 1,
      total: 80,
      signal: 40,
      corruption: 0.02,
      build: 1,
      relics: 0,
      up: { dish: 2, scan: 0, probes: 0, auto: 0, stabil: 0, relicAmp: 0 }
    },
    2: {
      phase: 2,
      total: 720,   // between 500 and 1799
      signal: 220,
      corruption: 0.08,
      build: 1,
      relics: 0,
      up: { dish: 7, scan: 2, probes: 1, auto: 0, stabil: 0, relicAmp: 0 }
    },
    3: {
      phase: 3,
      total: 2400,  // between 1800 and 8999
      signal: 650,
      corruption: 0.18,
      build: 1,
      relics: 0,
      up: { dish: 13, scan: 4, probes: 2, auto: 2, stabil: 0, relicAmp: 0 }
    },
    4: {
      phase: 4,
      total: 10_200, // between 9000 and 11999
      signal: 1500,
      corruption: 0.42,
      build: 1,
      relics: 0,
      up: { dish: 26, scan: 8, probes: 4, auto: 5, stabil: 1, relicAmp: 0 }
    },
    5: {
      phase: 5,
      total: 13_400, // between 12000 and 34999
      signal: 2800,
      corruption: 0.55,
      build: 1,
      relics: 3,
      up: { dish: 32, scan: 10, probes: 5, auto: 7, stabil: 2, relicAmp: 1 }
    },
    6: {
      phase: 6,
      total: 42_000, // 35000+
      signal: 8200,
      corruption: 0.78,
      build: 2,
      relics: 12,
      up: { dish: 60, scan: 14, probes: 8, auto: 14, stabil: 4, relicAmp: 3 }
    }
  };

  async function applyPhaseSnapshot(ph) {
    const snap = PHASE_SNAPSHOTS[clamp(Number(ph) || 1, 1, 6)];
    if (!snap) return;

    // Keep identity (username) as-is
    const keepName = (state.profile?.name || "GUEST").toUpperCase().slice(0, 18);

    // Apply snapshot state
    state.build = snap.build;
    state.relics = snap.relics;
    state.signal = snap.signal;
    state.total = snap.total;
    state.corruption = snap.corruption;
    state.phase = snap.phase;

    // Reset upgrades exactly to snapshot
    state.up = {
      dish: snap.up.dish || 0,
      scan: snap.up.scan || 0,
      probes: snap.up.probes || 0,
      auto: snap.up.auto || 0,
      stabil: snap.up.stabil || 0,
      relicAmp: snap.up.relicAmp || 0
    };

    // Cooldowns/ambient timing: reset so testing feels fresh
    state.lastAmbientAt = 0;
    state.lastAiAt = 0;

    state.profile.name = keepName;

    touch();
    recompute();
    setPhase(state.phase);
    renderAll();

    // Persist
    saves.saveLocal(state);
    if (saves.isSignedIn()) {
      try { await saves.saveCloud(state, { force: true }); } catch {}
    }
  }

  function injectDevPanel() {
    if (document.getElementById("devPanel")) return;

    const wrap = document.querySelector(".wrap");
    if (!wrap) return;

    const card = document.createElement("section");
    card.className = "card";
    card.id = "devPanel";
    card.innerHTML = `
      <div class="hd">
        <div>DEV CONSOLE</div>
        <div class="muted">MASTER ACCESS</div>
      </div>
      <div class="pad">
        <div class="muted" style="margin-bottom:10px">Phase snapshot load (testing only)</div>

        <div class="grid2" style="grid-template-columns: repeat(3, 1fr);">
          <button data-ph="1">P1</button>
          <button data-ph="2">P2</button>
          <button data-ph="3">P3</button>
          <button data-ph="4">P4</button>
          <button data-ph="5">P5</button>
          <button data-ph="6">P6</button>
        </div>

        <div style="height:10px"></div>

        <div class="grid2">
          <button id="devAddSignal">+10K SIGNAL</button>
          <button id="devClearCorr">CLEAR CORRUPTION</button>
        </div>

        <div style="height:10px"></div>

        <div class="grid2">
          <button id="devAddRelics">+10 RELICS</button>
          <button id="devHide">HIDE DEV</button>
        </div>
      </div>
    `;
    wrap.prepend(card);

    // Phase snapshot load
    card.querySelectorAll("button[data-ph]").forEach((btn) => {
      btn.onclick = async () => {
        markActive();
        feedback(false);

        const ph = Number(btn.getAttribute("data-ph")) || 1;
        await applyPhaseSnapshot(ph);

        popup("SYS", `DEV: PHASE ${clamp(ph,1,6)} SNAPSHOT LOADED`);
        pushLog("log", "SYS", `DEV SNAPSHOT: PHASE ${clamp(ph,1,6)} LOADED.`);
      };
    });

    // Cheats
    $("devAddSignal").onclick = async () => {
      markActive();
      feedback(false);
      state.signal += 10_000;
      state.total += 10_000;
      touch();
      recompute();
      renderAll();
      saves.saveLocal(state);
      if (saves.isSignedIn()) saves.saveCloud(state, { force: true }).catch(() => {});
      popup("SYS", "DEV: +10K SIGNAL");
    };

    $("devClearCorr").onclick = async () => {
      markActive();
      feedback(false);
      state.corruption = 0;
      touch();
      renderAll();
      saves.saveLocal(state);
      if (saves.isSignedIn()) saves.saveCloud(state, { force: true }).catch(() => {});
      popup("SYS", "DEV: CORRUPTION CLEARED");
    };

    $("devAddRelics").onclick = async () => {
      markActive();
      feedback(false);
      state.relics += 10;
      touch();
      renderAll();
      saves.saveLocal(state);
      if (saves.isSignedIn()) saves.saveCloud(state, { force: true }).catch(() => {});
      popup("SYS", "DEV: +10 RELICS");
    };

    $("devHide").onclick = () => {
      markActive();
      feedback(false);
      removeDevPanel();
    };
  }

  // ----------------------------
  // AI + Ambient human messages
  // ----------------------------
  function aiReady() {
    if (!state.aiOn) return false;
    if (!saves.isSignedIn()) return false;
    if (!isActive()) return false;
    const cooldown = 180_000;
    if ((nowMs() - (state.lastAiAt || 0)) < cooldown) return false;
    return true;
  }

  async function aiComms(eventName, speakerHint="OPS") {
    if (!aiReady()) return false;

    state.lastAiAt = nowMs();
    saves.saveLocal(state);
    $("aiChip").textContent = "AI: ...";

    try {
      const payload = {
        event: eventName,
        speaker_hint: speakerHint,
        player_name: state.profile.name,
        phase: state.phase,
        build: state.build,
        signal: Math.floor(state.signal),
        total: Math.floor(state.total),
        sps: Math.floor(derived.sps),
        corruption: Number(state.corruption.toFixed(3))
      };

      const { data, error } = await saves.supabase.functions.invoke(EDGE_FUNCTION, { body: payload });
      if (error) throw error;

      const who = data?.who || speakerHint;
      const text = (data?.text || "").trim() || "…";

      popup(who, text);
      pushLog("comms", who, String(text).replaceAll("<","&lt;"));
      $("aiChip").textContent = "AI: READY";
      return true;
    } catch (err) {
      $("aiChip").textContent = "AI: OFF";
      pushLog("log","SYS","AI FAILED: " + String(err?.message || err).replaceAll("<","&lt;"));
      return false;
    }
  }

  const HUMAN_POOL = [
    (n)=>`Hey ${n}, you still with us?`,
    (n)=>`Hold up, ${n}. That spike looked… deliberate.`,
    (n)=>`You’re doing fine, ${n}. Keep the pings steady.`,
    (n)=>`If it starts feeling personal, tell me, ${n}.`,
    (n)=>`Take a breath, ${n}. Then keep scanning.`,
    (n)=>`I hate this part, ${n}. But we need the data.`
  ];

  function maybeAmbient() {
    if (!state.aiOn) return;
    if (!saves.isSignedIn()) return;
    if (!isActive()) return;
    if ((nowMs() - (state.lastAmbientAt || 0)) < AMBIENT_EVERY_MS) return;

    state.lastAmbientAt = nowMs();
    saves.saveLocal(state);

    const msg = HUMAN_POOL[Math.floor(Math.random()*HUMAN_POOL.length)](state.profile.name);
    popup("OPS", msg);
    pushLog("comms", "OPS", String(msg).replaceAll("<","&lt;"));

    if (Math.random() < 0.25) aiComms("ambient", "OPS");
  }

  // ----------------------------
  // UI Render
  // ----------------------------
  function renderHUD() {
    $("signal").textContent = fmt(state.signal);
    $("sps").textContent = fmt(derived.sps);

    $("buildChip").textContent = "BUILD: " + state.build;
    $("relicChip").textContent = "RELICS: " + state.relics;
    $("userChip").textContent = "USER: " + state.profile.name;

    $("corrFill").style.width = (state.corruption * 100).toFixed(1) + "%";
    $("corrText").textContent = (state.corruption * 100).toFixed(1) + "% (" + corruptionLabel(state.corruption) + ")";

    const rite = $("riteBtn");
    const can = canRite();
    rite.disabled = !can;
    rite.textContent = can ? `RITE +${prestigeGain()}` : "RITE";

    $("aiChip").textContent = saves.isSignedIn()
      ? (state.aiOn ? "AI: READY" : "AI: OFF")
      : "AI: OFF";
  }

  function renderUpgrades() {
    const root = $("upgrades");
    root.innerHTML = "";

    for (const u of UPG) {
      if (u.id === "relicAmp" && state.relics <= 0 && lvl("relicAmp") === 0) continue;

      const unlocked = state.total >= u.unlock;
      const price = cost(u);
      const currency = u.currency || "signal";
      const have = currency === "relics" ? state.relics : state.signal;
      const afford = unlocked && have >= price;

      const row = document.createElement("div");
      row.className = "up" + (afford ? " afford" : "") + (!unlocked ? " locked" : "");

      const meta = document.createElement("div");
      meta.className = "meta";
      meta.innerHTML = `
        <div class="name">${String(u.name).replaceAll("<","&lt;")} (LV ${lvl(u.id)})</div>
        <div class="desc">${String(unlocked ? u.desc : \`LOCKED UNTIL ${fmt(u.unlock)} TOTAL.\`).replaceAll("<","&lt;")}</div>
        <div class="cost">${unlocked ? \`COST: ${fmt(price)} ${currency.toUpperCase()}\` : "STATUS: LOCKED"}</div>
      `;

      const btn = document.createElement("button");
      btn.textContent = afford ? "ACQUIRE" : (unlocked ? "LOCKED" : "CLASSIF");
      btn.disabled = !afford;

      btn.onclick = async () => {
        if (!afford) return;
        markActive();
        feedback(false);

        if (currency === "relics") state.relics -= price;
        else state.signal -= price;

        u.buy();
        touch();
        recompute();
        renderAll();

        try { await saveNow(false); } catch {}
        if (Math.random() < 0.18) aiComms("buy_" + u.id, "OPS");
      };

      row.appendChild(meta);
      row.appendChild(btn);
      root.appendChild(row);
    }
  }

  function lockValue() {
    const a = clamp(Math.log10(state.total + 1) / 5, 0, 1);
    const b = clamp((derived.bw - 1) / 3, 0, 1);
    const raw = 0.6 * a + 0.4 * b;
    return clamp(raw * (1 - 0.55 * state.corruption), 0, 1);
  }
  function updateScopeLabel() {
    $("scopeLabel").textContent = "LOCK: " + Math.round(lockValue() * 100) + "%";
  }

  function renderAll() {
    phaseCheck();
    renderHUD();
    renderUpgrades();
    updateScopeLabel();
  }

  // ----------------------------
  // Scope Visualiser (kept lightweight)
  // ----------------------------
  const scope = $("scope");
  const ctx = scope.getContext("2d", { alpha: false });
  let sw = 0, sh = 0, dpr = 1;

  function resizeScope() {
    dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const cssW = scope.clientWidth || 300;
    const cssH = 84;
    scope.style.height = cssH + "px";
    scope.width = Math.floor(cssW * dpr);
    scope.height = Math.floor(cssH * dpr);
    sw = scope.width; sh = scope.height;
  }
  window.addEventListener("resize", resizeScope);

  function drawScope(_dt, t) {
    if (!sw || !sh) return;
    ctx.fillStyle = "rgb(0,0,0)";
    ctx.fillRect(0,0,sw,sh);

    const y = Math.floor((t/12) % sh);
    ctx.fillStyle = "rgba(60,255,120,0.12)";
    ctx.fillRect(0, y, sw, Math.max(1, Math.floor(dpr)));

    ctx.strokeStyle = "rgba(60,255,120,0.75)";
    ctx.lineWidth = Math.max(1, dpr);
    ctx.beginPath();

    const lk = lockValue();
    for (let x=0; x<sw; x+=Math.max(2, Math.floor(dpr*2))) {
      const n = Math.sin((x/45) + (t/500)) * 0.35 + Math.sin((x/19) + (t/900)) * 0.20;
      const amp = (0.25 + 0.75*lk) * (1 - 0.55*state.corruption);
      const yy = Math.floor(sh*0.6 - n * amp * sh*0.38);
      if (x === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
    }
    ctx.stroke();
  }

  // ----------------------------
  // Controls
  // ----------------------------
  $("ping").onclick = async () => {
    markActive();
    feedback(false);

    const g = derived.click * derived.bw * (1 - 0.35 * state.corruption);
    state.signal += g;
    state.total += g;
    state.corruption = clamp(state.corruption + 0.00055, 0, 1);

    touch();
    recompute();
    renderAll();
    try { await saveNow(false); } catch {}

    if (Math.random() < 0.08) aiComms("ping", "OPS");
  };

  $("saveBtn").onclick = async () => {
    markActive();
    feedback(false);
    try { await saveNow(true); } catch {}
    pushLog("log","SYS", saves.isSignedIn() ? "SAVED (CLOUD)." : "SAVED (GUEST).");
  };

  $("wipeBtn").onclick = async () => {
    markActive();
    feedback(true);

    const ok = confirm(
      saves.isSignedIn()
        ? "WIPE deletes your CLOUD save + guest local.\n\nProceed?"
        : "WIPE deletes your guest local save.\n\nProceed?"
    );
    if (!ok) return;

    saves.wipeLocal();
    if (saves.isSignedIn()) {
      try { await saves.wipeCloud(); } catch {}
    }
    location.reload();
  };

  $("riteBtn").onclick = async () => {
    if (!canRite()) return;
    markActive();
    feedback(true);

    const g = prestigeGain();
    const ok = confirm(`RITE resets this build.\nYou gain +${g} relics.\n\nProceed?`);
    if (!ok) return;

    doRite();
    renderAll();
    try { await saveNow(true); } catch {}
    aiComms("rite", "MOTHERLINE");
  };

  $("aiBtn").onclick = () => {
    markActive();
    feedback(false);
    state.aiOn = !state.aiOn;
    $("aiBtn").textContent = state.aiOn ? "AI COMMS" : "AI OFF";
    $("aiChip").textContent = saves.isSignedIn()
      ? (state.aiOn ? "AI: READY" : "AI: OFF")
      : "AI: OFF";
    touch();
    saves.saveLocal(state);
    if (saves.isSignedIn()) saves.saveCloud(state, { force: true }).catch(()=>{});
  };

  $("fbBtn").onclick = () => {
    markActive();
    feedback(false);
    feedbackOn = !feedbackOn;
    $("fbBtn").textContent = feedbackOn ? "FEEDBACK" : "FB OFF";
  };

  $("helpBtn").onclick = () => {
    markActive();
    openModal("HOME BASE COMMUNIQUE",
      `<p><span class="tag">HB</span>Operator, we’re receiving structured noise. Build Signal, unlock buffs, and keep Corruption from spiraling while we decode intent.</p>
       <p><span class="tag">HOW</span>Tap <b>PING VOID</b> for Signal. Buy <b>DISH</b> for passive gain. New buffs unlock at Total milestones.</p>
       <p><span class="tag">TIP</span>Sign in to sync across devices. (Cloud save loads on sign-in.)</p>`
    );
  };

  $("userChip").onclick = () => {
    markActive();
    openModal("IDENTITY OVERRIDE",
      `<p><span class="tag">OPS</span>A callsign makes the logs readable.</p>
       <input class="texty" id="nameInput" maxlength="18" placeholder="USERNAME" value="${esc(state.profile.name)}" />
       <div style="height:10px"></div>
       <button id="nameSave" style="width:100%">SAVE</button>`
    );

    const input = document.getElementById("nameInput");
    document.getElementById("nameSave").onclick = async () => {
      const name = (input.value || "").trim().slice(0, 18);
      state.profile.name = (name ? name : "GUEST").toUpperCase();
      closeModal();

      popup("OPS", `Copy that, ${state.profile.name}.`);
      pushLog("comms","OPS", `Alright ${String(state.profile.name).replaceAll("<","&lt;")}. Keep it steady.`);

      touch();
      saves.saveLocal(state);
      if (saves.isSignedIn()) {
        try { await saves.saveCloud(state, { force: true }); } catch {}
      }
      renderAll();
    };
  };

  // ----------------------------
  // Auth
  // ----------------------------
  const emailEl = $("email");
  const passEl = $("pass");

  $("signUpBtn").onclick = async () => {
    markActive();
    const email = emailEl.value.trim();
    const pass = passEl.value;
    if (!email || !pass) return alert("Enter email + password.");
    try {
      await saves.signUp(email, pass);
      alert("Signed up. Now press SIGN IN.");
    } catch (e) {
      alert(e.message || String(e));
    }
  };

  $("signInBtn").onclick = async () => {
    markActive();
    const email = emailEl.value.trim();
    const pass = passEl.value;
    if (!email || !pass) return alert("Enter email + password.");
    try {
      await saves.signIn(email, pass);
    } catch (e) {
      alert(e.message || String(e));
    }
  };

  $("signOutBtn").onclick = async () => {
    markActive();
    const ok = confirm("Sign out? (Cloud save remains safe.)");
    if (!ok) return;
    try { await saves.signOut(); } catch (e) { alert(e.message || String(e)); }
  };

  $("whoBtn").onclick = async () => {
    markActive();
    try {
      const uid = await saves.getUserId();
      alert(uid ? `UID: ${uid}` : "Not signed in.");
    } catch { alert("Not signed in."); }
  };

  function setAuthUI({ signedIn, userId }) {
    $("authStatus").textContent = signedIn ? "STATUS: SIGNED IN" : "STATUS: NOT SIGNED IN";
    $("signOutBtn").disabled = !signedIn;
    $("syncChip").textContent = signedIn ? "SYNC: CLOUD" : "SYNC: GUEST";
    $("aiChip").textContent = signedIn ? (state.aiOn ? "AI: READY" : "AI: OFF") : "AI: OFF";
    if (signedIn && userId) pushLog("log","SYS", `SIGNED IN (${userId.slice(0,4)}…${userId.slice(-4)}).`);
  }

  async function onAuthChange(info) {
    setAuthUI(info);

    if (info.signedIn) {
      try {
        const res = await saves.syncOnSignIn(state);
        if (res.cloudLoaded) {
          loadIntoState(res.cloudLoaded);
          pushLog("log","SYS","CLOUD SAVE LOADED (REPLACING GUEST RUN).");
          popup("SYS","Cloud state loaded.");
        } else {
          pushLog("log","SYS","NO CLOUD SAVE FOUND. CREATED ONE FROM CURRENT RUN.");
        }
        await saveNow(true);
        renderAll();

        // PATCH: after sign-in, if username is still GUEST, force prompt
        if ((state.profile.name || "GUEST").toUpperCase() === "GUEST") {
          forceUsernamePrompt("CONTROL");
        }

        // DEV MODE: after sign-in, inject panel if master
        await checkDevAndMaybeInject();

        updateOnboardVisibility();
      } catch (e) {
        pushLog("log","SYS","CLOUD SYNC FAILED: " + String(e?.message || e).replaceAll("<","&lt;"));
        $("syncChip").textContent = "SYNC: CLOUD (ERR)";
      }
    } else {
      removeDevPanel();
      updateOnboardVisibility();
    }
  }

  // ----------------------------
  // Boot narrative
  // ----------------------------
  function bootNarrative() {
    if ($("log").children.length) return;
    pushLog("log","SYS","SYGN1L ONLINE. SILENCE IS UNPROCESSED DATA.");
    pushLog("comms","OPS","Ping the void so we can get a baseline.");
    popup("OPS","Tap PING VOID, then buy DISH to start passive gain.");
  }

  // ----------------------------
  // Main loop
  // ----------------------------
  let last = performance.now();
  let upgradesRefreshAcc = 0;

  function loop(t) {
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;

    recompute();

    // passive
    if (derived.sps > 0) {
      const g = derived.sps * dt;
      state.signal += g;
      state.total += g;
    }

    // auto
    if (derived.autoRate > 0) {
      const p = derived.autoRate * dt;
      const g = p * (derived.click * derived.bw) * (1 - 0.25 * state.corruption);
      state.signal += g;
      state.total += g;
    }

    corruptionCreep(dt);
    phaseCheck();

    renderHUD();

    upgradesRefreshAcc += dt;
    if (upgradesRefreshAcc >= 0.25) {
      upgradesRefreshAcc = 0;
      renderUpgrades();
      maybeAmbient();
    }

    drawScope(dt, t);

    // keep updatedAt fresh so offline calc works
    if ((t | 0) % 2500 < 16) {
      touch();
      saves.saveLocal(state);
      if (saves.isSignedIn()) saves.saveCloud(state, { force: false }).catch(()=>{});
    }

    requestAnimationFrame(loop);
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      saveNow(true).catch(()=>{});
    }
  });

  // ----------------------------
  // START
  // ----------------------------
  resizeScope();

  // Load guest local first
  const local = saves.loadLocal();
  if (local) loadIntoState(local);

  // Apply offline earnings before first render
  applyOfflineEarnings();

  // Prime
  state.profile.name = (state.profile.name || "GUEST").toUpperCase().slice(0, 18);
  recompute();
  setPhase(state.phase || 1);
  bootNarrative();
  renderAll();
  updateOnboardVisibility();

  // Auth init + loop
  saves.initAuth(onAuthChange)
    .then(() => {
      // If already signed-in on load, onAuthChange will run, but this makes dev panel appear ASAP.
      checkDevAndMaybeInject().catch(()=>{});
      requestAnimationFrame(loop);
    })
    .catch((e) => {
      showFatal(e?.message || e);
      requestAnimationFrame(loop);
    });
})();