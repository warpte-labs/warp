/**
 * Warp.spinner — Flows right-sidebar circle-trace indicator.
 */
(function (global) {
  "use strict";

  const W = (global.Warp = global.Warp || {});

  const SVG =
    '<svg class="agent-think-svg" viewBox="0 0 24 24" fill="none">' +
    '<circle class="trace" cx="12" cy="12" r="8" pathLength="100"/>' +
    "</svg>";

  /**
   * @param {"idle"|"running"|"complete"|"error"|"compacting"} state
   * @returns {string} HTML
   */
  function html(state) {
    const s = state || "idle";
    return (
      '<div class="agent-think-wrap" data-state="' +
      s +
      '">' +
      SVG +
      "</div>"
    );
  }

  /**
   * @param {HTMLElement|null} wrap
   * @param {"idle"|"running"|"complete"|"error"|"compacting"} state
   */
  function setState(wrap, state) {
    if (!wrap) {
      return;
    }
    wrap.dataset.state = state || "idle";
  }

  W.spinner = { html, setState, SVG };
})(typeof window !== "undefined" ? window : globalThis);
