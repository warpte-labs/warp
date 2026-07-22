/**
 * Warp.agentFill — radial fill circle for multi-agent (no spin, no pulse).
 * Fill grows from center toward the inner edge of the ring.
 * Color is per-agent via CSS --agent-color.
 */
(function (global) {
  "use strict";

  const W = (global.Warp = global.Warp || {});

  /** Distinct hues for concurrent agents */
  const PALETTE = [
    "#7aa2f7", // blue
    "#9ece6a", // green
    "#bb9af7", // purple
    "#e0af68", // amber
    "#7dcfff", // cyan
    "#f7768e", // rose
    "#73daca", // teal
    "#ff9e64", // orange
    "#c0caf5", // soft white-blue
    "#ff007c", // magenta
  ];

  const colorById = new Map();
  let colorSeq = 0;

  /**
   * Stable color for an agent / task id.
   * @param {string} id
   * @returns {string}
   */
  function colorFor(id) {
    const key = String(id || "agent");
    if (colorById.has(key)) {
      return colorById.get(key);
    }
    // Prefer hash so reload looks stable when possible
    let h = 0;
    for (let i = 0; i < key.length; i++) {
      h = (h * 31 + key.charCodeAt(i)) >>> 0;
    }
    const c = PALETTE[h % PALETTE.length];
    // If collision with last few sequential picks, nudge
    const pick = PALETTE[(h + colorSeq) % PALETTE.length] || c;
    colorSeq++;
    colorById.set(key, pick);
    return pick;
  }

  /**
   * @param {{
   *   state?: "idle"|"running"|"done"|"error",
   *   fill?: number,
   *   color?: string,
   *   id?: string
   * }} opts
   * @returns {string}
   */
  function html(opts) {
    const o = opts || {};
    const state = o.state || "idle";
    const fill = clampFill(o.fill != null ? o.fill : stateFill(state));
    const color = o.color || colorFor(o.id || "default");
    return (
      '<div class="agent-fill-dot" data-state="' +
      esc(state) +
      '" style="--agent-color:' +
      esc(color) +
      ";--fill:" +
      fill +
      '" aria-hidden="true">' +
      '<span class="agent-fill-ring"></span>' +
      '<span class="agent-fill-core"></span>' +
      "</div>"
    );
  }

  /**
   * @param {HTMLElement|null} el
   * @param {{
   *   state?: string,
   *   fill?: number,
   *   color?: string
   * }} opts
   */
  function update(el, opts) {
    if (!el) return;
    const o = opts || {};
    if (o.state) {
      el.dataset.state = o.state;
    }
    if (o.color) {
      el.style.setProperty("--agent-color", o.color);
    }
    const fill =
      o.fill != null
        ? clampFill(o.fill)
        : o.state
          ? stateFill(o.state)
          : null;
    if (fill != null) {
      el.style.setProperty("--fill", String(fill));
    }
  }

  /**
   * Map task status → visual state + fill amount.
   * @param {string} status
   */
  function fromTaskStatus(status) {
    const s = String(status || "").toLowerCase();
    if (s === "failed" || s === "error") {
      return { state: "error", fill: 1 };
    }
    if (s === "cancelled" || s === "canceled") {
      return { state: "error", fill: 0.55 };
    }
    if (s === "completed" || s === "done" || s === "success") {
      return { state: "done", fill: 1 };
    }
    if (s === "pending" || s === "queued") {
      return { state: "running", fill: 0.18 };
    }
    // running
    return { state: "running", fill: 0.55 };
  }

  function stateFill(state) {
    const s = String(state || "");
    if (s === "done" || s === "complete") return 1;
    if (s === "error") return 1;
    if (s === "idle") return 0.12;
    if (s === "running") return 0.55;
    return 0.35;
  }

  function clampFill(n) {
    const v = Number(n);
    if (Number.isNaN(v)) return 0.35;
    return Math.max(0, Math.min(1, v));
  }

  function esc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;");
  }

  W.agentFill = {
    html,
    update,
    colorFor,
    fromTaskStatus,
    PALETTE,
  };
})(typeof window !== "undefined" ? window : globalThis);
