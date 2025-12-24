// /js/saves.js
// Supabase auth + cloud save manager for SYGN1L
// Canonical write API: writeCloudState(state, force)

const SUPABASE_URL = "https://qwrvlhdouicfyypxjffn.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_uBQsnY94g__2VzSm4Z9Yvg_mq32-ABR";

const LOCAL_KEY = "sygn1l_local_cache_v1";
const TABLE = "saves";

const CLOUD_SAVE_THROTTLE_MS = 45000;

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
  function loadLocal() {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function saveLocal(state) {
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(sanitizeStateForSave(state)));
      return true;
    } catch {
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
      } catch {}

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
  // Canonical write entrypoint
  // ----------------------------
  async function writeCloudState(state, force = false) {
    // Always keep local current
    saveLocal(state);

    // Opportunistic cloud save if signed in
    if (isSignedIn()) {
      try {
        await saveCloud(state, force);
      } catch {
        // swallow network errors, game should keep running
      }
    }
  }

  async function syncOnSignIn(currentState) {
    if (!supabase || !isSignedIn()) {
      return { mode: "guest", cloudLoaded: null };
    }

    const cloudState = await loadCloud();
    if (cloudState) {
      return { mode: "cloud", cloudLoaded: cloudState };
    }

    // No cloud row yet, seed it with current local
    await saveCloud(currentState, true);
    return { mode: "cloud", cloudLoaded: null };
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

    // canonical write
    writeCloudState
  };
}