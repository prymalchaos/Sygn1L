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

    const anchor = ui.$("objective")?.parentElement;
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

    return host;
  }

  function tick(api) {
    if (!isEnabled()) return;
    buildPanel(api);
  }

  return { isEnabled, tick };
}
