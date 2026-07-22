/**
 * Warp.util — shared webview helpers (DRY: escape, format, tokens).
 */
(function (global) {
  "use strict";

  const W = (global.Warp = global.Warp || {});

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatTok(n) {
    if (!Number.isFinite(n) || n < 0) return "—";
    if (n < 1000) return String(Math.round(n));
    if (n < 10_000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
    if (n < 1_000_000) return Math.round(n / 1000) + "k";
    return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  }

  W.util = {
    escapeHtml: escapeHtml,
    formatTok: formatTok,
  };
})(typeof window !== "undefined" ? window : globalThis);
