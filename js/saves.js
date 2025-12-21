// /js/saves.js
// Supabase auth + cloud save manager for SYGN1L
// Canonical write API: writeCloudState(state, force)

const SUPABASE_URL = "https://qwrvlhdouicfyypxjffn.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_uBQsnY94g__2VzSm4Z9Yvg_mq32-ABR";

const LOCAL_KEY = "sygn1l_guest_save_v1";
const TABLE = "saves";

const CLOUD_SAVE_THROTTLE_MS = 45_000;

export function createSaves() {
  const supabase = window.supabase?.createClient?.(
    SUPABASE_URL,
    SUPABASE_ANON_KEY
  );

  if (!supabase) {
    console.warn("[SYGN1L] Supabase client missing. Cloud disabled.");
  }

  let _userId = null;
  let _cloudReady = false;
  let _lastCloudSaveAt = 0;

  // ----------------------------
  // Local (guest)
  // ----------------------------
  function loadLocal() {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }

  function saveLocal(state) {
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(state));
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

    _userId = await getUserId();
    _cloudReady = !!_userId;
    onChange?.({ signedIn: isSignedIn(), userId: _userId });

    supabase.auth.onAuthStateChange((_evt, session) => {
      _userId = session?.user?.id || null;
      _cloudReady = !!_userId;
      onChange?.({ signedIn: isSignedIn(), userId: _userId });
    });
  }

  async function signUp(email, password) {
    if (!supabase) throw new Error("Supabase missing");
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
  }

  async function signIn(email, password) {
    if (!supabase) throw new Error("Supabase missing");
    const { error } =
      await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }

  async function signOut() {
    if (!supabase) throw new Error("Supabase missing");
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }

  // ----------------------------
  // Cloud IO
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
    if (!force && now - _lastCloudSaveAt < CLOUD_SAVE_THROTTLE_MS) {
      return false;
    }
    _lastCloudSaveAt = now;

    const payload = {
      player_id: _userId,
      updated_at: new Date().toISOString(),
      state: JSON.parse(JSON.stringify(state))
    };

    const { error } =
      await supabase.from(TABLE).upsert(payload);

    if (error) throw error;
    return true;
  }

  async function wipeCloud() {
    if (!supabase || !isSignedIn()) return false;
    const { error } =
      await supabase.from(TABLE).delete().eq("player_id", _userId);
    if (error) throw error;
    return true;
  }

  // ----------------------------
  // Canonical write entrypoint
  // ----------------------------
  async function writeCloudState(state, force = false) {
    saveLocal(state);
    if (isSignedIn()) {
      try {
        await saveCloud(state, force);
      } catch {}
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

    await saveCloud(currentState, true);
    return { mode: "cloud", cloudLoaded: null };
  }

  // ----------------------------
  // Public API
  // ----------------------------
  return {
    supabase,

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

    // cloud
    loadCloud,
    saveCloud,
    wipeCloud,
    syncOnSignIn,

    // canonical write
    writeCloudState
  };
}