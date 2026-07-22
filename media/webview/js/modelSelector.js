/**
 * Warp.modelSelector — model · effort · tools picker.
 *
 * State is a single mutable object. Updates never replace it wholesale.
 *  - setModel / models messages → model id, effort list, effort only
 *  - setPermissionMode messages → tools mode only
 *  - User effort drag → effort only
 *  - User tools click → tools only
 */
(function (global) {
  "use strict";

  const W = (global.Warp = global.Warp || {});

  const RANK = { none: 0, minimal: 1, low: 2, medium: 3, high: 4, xhigh: 5, max: 6 };
  const INPUT_FOLLOW = 0.92;
  const SETTLE_LERP = 0.2;

  const EFFORT_HINT = {
    none: "Minimal work",
    minimal: "Minimal work",
    low: "Fast and light",
    medium: "Balanced depth",
    high: "Deepest search",
    xhigh: "Deepest search",
    max: "Deepest search",
  };

  const TOOL_HINT = {
    ask: "Confirm each tool",
    auto: "Safe tools free",
    yolo: "No tool prompts",
  };

  function esc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function asToolMode(v) {
    return v === "auto" || v === "yolo" || v === "ask" ? v : null;
  }

  /**
   * @param {{
   *   metaEl: HTMLElement | null,
   *   post: (msg: object) => void,
   *   metaRow?: HTMLElement | null,
   * }} opts
   */
  function mount(opts) {
    const metaEl = opts.metaEl;
    const post = opts.post;
    const metaRow = opts.metaRow || metaEl?.parentElement || null;
    if (!metaEl) {
      return {
        applyModels: function () {},
        applyPermissionMode: function () {},
        setOpen: function () {},
        getState: function () {
          return null;
        },
      };
    }

    // ── single state (mutate fields only — never reassign) ───────────
    const state = {
      currentModelId: "grok-4.5",
      reasoningEffort: "high",
      toolMode: "ask",
      availableModels: [
        {
          modelId: "grok-4.5",
          name: "Grok 4.5",
          supportsReasoningEffort: true,
          reasoningEffort: "high",
          reasoningEfforts: [
            { id: "low", value: "low", label: "Low Effort" },
            { id: "medium", value: "medium", label: "Medium Effort" },
            { id: "high", value: "high", label: "High Effort", default: true },
          ],
        },
      ],
    };

    const pop = document.createElement("div");
    pop.className = "model-pop hidden";
    pop.setAttribute("role", "dialog");
    pop.setAttribute("aria-label", "Model, effort, and tools");
    pop.setAttribute("aria-hidden", "true");
    document.body.appendChild(pop);

    let open = false;
    let ignoreOutsideUntil = 0;
    let popLeft = 0;
    let popTop = 0;
    let popW = 280;
    let popLocked = false;

    // effort slider runtime
    let efforts = [];
    let notches = [0, 0.5, 1];
    let displayT = 1;
    let targetT = 1;
    let dragging = false;
    let settling = false;
    let dragOriginIdx = 2;
    let pendingSettleIdx = null;
    let rafId = 0;
    let sliderBound = false;
    /** Accept next host reasoningEffort (only after we post setModel). */
    let acceptHostEffort = false;
    /** First models payload from host may seed effort; later session noise may not. */
    let seenHostModels = false;

    // ── helpers ──────────────────────────────────────────────────────

    function model() {
      return (
        state.availableModels.find((m) => m.modelId === state.currentModelId) ||
        state.availableModels[0] ||
        null
      );
    }

    function loadEfforts() {
      const m = model();
      const list = (m && m.reasoningEfforts) || [];
      efforts = list.slice().sort((a, b) => {
        const va = String(a.value || a.id || "").toLowerCase();
        const vb = String(b.value || b.id || "").toLowerCase();
        return (RANK[va] ?? 50) - (RANK[vb] ?? 50);
      });
      const n = Math.max(1, efforts.length);
      notches = n === 1 ? [1] : efforts.map((_, i) => i / (n - 1));
    }

    function effortIdx(id) {
      const i = efforts.findIndex((e) => e.value === id || e.id === id);
      return i < 0 ? Math.max(0, efforts.length - 1) : i;
    }

    function tFromIdx(i) {
      if (!notches.length) return 0;
      return notches[Math.max(0, Math.min(notches.length - 1, i))];
    }

    function pct(t) {
      return 3 + t * 94;
    }

    function idxFromT(t) {
      if (efforts.length <= 1) return 0;
      for (let i = 0; i < notches.length - 1; i++) {
        if (t < (notches[i] + notches[i + 1]) / 2) return i;
      }
      return notches.length - 1;
    }

    function effortLabel(id) {
      const e = efforts.find((x) => x.value === id || x.id === id);
      if (e?.label) return String(e.label).replace(/\s*Effort$/i, "");
      if (!id) return "";
      return id.charAt(0).toUpperCase() + id.slice(1);
    }

    function effortHint(id) {
      const k = String(id || "").toLowerCase();
      return EFFORT_HINT[k] || "";
    }

    function tickLabel(e) {
      return String(e.label || e.value || e.id || "").replace(/\s*Effort$/i, "");
    }

    // ── meta chip ────────────────────────────────────────────────────

    function paintMeta() {
      const m = model();
      const name = m?.name || state.currentModelId || "Model";
      const effort =
        m?.supportsReasoningEffort && state.reasoningEffort
          ? effortLabel(state.reasoningEffort)
          : "";
      const mode = state.toolMode;
      const plain = [name]
        .concat(effort ? [effort] : [])
        .concat([mode])
        .join(" · ");

      metaEl.innerHTML =
        '<span class="meta-name">' +
        esc(name) +
        "</span>" +
        (effort
          ? '<span class="meta-sep" aria-hidden="true"> · </span><span class="meta-effort">' +
            esc(effort) +
            "</span>"
          : "") +
        '<span class="meta-sep" aria-hidden="true"> · </span><span class="meta-mode">' +
        esc(mode) +
        "</span>";
      metaEl.title = plain + " — click to change";
      metaEl.setAttribute("aria-label", plain);
      metaEl.setAttribute("role", "button");
      metaEl.setAttribute("aria-haspopup", "dialog");
      metaEl.setAttribute("aria-expanded", open ? "true" : "false");
      metaEl.tabIndex = 0;
      metaEl.classList.add("meta-btn");
      metaEl.classList.toggle("mode-yolo", mode === "yolo");
      metaEl.classList.toggle("mode-auto", mode === "auto");
      metaEl.classList.toggle("mode-ask", mode === "ask");
      if (metaEl.tagName === "BUTTON") metaEl.type = "button";
    }

    // ── pop position (locked while open) ─────────────────────────────

    function positionPop(force) {
      if (!open || !metaEl) return;
      if (popLocked && !force) {
        pop.style.width = popW + "px";
        pop.style.left = popLeft + "px";
        pop.style.top = popTop + "px";
        return;
      }
      const r = metaEl.getBoundingClientRect();
      const pad = 8;
      const gap = 6;
      const w = Math.min(280, window.innerWidth - pad * 2);
      let left = r.right - w;
      const mid = r.left + r.width / 2 - w / 2;
      if (mid >= pad && mid + w <= window.innerWidth - pad) left = mid;
      if (left < pad) left = pad;
      if (left + w > window.innerWidth - pad) left = window.innerWidth - pad - w;
      const h = pop.offsetHeight || 180;
      let top = r.top - h - gap;
      if (top < pad) top = r.bottom + gap;
      popW = w;
      popLeft = Math.round(left);
      popTop = Math.round(top);
      pop.style.width = popW + "px";
      pop.style.left = popLeft + "px";
      pop.style.top = popTop + "px";
      popLocked = true;
    }

    // ── tools pill ───────────────────────────────────────────────────

    function positionPill(instant) {
      const bar = pop.querySelector(".perm-mode");
      const pill = pop.querySelector("#perm-mode-pill");
      if (!bar || !pill) return;
      const on = bar.querySelector(".perm-mode-btn.on");
      if (!on) return;
      if (instant) pill.style.transition = "none";
      const br = bar.getBoundingClientRect();
      const btn = on.getBoundingClientRect();
      pill.style.width = btn.width + "px";
      pill.style.left = btn.left - br.left + "px";
      if (instant) {
        void pill.offsetWidth;
        pill.style.transition = "";
      }
    }

    /** Update tools UI only. Never touches effort. */
    function paintTools(instant) {
      const mode = state.toolMode;
      pop.querySelectorAll(".perm-mode-btn").forEach((btn) => {
        btn.classList.toggle("on", btn.getAttribute("data-perm") === mode);
      });
      const hint = pop.querySelector(".perm-mode-hint");
      if (hint) hint.textContent = TOOL_HINT[mode] || TOOL_HINT.ask;
      positionPill(!!instant);
    }

    // ── effort UI ────────────────────────────────────────────────────

    function placeKnob(t) {
      const knob = pop.querySelector("#effort-knob");
      if (knob) knob.style.left = pct(t) + "%";
    }

    /** Update effort UI only. Never touches tools. */
    function paintEffort(opts) {
      const o = opts || {};
      if (!efforts.length) return;
      const val = state.reasoningEffort;
      const i = effortIdx(val);
      displayT = tFromIdx(i);
      targetT = displayT;
      placeKnob(displayT);

      const fill = pop.querySelector("#effort-fill");
      if (fill) {
        fill.classList.add("settled");
        fill.style.width = pct(displayT) + "%";
        fill.setAttribute("data-tier", "high");
        if (o.burst) {
          fill.classList.remove("digital-burst", "digital-idle");
          void fill.offsetWidth;
          fill.classList.add("digital-burst");
          setTimeout(() => {
            fill.classList.remove("digital-burst");
            fill.classList.add("digital-idle");
          }, 720);
        } else {
          fill.classList.remove("digital-burst");
          fill.classList.add("digital-idle");
        }
      }

      const track = pop.querySelector("#effort-track");
      if (track) track.setAttribute("aria-valuenow", String(i));

      pop.querySelectorAll(".effort-tick").forEach((el) => {
        const id = el.getAttribute("data-effort");
        el.classList.toggle("on", id === val);
      });

      const hint = pop.querySelector("#effort-hint");
      if (hint) hint.textContent = effortHint(val);
    }

    // ── full render (from state only) ────────────────────────────────

    function render() {
      loadEfforts();
      // Keep effort if still valid; otherwise pick a real option (not forced "high")
      if (efforts.length) {
        const ok = efforts.some(
          (e) => e.value === state.reasoningEffort || e.id === state.reasoningEffort
        );
        if (!ok) {
          const def = efforts.find((e) => e.default) || efforts[efforts.length - 1];
          state.reasoningEffort = def.value || def.id;
        }
      }

      const mode = state.toolMode;
      let html = "";

      if (efforts.length) {
        const cur = state.reasoningEffort;
        const i = effortIdx(cur);
        displayT = tFromIdx(i);
        targetT = displayT;
        const p = pct(displayT);

        html += '<div class="model-pop-pad">';
        html += '<div class="model-pop-hd">Effort</div>';
        html += '<div class="effort-slider"><div class="effort-ticks">';
        for (const e of efforts) {
          const val = e.value || e.id;
          html +=
            '<button type="button" class="effort-tick' +
            (val === cur ? " on" : "") +
            '" data-effort="' +
            esc(val) +
            '">' +
            esc(tickLabel(e)) +
            "</button>";
        }
        html += "</div>";
        html +=
          '<div class="effort-track" id="effort-track" role="slider" aria-valuemin="0" aria-valuemax="' +
          (efforts.length - 1) +
          '" aria-valuenow="' +
          i +
          '" aria-label="Reasoning effort">';
        html +=
          '<div class="effort-fill settled digital-idle" id="effort-fill" style="width:' +
          p +
          '%"><span class="effort-sheen"></span></div>';
        html +=
          '<div class="effort-knob" id="effort-knob" style="left:' + p + '%"></div>';
        html += "</div>";
        html +=
          '<div class="effort-hint" id="effort-hint">' +
          esc(effortHint(cur)) +
          "</div></div></div>";
      }

      html += '<div class="model-pop-sep"></div><div class="model-pop-pad">';
      html += '<div class="model-pop-hd">Tools</div>';
      html +=
        '<div class="perm-mode" role="group" aria-label="Tool permission mode">';
      html += '<div class="perm-mode-pill" id="perm-mode-pill"></div>';
      for (const key of ["ask", "auto", "yolo"]) {
        const label = key.charAt(0).toUpperCase() + key.slice(1);
        html +=
          '<button type="button" class="perm-mode-btn' +
          (mode === key ? " on" : "") +
          '" data-perm="' +
          key +
          '">' +
          label +
          "</button>";
      }
      html += "</div>";
      html +=
        '<div class="perm-mode-hint">' +
        (TOOL_HINT[mode] || TOOL_HINT.ask) +
        "</div></div>";

      pop.innerHTML = html;
      sliderBound = false;
      if (efforts.length) bindSlider();
      bindTools();
      requestAnimationFrame(() => positionPill(true));
    }

    // ── user actions ─────────────────────────────────────────────────

    function commitEffort(idx) {
      if (!efforts.length) return;
      const i = Math.max(0, Math.min(efforts.length - 1, idx));
      const e = efforts[i];
      if (!e) return;
      const val = e.value || e.id;
      const prev = state.reasoningEffort;
      state.reasoningEffort = val;
      const m = model();
      if (m) m.reasoningEffort = val;

      paintEffort({ burst: prev !== val });
      paintMeta();
      // tools untouched

      if (prev !== val) {
        acceptHostEffort = true;
        post({
          type: "setModel",
          modelId: state.currentModelId,
          reasoningEffort: val,
        });
      }
    }

    function commitTools(mode) {
      const next = asToolMode(mode);
      if (!next || next === state.toolMode) return;
      state.toolMode = next;
      paintTools(false);
      paintMeta();
      // effort untouched
      post({ type: "setPermissionMode", mode: next });
    }

    function bindTools() {
      pop.querySelectorAll(".perm-mode-btn").forEach((btn) => {
        btn.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          commitTools(btn.getAttribute("data-perm"));
        });
      });
    }

    // ── slider physics ───────────────────────────────────────────────

    function stopPhysics() {
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
    }

    function startPhysics() {
      stopPhysics();
      function tick() {
        if (dragging) {
          displayT += (targetT - displayT) * INPUT_FOLLOW;
        } else if (settling) {
          const err = targetT - displayT;
          if (Math.abs(err) < 0.004) displayT = targetT;
          else displayT += err * SETTLE_LERP;
        } else {
          displayT = targetT;
        }
        displayT = Math.max(0, Math.min(1, displayT));
        placeKnob(displayT);

        if (dragging || settling) {
          const fill = pop.querySelector("#effort-fill");
          if (fill) {
            fill.classList.remove("settled", "digital-burst");
            fill.style.width = pct(displayT) + "%";
          }
        }

        const still = dragging
          ? Math.abs(targetT - displayT) > 0.002
          : settling && Math.abs(targetT - displayT) > 0.004;

        if (still || dragging) {
          rafId = requestAnimationFrame(tick);
        } else {
          rafId = 0;
          if (settling) {
            settling = false;
            displayT = targetT;
            placeKnob(displayT);
            const idx =
              pendingSettleIdx != null
                ? pendingSettleIdx
                : idxFromT(displayT);
            pendingSettleIdx = null;
            commitEffort(idx);
          }
        }
      }
      rafId = requestAnimationFrame(tick);
    }

    function bindSlider() {
      if (sliderBound) return;
      const track = pop.querySelector("#effort-track");
      const knob = pop.querySelector("#effort-knob");
      if (!track || !efforts.length) return;
      sliderBound = true;

      function tFromX(clientX) {
        const r = track.getBoundingClientRect();
        if (r.width <= 0) return displayT;
        let raw = (clientX - r.left) / r.width;
        raw = (raw - 0.03) / 0.94;
        return Math.max(0, Math.min(1, raw));
      }

      function aim(clientX) {
        targetT = tFromX(clientX);
        if (!rafId) startPhysics();
      }

      function startDrag(ev) {
        ev.preventDefault();
        ev.stopPropagation();
        dragging = true;
        settling = false;
        pendingSettleIdx = null;
        dragOriginIdx = effortIdx(state.reasoningEffort);
        track.classList.add("dragging");
        const fill = pop.querySelector("#effort-fill");
        if (fill) fill.classList.remove("settled", "digital-burst");
        aim(ev.touches ? ev.touches[0].clientX : ev.clientX);
        startPhysics();

        function move(e) {
          if (!dragging) return;
          if (e.cancelable) e.preventDefault();
          aim(e.touches ? e.touches[0].clientX : e.clientX);
        }
        function end() {
          if (!dragging) return;
          dragging = false;
          track.classList.remove("dragging");
          pendingSettleIdx = idxFromT(displayT);
          targetT = tFromIdx(pendingSettleIdx);
          settling = true;
          startPhysics();
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", end);
          window.removeEventListener("pointercancel", end);
          window.removeEventListener("touchmove", move);
          window.removeEventListener("touchend", end);
        }
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", end);
        window.addEventListener("pointercancel", end);
        window.addEventListener("touchmove", move, { passive: false });
        window.addEventListener("touchend", end);
      }

      track.addEventListener("pointerdown", startDrag);
      if (knob) {
        knob.style.pointerEvents = "auto";
        knob.addEventListener("pointerdown", startDrag);
      }

      pop.querySelectorAll(".effort-tick").forEach((el) => {
        el.addEventListener("click", (ev) => {
          ev.stopPropagation();
          const id = el.getAttribute("data-effort") || "";
          pendingSettleIdx = effortIdx(id);
          targetT = tFromIdx(pendingSettleIdx);
          settling = true;
          dragging = false;
          startPhysics();
        });
      });
    }

    // ── host → UI ────────────────────────────────────────────────────

    /**
     * Models payload: model list / id.
     * Effort only when we asked for it (setModel) or the model id changed.
     * YOLO restart emits session defaults (often high) — ignore that noise.
     * Never touches toolMode.
     */
    function applyModels(msg) {
      if (!msg || typeof msg !== "object") return;

      const prevId = state.currentModelId;
      const prevKey = state.availableModels.map((m) => m.modelId).join("\0");

      if (typeof msg.currentModelId === "string" && msg.currentModelId) {
        state.currentModelId = msg.currentModelId;
      }
      if (Array.isArray(msg.availableModels) && msg.availableModels.length) {
        state.availableModels = msg.availableModels;
      }

      const modelChanged =
        typeof msg.currentModelId === "string" &&
        msg.currentModelId &&
        msg.currentModelId !== prevId;
      const hostEffort =
        typeof msg.reasoningEffort === "string" && msg.reasoningEffort
          ? msg.reasoningEffort
          : "";

      // Take host effort when: first seed, we posted setModel, or model id changed.
      // Skip otherwise — YOLO restart session/new defaults to high and must not win.
      if (
        hostEffort &&
        (acceptHostEffort || modelChanged || !seenHostModels)
      ) {
        state.reasoningEffort = hostEffort;
        acceptHostEffort = false;
      }
      seenHostModels = true;

      const m = model();
      if (m && state.reasoningEffort) m.reasoningEffort = state.reasoningEffort;

      paintMeta();

      if (!open) return;

      const nextKey = state.availableModels.map((x) => x.modelId).join("\0");
      const identityChanged =
        state.currentModelId !== prevId || nextKey !== prevKey;

      if (identityChanged) {
        render();
        requestAnimationFrame(() => positionPop(true));
      } else if (!dragging && !settling) {
        loadEfforts();
        paintEffort();
      }
    }

    /**
     * Permission payload: update toolMode only.
     * Never reads or writes reasoningEffort.
     */
    function applyPermissionMode(msg) {
      if (!msg || typeof msg !== "object") return;
      const fromMsg =
        asToolMode(msg.permissionMode) ||
        (msg.alwaysApprove ? "yolo" : null);
      if (!fromMsg) return;
      if (fromMsg === state.toolMode) {
        // still refresh meta/pill in case UI desynced
        paintMeta();
        if (open) paintTools(true);
        return;
      }
      state.toolMode = fromMsg;
      paintMeta();
      if (open) paintTools(false);
    }

    // ── open / close ─────────────────────────────────────────────────

    function setOpen(v) {
      const next = !!v;
      if (next === open) return;
      open = next;
      pop.classList.toggle("hidden", !open);
      pop.setAttribute("aria-hidden", open ? "false" : "true");
      metaEl.classList.toggle("meta-open", open);
      metaEl.setAttribute("aria-expanded", open ? "true" : "false");
      if (open) {
        ignoreOutsideUntil = Date.now() + 250;
        popLocked = false;
        render();
        requestAnimationFrame(() => {
          positionPop(true);
          requestAnimationFrame(() => positionPop(true));
        });
      } else {
        popLocked = false;
        stopPhysics();
        dragging = false;
        settling = false;
      }
    }

    function toggle() {
      setOpen(!open);
    }

    // ── events ───────────────────────────────────────────────────────

    pop.addEventListener("mousedown", (ev) => ev.stopPropagation());

    metaEl.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      toggle();
    });
    metaEl.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        ev.stopPropagation();
        toggle();
      } else if (ev.key === "Escape" && open) {
        ev.preventDefault();
        setOpen(false);
      }
    });

    document.addEventListener(
      "mousedown",
      (ev) => {
        if (!open || Date.now() < ignoreOutsideUntil) return;
        const t = ev.target;
        if (
          t instanceof Node &&
          (pop.contains(t) ||
            metaEl.contains(t) ||
            (metaRow && metaRow.contains(t)))
        ) {
          return;
        }
        setOpen(false);
      },
      true
    );

    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape" && open) setOpen(false);
    });

    window.addEventListener("resize", () => {
      if (open) {
        positionPop(true);
        positionPill(true);
      }
    });

    paintMeta();

    return {
      applyModels: applyModels,
      applyPermissionMode: applyPermissionMode,
      setOpen: setOpen,
      getState: function () {
        // Compat shape for slash/composer
        return {
          currentModelId: state.currentModelId,
          modelId: state.currentModelId,
          reasoningEffort: state.reasoningEffort,
          permissionMode: state.toolMode,
          alwaysApprove: state.toolMode === "yolo",
          availableModels: state.availableModels,
        };
      },
    };
  }

  W.modelSelector = { mount: mount };
})(typeof window !== "undefined" ? window : globalThis);
