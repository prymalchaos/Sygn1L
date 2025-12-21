
(() => {
  const $ = (id) => document.getElementById(id);

  // Prevent double-tap zoom on buttons (iOS Safari annoyance)
  document.addEventListener("dblclick", (e) => {
    if (e.target && e.target.closest("button")) e.preventDefault();
  }, { passive:false });

  // ----------------------------
  // Supabase CONFIG
  // ----------------------------
  const SUPABASE_URL = "https://qwrvlhdouicfyypxjffn.supabase.co";
  const SUPABASE_ANON_KEY = "sb_publishable_uBQsnY94g__2VzSm4Z9Yvg_mq32-ABR";
  const supabase = window.supabase?.createClient?.(SUPABASE_URL, SUPABASE_ANON_KEY);

  // Edge Function name for AI comms:
  const EDGE_FUNCTION = "sygn1l-comms";

  // ----------------------------
  // Core rules
  // ----------------------------
  const LOCAL_KEY = "sygn1l_core_save_v2";           // bumped version to avoid older broken local merges
  const OFFLINE_CAP_SEC = 6 * 60 * 60;              // 6 hours max offline gain
  const CLOUD_SAVE_THROTTLE_MS = 45_000;
  const AI_COOLDOWN_MS = 180_000;                   // 3 minutes
  const AMBIENT_COOLDOWN_MS = 180_000;              // 3 minutes
  const ACTIVE_WINDOW_MS = 20_000;                  // must have interacted recently
  const AUTOSAVE_EVERY_MS = 2500;                   // local cache cadence while running

  // ----------------------------
  // Feedback
  // ----------------------------
  let feedbackOn = true;
  let audioCtx = null;

  function haptic(ms=10){
    if (!feedbackOn) return false;
    if (navigator.vibrate) { navigator.vibrate([ms]); return true; }
    return false;
  }
  function clickSound(){
    if (!feedbackOn) return;
    try{
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
      g.gain.exponentialRampToValueAtTime(0.025, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.00001, t + 0.050);
      o.stop(t + 0.055);
    } catch(_){}
  }
  function feedback(strong=false){
    const ok = strong ? haptic(18) : haptic(10);
    if (!ok) clickSound();
  }

  // ----------------------------
  // Activity gating
  // ----------------------------
  let lastActionAt = 0;
  function markActive(){ lastActionAt = Date.now(); }
  window.addEventListener("pointerdown", markActive, { passive:true });
  window.addEventListener("keydown", markActive, { passive:true });
  function isActive(){ return (Date.now() - lastActionAt) <= ACTIVE_WINDOW_MS; }

  // ----------------------------
  // Utils
  // ----------------------------
  const clamp = (x,a,b) => Math.max(a, Math.min(b, x));
  const nowMs = () => Date.now();
  const esc = (s) => String(s)
    .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
    .replaceAll('"',"&quot;").replaceAll("'","&#039;");

  function fmt(n){
    n = Number(n) || 0;
    if (n < 1000) return n.toFixed(0);
    const u = ["K","M","B","T","Qa","Qi"];
    let i = -1;
    while (n >= 1000 && i < u.length-1){ n/=1000; i++; }
    return n.toFixed(n < 10 ? 2 : n < 100 ? 1 : 0) + u[i];
  }

  function pushLog(elId, tag, msg){
    const host = $(elId);
    if (!host) return;
    const p = document.createElement("p");
    p.innerHTML = `<span class="tag">${esc(tag)}</span>${msg}`;
    host.prepend(p);
  }

  function popup(who, msg){
    const host = $("popHost");
    if (!host) return;
    const box = document.createElement("div");
    box.className = "pop";
    box.innerHTML = `<div class="who">${esc(who)}</div><div class="msg">${esc(msg)}</div><div class="hint">TAP TO CLOSE</div>`;
    box.style.pointerEvents = "auto";
    box.addEventListener("click", () => box.remove());
    host.prepend(box);
  }

  // ----------------------------
  // Modal
  // ----------------------------
  function openModal(title, html){
    $("modalTitle").textContent = title;
    $("modalBody").innerHTML = html;
    $("modalBack").style.display = "flex";
    $("modalBack").setAttribute("aria-hidden","false");
  }
  function closeModal(){
    $("modalBack").style.display = "none";
    $("modalBack").setAttribute("aria-hidden","true");
    $("modalBody").innerHTML = "";
  }
  if ($("modalClose")) $("modalClose").onclick = closeModal;
  if ($("modalBack")) {
    $("modalBack").addEventListener("click", (e) => {
      if (e.target === $("modalBack")) closeModal();
    });
  }

  // ----------------------------
  // STATE
  // ----------------------------
  const state = {
    profile: { name: "GUEST" },

    // core progression
    build: 1,
    relics: 0,
    signal: 0,
    total: 0,

    corruption: 0,     // 0..1
    phase: 1,          // 1..6

    // toggles
    aiOn: true,
    lastAiAt: 0,
    lastAmbientAt: 0,

    // upgrades
    up: {
      dish: 0,
      scan: 0,
      probes: 0,
      auto: 0,
      stabil: 0,
      relicAmp: 0
    },

    // timestamps
    updatedAtMs: 0,    // last time state changed
    lastSeenMs: 0      // last time the game was "alive" (for offline gain)
  };

  // derived (not stored)
  const derived = {
    sps: 0,
    click: 1,
    bw: 1,
    autoRate: 0
  };

  function normalizeName(){
    state.profile.name = (state.profile.name || "GUEST").toUpperCase().slice(0,18);
  }

  function touch(){
    const n = nowMs();
    state.updatedAtMs = n;
    state.lastSeenMs = n;
  }

  // ----------------------------
  // PHASES (6) + tint
  // ----------------------------
  // NOTE: We set --accent to a real hex here, so it will visually change even if CSS vars aren't wired perfectly yet.
  const PHASES = [
    { n:1, at:0,     accent:"#39ff6a", status:"ARRAY: STABLE", sub:"THE ARRAY LISTENS. YOU PING.", obj:"Tap PING VOID. Buy DISH." },
    { n:2, at:500,   accent:"#62ff9d", status:"ARRAY: DRIFT",  sub:"We’re getting structure. Keep it clean.", obj:"Buy SCAN. Reach 120 total for PROBES." },
    { n:3, at:1800,  accent:"#a0ffd0", status:"ARRAY: ACTIVE", sub:"It’s answering. Don’t answer back.", obj:"Unlock AUTO. Boost Signal/sec." },
    { n:4, at:9000,  accent:"#8cffef", status:"ARRAY: GLITCH", sub:"Instability rising. Containment protocols online.", obj:"Buy STABIL. Keep corruption under control." },
    { n:5, at:12000, accent:"#ff6be5", status:"ARRAY: RITUAL", sub:"We can reset the Array and keep the residue.", obj:"RITE becomes available. Consider timing." },
    { n:6, at:35000, accent:"#ff3b6b", status:"ARRAY: BREACH", sub:"Something is using our signal to arrive.", obj:"Push relic scaling. Corruption will bite back." },
  ];

  function setPhase(n){
    state.phase = clamp(n,1,6);
    const ph = PHASES[state.phase-1];

    document.documentElement.style.setProperty("--accent", ph.accent);

    if ($("phase")) $("phase").textContent = `PHASE ${state.phase}`;
    if ($("status")) $("status").textContent = ph.status;
    if ($("subtitle")) $("subtitle").textContent = ph.sub;
    if ($("objective")) $("objective").textContent = "OBJECTIVE: " + ph.obj;
    if ($("phaseTint")) $("phaseTint").textContent = "P" + state.phase;
  }

  function phaseCheck(){
    for (let i = PHASES.length-1; i >= 0; i--){
      if (state.total >= PHASES[i].at){
        if (state.phase !== PHASES[i].n){
          setPhase(PHASES[i].n);
          pushLog("log","SYS",`PHASE ${state.phase} ENGAGED.`);
        }
        break;
      }
    }
  }

  // ----------------------------
  // UPGRADES
  // ----------------------------
  const UPG = [
    { id:"dish",   name:"DISH CALIBRATION", unlock:0,    base:10,   mult:1.18, desc:"+1 Signal/sec.", buy(){ state.up.dish++; } },
    { id:"scan",   name:"DEEP SCAN",        unlock:100,  base:50,   mult:1.25, desc:"+10% bandwidth.", buy(){ state.up.scan++; } },
    { id:"probes", name:"PROBE SWARM",      unlock:120,  base:80,   mult:1.22, desc:"+1 click power.", buy(){ state.up.probes++; } },
    { id:"auto",   name:"AUTO ROUTINE",     unlock:600,  base:520,  mult:1.30, desc:"Auto pings/sec.", buy(){ state.up.auto++; } },
    { id:"stabil", name:"STABILIZER",       unlock:9500, base:7200, mult:1.33, desc:"Slows corruption.", buy(){ state.up.stabil++; } },
    { id:"relicAmp", name:"RELIC AMP", unlock:0, base:3, mult:1.65, currency:"relics",
      desc:"Spend relics: +8% mult.", buy(){ state.up.relicAmp++; } },
  ];

  function lvl(id){ return state.up[id] || 0; }
  function cost(u){ return Math.floor(u.base * Math.pow(u.mult, lvl(u.id))); }

  function recompute(){
    derived.click = 1 + lvl("probes");
    derived.bw = Math.pow(1.10, lvl("scan")) * (1 + 0.08*lvl("relicAmp"));
    derived.sps = (lvl("dish") * 1.0) * derived.bw;
    derived.autoRate = lvl("auto") > 0 ? (lvl("auto") * 0.65 * (1 + 0.15*lvl("probes"))) : 0;
  }

  function corruptionLabel(c){
    if (c < 0.10) return "DORMANT";
    if (c < 0.30) return "WHISPER";
    if (c < 0.60) return "INCIDENT";
    if (c < 0.85) return "BREACH";
    return "OVERRUN";
  }

  function corruptionCreep(dt){
    const creep = 0.0000025 * Math.log10(state.total + 10);
    const tech = (lvl("scan") + lvl("auto")) * 0.0000012;
    const stabil = clamp(1 - 0.06*lvl("stabil"), 0.25, 1.0);
    state.corruption = clamp(state.corruption + (creep + tech) * stabil * dt, 0, 1);
  }

  // ----------------------------
  // PRESTIGE (Rite)
  // ----------------------------
  function prestigeGain(){
    const over = Math.max(0, state.total - 12000);
    return 1 + Math.floor(Math.sqrt(over / 6000));
  }
  function canRite(){ return state.total >= 12000; }

  function doRite(){
    const gain = prestigeGain();
    state.relics += gain;
    state.build += 1;

    pushLog("log","SYS",`RITE COMPLETE. +${gain} RELICS.`);
    pushLog("comms","OPS","We keep the residue. We pretend it’s control.");

    // reset build-scoped
    state.signal = 0;
    state.total = 0;
    state.corruption = Math.max(0, state.corruption * 0.25);
    state.phase = 1;

    // reset upgrades except relic amp
    const keep = lvl("relicAmp");
    for (const k in state.up) state.up[k] = 0;
    state.up.relicAmp = keep;

    touch();
    recompute();
    setPhase(1);
  }

  // ----------------------------
  // SAVE: Local + Cloud (fixed rules)
  // ----------------------------
  let userId = null;
  let cloudReady = false;
  let lastCloudSaveAt = 0;

  function hasLocalFile(){
    return !!localStorage.getItem(LOCAL_KEY);
  }

  function saveLocal(){
    // IMPORTANT: local is a cache, but still used for offline progress.
    // We update timestamps so offline gain uses lastSeenMs.
    touch();
    localStorage.setItem(LOCAL_KEY, JSON.stringify(state));
    if ($("syncChip")) $("syncChip").textContent = cloudReady ? "SYNC: CLOUD+LOCAL" : "SYNC: LOCAL";
  }

  function loadLocal(){
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return false;
    try{
      const data = JSON.parse(raw);
      if (data && typeof data === "object"){
        state.profile = Object.assign(state.profile, data.profile || {});
        state.up = Object.assign(state.up, data.up || {});
        for (const k of ["build","relics","signal","total","corruption","phase","aiOn","lastAiAt","lastAmbientAt","updatedAtMs","lastSeenMs"]){
          if (k in data) state[k] = data[k];
        }
      }
      normalizeName();
      return true;
    } catch {
      return false;
    }
  }

  function applyOfflineFromLastSeen(labelTag="SYS"){
    const last = Number(state.lastSeenMs || 0);
    if (!last) return;

    let dt = (nowMs() - last) / 1000;
    if (!isFinite(dt) || dt < 2.5) return;

    dt = Math.min(dt, OFFLINE_CAP_SEC);
    recompute();

    const gain = derived.sps * dt;
    if (gain > 0){
      state.signal += gain;
      state.total += gain;
      pushLog("log", labelTag, `OFFLINE: +${fmt(gain)} SIGNAL (${Math.floor(dt/60)}m).`);
    }

    // After applying, update lastSeen so we don’t double-apply.
    state.lastSeenMs = nowMs();
    state.updatedAtMs = state.lastSeenMs;
  }

  async function saveCloud(force=false){
    if (!supabase || !cloudReady || !userId) return false;
    const n = nowMs();
    if (!force && (n - lastCloudSaveAt) < CLOUD_SAVE_THROTTLE_MS) return false;
    lastCloudSaveAt = n;

    touch();
    const payload = {
      player_id: userId,
      updated_at: new Date().toISOString(),
      state: JSON.parse(JSON.stringify(state))
    };

    const { error } = await supabase.from("saves").upsert(payload);
    if (error) throw error;
    if ($("syncChip")) $("syncChip").textContent = "SYNC: CLOUD+LOCAL";
    return true;
  }

  async function loadCloud(){
    if (!supabase || !cloudReady || !userId) return null;
    const { data, error } = await supabase
      .from("saves")
      .select("state, updated_at")
      .eq("player_id", userId)
      .maybeSingle();
    if (error) throw error;
    if (!data?.state) return null;

    const cloudState = data.state;
    const cloudUpdated = cloudState.updatedAtMs || (data.updated_at ? Date.parse(data.updated_at) : 0);
    return { cloudState, cloudUpdated };
  }

  function mergeCloudState(cloudState){
    if (!cloudState || typeof cloudState !== "object") return;
    state.profile = Object.assign(state.profile, cloudState.profile || {});
    state.up = Object.assign(state.up, cloudState.up || {});
    for (const k of ["build","relics","signal","total","corruption","phase","aiOn","lastAiAt","lastAmbientAt","updatedAtMs","lastSeenMs"]){
      if (k in cloudState) state[k] = cloudState[k];
    }
    normalizeName();
  }

  // Cloud-truth sync:
  // - If cloud exists: ALWAYS load it on sign-in (no guest/local precedence)
  // - If cloud doesn't exist: create it from current state
  async function syncOnSignIn(){
    try{
      const cloud = await loadCloud();

      if (cloud?.cloudState){
        mergeCloudState(cloud.cloudState);

        // Apply offline based on the cloud state's lastSeenMs (works across devices)
        applyOfflineFromLastSeen("SYS");

        pushLog("log","SYS","CLOUD LOADED (SIGNED IN).");
      } else {
        // First-time account: create cloud from current state (which may include guest progress)
        touch();
        await saveCloud(true);
        pushLog("log","SYS","CLOUD CREATED FOR ACCOUNT.");
      }

      // keep local cache aligned to cloud
      saveLocal();
    } catch (err){
      cloudReady = false;
      if ($("syncChip")) $("syncChip").textContent = "SYNC: LOCAL";
      pushLog("log","SYS","CLOUD SYNC FAILED: " + esc(err?.message || String(err)));
    }
  }

  async function initAuth(){
    if (!supabase){
      if ($("authStatus")) $("authStatus").textContent = "STATUS: SUPABASE MISSING";
      return;
    }

    const applySignedInUI = () => {
      if ($("authStatus")) $("authStatus").textContent = "STATUS: SIGNED IN";
      if ($("signOutBtn")) $("signOutBtn").disabled = false;
      if ($("syncChip")) $("syncChip").textContent = "SYNC: CLOUD";
      if ($("aiChip")) $("aiChip").textContent = state.aiOn ? "AI: READY" : "AI: OFF";
    };

    const applySignedOutUI = () => {
      if ($("authStatus")) $("authStatus").textContent = "STATUS: NOT SIGNED IN";
      if ($("signOutBtn")) $("signOutBtn").disabled = true;
      if ($("syncChip")) $("syncChip").textContent = "SYNC: LOCAL";
      if ($("aiChip")) $("aiChip").textContent = "AI: OFF";
    };

    // initial session
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user?.id){
      userId = session.user.id;
      cloudReady = true;
      applySignedInUI();
      await syncOnSignIn();
    } else {
      userId = null;
      cloudReady = false;
      applySignedOutUI();
    }

    supabase.auth.onAuthStateChange(async (_evt, session2) => {
      if (session2?.user?.id){
        userId = session2.user.id;
        cloudReady = true;
        applySignedInUI();
        await syncOnSignIn();
      } else {
        userId = null;
        cloudReady = false;
        applySignedOutUI();
      }
      renderAll();
    });
  }

  // ----------------------------
  // AI comms (Edge Function)
  // ----------------------------
  function aiReady(){
    if (!state.aiOn) return false;
    if (!cloudReady) return false;
    if (!isActive()) return false;
    if ((nowMs() - (state.lastAiAt||0)) < AI_COOLDOWN_MS) return false;
    return true;
  }

  async function aiComms(eventName, speakerHint="OPS"){
    if (!aiReady()) return false;

    state.lastAiAt = nowMs();
    saveLocal();
    if ($("aiChip")) $("aiChip").textContent = "AI: ...";

    try{
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

      const { data, error } = await supabase.functions.invoke(EDGE_FUNCTION, { body: payload });
      if (error) throw error;

      const who = data?.who || speakerHint;
      const text = (data?.text || "").trim() || "…";

      popup(who, text);
      pushLog("comms", who, esc(text));
      if ($("aiChip")) $("aiChip").textContent = "AI: READY";
      return true;
    } catch (err){
      if ($("aiChip")) $("aiChip").textContent = "AI: OFF";
      pushLog("log","SYS","AI FAILED: " + esc(err?.message || String(err)));
      return false;
    }
  }

  // Ambient human comms every ~3 minutes, no explicit in-game trigger.
  const HUMAN_POOL = [
    (n)=>`Hey ${n}, you still with us?`,
    (n)=>`If this gets weird, say so, ${n}.`,
    (n)=>`You’re doing fine, ${n}. Keep the pings steady.`,
    (n)=>`I don’t love this… but we need the data, ${n}.`,
    (n)=>`Take a breath, ${n}. Then keep scanning.`,
    (n)=>`If it starts feeling personal, tell me, ${n}.`
  ];

  async function maybeAmbient(){
    if (!state.aiOn) return;
    if (!cloudReady) return;
    if (!isActive()) return;
    if ((nowMs() - (state.lastAmbientAt||0)) < AMBIENT_COOLDOWN_MS) return;

    state.lastAmbientAt = nowMs();
    saveLocal();

    const msg = HUMAN_POOL[Math.floor(Math.random()*HUMAN_POOL.length)](state.profile.name);
    popup("OPS", msg);
    pushLog("comms","OPS", esc(msg));

    // occasionally ask GPT to add a one-liner vibe response
    if (Math.random() < 0.35) {
      await aiComms("ambient", "OPS");
    }
  }

  // ----------------------------
  // UI render
  // ----------------------------
  function renderHUD(){
    if ($("signal")) $("signal").textContent = fmt(state.signal);
    if ($("sps")) $("sps").textContent = fmt(derived.sps);

    if ($("buildChip")) $("buildChip").textContent = "BUILD: " + state.build;
    if ($("relicChip")) $("relicChip").textContent = "RELICS: " + state.relics;

    if ($("userChip")) $("userChip").textContent = "USER: " + state.profile.name;

    // corruption
    if ($("corrFill")) $("corrFill").style.width = (state.corruption*100).toFixed(1) + "%";
    if ($("corrText")) $("corrText").textContent = (state.corruption*100).toFixed(1) + "% (" + corruptionLabel(state.corruption) + ")";

    // rite
    const rite = $("riteBtn");
    if (rite){
      const can = canRite();
      rite.disabled = !can;
      rite.textContent = can ? `RITE +${prestigeGain()}` : "RITE";
    }

    if ($("aiChip")) $("aiChip").textContent = cloudReady ? (state.aiOn ? "AI: READY" : "AI: OFF") : "AI: OFF";
  }

  function renderUpgrades(){
    const root = $("upgrades");
    if (!root) return;
    root.innerHTML = "";

    for (const u of UPG){
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
        <div class="name">${esc(u.name)} (LV ${lvl(u.id)})</div>
        <div class="desc">${esc(unlocked ? u.desc : `LOCKED UNTIL ${fmt(u.unlock)} TOTAL.`)}</div>
        <div class="cost">${unlocked ? `COST: ${fmt(price)} ${currency.toUpperCase()}` : "STATUS: LOCKED"}</div>
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
        saveLocal();
        try{ await saveCloud(false); } catch(_){}

        if (Math.random() < 0.22) await aiComms("buy_" + u.id, "OPS");
      };

      row.appendChild(meta);
      row.appendChild(btn);
      root.appendChild(row);
    }
  }

  function renderAll(){
    phaseCheck();
    renderHUD();
    renderUpgrades();
    updateScopeLabel();
  }

  // ----------------------------
  // Scope visualiser (noise -> spikes)
  // ----------------------------
  const scope = $("scope");
  const ctx = scope ? scope.getContext("2d", { alpha:false }) : null;
  let sw=0, sh=0, dpr=1;
  const sig = { cols:[], vel:[], phase:0 };

  function resizeScope(){
    if (!scope || !ctx) return;
    dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const cssW = scope.clientWidth || 300;
    const cssH = 84;
    scope.style.height = cssH + "px";
    scope.width = Math.floor(cssW * dpr);
    scope.height = Math.floor(cssH * dpr);
    sw = scope.width; sh = scope.height;

    const cols = Math.max(120, Math.floor(sw / (2*dpr)));
    sig.cols = new Array(cols).fill(0);
    sig.vel = new Array(cols).fill(0);
    sig.phase = 0;
  }
  window.addEventListener("resize", resizeScope);

  function lockValue(){
    const a = clamp(Math.log10(state.total + 1)/5, 0, 1);
    const b = clamp((derived.bw - 1)/3, 0, 1);
    const raw = 0.6*a + 0.4*b;
    return clamp(raw * (1 - 0.55*state.corruption), 0, 1);
  }
  function updateScopeLabel(){
    if ($("scopeLabel")) $("scopeLabel").textContent = "LOCK: " + Math.round(lockValue()*100) + "%";
  }
  function rand01(seed){
    seed = (seed ^ 0x6D2B79F5) >>> 0;
    seed = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    seed ^= seed + Math.imul(seed ^ (seed >>> 7), 61 | seed);
    return ((seed ^ (seed >>> 14)) >>> 0) / 4294967296;
  }

  function getAccentHex(){
    // JS sets --accent to a literal hex, so this is safe.
    const v = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
    return v || "#39ff6a";
  }

  function drawScope(dt, t){
    if (!ctx || !sw || !sh) return;

    const lk = lockValue();
    const corr = state.corruption;

    ctx.fillStyle = "rgb(0,0,0)";
    ctx.fillRect(0,0,sw,sh);

    const noiseAmt = clamp(0.85 - 0.70*lk + 0.35*corr, 0.15, 0.95);
    const spikeProb = clamp(0.05 + 0.35*lk, 0.05, 0.70);

    const cols = sig.cols.length;
    sig.phase += dt * (0.6 + 1.8*lk) * (1 + 0.8*corr);

    for (let i=0;i<cols;i++){
      const base = Math.sin(sig.phase + i*0.07) * 0.25;
      const chaos = (rand01((t|0) + i*9973) - 0.5) * (0.45 + 0.9*corr);
      const target = base + chaos;

      const stiffness = 0.08 + 0.22*lk;
      const damping = 0.82 - 0.35*corr;

      sig.vel[i] = sig.vel[i]*damping + (target - sig.cols[i]) * stiffness;
      sig.cols[i] += sig.vel[i];
    }

    const midY = Math.floor(sh * 0.60);
    const px = Math.max(1, Math.floor(dpr));
    const baseG = 190;

    for (let y=0;y<sh;y+=px){
      const lineFade = 0.72 + 0.28*Math.sin((y/sh)*Math.PI);
      for (let x=0;x<sw;x+=px){
        const n = rand01((x*131 + y*977 + (t|0))|0);
        if (n < noiseAmt){
          const v = Math.floor((baseG + 55*n) * lineFade);
          ctx.fillStyle = `rgb(0,${v},0)`;
          ctx.fillRect(x,y,px,px);
        }
      }
    }

    ctx.lineWidth = Math.max(1, 1*dpr);
    ctx.strokeStyle = getAccentHex();
    ctx.beginPath();
    for (let i=0;i<cols;i++){
      const x = Math.floor((i/(cols-1)) * (sw-1));
      const s = sig.cols[i];
      const spike = (rand01((t|0) + i*71) < spikeProb) ? 1 : 0;

      const spikeH = spike * (0.15 + 0.85*lk) * (0.75 + 0.25*Math.abs(s));
      const noiseH = (s * (0.35 + 0.65*(1-lk))) * 0.35;
      const echo = corr > 0.28 ? (0.10 + 0.35*corr) * Math.sin(sig.phase*2 + i*0.12) : 0;

      const y = midY - (spikeH + noiseH + echo) * (sh * 0.70);
      if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    }
    ctx.stroke();
  }

  // ----------------------------
  // Controls
  // ----------------------------
  if ($("ping")) {
    $("ping").onclick = async () => {
      markActive();
      feedback(false);

      const gain = derived.click * derived.bw * (1 - 0.35*state.corruption);
      state.signal += gain;
      state.total += gain;

      state.corruption = clamp(state.corruption + 0.00055, 0, 1);

      touch();
      recompute();
      renderAll();
      saveLocal();
      try{ await saveCloud(false); } catch(_){}

      if (Math.random() < 0.10) await aiComms("ping", "OPS");
    };
  }

  if ($("saveBtn")) {
    $("saveBtn").onclick = async () => {
      markActive();
      feedback(false);
      saveLocal();
      try{
        await saveCloud(true);
        pushLog("log","SYS","SAVED (CLOUD).");
      } catch (err){
        pushLog("log","SYS","SAVED (LOCAL).");
      }
    };
  }

  if ($("wipeBtn")) {
    $("wipeBtn").onclick = async () => {
      markActive();
      feedback(true);
      const ok = confirm("WIPE deletes local save.\nIf signed in, it also deletes cloud save.\n\nProceed?");
      if (!ok) return;

      localStorage.removeItem(LOCAL_KEY);
      if (cloudReady && userId && supabase){
        try{ await supabase.from("saves").delete().eq("player_id", userId); } catch(_){}
      }
      location.reload();
    };
  }

  if ($("riteBtn")) {
    $("riteBtn").onclick = async () => {
      if (!canRite()) return;
      markActive();
      feedback(true);

      const g = prestigeGain();
      const ok = confirm(`RITE resets this build.\nYou gain +${g} relics.\n\nProceed?`);
      if (!ok) return;

      doRite();
      renderAll();
      saveLocal();
      try{ await saveCloud(true); } catch(_){}
      await aiComms("rite", "MOTHERLINE");
    };
  }

  if ($("aiBtn")) {
    $("aiBtn").onclick = () => {
      markActive();
      feedback(false);
      state.aiOn = !state.aiOn;
      $("aiBtn").textContent = state.aiOn ? "AI COMMS" : "AI OFF";
      if ($("aiChip")) $("aiChip").textContent = cloudReady ? (state.aiOn ? "AI: READY" : "AI: OFF") : "AI: OFF";
      saveLocal();
    };
  }

  if ($("fbBtn")) {
    $("fbBtn").onclick = () => {
      markActive();
      feedback(false);
      feedbackOn = !feedbackOn;
      $("fbBtn").textContent = feedbackOn ? "FEEDBACK" : "FB OFF";
    };
  }

  if ($("helpBtn")) {
    $("helpBtn").onclick = () => {
      markActive();
      openModal("HOME BASE COMMUNIQUE",
        `<p><span class="tag">HB</span>Operator, we’re receiving structured noise. We need you to build Signal, unlock buffs, and keep Corruption from spiraling while we decode intent.</p>
         <p><span class="tag">HOW</span>Tap <b>PING VOID</b> to gain Signal. Buy <b>DISH</b> for passive Signal/sec. Unlock new buffs by reaching Total milestones.</p>
         <p><span class="tag">TIP</span>Sign in (email/pass) to sync your save across devices.</p>`
      );
    };
  }

  // Username editor
  if ($("userChip")) {
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
        const name = (input.value || "").trim().slice(0,18);
        state.profile.name = (name ? name : "GUEST").toUpperCase();
        closeModal();

        popup("OPS", `Copy that, ${state.profile.name}.`);
        pushLog("comms","OPS", `Alright ${esc(state.profile.name)}. Keep it steady.`);

        saveLocal();

        if (cloudReady && userId){
          try{
            await saveCloud(true);
            pushLog("log","SYS","IDENTITY SAVED (CLOUD).");
          } catch(err){
            pushLog("log","SYS","CLOUD IDENTITY SAVE FAILED: " + esc(err?.message || String(err)));
          }
        }

        renderAll();
      };
    };
  }

  // Account buttons
  if ($("signUpBtn")) {
    $("signUpBtn").onclick = async () => {
      markActive();
      if (!supabase) return alert("Supabase missing.");
      const email = $("email").value.trim();
      const pass = $("pass").value;
      if (!email || !pass) return alert("Enter email + password.");
      const { error } = await supabase.auth.signUp({ email, password: pass });
      if (error) return alert(error.message);
      alert("Signed up. Now press SIGNIN.");
    };
  }

  if ($("signInBtn")) {
    $("signInBtn").onclick = async () => {
      markActive();
      if (!supabase) return alert("Supabase missing.");
      const email = $("email").value.trim();
      const pass = $("pass").value;
      if (!email || !pass) return alert("Enter email + password.");
      const { error } = await supabase.auth.signInWithPassword({ email, password: pass });
      if (error) return alert(error.message);
    };
  }

  if ($("signOutBtn")) {
    $("signOutBtn").onclick = async () => {
      markActive();
      if (!supabase) return;
      const ok = confirm("Sign out? Cloud save remains safe.");
      if (!ok) return;
      const { error } = await supabase.auth.signOut();
      if (error) alert(error.message);
    };
  }

  if ($("whoBtn")) {
    $("whoBtn").onclick = async () => {
      markActive();
      if (!supabase) return alert("Supabase missing.");
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user?.id) alert("UID: " + session.user.id);
      else alert("Not signed in.");
    };
  }

  // ----------------------------
  // Boot narrative
  // ----------------------------
  function bootNarrative(){
    if ($("log") && $("log").children.length) return;
    pushLog("log","SYS","SYGN1L ONLINE. SILENCE IS UNPROCESSED DATA.");
    pushLog("comms","OPS","Ping the void so we can get a baseline.");
    popup("OPS","Tap PING VOID, then buy DISH to start passive gain.");
  }

  // ----------------------------
  // Main loop
  // ----------------------------
  let last = performance.now();
  let upgradesRefreshAcc = 0;
  let lastAutoSaveT = performance.now();

  function loop(t){
    const dt = Math.min(0.05, (t - last)/1000);
    last = t;

    recompute();

    // passive gain
    if (derived.sps > 0){
      const g = derived.sps * dt;
      state.signal += g;
      state.total += g;
    }

    // auto pings
    if (derived.autoRate > 0){
      const p = derived.autoRate * dt;
      const g = p * (derived.click * derived.bw) * (1 - 0.25*state.corruption);
      state.signal += g;
      state.total += g;
    }

    corruptionCreep(dt);
    phaseCheck();

    // render HUD each frame, upgrades ~4x/sec
    renderHUD();
    upgradesRefreshAcc += dt;
    if (upgradesRefreshAcc >= 0.25){
      upgradesRefreshAcc = 0;
      renderUpgrades();
      maybeAmbient();
    }

    drawScope(dt, t|0);

    // predictable autosave
    if ((t - lastAutoSaveT) >= AUTOSAVE_EVERY_MS){
      lastAutoSaveT = t;
      saveLocal();
      if (cloudReady) saveCloud(false).catch(()=>{});
    }

    requestAnimationFrame(loop);
  }

  // Save when backgrounded
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden"){
      saveLocal();
      if (cloudReady) saveCloud(true).catch(()=>{});
    }
  });

  // ----------------------------
  // Start
  // ----------------------------
  resizeScope();

  // load local cache first (guest/offline)
  loadLocal();
  normalizeName();
  if (!state.lastSeenMs) state.lastSeenMs = nowMs(); // backfill for older saves
  applyOfflineFromLastSeen("SYS");

  recompute();
  setPhase(state.phase || 1);
  bootNarrative();
  renderAll();

  initAuth().finally(() => {
    requestAnimationFrame(loop);
  });

})();