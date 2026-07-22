/**
 * Warp.history — chat history panel (local Grok sessions via host).
 */
(function (global) {
  "use strict";

  const W = (global.Warp = global.Warp || {});

  /**
   * @param {{
   *   root: HTMLElement,
   *   panel: HTMLElement,
   *   list: HTMLElement,
   *   detail: HTMLElement,
   *   detailBody: HTMLElement,
   *   title: HTMLElement,
   *   btnOpen: HTMLElement,
   *   btnBack: HTMLElement,
   *   btnRefresh: HTMLElement,
   *   post: (msg: object) => void,
   *   onOpenChange?: (open: boolean) => void,
   * }} opts
   */
  function mount(opts) {
    const PAGE = 20;
    const state = {
      open: false,
      viewingId: null,
      loading: false,
      allSessions: /** @type {Array} */ ([]),
      shown: 0,
    };

    function setOpen(open) {
      state.open = open;
      opts.root.classList.toggle("history-open", open);
      opts.panel.classList.toggle("hidden", !open);
      opts.panel.setAttribute("aria-hidden", open ? "false" : "true");
      opts.btnOpen.classList.toggle("on", open);
      if (open) {
        showList();
        // Live list while panel open (fs watch + poll)
        opts.post({ type: "historySubscribe" });
      } else {
        opts.post({ type: "historyUnsubscribe" });
      }
      if (typeof opts.onOpenChange === "function") {
        opts.onOpenChange(open);
      }
    }

    function showList() {
      state.viewingId = null;
      opts.title.textContent = "Chat history";
      opts.list.classList.remove("hidden");
      opts.detail.classList.add("hidden");
      opts.btnBack.textContent = "← Back";
    }

    function showDetail(sessionTitle) {
      opts.title.textContent = sessionTitle || "Chat";
      opts.list.classList.add("hidden");
      opts.detail.classList.remove("hidden");
      opts.btnBack.textContent = "← Back";
    }

    function requestList(force) {
      // Soft live updates skip the full loading flash
      if (force || !state.allSessions.length) {
        state.loading = true;
        state.allSessions = [];
        state.shown = 0;
        opts.list.innerHTML =
          '<div class="history-loading">Loading local sessions…</div>';
      }
      opts.post({ type: "listHistory" });
    }

    function requestDetail(id) {
      state.viewingId = id;
      if (!opts.detailBody.querySelector(".hist-msg")) {
        opts.detailBody.innerHTML =
          '<div class="history-loading">Loading transcript…</div>';
      }
      showDetail("Loading…");
      opts.post({ type: "getHistory", sessionId: id });
    }

    function createItem(s) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "hist-item compact";
      btn.dataset.id = s.id;

      const title = document.createElement("div");
      title.className = "ht";
      title.textContent = s.title || "Untitled chat";

      const meta = document.createElement("div");
      meta.className = "hm";
      const when = document.createElement("span");
      when.textContent = formatWhen(s.updatedAt);
      meta.appendChild(when);

      btn.appendChild(title);
      btn.appendChild(meta);
      btn.addEventListener("click", () => requestDetail(s.id));
      return btn;
    }

    /** Append next page of session rows (no chrome). */
    function appendMore() {
      if (state.shown >= state.allSessions.length) {
        return;
      }
      const end = Math.min(state.shown + PAGE, state.allSessions.length);
      const frag = document.createDocumentFragment();
      for (let i = state.shown; i < end; i++) {
        frag.appendChild(createItem(state.allSessions[i]));
      }
      opts.list.appendChild(frag);
      state.shown = end;

      // If the first page(s) don't fill the scroll area, keep filling
      // so the user can still scroll into more items.
      if (
        state.shown < state.allSessions.length &&
        opts.list.scrollHeight <= opts.list.clientHeight + 4
      ) {
        requestAnimationFrame(appendMore);
      }
    }

    /**
     * @param {Array} sessions
     * @param {{ live?: boolean }} [meta]
     */
    function renderList(sessions, meta) {
      state.loading = false;
      const next = Array.isArray(sessions) ? sessions : [];
      const live = !!(meta && meta.live);
      // Live re-push: keep scroll position / shown window when possible
      const prevScroll = live ? opts.list.scrollTop : 0;
      const prevShown = live ? state.shown : 0;
      state.allSessions = next;
      state.shown = 0;
      opts.list.innerHTML = "";
      if (!state.allSessions.length) {
        opts.list.innerHTML =
          '<div class="history-empty">No local chats yet.<br/>Send a message to create one — history is stored by Grok on this machine.</div>';
        return;
      }
      // Restore enough pages so scroll stays meaningful
      const want = live && prevShown > 0 ? prevShown : 20;
      while (state.shown < want && state.shown < state.allSessions.length) {
        appendMore();
      }
      if (live && prevScroll > 0) {
        opts.list.scrollTop = prevScroll;
      }
    }

    opts.list.addEventListener("scroll", () => {
      if (state.loading || state.viewingId) {
        return;
      }
      if (state.shown >= state.allSessions.length) {
        return;
      }
      const el = opts.list;
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 80) {
        appendMore();
      }
    });

    /**
     * @param {{ session?: object|null, messages?: Array, live?: boolean }} payload
     */
    function renderDetail(payload) {
      const session = payload && payload.session;
      const messages = (payload && payload.messages) || [];
      const live = !!(payload && payload.live);
      const nearBottom =
        opts.detailBody.scrollHeight -
          opts.detailBody.scrollTop -
          opts.detailBody.clientHeight <
        80;
      const prevScroll = opts.detailBody.scrollTop;
      showDetail((session && session.title) || "Chat");

      opts.detailBody.innerHTML = "";
      if (!messages.length) {
        opts.detailBody.innerHTML =
          '<div class="history-empty">No messages found in this session.</div>';
        return;
      }

      for (const m of messages) {
        const role = m.role === "user" ? "user" : "assistant";
        const el = document.createElement("div");
        el.className = "hist-msg " + role;
        const who = document.createElement("div");
        who.className = "who";
        who.textContent = role === "user" ? "you" : "grok";
        const body = document.createElement("div");
        body.className = "body";
        body.textContent = m.text || "";
        el.appendChild(who);
        el.appendChild(body);
        opts.detailBody.appendChild(el);
      }
      if (live && !nearBottom) {
        opts.detailBody.scrollTop = prevScroll;
      } else {
        opts.detailBody.scrollTop = live ? opts.detailBody.scrollHeight : 0;
      }
    }

    function formatWhen(iso) {
      if (!iso) {
        return "";
      }
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) {
        return "";
      }
      const now = Date.now();
      const diff = now - d.getTime();
      if (diff < 60_000) {
        return "just now";
      }
      if (diff < 3_600_000) {
        return Math.floor(diff / 60_000) + "m ago";
      }
      if (diff < 86_400_000) {
        return Math.floor(diff / 3_600_000) + "h ago";
      }
      if (diff < 86_400_000 * 7) {
        return Math.floor(diff / 86_400_000) + "d ago";
      }
      return d.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      });
    }

    opts.btnOpen.addEventListener("click", () => {
      setOpen(!state.open);
    });
    opts.btnBack.addEventListener("click", () => {
      if (state.viewingId) {
        showList();
        // Back to list — stop detail watch, list watch stays if panel open
        opts.post({ type: "listHistory" });
        return;
      }
      setOpen(false);
    });
    // Force re-pull (live already runs; ↻ is optional manual)
    opts.btnRefresh.addEventListener("click", () => {
      if (state.viewingId) {
        requestDetail(state.viewingId);
      } else {
        requestList(true);
      }
    });

    function openSession(sessionId) {
      if (!sessionId) return;
      if (!state.open) {
        state.open = true;
        opts.root.classList.toggle("history-open", true);
        opts.panel.classList.toggle("hidden", false);
        opts.panel.setAttribute("aria-hidden", "false");
        opts.btnOpen.classList.toggle("on", true);
        opts.post({ type: "historySubscribe" });
        if (typeof opts.onOpenChange === "function") {
          opts.onOpenChange(true);
        }
      }
      requestDetail(sessionId);
    }

    return {
      setOpen,
      isOpen: () => state.open,
      openSession,
      renderList,
      renderDetail,
      onError(text) {
        state.loading = false;
        if (state.viewingId) {
          opts.detailBody.innerHTML =
            '<div class="history-empty">' +
            escapeHtml(text || "Failed to load") +
            "</div>";
        } else {
          opts.list.innerHTML =
            '<div class="history-empty">' +
            escapeHtml(text || "Failed to load history") +
            "</div>";
        }
      },
    };
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  W.history = { mount };
})(typeof window !== "undefined" ? window : globalThis);
