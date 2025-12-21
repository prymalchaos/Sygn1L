// ./js/saves.js
// Supabase auth + cloud save manager for SYGN1L
// - Guest mode uses localStorage only
// - Signed-in mode uses cloud (and can optionally mirror local for offline fallback)
// - On sign-in: cloud save ALWAYS loads (replaces current in-memory state) if it exists
// - If no cloud save exists yet: creates one from current state

const SUPABASE_URL = "https://qwrvlhdouicfyypxjffn.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_uBQsnY94g__2VzSm4Z9Yvg_mq32-ABR";

const LOCAL_KEY = "sygn1l_guest_save_v1";
const TABLE = "saves"; // columns: player_id (text/uuid), updated_at (timestamptz), state (jsonb)

const CLOUD_SAVE_THROTTLE_MS = 45_000;

export function createSaves() {
  const supabase = window.supabase?.createClient?.(SUPABASE_URL, SUPABASE_ANON_KEY);
  if (!supabase) {
    console.warn("[SYGN1L] Supabase client missing. Cloud disabled.");
  }

  let _userId = null;
  let _cloudReady = false;
  let _lastCloudSaveAt = 0;

  // ---- Local (guest) ----
  function hasLocal() {
    return !!localStorage.getItem(LOCAL_KEY);
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
      localStorage.setItem(LOCAL_KEY, JSON.stringify(state));
      return true;
    } catch {
      return false;
    }
  }

  function wipeLocal() {
    localStorage.removeItem(LOCAL_KEY);
  }

  // ---- Auth state ----
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

    // initial
    const uid = await getUserId();
    _userId = uid;
    _cloudReady = !!uid;

    onChange?.({ signedIn: isSignedIn(), userId: _userId });

    // listener
    supabase.auth.onAuthStateChange(async (_evt, session) => {
      _userId = session?.user?.id || null;
      _cloudReady = !!_userId;
      onChange?.({ signedIn: isSignedIn(), userId: _userId });
    });
  }

  async function signUp(email, password) {
    if (!supabase) throw new Error("Supabase missing");
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
    return true;
  }

  async function signIn(email, password) {
    if (!supabase) throw new Error("Supabase missing");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return true;
  }

  async function signOut() {
    if (!supabase) throw new Error("Supabase missing");
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    return true;
  }

  // ---- Cloud IO ----
  async function loadCloud() {
    if (!supabase || !isSignedIn()) return null;

    const { data, error } = await supabase
      .from(TABLE)
      .select("state, updated_at")
      .eq("player_id", _userId)
      .maybeSingle();

    if (error) throw error;
    if (!data?.state) return null;

    const cloudState = data.state;
    const cloudUpdatedMs =
      cloudState?.updatedAtMs ||
      (data.updated_at ? Date.parse(data.updated_at) : 0);

    return { cloudState, cloudUpdatedMs };
  }

  async function saveCloud(state, { force = false } = {}) {
    if (!supabase || !isSignedIn()) return false;

    const now = Date.now();
    if (!force && (now - _lastCloudSaveAt) < CLOUD_SAVE_THROTTLE_MS) return false;
    _lastCloudSaveAt = now;

    const payload = {
      player_id: _userId,
      updated_at: new Date().toISOString(),
      state: JSON.parse(JSON.stringify(state))
    };

    const { error } = const { error } = await supabase
  .from(TABLE)
  .upsert(payload, { onConflict: "player_id" });
    if (error) throw error;
    return true;
  }

  async function wipeCloud() {
    if (!supabase || !isSignedIn()) return false;
    const { error } = await supabase.from(TABLE).delete().eq("player_id", _userId);
    if (error) throw error;
    return true;
  }

  /**
   * On sign-in:
   * - If cloud exists: RETURN cloud state (caller should replace in-memory state)
   * - If cloud doesn't exist: create from current state and return null
   *
   * This prevents the “guest run keeps going after sign-in” issue.
   */
  async function syncOnSignIn(currentState) {
    if (!supabase || !isSignedIn()) return { mode: "guest", cloudLoaded: null };

    const cloud = await loadCloud();
    if (cloud?.cloudState) {
      return { mode: "cloud", cloudLoaded: cloud.cloudState };
    }

    // No cloud yet: create it from current state (guest progress becomes account seed)
    await saveCloud(currentState, { force: true });
    return { mode: "cloud", cloudLoaded: null };
  }

  return {
    supabase,
    // local
    LOCAL_KEY,
    hasLocal,
    loadLocal,
    saveLocal,
    wipeLocal,

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
    syncOnSignIn
  };
}