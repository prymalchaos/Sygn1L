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
      box.innerHTML = <div class="who">SYS</div><div class="msg">JS ERROR: ${String(msg).replaceAll("<","&lt;")}</div><div class="hint">Tap to close</div>;
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
  const DEV_MASTER_UID = "7ac61fd5-1d8a-4c27-95b9-a491f2121380";