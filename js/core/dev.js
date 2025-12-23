// /js/core/dev.js
// Robust-ish dev mode that doesn't pollute gameplay code.

export function createDevTools({ ui, saves }) {
  let enabled = false;

  function isEnabled() {
    const url = new URL(location.href);
    if (url.searchParams.get("dev") === "1") return true;
    // You can also flip this in console: localStorage.sygn1lDev='1'
    if (localStorage.getItem("sygn1lDev") === "1") return true;
    return enabled;
  }

  function buildPanel(api) {
    // Create once
    let host = ui.$("devPanel");
    if (host) return host;

    // Put it at the bottom of the page so it doesn't crowd core UI.
    const anchor = document.querySelector(".wrap");
    if (!anchor) return null;

    host = document.createElement("div");
    host.id = "devPanel";
    host.style.marginTop = "12px";
    host.style.borderTop = "1px solid rgba(255,255,255,.08)";
    host.style.paddingTop = "12px";

    host.innerHTML = `
      <div class="muted" style="letter-spacing:.12em; font-size:11px; margin-bottom:8px;">DEV MODE</div>
      <div class="grid2">
        <button id="devP0">LOAD P0</button>
        <button id="devP1">LOAD P1</button>
      </div>
      <div class="grid2">
        <button id="devPlus1k">+1,000 SIGNAL</button>
        <button id="devPlus1m">+1,000,000 SIGNAL</button>
      </div>
      <div class="grid2">
        <button id="devClearPhase">CLEAR PHASE DATA</button>
        <button id="devDump">DUMP STATE</button>
      </div>
      <div class="grid2">
        <button id="devAiOn">AI ON</button>
        <button id="devAiOff">AI OFF</button>
      </div>

      <div style="height:10px"></div>
      <div class="muted" style="letter-spacing:.12em; font-size:11px; margin-bottom:8px;">ACCOUNT PURGE (DEV)</div>
      <div class="grid2">
        <button id="devWipeCloud">DELETE MY CLOUD SAVE</button>
        <button id="devDeleteMe">DELETE MY ACCOUNT</button>
      </div>
      <div style="height:10px"></div>
      <button id="devListUsers" style="width:100%">LIST TEST ACCOUNTS</button>
      <div id="devUsers" style="margin-top:10px; max-height:220px; overflow:auto;"></div>
    `;

    anchor.appendChild(host);

    // Wiring
    ui.$("devP0").onclick = () => api.setPhase(0);
    ui.$("devP1").onclick = () => api.setPhase(1);

    ui.$("devPlus1k").onclick = () => {
      api.state.signal += 1000;
      api.state.total += 1000;
      api.touch();
      api.recomputeAndRender();
    };
    ui.$("devPlus1m").onclick = () => {
      api.state.signal += 1_000_000;
      api.state.total += 1_000_000;
      api.touch();
      api.recomputeAndRender();
    };

    ui.$("devClearPhase").onclick = () => {
      api.state.phaseData = {};
      api.touch();
      api.recomputeAndRender();
      ui.pushLog("log", "SYS", "DEV: phaseData cleared.");
    };

    ui.$("devDump").onclick = () => {
      console.log("STATE DUMP", JSON.parse(JSON.stringify(api.state)));
      ui.popup("DEV", "Dumped state to console.");
    };

    ui.$("devAiOn").onclick = () => api.setAiEnabled(true);
    ui.$("devAiOff").onclick = () => api.setAiEnabled(false);

    // Purge tools
    ui.$("devWipeCloud").onclick = async () => {
      if (!saves.isSignedIn()) {
        ui.popup("DEV", "Not signed in.");
        return;
      }
      const ok = confirm("Delete your cloud save row? (Your auth account stays.)");
      if (!ok) return;
      try {
        await saves.wipeCloud();
        ui.popup("DEV", "Cloud save deleted.");
      } catch (e) {
        ui.popup("DEV", `Cloud delete failed: ${e?.message || e}`, { level: "danger" });
      }
    };

    ui.$("devDeleteMe").onclick = async () => {
      // This requires a custom edge function (service role) that you control.
      const ok = confirm(
        "This requires an Edge Function called 'sygn1l-admin' with permission to delete users.\n\nAttempt it?"
      );
      if (!ok) return;
      try {
        await saves.adminInvoke("delete_self");
        ui.popup("DEV", "Delete requested. If successful, you will be signed out.");
      } catch (e) {
        ui.popup(
          "DEV",
          `Admin delete unavailable: ${e?.message || e}`,
          { level: "danger" }
        );
      }
    };

    ui.$("devListUsers").onclick = async () => {
      const out = ui.$("devUsers");
      if (!out) return;
      out.innerHTML = "";
      try {
        const data = await saves.adminInvoke("list_users");
        const users = Array.isArray(data?.users) ? data.users : [];
        if (!users.length) {
          out.innerHTML = '<div class="muted">(no users returned)</div>';
          return;
        }

        for (const u of users) {
          const row = document.createElement("div");
          row.style.display = "flex";
          row.style.justifyContent = "space-between";
          row.style.alignItems = "center";
          row.style.padding = "8px 0";
          row.style.borderBottom = "1px solid rgba(255,255,255,.06)";

          const label = document.createElement("div");
          label.className = "muted";
          label.style.fontSize = "11px";
          label.style.letterSpacing = ".08em";
          label.textContent = u.email || u.id || "(unknown)";

          const del = document.createElement("button");
          del.textContent = "DELETE";
          del.onclick = async () => {
            const ok = confirm(`Delete account: ${label.textContent}?`);
            if (!ok) return;
            try {
              await saves.adminInvoke("delete_user", { id: u.id, email: u.email });
              row.remove();
            } catch (e) {
              ui.popup("DEV", `Delete failed: ${e?.message || e}`, { level: "danger" });
            }
          };

          row.appendChild(label);
          row.appendChild(del);
          out.appendChild(row);
        }
      } catch (e) {
        out.innerHTML = `<div class="muted">Admin list unavailable: ${String(e?.message || e)}</div>`;
      }
    };

    return host;
  }

  function tick(api) {
    if (!isEnabled()) return;
    buildPanel(api);
  }

  return { isEnabled, tick };
}
