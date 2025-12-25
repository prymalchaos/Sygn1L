// /js/saves.js
// Supabase auth + cloud save manager for SYGN1L
// Canonical write API: writeCloudState(state, force)

const SUPABASE_URL = "https://qwrvlhdouicfyypxjffn.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_uBQsnY94g__2VzSm4Z9Yvg_mq32-ABR";

const LOCAL_KEY = "sygn1l_local_cache_v1";
const TABLE = "saves";

// Public leaderboard table (needs to exist in Supabase).
// See README in patch notes / SQL snippet.
const LEADERBOARD_TABLE = "phase_leaderboard";

const CLOUD_SAVE_THROTTLE_MS = 45000;

// Seamless sign-in note:
// We treat local storage as the always-on "black box" so a player never loses
// progress if cloud writes are throttled or connectivity is flaky.
// On sign-in we merge LOCAL + CLOUD and then force-write the merged snapshot.

export function createSaves() {
  const supabase = window.supabase?.createClient?.(SUPABASE_URL, SUPABASE_ANON_KEY) || null;

  let _userId = null;
  let _cloudReady = false;
  let _lastCloudSaveAt = 0;

  // ----------------------------
  // Local cache (signed-in safety net)
  // ----------------------------

  // Strip runtime-only fields that should never be persisted (canvas renderers, DOM refs, etc.)
  // This prevents "vanishing" visuals after refresh where a truthy but non-functional object
  // blocks re-initialisation (e.g., Phase 1 _osc/_bars renderers).
  function sanitizeStateForSave(state) {
    if (!state || typeof state !== "object") return state;

    const out = { ...state };

    // Phase data is the main risk area: phases often stash non-serializable helpers.
    if (out.phaseData && typeof out.phaseData === "object") {
      const clean = {};
      for (const [k, v] of Object.entries(out.phaseData)) {
        if (!v || typeof v !== "object") {
          clean[k] = v;
          continue;
        }
        const bucket = {};
        for (const [kk, vv] of Object.entries(v)) {
          // Convention: any key starting with '_' is runtime-only.
          if (String(kk).startsWith("_")) continue;
          if (typeof vv === "function") continue;
          bucket[kk] = vv;
        }
        clean[k] = bucket;
      }
      out.phaseData = clean;
    }

    return out;
  }

  // ----------------------------
  // Seamless merge helpers
  // ----------------------------
  function isObj(x) {
    return !!x && typeof x === "object" && !Array.isArray(x);
  }

  function num(x, fallback = 0) {
    const n = Number(x);
    return Number.isFinite(n) ? n : fallback;
  }

  function newerOf(a, b) {
    const ta = num(a?.meta?.updatedAtMs, 0);
    const tb = num(b?.meta?.updatedAtMs, 0);
    return tb > ta ? b : a;
  }

  // Merge two snapshots so we never lose progress.
  // NOTE: we assume the game isn't competitive, so "max" merging is OK.
  function mergeProgress(localState, cloudState) {
    if (!isObj(localState) && !isObj(cloudState)) return null;
    if (!isObj(localState)) return sanitizeStateForSave(cloudState);
    if (!isObj(cloudState)) return sanitizeStateForSave(localState);

    const base = sanitizeStateForSave(newerOf(localState, cloudState));
    const other = base === localState ? cloudState : localState;
    const out = sanitizeStateForSave({ ...base });

    // Core currencies / progress
    out.build = Math.max(1, Math.floor(Math.max(num(out.build, 1), num(other.build, 1))));
    out.relics = Math.max(num(out.relics, 0), num(other.relics, 0));
    out.signal = Math.max(num(out.signal, 0), num(other.signal, 0));
    out.total = Math.max(num(out.total, 0), num(other.total, 0));

    // Phase: never go backwards
    out.phase = Math.max(0, Math.floor(Math.max(num(out.phase, 0), num(other.phase, 0))));

    // Corruption is more "run state" than "wealth". Prefer the freshest snapshot.
    const freshest = newerOf(localState, cloudState);
    out.corruption = num(freshest?.corruption, num(out.corruption, 0));

    // Profile name: keep the most recently set non-empty name.
    const aName = String(base?.profile?.name || "").trim();
    const bName = String(other?.profile?.name || "").trim();
    const picked = (aName || bName || "GUEST").toUpperCase().slice(0, 18);
    out.profile = { ...(out.profile || {}), name: picked };

    // Upgrades: max each (covers both old economy.js style and newer variants)
    out.up = { ...(out.up || {}) };
    const otherUp = other?.up || {};
    const keys = new Set([...Object.keys(out.up), ...Object.keys(otherUp)]);
    for (const k of keys) {
      out.up[k] = Math.max(0, Math.floor(Math.max(num(out.up[k], 0), num(otherUp[k], 0))));
    }

    // Phase data: shallow merge, freshest keys win.
    const aPD = isObj(out.phaseData) ? out.phaseData : {};
    const bPD = isObj(other.phaseData) ? other.phaseData : {};
    const mergedPD = { ...aPD };
    for (const [phaseId, bucket] of Object.entries(bPD)) {
      if (!isObj(bucket)) continue;
      const have = mergedPD[phaseId];
      if (!isObj(have)) mergedPD[phaseId] = bucket;
      else mergedPD[phaseId] = { ...have, ...bucket };
    }
    out.phaseData = mergedPD;

    // Meta: keep the newest timestamps.
    out.meta = { ...(out.meta || {}) };
    const om = other?.meta || {};
    out.meta.updatedAtMs = Math.max(num(out.meta.updatedAtMs, 0), num(om.updatedAtMs, 0));
    out.meta.lastTickMs = Math.max(num(out.meta.lastTickMs, 0), num(om.lastTickMs, 0));
    out.meta.lastCloudWriteMs = Math.max(num(out.meta.lastCloudWriteMs, 0), num(om.lastCloudWriteMs, 0));

    return out;
  }

  function loadLocal() {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function saveLocal(state) {
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(sanitizeStateForSave(state)));
      return true;
    } catch (e) {
      return false;
    }
  }

  function wipeLocal() {
    localStorage.removeItem(LOCAL_KEY);
  }

  function hasLocal() {
    return !!localStorage.getItem(LOCAL_KEY);
  }

  // ----------------------------
  // Auth helpers
  // ----------------------------
  function isSignedIn() {
    return !!_userId && _cloudReady;
  }

  async function getUserId() {
    if (!supabase) return null;
    const { data: { session } } = await supabase.auth.getSession();
    return session?.user?.id || null;
  }

  async function initAuth(onChange) {
    if (!supabase) {
      _userId = null;
      _cloudReady = false;
      onChange?.({ signedIn: false, userId: null });
      return;
    }

    const uid = await getUserId();
    _userId = uid;
    _cloudReady = !!uid;
    onChange?.({ signedIn: isSignedIn(), userId: _userId });

    supabase.auth.onAuthStateChange(async (_evt, session) => {
      _userId = session?.user?.id || null;
      _cloudReady = !!_userId;
      onChange?.({ signedIn: isSignedIn(), userId: _userId });
    });
  }

  async function signUp(email, password) {
    if (!supabase) throw new Error("Supabase missing");
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
    return data;
  }

  async function signIn(email, password) {
    if (!supabase) throw new Error("Supabase missing");
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  }

  // ----------------------------
  // Dev-only admin bridge (requires an Edge Function you control)
  // Expected Edge Function name: "sygn1l-admin"
  // This is optional; in production this can be missing.
  // ----------------------------
    async function adminInvoke(op, payload = {}) {
    if (!supabase) throw new Error("Supabase missing");
    if (!supabase.functions?.invoke) throw new Error("Supabase functions unavailable");

    const { data, error } = await supabase.functions.invoke("sygn1l-admin", {
      body: { op, ...payload },
    });

    if (error) {
      // Supabase v2: FunctionsHttpError includes a Response in error.context
      let body = null;
      try {
        if (error?.context?.json) body = await error.context.json();
      } catch (e) {}

      const status =
        error?.context?.status ||
        error?.status ||
        body?.status ||
        body?.code ||
        "?";

      // Prefer the function's own message if present
      const msg =
        body?.error
          ? `Admin ${op} failed (${status}): ${body.error}`
          : `Admin ${op} failed (${status}): ${error.message}`;

      // Include extra detail if available
      const extra = body?.extra ? `\nExtra: ${JSON.stringify(body.extra)}` : "";
      throw new Error(msg + extra);
    }

    return data;
  }

  async function signOut() {
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }

  // ----------------------------
  // Cloud storage
  // Row schema expectation:
  //   player_id (text, PK)
  //   state (jsonb)
  //   updated_at (timestamptz)
  // ----------------------------
  async function loadCloud() {
    if (!supabase || !isSignedIn()) return null;

    const { data, error } = await supabase
      .from(TABLE)
      .select("state")
      .eq("player_id", _userId)
      .maybeSingle();

    if (error) throw error;
    return data?.state || null;
  }

  async function saveCloud(state, force = false) {
    if (!supabase || !isSignedIn()) return false;

    const now = Date.now();
    if (!force && now - _lastCloudSaveAt < CLOUD_SAVE_THROTTLE_MS) return false;
    _lastCloudSaveAt = now;

    const payload = {
      player_id: _userId,
      state: sanitizeStateForSave(state),
      updated_at: new Date().toISOString()
    };

    const { error } = await supabase.from(TABLE).upsert(payload);
    if (error) throw error;
    return true;
  }

  async function wipeCloud() {
    if (!supabase || !isSignedIn()) return false;
    const { error } = await supabase.from(TABLE).delete().eq("player_id", _userId);
    if (error) throw error;
    return true;
  }

  // ----------------------------
  // Leaderboards (public read, per-user best write)
  // ----------------------------
  async function submitPhaseBest({ phase, timeMs, username }) {
    if (!supabase || !isSignedIn()) return { ok: false, reason: "not_signed_in" };
    const p = Number(phase) || 0;
    const t = Math.max(0, Math.floor(Number(timeMs) || 0));
    if (!p || !t) return { ok: false, reason: "bad_args" };

    const name = String(username || "").trim().toUpperCase().slice(0, 18) || "UNKNOWN";

    // Read current best for this user+phase
    const { data: existing, error: selErr } = await supabase
      .from(LEADERBOARD_TABLE)
      .select("time_ms")
      .eq("phase", p)
      .eq("player_id", _userId)
      .maybeSingle();

    // If table is missing or RLS blocks access, don't crash the game.
    if (selErr && String(selErr.message || "").length) {
      throw selErr;
    }

    const cur = existing?.time_ms;
    if (typeof cur === "number" && cur > 0 && t >= cur) {
      // Not a PB
      return { ok: true, updated: false, bestMs: cur };
    }

    const payload = {
      phase: p,
      player_id: _userId,
      username: name,
      time_ms: t,
      updated_at: new Date().toISOString(),
    };

    const { error: upErr } = await supabase.from(LEADERBOARD_TABLE).upsert(payload);
    if (upErr) throw upErr;
    return { ok: true, updated: true, bestMs: t };
  }

  async function fetchGlobalLeaderboards({ limitPerPhase = 25 } = {}) {
    if (!supabase) return { ok: false, phases: {} };

    // Fetch a reasonable slice; client will group by phase.
    // If you later have lots of phases/rows, switch to a view/RPC.
    const { data, error } = await supabase
      .from(LEADERBOARD_TABLE)
      .select("phase, username, time_ms, updated_at")
      .order("phase", { ascending: true })
      .order("time_ms", { ascending: true })
      .limit(500);

    if (error) throw error;

    const phases = {};
    for (const row of data || []) {
      const p = Number(row.phase) || 0;
      if (!p) continue;
      phases[p] ||= [];
      if (phases[p].length >= limitPerPhase) continue;
      phases[p].push(row);
    }

    return { ok: true, phases };
  }

  // ----------------------------
  // Canonical write entrypoint
  // ----------------------------
  async function writeCloudState(state, force = false) {
    // Always keep local current
    saveLocal(state);

    // Opportunistic cloud save if signed in
    if (isSignedIn()) {
      try {
        await saveCloud(state, force);
      } catch (e) {
        // swallow network errors, game should keep running
      }
    }
  }

  async function syncOnSignIn(currentState) {
    // Back-compat: keep the old name, but route through the seamless flow.
    return await syncSeamless(currentState);
  }

  // Seamless sign-in sync:
  // - merges LOCAL + CLOUD snapshots
  // - force-writes the merged state to cloud so the next session never "reverts"
  // - always keeps LOCAL current as the safety net
  async function syncSeamless(currentState) {
    const localState = loadLocal();

    // Guest mode: still prefer local if it exists.
    if (!supabase || !isSignedIn()) {
      const merged = mergeProgress(localState, currentState) || sanitizeStateForSave(currentState);
      saveLocal(merged);
      return { mode: "guest", merged, cloudLoaded: null };
    }

    let cloudState = null;
    try {
      cloudState = await loadCloud();
    } catch (e) {
      // Cloud unavailable: fall back to local/current and keep playing.
      const merged = mergeProgress(localState, currentState) || sanitizeStateForSave(currentState);
      saveLocal(merged);
      return { mode: "cloud", merged, cloudLoaded: null, warning: "cloud_unavailable" };
    }

    // Merge local and cloud so we don't lose progress from throttled cloud writes.
    const merged =
      mergeProgress(localState, cloudState) ||
      mergeProgress(localState, currentState) ||
      sanitizeStateForSave(cloudState || currentState);

    saveLocal(merged);

    // Ensure the cloud is immediately brought up to date.
    try {
      await saveCloud(merged, true);
      _lastCloudSaveAt = Date.now();
    } catch (e) {
      // swallow; local is the safety net
    }

    return { mode: "cloud", merged, cloudLoaded: cloudState };
  }

  // ----------------------------
  // UI wiring helper (called by main.js)
  // ----------------------------
  function wireAuthUI({
    emailEl,
    passEl,
    signUpBtn,
    signInBtn,
    signOutBtn,
    whoBtn,
    authStatusEl,
    onSignedIn,
    onSignedOut
  }) {
    let lastSignedIn = null;

    function setStatus(signedIn, userId) {
      if (authStatusEl) {
        authStatusEl.textContent = signedIn ? `SIGNED IN (${String(userId).slice(0, 8)}…)` : "GUEST";
      }

      if (signUpBtn) signUpBtn.disabled = signedIn;
      if (signInBtn) signInBtn.disabled = signedIn;
      if (signOutBtn) signOutBtn.disabled = !signedIn;
      if (whoBtn) whoBtn.disabled = !signedIn;
    }

    initAuth(({ signedIn, userId }) => {
      setStatus(signedIn, userId);
      // Fire callbacks only when the signed-in state actually changes.
      if (lastSignedIn === null || lastSignedIn !== signedIn) {
        lastSignedIn = signedIn;
        if (signedIn) onSignedIn?.();
        else onSignedOut?.();
      }
    });

    if (signUpBtn) {
      signUpBtn.onclick = async () => {
        try {
          await signUp(emailEl?.value?.trim() || "", passEl?.value || "");
        } catch (e) {
          alert(`Sign up failed: ${e?.message || e}`);
        }
      };
    }

    if (signInBtn) {
      signInBtn.onclick = async () => {
        try {
          await signIn(emailEl?.value?.trim() || "", passEl?.value || "");
        } catch (e) {
          alert(`Sign in failed: ${e?.message || e}`);
        }
      };
    }

    if (signOutBtn) {
      signOutBtn.onclick = async () => {
        try {
          await signOut();
        } catch (e) {
          alert(`Sign out failed: ${e?.message || e}`);
        }
      };
    }

    if (whoBtn) {
      whoBtn.onclick = async () => {
        try {
          const uid = await getUserId();
          alert(uid ? `User: ${uid}` : "No user session.");
        } catch (e) {
          alert(`Error: ${e?.message || e}`);
        }
      };
    }
  }

  // ----------------------------
  // Public API
  // ----------------------------
  return {
    // local
    loadLocal,
    saveLocal,
    wipeLocal,
    hasLocal,

    // auth
    initAuth,
    signUp,
    signIn,
    signOut,
    isSignedIn,
    getUserId,
    wireAuthUI,

    // dev admin bridge (optional)
    adminInvoke,

    // cloud
    loadCloud,
    saveCloud,
    wipeCloud,
    syncOnSignIn,
    syncSeamless,

    // canonical write
    writeCloudState,

    // leaderboards
    submitPhaseBest,
    fetchGlobalLeaderboards
  };
}