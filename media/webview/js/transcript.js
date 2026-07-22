/**
 * Warp.Transcript — turn-based UI controller.
 *
 * Turn layout:
 *   user card → think UI (immediate) → grok reply (canvas)
 */
(function (global) {
  "use strict";

  const W = (global.Warp = global.Warp || {});

  class Transcript {
    /**
     * @param {HTMLElement} root
     * @param {{ onEmptyChange?: (empty: boolean) => void }} [opts]
     */
    constructor(root, opts) {
      this.root = root;
      this.opts = opts || {};
      /** @type {null | ActiveTurn} */
      this.active = null;
      /** @type {HTMLElement|null} */
      this._compactEl = null;
      /** When false, streaming tokens do not force-scroll the transcript */
      this.scrollWithStream = true;
      /** User has scrolled up — pause follow until they send or scroll to bottom */
      this._userPinned = false;
      /** Stagger new tool rows so fast ACP bursts don't pop in all at once */
      /** @type {HTMLElement[]} */
      this._toolRevealQ = [];
      this._toolRevealTimer = 0;
      this._lastToolRevealAt = 0;
      /** ms between revealing new tool rows (shorten if queue is long) */
      this._toolRevealGap = 110;
      this._bindScrollGuard();
    }

    /**
     * @param {boolean} on
     */
    setScrollWithStream(on) {
      this.scrollWithStream = on !== false;
      if (this.scrollWithStream) {
        this._userPinned = false;
      }
    }

    _bindScrollGuard() {
      if (!this.root || this.root._warpScrollBound) return;
      this.root._warpScrollBound = true;
      this.root.addEventListener(
        "scroll",
        () => {
          const el = this.root;
          const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
          // More than ~48px from bottom → user is reading up
          this._userPinned = dist > 48;
        },
        { passive: true }
      );
    }

    isEmpty() {
      return this.root.children.length === 0;
    }

    clear() {
      this.endActiveTimers();
      this._flushToolReveal(true);
      this.active = null;
      this.root.innerHTML = "";
      this._notifyEmpty();
    }

    /**
     * Show orange compacting indicator (same circle as think, orange).
     * @param {{reason?: string, percentage?: number}} [info]
     */
    beginCompact(info) {
      this.endCompact(true);
      const el = document.createElement("div");
      el.className = "card compact is-running";
      el.id = "compact-status";
      const spin = W.spinner
        ? W.spinner.html("running")
        : '<div class="agent-think-wrap" data-state="running"></div>';
      const pct =
        info && typeof info.percentage === "number"
          ? " · " + info.percentage + "%"
          : "";
      el.innerHTML =
        '<div class="compact-hd">' +
        spin +
        '<span class="label">Compacting…</span>' +
        '<span class="detail" data-role="detail">' +
        (info && info.reason === "manual" ? "manual" : "auto") +
        pct +
        "</span></div>";
      const wrap = el.querySelector(".agent-think-wrap");
      if (wrap) wrap.dataset.state = "compacting";
      this.root.appendChild(el);
      this._compactEl = el;
      this.scrollToBottom();
      this._notifyEmpty();
    }

    /**
     * @param {boolean} [silent] remove without settled line
     * @param {{tokensBefore?:number,tokensAfter?:number}} [info]
     */
    endCompact(silent, info) {
      const el =
        this._compactEl || this.root.querySelector("#compact-status");
      this._compactEl = null;
      if (!el) return;
      if (silent) {
        el.remove();
        return;
      }
      el.classList.remove("is-running");
      el.classList.add("is-done");
      const before =
        info && typeof info.tokensBefore === "number"
          ? info.tokensBefore
          : null;
      const after =
        info && typeof info.tokensAfter === "number" ? info.tokensAfter : null;
      let detail = "done";
      if (before != null && after != null) {
        detail =
          formatTokLocal(before) + " → " + formatTokLocal(after) + " tokens";
      } else if (after != null) {
        detail = formatTokLocal(after) + " tokens";
      }
      el.innerHTML =
        '<div class="compact-hd settled">' +
        '<span class="label">Compacted</span>' +
        '<span class="detail">' +
        detail +
        "</span></div>";
      this.scrollToBottom();
    }

    failCompact(message) {
      const el =
        this._compactEl || this.root.querySelector("#compact-status");
      this._compactEl = null;
      if (!el) return;
      el.classList.remove("is-running");
      el.classList.add("is-error");
      el.innerHTML =
        '<div class="compact-hd settled">' +
        '<span class="label">Compact failed</span>' +
        '<span class="detail">' +
        escapeLocal(message || "error") +
        "</span></div>";
      this.scrollToBottom();
    }

    /**
     * @param {string} userText
     * @param {Array<{name?:string,isImage?:boolean,previewUrl?:string,mime?:string}>} [attachments]
     */
    beginTurn(userText, attachments) {
      this.endActiveTimers();
      // New send always jumps to bottom so the user sees their prompt
      this._userPinned = false;
      const userEl = W.cards.createUserCard(userText, attachments);
      this.root.appendChild(userEl);

      this.active = {
        thinkEl: null,
        agentEl: null,
        /** Text for the current agent card only (may split after tools) */
        segmentAnswer: "",
        toolEls: {},
        thought: "",
        answer: "",
        t0: Date.now(),
        timerIv: null,
        thoughtSettled: false,
      };

      // Always show thinking UI immediately (don't wait for first ACP chunk)
      this.ensureThinking();
      this._notifyEmpty();
      this.scrollToBottom({ force: true });
    }

    ensureThinking() {
      const a = this.active;
      if (!a) {
        return;
      }
      // More thought after message/tools: open a new think card in place
      // (never drop mid-turn reasoning — that caused "missing thinking")
      if (a.thoughtSettled) {
        a.thoughtSettled = false;
        a.thinkEl = null;
        a.thought = "";
        if (a.timerIv) {
          clearInterval(a.timerIv);
          a.timerIv = null;
        }
      }
      if (!a.thinkEl) {
        a.thinkEl = W.cards.createThinkCard();
        // Chronological: always append (after tools / reply if any)
        this.root.appendChild(a.thinkEl);
        a.t0 = Date.now();
        a.timerIv = window.setInterval(() => {
          if (!a.thinkEl || a.thoughtSettled) {
            return;
          }
          W.cards.setThinkTimer(a.thinkEl, (Date.now() - a.t0) / 1000);
        }, 100);
      }
      this.scrollToBottom();
    }

    /**
     * @param {string} delta
     */
    appendThought(delta) {
      const a = this.active;
      if (!a || !delta) {
        return;
      }
      this.ensureThinking();
      a.thought += delta;
      W.cards.updateThinkBody(a.thinkEl, a.thought);
      this.scrollToBottom();
    }

    completeThought() {
      const a = this.active;
      if (!a || !a.thinkEl || a.thoughtSettled) {
        return;
      }
      a.thoughtSettled = true;
      if (a.timerIv) {
        clearInterval(a.timerIv);
        a.timerIv = null;
      }
      const elapsed = (Date.now() - a.t0) / 1000;
      W.cards.finalizeThink(a.thinkEl, elapsed);
    }

    /**
     * @param {string} delta
     */
    appendMessage(delta) {
      const a = this.active;
      if (!a || !delta) {
        return;
      }
      if (a.thinkEl && !a.thoughtSettled) {
        this.completeThought();
      }
      // Chronological flow: if tools (or anything) landed after the current
      // agent card, open a new reply card so text continues under tools.
      if (
        !a.agentEl ||
        a.agentEl.parentNode !== this.root ||
        this.root.lastElementChild !== a.agentEl
      ) {
        a.agentEl = W.cards.createAgentCard();
        this.root.appendChild(a.agentEl);
        a.segmentAnswer = "";
      }
      a.answer += delta;
      a.segmentAnswer = (a.segmentAnswer || "") + delta;
      W.cards.updateAgentBody(a.agentEl, a.segmentAnswer);
      this.scrollToBottom();
    }

    /**
     * Tool / command activity (read, run, search, …).
     * Always append in time order (never jump above the agent message).
     * New rows are staggered so fast tool bursts still feel sequential.
     * @param {{ id?: string, title?: string, status?: string, kind?: string, target?: string, label?: string }} p
     */
    upsertTool(p) {
      const a = this.active;
      if (!a) {
        return;
      }
      const id = p.id || "tool-" + Date.now();
      if (!a.toolEls) {
        a.toolEls = {};
      }
      let el = a.toolEls[id];
      if (!el) {
        el = W.tools.createToolRow({ ...p, id });
        a.toolEls[id] = el;
        el.classList.add("tool-row-enter");
        this._enqueueToolReveal(el);
      } else {
        W.tools.updateToolRow(el, p);
        // Already visible — keep live status updates snappy
        if (el.isConnected) {
          this.scrollToBottom();
        }
      }
    }

    /**
     * Queue a tool row for staggered insert + fade-in.
     * @param {HTMLElement} el
     */
    _enqueueToolReveal(el) {
      if (!el) return;
      this._toolRevealQ.push(el);
      this._pumpToolReveal();
    }

    _toolGapMs() {
      // Back up a little when many tools pile up so we don't lag the turn forever
      const n = this._toolRevealQ.length;
      if (n > 12) return 45;
      if (n > 6) return 70;
      return this._toolRevealGap;
    }

    _pumpToolReveal() {
      if (this._toolRevealTimer) return;
      const step = () => {
        this._toolRevealTimer = 0;
        if (!this._toolRevealQ.length) return;

        const gap = this._toolGapMs();
        const elapsed = Date.now() - this._lastToolRevealAt;
        if (this._lastToolRevealAt && elapsed < gap) {
          this._toolRevealTimer = window.setTimeout(step, gap - elapsed);
          return;
        }

        const el = this._toolRevealQ.shift();
        if (el && !el.isConnected && this.root) {
          this.root.appendChild(el);
          // Next frame: animate from enter → in
          requestAnimationFrame(() => {
            if (el.isConnected) {
              el.classList.add("tool-row-in");
              el.classList.remove("tool-row-enter");
            }
          });
          this._lastToolRevealAt = Date.now();
          this.scrollToBottom();
        }

        if (this._toolRevealQ.length) {
          this._toolRevealTimer = window.setTimeout(step, this._toolGapMs());
        }
      };
      step();
    }

    /**
     * @param {boolean} [instant] skip animation (clear / end of turn)
     */
    _flushToolReveal(instant) {
      if (this._toolRevealTimer) {
        clearTimeout(this._toolRevealTimer);
        this._toolRevealTimer = 0;
      }
      while (this._toolRevealQ.length) {
        const el = this._toolRevealQ.shift();
        if (!el || el.isConnected || !this.root) continue;
        this.root.appendChild(el);
        if (instant) {
          el.classList.remove("tool-row-enter");
          el.classList.add("tool-row-in");
        } else {
          requestAnimationFrame(() => {
            el.classList.add("tool-row-in");
            el.classList.remove("tool-row-enter");
          });
        }
      }
      this._lastToolRevealAt = 0;
    }

    endTurn() {
      const a = this.active;
      if (a && a.thinkEl && !a.thoughtSettled) {
        this.completeThought();
      }
      // Show any still-queued tool rows so nothing is lost after the turn
      this._flushToolReveal(false);
      this.endActiveTimers();
    }

    /**
     * @param {string} text
     */
    showError(text) {
      this.endActiveTimers();
      this.root.appendChild(W.cards.createErrorCard(text));
      this._notifyEmpty();
      this.scrollToBottom();
    }

    /**
     * @param {{ force?: boolean }} [opts]
     */
    scrollToBottom(opts) {
      const force = !!(opts && opts.force);
      // Respect Settings → Scroll with stream, and user scroll-up pin
      if (!force) {
        if (this.scrollWithStream === false) return;
        if (this._userPinned) return;
      }
      requestAnimationFrame(() => {
        if (!this.root) return;
        this.root.scrollTop = this.root.scrollHeight;
        this._userPinned = false;
      });
    }

    endActiveTimers() {
      if (this.active && this.active.timerIv) {
        clearInterval(this.active.timerIv);
        this.active.timerIv = null;
      }
    }

    /**
     * Collect markdown export of visible chat (user + assistant).
     * @returns {string}
     */
    exportMarkdown() {
      const parts = [];
      const children = this.root.children;
      for (let i = 0; i < children.length; i++) {
        const el = children[i];
        if (!el || !el.classList) continue;
        if (el.classList.contains("user")) {
          const body = el.querySelector("[data-role=body], .md");
          const t = (body && body.innerText) || "";
          if (t.trim()) parts.push("## You\n\n" + t.trim());
        } else if (el.classList.contains("reply")) {
          const body = el.querySelector("[data-role=body], .md");
          const t = (body && body.innerText) || "";
          if (t.trim()) parts.push("## Grok\n\n" + t.trim());
        }
      }
      if (!parts.length && this.active && this.active.answer) {
        parts.push("## Grok\n\n" + this.active.answer.trim());
      }
      return parts.join("\n\n") + (parts.length ? "\n" : "");
    }

    /**
     * Last N assistant replies (newest first). N defaults to 1.
     * @param {number} [n]
     * @returns {string}
     */
    getLastAssistantText(n) {
      const want = Math.max(1, Number(n) || 1);
      const texts = [];
      if (this.active && this.active.answer && this.active.answer.trim()) {
        texts.push(this.active.answer.trim());
      }
      const children = this.root.children;
      for (let i = children.length - 1; i >= 0 && texts.length < want + 2; i--) {
        const el = children[i];
        if (!el || !el.classList) continue;
        if (el.classList.contains("reply")) {
          const body = el.querySelector("[data-role=body], .md");
          const t = ((body && body.innerText) || "").trim();
          if (t && texts.indexOf(t) < 0) texts.push(t);
        }
      }
      return texts[want - 1] || texts[0] || "";
    }

    _notifyEmpty() {
      if (this.opts.onEmptyChange) {
        this.opts.onEmptyChange(this.isEmpty());
      }
    }
  }

  /**
   * @typedef {{
   *   thinkEl: HTMLElement|null,
   *   agentEl: HTMLElement|null,
   *   toolEls: Object.<string, HTMLElement>,
   *   thought: string,
   *   answer: string,
   *   t0: number,
   *   timerIv: number|null,
   *   thoughtSettled: boolean
   * }} ActiveTurn
   */

  function formatTokLocal(n) {
    if (!Number.isFinite(n) || n < 0) return "—";
    if (n < 1000) return String(Math.round(n));
    if (n < 10_000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
    if (n < 1_000_000) return Math.round(n / 1000) + "k";
    return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  }

  function escapeLocal(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  W.Transcript = Transcript;
})(typeof window !== "undefined" ? window : globalThis);
