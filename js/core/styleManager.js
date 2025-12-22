// /js/core/styleManager.js
// Lets phases inject CSS safely (and remove it cleanly on exit).

export function createStyleManager() {
  const map = new Map(); // id -> <style>

  function add(id, cssText) {
    remove(id);
    const el = document.createElement("style");
    el.setAttribute("data-phase-style", id);
    el.textContent = String(cssText || "");
    document.head.appendChild(el);
    map.set(id, el);
  }

  function remove(id) {
    const el = map.get(id);
    if (el?.parentNode) el.parentNode.removeChild(el);
    map.delete(id);
  }

  function clearAll() {
    for (const id of [...map.keys()]) remove(id);
  }

  return { add, remove, clearAll };
}
