// /js/ui.js
// DOM + rendering only. No Supabase. No game math (that stays in economy.js).

import { esc, fmt } from "./state.js";
import { PHASES, corruptionLabel, prestigeGain, canRite } from "./economy.js";

export function createUI() {
  const $ = (id) => document.getElementById(id);

  // --- basic safety
  function must(id) {
    const el = $(id);
    if (!el) throw new Error("Missing element #" + id);
    return el;
  }

  // --- Logs
  function pushLog(elId, tag, msg) {
    const host = $(elId);
    if (!host) return;
    const p = document.createElement("p");
    p.innerHTML = `<span class="tag">${esc(tag)}</span>${msg}`;
    host.prepend(p);
  }

  // --- Popups (tap to close)
  function popup(who, msg) {
    const host = $("popHost");
    if (!host) return;
    const box = document.createElement("div");
    box.className = "pop";
    box.innerHTML = `
      <div class="who">${esc(who)}</div>
      <div class="msg">${esc(msg)}</div>
      <div class="hint">TAP TO CLOSE</div>
    `;
    // allow tap to close even though host is overlay
    box.style.pointerEvents = "auto";
    box.addEventListener("click", () => box.remove());
    host.prepend(box);
  }

  // --- Modal
  function openModal(title, html) {
    must("modalTitle").textContent = title;
    must("modalBody").innerHTML = html;
    const back = must("modalBack");
    back.style.display = "flex";
    back.setAttribute("aria-hidden", "false");
  }
  function closeModal() {
    const back = must("modalBack");
    back.style.display = "none";
    back.setAttribute("aria-hidden", "true");
    must("modalBody").innerHTML = "";
  }

  // close wiring
  if ($("modalClose")) $("modalClose").onclick = closeModal;
  if ($("modalBack")) {
    $("modalBack").addEventListener("click", (e) => {
      if (e.target === $("modalBack")) closeModal();
    });
  }

  // --- Confirmation dialog (uses native confirm for reliability on mobile)
  function confirmAction(text) {
    return window.confirm(text);
  }

  // --- Apply phase tint + text
  function applyPhaseUI(phaseN) {
    const ph = PHASES[Math.max(0, Math.min(PHASES.length - 1, phaseN - 1))];

    // CSS hook: data-phase + --accent token
    document.documentElement.dataset.phase = String(ph.n);
    // If your CSS uses --accent, we map it to --p1..--p6 variables
    document.documentElement.style.setProperty("--accent", `var(--${ph.tint})`);

    if ($("phase")) $("phase").textContent = `PHASE ${ph.n}`;
    if ($("status")) $("status").textContent = ph.status;
    if ($("subtitle")) $("subtitle").textContent = ph.sub;
    if ($("objective")) $("objective").textContent = "OBJECTIVE: " + ph.obj;
    if ($("phaseTint")) $("phaseTint").textContent = "P" + ph.n;
  }

  // --- HUD render
  function renderHUD(state, derived, syncText) {
    if ($("signal")) $("signal").textContent = fmt(state.signal);
    if ($("sps")) $("sps").textContent = fmt(derived.sps);

    if ($("buildChip")) $("buildChip").textContent = "BUILD: " + state.build;
    if ($("relicChip")) $("relicChip").textContent = "RELICS: " + state.relics;

    if ($("userChip")) $("userChip").textContent = "USER: " + (state.profile?.name || "GUEST");

    // corruption bar
    if ($("corrFill")) $("corrFill").style.width = ((state.corruption || 0) * 100).toFixed(1) + "%";
    if ($("corrText")) $("corrText").textContent =
      ((state.corruption || 0) * 100).toFixed(1) + "% (" + corruptionLabel(state.corruption || 0) + ")";

    // rite button shows gain
    const rite = $("riteBtn");
    if (rite) {
      const can = canRite(state);
      rite.disabled = !can;
      rite.textContent = can ? `RITE +${prestigeGain(state)}` : "RITE";
    }

    // sync chip text supplied by main
    if ($("syncChip") && syncText) $("syncChip").textContent = syncText;

    // AI chip display handled in ai.js, but we can show a default
    if ($("aiChip")) $("aiChip").textContent = $("aiChip").textContent || "AI: …";
  }

  // --- Upgrades render
  /**
   * @param {Array} upgrades - UPGRADES from economy.js
   * @param {Function} canBuy - (u) => boolean
   * @param {Function} getCost - (u) => number
   * @param {Function} getLevel - (id) => number
   * @param {Function} onBuy - async (u) => void
   */
  function renderUpgrades({ state, upgrades, canBuy, getCost, getLevel, onBuy }) {
    const root = $("upgrades");
    if (!root) return;
    root.innerHTML = "";

    for (const u of upgrades) {
      // show relic amp only when relevant
      if (u.id === "relicAmp" && (state.relics <= 0 && getLevel(u.id) === 0)) continue;

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
      btn.textContent = affordable ? "ACQUIRE" : (unlocked ? "LOCKED" : "CLASSIF");
      btn.disabled = !affordable;

      // glow when available
      if (affordable) row.classList.add("afford");

      btn.onclick = async () => {
        if (btn.disabled) return;
        await onBuy(u);
      };

      row.appendChild(meta);
      row.appendChild(btn);
      root.appendChild(row);
    }
  }

  // --- Help/Manual
  function openManual() {
    openModal(
      "HOME BASE COMMUNIQUE",
      `
      <div class="scrollBox">
        <p><span class="tag">HB</span>
        Operator: we are receiving structured noise from a deep-array we should not have built.
        Your job is simple. Keep the Signal climbing. Keep Corruption from climbing faster.</p>

        <p><span class="tag">HOW</span>
        Tap <b>PING</b> to gain Signal. Buy <b>DISH</b> for passive Signal/sec.
        Unlock buffs by reaching <b>Total</b> milestones. When Corruption starts whispering, treat it like a live wire.</p>

        <p><span class="tag">TIP</span>
        Sign in to sync your save across devices. Your callsign appears in comms. Make it yours.</p>
      </div>
      `
    );
  }

  // --- Username editor UI
  function openUsernameEditor(currentName, onSave) {
    openModal(
      "IDENTITY OVERRIDE",
      `
      <p><span class="tag">OPS</span>A callsign makes the logs readable.</p>
      <input class="texty" id="nameInput" maxlength="18" placeholder="USERNAME" value="${esc(currentName)}" />
      <div style="height:10px"></div>
      <button id="nameSave" style="width:100%">SAVE</button>
      `
    );
    const input = document.getElementById("nameInput");
    const btn = document.getElementById("nameSave");
    if (btn) btn.onclick = () => {
      const name = (input?.value || "").trim().slice(0, 18);
      onSave(name);
      closeModal();
    };
  }

  // public
  return {
    $,
    pushLog,
    popup,
    openModal,
    closeModal,
    confirmAction,
    applyPhaseUI,
    renderHUD,
    renderUpgrades,
    openManual,
    openUsernameEditor
  };
}