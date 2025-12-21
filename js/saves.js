// /js/saves.js
// Bulletproof auth + cloud save load/merge rules + offline/AFK catch-up.
// Requires Supabase v2 script tag in index.html.

import { defaultState, sanitizeState, SAVE_VERSION, clamp } from "./state.js";
import { recompute, corruptionTick, autoGainPerSec } from "./economy.js";

export function createSaves(opts) {
  const {
    supabaseUrl,
    supabaseAnonKey,
    table = "saves",
    offlineCapSec = 6 * 60 * 60,
    cloudThrottleMs = 45_000
  } = opts;

  const supabase = window.supabase?.createClient?.(supabaseUrl, supabaseAnonKey);

  let userId = null;
  let cloudReady = false;

  // local fallback ONLY for guests; once signed in, we treat cloud as source of truth.
  const LOCAL_KEY = "sygn1l_guest_save_v1";

  function isSignedIn() {
    return !!(cloudReady && userId);
  }

  // -------- AFK / Offline simulation (browser closed) --------
  // We apply catch-up whenever we load any state (guest or cloud).
  function applyOfflineProgress(state) {
    const now = Date.now();
    const last = Number(state?.meta?.lastTickMs || state?.meta?.updatedAtMs || 0);
    if (!last || !Number.isFinite(last)) {
      state.meta.lastTickMs = now;
      return { appliedSec: 0, gained: 0 };
    }

    let dt = (now - last) / 1000;
    if (!Number.isFinite(dt) || dt < 3) {
      state.meta.lastTickMs = now;
      return { appliedSec: 0, gained: 0 };
    }

    dt = Math.min(dt, offlineCapSec);

    // compute current rates from upgrades
    const d = recompute(state);

    // passive gain
    const passive = d.sps * dt;

    // auto gain (per second)
    const auto = autoGainPerSec(state, d) * dt;

    const gained = passive + auto;
    if (gained > 0) {
      state.signal += gained;
      state.total += gained;

      // corruption should also creep while offline (scaled down a bit to be fair)
      // simulate in chunks to keep it stable
      const chunks = Math.min(60, Math.ceil(dt / 10));
      const step = dt / chunks;
      for (let i = 0; i < chunks; i++) corruptionTick(state, step * 0.85);
    }

    state.meta.lastTickMs = now;
    state.meta.updatedAtMs = now;
    // hard clamp to prevent accidental NaN bombs
    state.signal = clamp(Number(state.signal) || 0, 0, 1e30);
    state.total = clamp(Number(state.total) || 0, 0, 1e30);
    state.corruption = clamp(Number(state.corruption) || 0, 0, 1);

    return { appliedSec: dt, gained };
  }

  // -------- Local (guest) save/load --------
  function loadLocalGuest() {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return null;
    try {
      return sanitizeState(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  function saveLocalGuest(state) {
    // guest-only; signed-in users should not rely on this
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(state));
    } catch {}
  }

  function clearLocalGuest() {
    try { localStorage.removeItem(LOCAL_KEY); } catch {}
  }

  // -------- Cloud (signed in) save/load --------
  async function loadCloudState(uid) {
    const { data, error } = await supabase
      .from(table)
      .select("state, updated_at")
      .eq("player_id", uid)
      .maybeSingle();

    if (error) throw error;
    if (!data?.state) return null;

    const s = sanitizeState(data.state);
    // server timestamp fallback
    const serverMs = data.updated_at ? Date.parse(data.updated_at) : 0;
    const ms = Number(s.meta?.updatedAtMs || 0) || serverMs || 0;
    return { state: s, updatedMs: ms };
  }

  async function writeCloudState(state, force = false) {
    if (!isSignedIn()) return false;

    const now = Date.now();
    const lastWrite = Number(state.meta?.lastCloudWriteMs || 0);
    if (!force && now - lastWrite < cloudThrottleMs) return false;

    state.v = SAVE_VERSION;
    state.meta.updatedAtMs = now;
    state.meta.lastTickMs = state.meta.lastTickMs || now;
    state.meta.lastCloudWriteMs = now;

    const payload = {
      player_id: userId,
      updated_at: new Date(now).toISOString(),
      state: JSON.parse(JSON.stringify(state))
    };

    const { error } = await supabase.from(table).upsert(payload);
    if (error) throw error;
    return true;
  }

  async function deleteCloudState() {
    if (!isSignedIn()) return;
    const { error } = await supabase.from(table).delete().eq("player_id", userId);
    if (error) throw error;
  }

  // -------- Auth --------
  async function getSession() {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) throw error;
    return session;
  }

  async function signIn(email, password) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }

  async function signUp(email, password) {
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
  }

  async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }

  // -------- Initialization / Source of truth rules --------
  /**
   * init() decides what state to run:
   * - if signed-in: CLOUD IS SOURCE OF TRUTH (always load cloud if present)
   * - if no cloud exists yet: seed cloud with either existing guest state or a fresh state
   * - guest: local guest state, with offline progress applied
   */
  async function init() {
    if (!supabase) {
      // no supabase available -> pure guest
      let st = loadLocalGuest() || defaultState();
      applyOfflineProgress(st);
      saveLocalGuest(st);
      return { state: st, mode: "guest", cloud: false };
    }

    const session = await getSession();
    if (!session?.user?.id) {
      cloudReady = false;
      userId = null;

      // guest mode
      let st = loadLocalGuest() || defaultState();
      applyOfflineProgress(st);
      saveLocalGuest(st);
      return { state: st, mode: "guest", cloud: false };
    }

    // signed in
    cloudReady = true;
    userId = session.user.id;

    // IMPORTANT RULE: once signed-in, we do NOT continue guest progress blindly.
    // We load cloud if it exists; if not, we create it.
    const cloud = await loadCloudState(userId);

    if (cloud?.state) {
      const st = cloud.state;
      applyOfflineProgress(st);
      // push offline-applied changes back to cloud (force)
      await writeCloudState(st, true);
      // guest file is now irrelevant; optional to clear
      // clearLocalGuest();
      return { state: st, mode: "signed_in", cloud: true };
    }

    // no cloud save exists yet -> seed it
    const guest = loadLocalGuest();
    const seed = guest ? guest : defaultState();
    applyOfflineProgress(seed);
    await writeCloudState(seed, true);
    // clearLocalGuest();
    return { state: seed, mode: "signed_in", cloud: true };
  }

  // Listen for auth changes and let main.js decide what to do
  function onAuthChange(cb) {
    if (!supabase) return () => {};
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      cloudReady = !!session?.user?.id;
      userId = session?.user?.id || null;
      cb({ signedIn: !!userId, userId });
    });
    return () => sub.subscription?.unsubscribe?.();
  }

  // Public API
  return {
    supabase,
    isSignedIn,
    getUserId: () => userId,
    init,
    onAuthChange,

    // guest
    loadLocalGuest,
    saveLocalGuest,
    clearLocalGuest,

    // cloud
    loadCloudState: async () => (isSignedIn() ? loadCloudState(userId) : null),
    writeCloudState,
    deleteCloudState,

    // auth
    signIn,
    signUp,
    signOut,

    // offline helper
    applyOfflineProgress
  };
}