// /js/core/dev.js
// Dev tools + Admin user manager (master-only server-side).
// Uses saves.adminInvoke if available, otherwise tries saves.supabase.functions.invoke.

export function createDevTools({ ui, saves }) {
  function isEnabled() {
    const url = new URL(location.href);
    return url.searchParams.get("dev") === "1" || localStorage.getItem("sygn1lDev") === "1";
  }

  async function adminCall(op, payload = {}) {
    // Preferred: your existing wrapper (expected signature: (op, payload))
    if (saves?.adminInvoke) {
      return await saves.adminInvoke(op, payload);
    }

    // Fallback: direct supabase client (if your saves module exposes it)
    const sb = saves?.supabase;
    if (sb?.functions?.invoke) {
      const { data, error } = await sb.functions.invoke("sygn1l-admin", {
        body: { op, ...payload },
      });
      if (error) throw error;
      return data;
    }

    throw new Error("Admin invoke not available (no saves.adminInvoke or saves.supabase.functions.invoke).");
  }

  function buildPanel(api) {
    let host = ui.$("devPanel");
    if (host) return host;

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
      <div class="muted" style="letter-spacing:.12em; font-size:11px; margin-bottom:8px;">ACCOUNT PURGE (SELF)</div>

      <div class="grid2">
        <button id="devWipeCloud">DELETE MY CLOUD SAVE</button>
        <button id="devDeleteMe">DELETE MY ACCOUNT</button>
      </div>

      <div style="height:14px"></div>
      <div class="muted" style="letter-spacing:.12em; font-size:11px; margin-bottom:8px;">ADMIN: USER MANAGER</div>

      <div style="display:flex; gap:8px; align-items:center;">
        <input id="devUserSearch" placeholder="search email / id" style="flex:1; padding:10px; border-radius:10px; border:1px solid rgba(255,255,255,.10); background:rgba(0,0,0,.25); color:inherit;" />
        <button id="devUserRefresh">REFRESH</button>
      </div>

      <div style="display:flex; gap:8px; align-items:center; margin-top:8px;">
        <button id="devUserPrev">◀</button>
        <div class="muted" id="devUserPage" style="font-size:11px; letter-spacing:.08em;">PAGE 1</div>
        <button id="devUserNext">▶</button>

        <div style="flex:1"></div>

        <select id="devUserPerPage" style="padding:10px; border-radius:10px; border:1px solid rgba(255,255,255,.10); background:rgba(0,0,0,.25); color:inherit;">
          <option value="10">10 / page</option>
          <option value="25" selected>25 / page</option>
          <option value="50">50 / page</option>
        </select>
      </div>

      <div style="margin-top:10px;" class="muted" id="devUserStatus"></div>

      <div style="margin-top:10px; max-height:280px; overflow:auto; border:1px solid rgba(255,255,255,.06); border-radius:12px; padding:6px;" id="devUsers"></div>

      <div style="height:10px"></div>
      <div class="muted" style="font-size:11px; letter-spacing:.08em;">
        Tip: “Delete SAVE” wipes the saves row only. “Delete USER” deletes auth user + save row.
      </div>
    `;

    anchor.appendChild(host);

    // Basic dev tools
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

    ui.$("devAiOn").onclick = () => api.setAiEnabled?.(true);
    ui.$("devAiOff").onclick = () => api.setAiEnabled?.(false);

    // Self tools
    ui.$("devWipeCloud").onclick = async () => {
      if (!saves?.isSignedIn?.()) return ui.popup("DEV", "Not signed in.");
      const ok = confirm("Delete your cloud save row? (Your auth account stays.)");
      if (!ok) return;
      try {
        await saves.wipeCloud?.();
        ui.popup("DEV", "Cloud save deleted.");
      } catch (e) {
        ui.popup("DEV", `Cloud delete failed: ${e?.message || e}`, { level: "danger" });
      }
    };

    ui.$("devDeleteMe").onclick = async () => {
      const ok = confirm("Delete YOUR auth account + save row?\n\nThis uses sygn1l-admin Edge Function.");
      if (!ok) return;
      try {
        const res = await adminCall("delete_self", {});
        ui.popup("DEV", `Delete requested. (save rows deleted: ${res?.save_deleted_rows ?? "?"})`);
      } catch (e) {
        ui.popup("DEV", `Delete failed: ${e?.message || e}`, { level: "danger" });
      }
    };

    // Admin user manager
    const out = ui.$("devUsers");
    const status = ui.$("devUserStatus");
    const pageLabel = ui.$("devUserPage");
    const searchEl = ui.$("devUserSearch");
    const perPageEl = ui.$("devUserPerPage");

    let page = 1;
    let perPage = 25;
    let lastQuery = "";

    function setStatus(t) {
      if (status) status.textContent = t || "";
    }

    function renderUsers(users) {
      if (!out) return;
      out.innerHTML = "";

      if (!users?.length) {
        out.innerHTML = `<div class="muted" style="padding:10px;">(no users returned)</div>`;
        return;
      }

      for (const u of users) {
        const email = u.email || "(no email)";
        const uid = u.id || "(no id)";
        const created = u.created_at ? new Date(u.created_at).toLocaleString() : "";

        const row = document.createElement("div");
        row.style.display = "grid";
        row.style.gridTemplateColumns = "1fr auto auto";
        row.style.gap = "8px";
        row.style.alignItems = "center";
        row.style.padding = "10px";
        row.style.borderBottom = "1px solid rgba(255,255,255,.06)";

        const label = document.createElement("div");
        label.className = "muted";
        label.style.fontSize = "11px";
        label.style.letterSpacing = ".08em";
        label.style.lineHeight = "1.25";
        label.textContent = `${email}\n${uid}${created ? "  •  " + created : ""}`;

        const delSave = document.createElement("button");
        delSave.textContent = "DELETE SAVE";
        delSave.onclick = async () => {
          const ok = confirm(
            `Delete SAVE only for:\n${email}\n${uid}\n\nThis does NOT delete the auth account.`
          );
          if (!ok) return;

          try {
            delSave.disabled = true;
            const res = await adminCall("delete_save", { id: uid });
            ui.popup("DEV", `Save deleted (rows: ${res?.save_deleted_rows ?? "?"}).`);
            await fetchUsers();
          } catch (e) {
            ui.popup("DEV", `Delete save failed: ${e?.message || e}`, { level: "danger" });
          } finally {
            delSave.disabled = false;
          }
        };

        const delUser = document.createElement("button");
        delUser.textContent = "DELETE USER";
        delUser.onclick = async () => {
          const typed = prompt(`Type DELETE to confirm deletion of AUTH USER + SAVE:\n\n${email}\n${uid}`);
          if (typed !== "DELETE") return;

          try {
            delUser.disabled = true;
            const res = await adminCall("delete_user", { id: uid });
            ui.popup(
              "DEV",
              `User deleted. Save rows deleted: ${res?.save_deleted_rows ?? "?"}`
            );
            await fetchUsers();
          } catch (e) {
            ui.popup("DEV", `Delete failed: ${e?.message || e}`, { level: "danger" });
          } finally {
            delUser.disabled = false;
          }
        };

        row.appendChild(label);
        row.appendChild(delSave);
        row.appendChild(delUser);
        out.appendChild(row);
      }
    }

    async function fetchUsers() {
      if (!pageLabel) return;

      pageLabel.textContent = `PAGE ${page}`;
      perPage = parseInt(perPageEl?.value || "25", 10) || 25;

      const q = (searchEl?.value || "").trim();
      lastQuery = q;

      setStatus("Loading…");
      try {
        const data = await adminCall("list_users", { page, per_page: perPage, q });
        const users = Array.isArray(data?.users) ? data.users : [];
        const total = typeof data?.total === "number" ? data.total : null;

        renderUsers(users);
        setStatus(total != null ? `Showing ${users.length} (total ~${total})` : `Showing ${users.length}`);
      } catch (e) {
        out.innerHTML = `<div class="muted" style="padding:10px;">Admin list unavailable: ${String(e?.message || e)}</div>`;
        setStatus("");
      }
    }

    ui.$("devUserRefresh").onclick = () => fetchUsers();

    ui.$("devUserPrev").onclick = () => {
      page = Math.max(1, page - 1);
      fetchUsers();
    };

    ui.$("devUserNext").onclick = () => {
      page += 1;
      fetchUsers();
    };

    perPageEl.onchange = () => {
      page = 1;
      fetchUsers();
    };

    let searchTimer = null;
    searchEl.oninput = () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        if ((searchEl.value || "").trim() !== lastQuery) {
          page = 1;
          fetchUsers();
        }
      }, 250);
    };

    // Initial load
    fetchUsers();

    return host;
  }

  function tick(api) {
    if (!isEnabled()) return;
    buildPanel(api);
  }

  return { isEnabled, tick };
}