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
    const state = {
      open: false,
      viewingId: null,
      loading: false,
    };

    function setOpen(open) {
      state.open = open;
      opts.root.classList.toggle("history-open", open);
      opts.panel.classList.toggle("hidden", !open);
      opts.panel.setAttribute("aria-hidden", open ? "false" : "true");
      opts.btnOpen.classList.toggle("on", open);
      if (open) {
        showList();
        requestList();
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

    function requestList() {
      state.loading = true;
      opts.list.innerHTML =
        '<div class="history-loading">Loading local sessions…</div>';
      opts.post({ type: "listHistory" });
    }

    function requestDetail(id) {
      state.viewingId = id;
      opts.detailBody.innerHTML =
        '<div class="history-loading">Loading transcript…</div>';
      showDetail("Loading…");
      opts.post({ type: "getHistory", sessionId: id });
    }

    /**
     * @param {Array} sessions
     */
    function renderList(sessions) {
      state.loading = false;
      const items = Array.isArray(sessions) ? sessions : [];
      if (!items.length) {
        opts.list.innerHTML =
          '<div class="history-empty">No local chats yet.<br/>Send a message to create one — history is stored by Grok on this machine.</div>';
        return;
      }

      opts.list.innerHTML = "";
      for (const s of items) {
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
        opts.list.appendChild(btn);
      }
    }

    /**
     * @param {{ session?: object|null, messages?: Array }} payload
     */
    function renderDetail(payload) {
      const session = payload && payload.session;
      const messages = (payload && payload.messages) || [];
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
      opts.detailBody.scrollTop = 0;
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
        return;
      }
      setOpen(false);
    });
    opts.btnRefresh.addEventListener("click", () => {
      if (state.viewingId) {
        requestDetail(state.viewingId);
      } else {
        requestList();
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
