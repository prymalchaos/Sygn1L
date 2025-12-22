// /js/ui.js
// DOM + rendering only. No Supabase. No game math (that stays in economy.js).

import { esc, fmt, fmtFull } from "./state.js";
import { PHASES, corruptionLabel, prestigeGain, canRite } from "./economy.js";

export function createUI() {
  const $ = (id) => document.getElementById(id);

  // ----------------------------
  // Logs + popups
  // ----------------------------
  function pushLog(elId, tag, msg) {
    const host = $(elId);
    if (!host) return;
    const p = document.createElement("p");
    p.innerHTML = `<span class="tag">${esc(tag)}</span>${esc(msg)}`;
    host.prepend(p);
  }

  function popup(who, msg, opts = {}) {
  const level = opts.level || "info";

  // Anything "BOOT"/systemy should never be a player popup.
  const isBoot =
    (who && String(who).toUpperCase() === "BOOT") ||
    (msg && /HTML loaded|Waiting for modules|BOOT/i.test(String(msg)));

  // If it's boot, quietly log it instead
  if (isBoot) {
    pushLog("log", "BOOT", String(msg));
    return;
  }

  // Optional: allow dev to silence popups entirely
  if (window.__DEV__ && window.__DEV__.silentPopups) {
    pushLog("log", String(who || "SYS"), String(msg));
    return;
  }

  // ... existing popup rendering below ...
  // (keep whatever you already do to show the popup)
}

  // ----------------------------
  // Station monitor (narrative)
  // ----------------------------
  function monitor(text) {
    const el = $("nText");
    if (el) el.textContent = text;
  }

  // ----------------------------
  // Phase text/tint
  // ----------------------------
  function applyPhaseUI(phaseN) {
    const ph = PHASES.find((p) => p.n === phaseN) || PHASES[0];

    document.documentElement.dataset.phase = String(ph.n);
    document.documentElement.style.setProperty("--accent", `var(--${ph.tint})`);

    if ($("phase")) $("phase").textContent = `PHASE ${ph.n}`;
    if ($("status")) $("status").textContent = ph.status;
    if ($("subtitle")) $("subtitle").textContent = ph.sub;
    if ($("objective")) $("objective").textContent = "OBJECTIVE: " + ph.obj;
    if ($("phaseTint")) $("phaseTint").textContent = "P" + ph.n;
  }

  // ----------------------------
  // HUD
  // ----------------------------
  function setSmartNumber(el, n) {
    if (!el) return;
    el.textContent = fmtFull(n);
    if (el.scrollWidth > el.clientWidth) el.textContent = fmt(n);
  }

  function renderHUD(state, derived, syncText) {
    setSmartNumber($("signal"), state.signal);
    setSmartNumber($("sps"), derived.sps);

    if ($("buildChip")) $("buildChip").textContent = "BUILD: " + state.build;
    if ($("relicChip")) $("relicChip").textContent = "RELICS: " + state.relics;
    if ($("userChip")) $("userChip").textContent = "USER: " + (state.profile?.name || "GUEST");

    if ($("corrFill")) $("corrFill").style.width = ((state.corruption || 0) * 100).toFixed(1) + "%";
    if ($("corrText")) {
      $("corrText").textContent =
        ((state.corruption || 0) * 100).toFixed(1) + "% (" + corruptionLabel(state.corruption || 0) + ")";
    }

    const rite = $("riteBtn");
    if (rite) {
      const can = canRite(state);
      rite.disabled = !can;
      rite.textContent = can ? `RITE +${prestigeGain(state)}` : "RITE";
    }

    if ($("syncChip") && syncText) $("syncChip").textContent = syncText;
  }

  // ----------------------------
  // Upgrades
  // ----------------------------
  function renderUpgrades({ state, upgrades, canBuy, getCost, getLevel, onBuy }) {
    const root = $("upgrades");
    if (!root) return;
    root.innerHTML = "";

    for (const u of upgrades) {
      if (u.id === "relicAmp" && state.relics <= 0 && getLevel(u.id) === 0) continue;

      const unlocked = (state.total || 0) >= u.unlock;
      const price = getCost(u);
      const currency = u.currency || "signal";
      const affordable = canBuy(u);

      const row = document.createElement("div");
      row.className = "up" + (affordable ? " afford" : "") + (!unlocked ? " locked" : "");

      const meta = document.createElement("div");
      meta.className = "meta";
      meta.innerHTML = `
        <div class="name">${esc(u.name)} (LV ${getLevel(u.id)})</div>
        <div class="desc">${esc(unlocked ? u.desc : `LOCKED UNTIL ${fmt(u.unlock)} TOTAL.`)}</div>
        <div class="cost">${unlocked ? `COST: ${fmt(price)} ${currency.toUpperCase()}` : "STATUS: LOCKED"}</div>
      `;

      const btn = document.createElement("button");
      btn.textContent = affordable ? "ACQUIRE" : unlocked ? "LOCKED" : "CLASSIF";
      btn.disabled = !affordable;
      btn.onclick = async () => {
        if (btn.disabled) return;
        await onBuy(u);
      };

      row.appendChild(meta);
      row.appendChild(btn);
      root.appendChild(row);
    }
  }

  // ----------------------------
  // Tiny utilities
  // ----------------------------
  function setVisible(id, on) {
    const el = $(id);
    if (!el) return;
    el.style.display = on ? "" : "none";
  }

  return {
    $,
    pushLog,
    popup,
    monitor,
    applyPhaseUI,
    renderHUD,
    renderUpgrades,
    setVisible
  };
}
