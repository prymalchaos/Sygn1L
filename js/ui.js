// /js/ui.js
// DOM + rendering only. No Supabase. No game math (that stays in economy.js).



import { esc, fmt, fmtFull } from "./state.js";
import { PHASES, corruptionLabel, prestigeGain, canRite } from "./economy.js";

// NOTE: All sound (button clicks, pings, music) is handled by /js/core/audio.js.
// UI remains purely DOM + rendering.

export function createUI() {
  const $ = (id) => document.getElementById(id);

  // ----------------------------
  // Modal windows (bigger than popups)
  // ----------------------------
  function ensureModalStyles() {
    if (document.getElementById("sygn1lModalStyles")) return;
    const st = document.createElement("style");
    st.id = "sygn1lModalStyles";
    st.textContent = `
      .sygModalHost{ position:fixed; inset:0; z-index:9999; display:flex; align-items:center; justify-content:center; padding:16px; }
      .sygModalShade{ position:absolute; inset:0; background:rgba(0,0,0,.65); backdrop-filter: blur(2px); }
      .sygModal{ position:relative; width:min(720px, 100%); max-height:min(78vh, 620px);
        background:rgba(10,12,16,.96); border:1px solid rgba(255,255,255,.14);
        border-radius:16px; overflow:hidden; box-shadow:0 18px 60px rgba(0,0,0,.55);
      }
      .sygModalHead{ display:flex; align-items:center; justify-content:space-between; gap:12px;
        padding:12px 12px 10px; border-bottom:1px solid rgba(255,255,255,.10);
      }
      .sygModalTitle{ font-weight:700; letter-spacing:.08em; font-size:12px; opacity:.95; }
      .sygModalClose{ padding:10px 12px; border-radius:12px; }
      .sygModalBody{ padding:12px; overflow:auto; max-height:calc(min(78vh, 620px) - 54px); }
      .sygModalBody h3{ margin:10px 0 8px; font-size:12px; letter-spacing:.08em; opacity:.9; }
      .sygModalBody .muted{ opacity:.7; }
      .sygLbRow{ display:flex; justify-content:space-between; gap:12px; padding:8px 10px; border-radius:12px;
        border:1px solid rgba(255,255,255,.08); margin:6px 0; background:rgba(255,255,255,.03);
      }
      .sygLbLeft{ display:flex; flex-direction:column; gap:2px; min-width:0; }
      .sygLbName{ font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .sygLbMeta{ font-size:12px; opacity:.75; }
      .sygLbTime{ font-variant-numeric: tabular-nums; font-weight:800; }
    `;
    document.head.appendChild(st);
  }

  function modal(title, content, opts = {}) {
    ensureModalStyles();
    const host = document.createElement("div");
    host.className = "sygModalHost";

    const shade = document.createElement("div");
    shade.className = "sygModalShade";
    host.appendChild(shade);

    const box = document.createElement("div");
    box.className = "sygModal";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");

    const head = document.createElement("div");
    head.className = "sygModalHead";
    head.innerHTML = `
      <div class="sygModalTitle">${esc(title || "WINDOW")}</div>
      <button class="sygModalClose">CLOSE</button>
    `;
    box.appendChild(head);

    const body = document.createElement("div");
    body.className = "sygModalBody";
    if (typeof content === "string") body.innerHTML = content;
    else if (content instanceof Node) body.appendChild(content);
    box.appendChild(body);

    host.appendChild(box);
    document.body.appendChild(host);

    const close = () => {
      try { opts.onClose?.(); } catch {}
      host.remove();
    };
    head.querySelector(".sygModalClose")?.addEventListener("click", close);
    shade.addEventListener("click", close);
    document.addEventListener(
      "keydown",
      (e) => {
        if (e.key === "Escape") close();
      },
      { once: true }
    );

    return { host, body, close };
  }

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
    const host = $("popHost");
    if (!host) return;

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

    const box = document.createElement("div");
    box.className = "pop" + (level === "danger" ? " danger" : "");
    box.innerHTML = `
      <div class="who">${esc(who || "SYS")}</div>
      <div class="msg">${esc(msg)}</div>
      <div class="hint">TAP TO CLOSE</div>
    `;
    box.style.pointerEvents = "auto";
    box.addEventListener("click", () => box.remove());
    host.prepend(box);
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

    // Phase LED: off for Phase 0, on otherwise
    const ledPhase = $("ledPhase");
    if (ledPhase) ledPhase.classList.toggle("on", Number(ph.n) > 0);
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
    // Prefer a precomputed "display" SPS if provided by the core loop.
    // Falls back to the core economy SPS.
    const spsVal = (derived && (derived.displaySps ?? derived.sps)) || 0;
    setSmartNumber($("sps"), spsVal);

    // Signal/sec LED: on when producing positive passive gain
    const ledSps = $("ledSps");
    if (ledSps) ledSps.classList.toggle("on", Number(spsVal) > 0);

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
    modal,
    monitor,
    applyPhaseUI,
    renderHUD,
    renderUpgrades,
    setVisible
  };
}
