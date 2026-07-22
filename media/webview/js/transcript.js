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
        /** Multi-agent blocks by task id */
        agentBlocks: {},
        agentStack: null,
        agentSeq: 0,
        agentWaitEl: null,
        /** Parent thought/message while agents run — flush once when done */
        agentHoldThought: "",
        agentHoldMessage: "",
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

    /** True if any accordion agent is still running. */
    _hasRunningAgents() {
      const a = this.active;
      if (!a || !a.agentBlocks) return false;
      for (const k of Object.keys(a.agentBlocks)) {
        const el = a.agentBlocks[k];
        if (el && el.dataset.status === "running") return true;
      }
      return false;
    }

    _runningAgentCount() {
      const a = this.active;
      if (!a || !a.agentBlocks) return 0;
      let n = 0;
      for (const k of Object.keys(a.agentBlocks)) {
        const el = a.agentBlocks[k];
        if (el && el.dataset.status === "running") n++;
      }
      return n;
    }

    _ensureAgentStack() {
      const a = this.active;
      if (!a) return null;
      if (!a.agentStack || !a.agentStack.isConnected) {
        a.agentStack = document.createElement("div");
        a.agentStack.className = "agent-stack";
        this.root.appendChild(a.agentStack);
      }
      return a.agentStack;
    }

    /** Single quiet line under the stack while agents work — no thought spam. */
    _syncAgentWaitLine() {
      const a = this.active;
      if (!a) return;
      const n = this._runningAgentCount();
      if (n <= 0) {
        if (a.agentWaitEl && a.agentWaitEl.isConnected) {
          a.agentWaitEl.remove();
        }
        a.agentWaitEl = null;
        return;
      }
      const stack = this._ensureAgentStack();
      if (!a.agentWaitEl || !a.agentWaitEl.isConnected) {
        a.agentWaitEl = document.createElement("div");
        a.agentWaitEl.className = "agent-wait-line";
        // Keep wait line right under the stack
        if (stack && stack.nextSibling) {
          this.root.insertBefore(a.agentWaitEl, stack.nextSibling);
        } else {
          this.root.appendChild(a.agentWaitEl);
        }
      }
      a.agentWaitEl.textContent =
        n === 1 ? "Waiting for 1 agent…" : "Waiting for " + n + " agents…";
    }

    /**
     * When all agents finish: drop wait noise; show only a real parent summary.
     */
    _flushAfterAgents() {
      const a = this.active;
      if (!a) return;
      this._syncAgentWaitLine();
      const heldMsg = String(a.agentHoldMessage || "").trim();
      a.agentHoldThought = "";
      a.agentHoldMessage = "";
      // Drop short wait chatter; keep a substantial final report
      if (heldMsg && heldMsg.length > 80 && !isAgentWaitChatter(heldMsg)) {
        if (a.thinkEl && !a.thoughtSettled) {
          this.completeThought();
        }
        a.agentEl = W.cards.createAgentCard();
        this.root.appendChild(a.agentEl);
        a.segmentAnswer = heldMsg;
        a.answer = (a.answer || "") + heldMsg;
        W.cards.updateAgentBody(a.agentEl, a.segmentAnswer);
      }
      this.scrollToBottom();
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
      // Grok sometimes streams [subagent:…] status as thought — drop pure noise
      if (isSubagentStatusNoise(delta)) {
        return;
      }
      // While agents run, don't split the UI with fragmented parent thoughts
      if (this._hasRunningAgents()) {
        a.agentHoldThought = (a.agentHoldThought || "") + delta;
        this._syncAgentWaitLine();
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
      if (isSubagentStatusNoise(delta)) {
        return;
      }
      // Parallel agent output often interleaves into parent stream — hold it
      // until all agent accordions finish so the UI is not shredded.
      if (this._hasRunningAgents()) {
        a.agentHoldMessage = (a.agentHoldMessage || "") + delta;
        this._syncAgentWaitLine();
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
     * While a subagent is running, steps nest under that block (fill circles).
     * Spawn / control tools never show as main orange pulse rows.
     * @param {{
     *   id?: string, title?: string, status?: string, kind?: string,
     *   target?: string, label?: string,
     *   subagentId?: string, subagentType?: string, isSpawn?: boolean
     * }} p
     */
    upsertTool(p) {
      const a = this.active;
      if (!a) {
        return;
      }
      if (!a.agentBlocks) a.agentBlocks = {};

      // Parent spawn → open/update subagent block only
      if (
        p &&
        (p.isSpawn ||
          (W.subagents && W.subagents.isMultiAgentTool(p)) ||
          (W.subagents && W.subagents.isSpawnLike(p)))
      ) {
        this._spawnFromTool(p);
        return;
      }

      // Child step: explicit tag, or nest under latest running subagent
      const block = this._resolveSubagentBlock(p);
      if (block && W.subagents) {
        W.subagents.upsertStep(block, p);
        // Stay closed unless user opened it
        this.scrollToBottom();
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
        if (el.isConnected) {
          this.scrollToBottom();
        }
      }
    }

    /**
     * Open subagent card from a parent spawn tool event.
     * @param {object} p
     */
    _spawnFromTool(p) {
      const id =
        String(p.subagentId || "").trim() ||
        String(p.id || "").trim() ||
        "agent-" + Date.now();
      const title = String(p.title || p.label || p.target || "Subagent").trim();
      // Avoid treating poll/kill as a new agent card
      if (W.subagents && W.subagents.isControlTool(p) && !p.isSpawn) {
        // Mark matching agent done/cancelled if we can
        const block = this._findBlockById(p.subagentId || p.target);
        if (block && /kill|cancel/i.test(String(p.kind || p.title || ""))) {
          W.subagents.updateBlock(block, {
            ...(block._task || {}),
            status: "cancelled",
          });
        }
        return;
      }
      this.upsertSubagent({
        id: id,
        toolCallId: p.id,
        kind: "subagent",
        status: p.status || "running",
        description: title,
        subagentType: p.subagentType || "general-purpose",
        background: true,
      });
    }

    /**
     * @param {object} p
     * @returns {HTMLElement|null}
     */
    _resolveSubagentBlock(p) {
      if (!this.active || !this.active.agentBlocks) return null;
      const sid = String(p?.subagentId || "").trim();
      if (sid) {
        const hit =
          this.active.agentBlocks[sid] || this._findBlockByPrefix(sid);
        if (hit) return hit;
      }
      // Nest under the most recently updated running subagent
      return this._latestRunningSubagent();
    }

    _findBlockById(id) {
      if (!id || !this.active?.agentBlocks) return null;
      return (
        this.active.agentBlocks[id] || this._findBlockByPrefix(String(id))
      );
    }

    _findBlockByPrefix(id) {
      const blocks = this.active?.agentBlocks || {};
      const s = String(id || "");
      if (!s) return null;
      // short id 019f8b30 matches full uuid
      for (const k of Object.keys(blocks)) {
        if (k === s || k.startsWith(s) || s.startsWith(k.slice(0, 8))) {
          return blocks[k];
        }
      }
      return null;
    }

    _latestRunningSubagent() {
      const blocks = this.active?.agentBlocks || {};
      let best = null;
      let bestT = 0;
      for (const k of Object.keys(blocks)) {
        const el = blocks[k];
        if (!el || el.dataset.status === "done" || el.dataset.status === "error") {
          continue;
        }
        const t = el._task?.updatedAt || el._t0 || 0;
        if (t >= bestT) {
          bestT = t;
          best = el;
        }
      }
      return best;
    }

    /**
     * Multi-agent accordion row in the turn stack.
     * @param {object} task
     */
    upsertSubagent(task) {
      if (!task || !W.subagents) return;
      if (!this.active) {
        this.active = {
          thinkEl: null,
          agentEl: null,
          segmentAnswer: "",
          toolEls: {},
          agentBlocks: {},
          agentStack: null,
          agentSeq: 0,
          thought: "",
          answer: "",
          t0: Date.now(),
          timerIv: null,
          thoughtSettled: true,
        };
      }
      const a = this.active;
      if (!a.agentBlocks) a.agentBlocks = {};
      if (typeof a.agentSeq !== "number") a.agentSeq = 0;

      const id = String(task.id || task.toolCallId || "");
      if (!id) return;

      let el = a.agentBlocks[id];
      if (!el && task.toolCallId && a.agentBlocks[task.toolCallId]) {
        el = a.agentBlocks[task.toolCallId];
        delete a.agentBlocks[task.toolCallId];
        a.agentBlocks[id] = el;
      }
      if (!el) {
        el = this._findBlockByPrefix(id);
        if (el) {
          const oldId = el.dataset.id;
          if (oldId && oldId !== id) {
            delete a.agentBlocks[oldId];
            a.agentBlocks[id] = el;
          }
        }
      }

      const wasRunning = this._hasRunningAgents();
      if (!el) {
        // Don't spawn empty shell agents that immediately read "0.0s · Done"
        // without work — wait for running status or a real description.
        const st0 = String(task.status || "running").toLowerCase();
        const terminal0 =
          st0 === "completed" ||
          st0 === "done" ||
          st0 === "failed" ||
          st0 === "error" ||
          st0 === "cancelled";
        if (terminal0 && !task.description) {
          return;
        }
        a.agentSeq += 1;
        el = W.subagents.createBlock(task, { agentIndex: a.agentSeq });
        a.agentBlocks[id] = el;
        if (a.thinkEl && !a.thoughtSettled) {
          this.completeThought();
        }
        const stack = this._ensureAgentStack();
        el.classList.add("tool-row-enter");
        stack.appendChild(el);
        requestAnimationFrame(() => {
          if (el.isConnected) {
            el.classList.add("tool-row-in");
            el.classList.remove("tool-row-enter");
          }
        });
      } else {
        W.subagents.updateBlock(el, task);
      }
      if (el._task) {
        el._task.updatedAt = task.updatedAt || Date.now();
      }
      this._syncAgentWaitLine();
      // Transition: agents were running → none running → flush held parent text
      if (wasRunning && !this._hasRunningAgents()) {
        this._flushAfterAgents();
      }
      this.scrollToBottom();
    }

    /**
     * Apply full tasks snapshot (idempotent upserts).
     * @param {{ tasks?: object[] }} snapshot
     */
    applyTasksSnapshot(snapshot) {
      const list = snapshot && Array.isArray(snapshot.tasks) ? snapshot.tasks : [];
      for (let i = 0; i < list.length; i++) {
        this.upsertSubagent(list[i]);
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
     * User hit Stop — mark think as interrupted, cancel running agents.
     */
    interrupt() {
      const a = this.active;
      if (!a) return;
      a.agentHoldThought = "";
      a.agentHoldMessage = "";
      if (a.agentWaitEl && a.agentWaitEl.isConnected) {
        a.agentWaitEl.remove();
      }
      a.agentWaitEl = null;
      if (a.agentBlocks) {
        for (const k of Object.keys(a.agentBlocks)) {
          const el = a.agentBlocks[k];
          if (el && el.dataset.status === "running" && W.subagents) {
            W.subagents.updateBlock(el, {
              ...(el._task || {}),
              status: "cancelled",
            });
          }
        }
      }
      if (a.thinkEl && !a.thoughtSettled) {
        if (a.timerIv) {
          clearInterval(a.timerIv);
          a.timerIv = null;
        }
        a.thoughtSettled = true;
        const elapsed = (Date.now() - a.t0) / 1000;
        if (W.cards && typeof W.cards.interruptThink === "function") {
          W.cards.interruptThink(a.thinkEl, elapsed);
        } else {
          this.completeThought();
        }
      }
      // Settle agent think lines too
      if (a.agentBlocks) {
        for (const k of Object.keys(a.agentBlocks)) {
          const el = a.agentBlocks[k];
          const label = el && el.querySelector('[data-role="think-label"]');
          if (label && el.dataset.status === "error") {
            label.textContent = "Agent interrupted";
          }
          const meta = el && el.querySelector('[data-role="meta"]');
          if (meta && el.dataset.status === "error") {
            const t = meta.textContent || "";
            if (!/Failed|Done/i.test(t)) {
              meta.textContent = t.replace(/\s*·.*$/, "") + " · Failed";
            }
          }
        }
      }
      this.scrollToBottom();
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
     * Normal white "grok" reply (no red error styling) — e.g. trial expired.
     * @param {string} text
     * @param {{ action?: string, actionLabel?: string }} [opts]
     */
    showNotice(text, opts) {
      this.endActiveTimers();
      const a = this.active;
      // Drop empty thinking chrome if we never received real thought tokens
      if (a && a.thinkEl && !a.thoughtSettled && !(a.thought || "").trim()) {
        try {
          a.thinkEl.remove();
        } catch (e) {
          /* ignore */
        }
        a.thinkEl = null;
      } else if (a && a.thinkEl && !a.thoughtSettled) {
        this.completeThought();
      }
      const el = W.cards.createAgentCard();
      W.cards.updateAgentBody(el, text || "");
      const action = opts && opts.action;
      const actionLabel = (opts && opts.actionLabel) || "Upgrade";
      if (action) {
        const row = document.createElement("div");
        row.className = "notice-actions";
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "notice-upgrade-btn";
        btn.textContent = actionLabel;
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          window.dispatchEvent(
            new CustomEvent("warp-notice-action", {
              detail: { action: action },
            })
          );
        });
        row.appendChild(btn);
        el.appendChild(row);
      }
      this.root.appendChild(el);
      if (a) {
        a.agentEl = el;
        a.segmentAnswer = text || "";
        a.answer = (a.answer || "") + (text || "");
      }
      this._notifyEmpty();
      this.scrollToBottom({ force: true });
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

  /**
   * Pure subagent status lines (not real reasoning) — hide from main stream.
   * e.g. `[subagent:explore] Explore codebase structure (019f8b30)`
   */
  function isSubagentStatusNoise(text) {
    const t = String(text || "").trim();
    if (!t) return false;
    // Whole chunk is just one or more subagent tags
    if (/^(\[subagent:[^\]]+\][^\n]*)+$/i.test(t)) return true;
    if (/^\[subagent:[^\]]+\]/i.test(t) && t.length < 160 && !t.includes("\n\n")) {
      return true;
    }
    return false;
  }

  /** Parent wait chatter while subagents run — never worth flushing. */
  function isAgentWaitChatter(text) {
    const t = String(text || "").trim().toLowerCase();
    if (!t) return true;
    if (t.length < 60) {
      if (
        /waiting|running|spawn|four explore|agents are|to finish|digging into/.test(
          t
        )
      ) {
        return true;
      }
    }
    // Heavily interleaved garbage often has mid-word splits from parallel streams
    const spaces = (t.match(/\s/g) || []).length;
    const weird = (t.match(/[a-z][A-Z]/g) || []).length;
    if (t.length > 200 && weird > 12 && spaces < t.length / 8) return true;
    return false;
  }

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
