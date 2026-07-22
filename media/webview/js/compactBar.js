/**
 * Warp.compactBar — compacting indicator above the message input.
 *
 * Grok fork payload (from _x.ai/session_notification):
 *   start: tokens_used, context_window, percentage, reason
 *   end:   tokens_before, tokens_after, elapsed_ms, summary_preview
 *   fail:  error
 *
 * Row: soft orange circle · grey "Compacting" · % · used / window tokens
 */
(function (global) {
  "use strict";

  const W = (global.Warp = global.Warp || {});

  /**
   * @param {{ root: HTMLElement | null }} opts
   */
  function mount(opts) {
    const root = opts.root;
    if (!root) {
      return {
        begin: function () {},
        end: function () {},
        fail: function () {},
        hide: function () {},
      };
    }

    /** Remember start tokens so end can show savings even if before is missing */
    let lastStart = null;

    function paintRunning(info) {
      info = info || {};
      lastStart = {
        tokensUsed:
          typeof info.tokensUsed === "number" ? info.tokensUsed : null,
        contextWindow:
          typeof info.contextWindow === "number" ? info.contextWindow : null,
        percentage:
          typeof info.percentage === "number" ? info.percentage : null,
      };

      const spin = W.spinner
        ? W.spinner.html("compacting")
        : '<div class="agent-think-wrap" data-state="compacting"></div>';

      const parts = [];
      // % of context window (fork: percentage)
      if (typeof info.percentage === "number") {
        parts.push(info.percentage + "%");
      }
      // Tokens being compacted / window (fork: tokens_used, context_window)
      if (typeof info.tokensUsed === "number") {
        if (typeof info.contextWindow === "number" && info.contextWindow > 0) {
          parts.push(fmt(info.tokensUsed) + " / " + fmt(info.contextWindow));
        } else {
          parts.push(fmt(info.tokensUsed) + " tokens");
        }
      } else if (
        typeof info.contextWindow === "number" &&
        info.contextWindow > 0
      ) {
        parts.push("of " + fmt(info.contextWindow));
      }

      const detail = parts.join(" · ");

      root.innerHTML =
        '<div class="compact-bar-inner">' +
        spin +
        '<span class="compact-bar-label">Compacting</span>' +
        (detail
          ? '<span class="compact-bar-detail">' + detail + "</span>"
          : "") +
        "</div>";
      root.hidden = false;
      root.classList.add("is-running");
      root.classList.remove("is-done", "is-error");
      const wrap = root.querySelector(".agent-think-wrap");
      if (wrap) wrap.dataset.state = "compacting";
      if (info.reason) {
        root.title = String(info.reason);
      }
    }

    function paintDone(info) {
      info = info || {};
      const before =
        typeof info.tokensBefore === "number"
          ? info.tokensBefore
          : lastStart && typeof lastStart.tokensUsed === "number"
            ? lastStart.tokensUsed
            : null;
      const after =
        typeof info.tokensAfter === "number" ? info.tokensAfter : null;

      const parts = [];
      if (before != null && after != null) {
        parts.push(fmt(before) + " → " + fmt(after));
        const saved = before - after;
        if (saved > 0) {
          parts.push("−" + fmt(saved));
          if (before > 0) {
            parts.push(Math.round((saved / before) * 100) + "% freed");
          }
        }
      } else if (after != null) {
        parts.push(fmt(after) + " after");
      }
      if (typeof info.elapsedMs === "number" && info.elapsedMs > 0) {
        parts.push(
          info.elapsedMs >= 1000
            ? (info.elapsedMs / 1000).toFixed(1) + "s"
            : info.elapsedMs + "ms"
        );
      }

      const detail = parts.join(" · ");
      root.innerHTML =
        '<div class="compact-bar-inner is-settled">' +
        '<span class="compact-bar-label">Compacted</span>' +
        (detail
          ? '<span class="compact-bar-detail">' + detail + "</span>"
          : "") +
        "</div>";
      root.hidden = false;
      root.classList.remove("is-running", "is-error");
      root.classList.add("is-done");
      lastStart = null;
      window.setTimeout(() => {
        if (root.classList.contains("is-done")) {
          hide();
        }
      }, 3200);
    }

    function paintError(message) {
      root.innerHTML =
        '<div class="compact-bar-inner is-error">' +
        '<span class="compact-bar-label">Compact failed</span>' +
        '<span class="compact-bar-detail">' +
        esc(message || "error") +
        "</span></div>";
      root.hidden = false;
      root.classList.remove("is-running", "is-done");
      root.classList.add("is-error");
      lastStart = null;
      window.setTimeout(() => {
        if (root.classList.contains("is-error")) {
          hide();
        }
      }, 4000);
    }

    function hide() {
      root.hidden = true;
      root.classList.remove("is-running", "is-done", "is-error");
      root.innerHTML = "";
      root.removeAttribute("title");
    }

    hide();
    return {
      begin: function (info) {
        paintRunning(info || {});
      },
      end: function (info) {
        paintDone(info || {});
      },
      fail: function (message) {
        paintError(message);
      },
      hide: hide,
    };
  }

  function fmt(n) {
    if (!Number.isFinite(n) || n < 0) return "—";
    if (n < 1000) return String(Math.round(n));
    if (n < 10_000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
    if (n < 1_000_000) return Math.round(n / 1000) + "k";
    return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  }

  function esc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  W.compactBar = { mount };
})(typeof window !== "undefined" ? window : globalThis);
