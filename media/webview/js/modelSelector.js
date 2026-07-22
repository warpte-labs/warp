/**
 * Warp.modelSelector — model + reasoning effort picker.
 *
 * Effort UX (monochrome ultra-thin):
 *  - 2px rail, white fill, round knob
 *  - Drag follows pointer (INPUT_FOLLOW); 50% threshold commits
 *  - Settle lerp + subtle sheen on land
 *  - session/set_model via post({ type: "setModel", ... })
 */
(function (global) {
  "use strict";

  const W = (global.Warp = global.Warp || {});

  const RANK = {
    none: 0,
    minimal: 1,
    low: 2,
    medium: 3,
    high: 4,
    xhigh: 5,
    max: 6,
  };

  const INPUT_FOLLOW = 0.92;
  const SETTLE_LERP = 0.2;

  /** One-line hints under the effort rail — keep ~same length, no fluff. */
  const SHORT_HINTS = {
    none: "Minimal work",
    minimal: "Minimal work",
    low: "Fast and light",
    medium: "Balanced depth",
    high: "Deepest search",
    xhigh: "Deepest search",
    max: "Deepest search",
  };

  /** One-line tools hints under the perm strip. */
  const PERM_HINTS = {
    ask: "Confirm each tool",
    auto: "Safe tools free",
    yolo: "No tool prompts",
  };

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

    /** @type {any} */
    let state = {
      currentModelId: "grok-4.5",
      reasoningEffort: "high",
      /** @type {"ask"|"auto"|"yolo"} */
      permissionMode: "ask",
      alwaysApprove: false,
      availableModels: [
        {
          modelId: "grok-4.5",
          name: "Grok 4.5",
          supportsReasoningEffort: true,
          reasoningEffort: "high",
          reasoningEfforts: [
            {
              id: "low",
              value: "low",
              label: "Low Effort",
              description: SHORT_HINTS.low,
            },
            {
              id: "medium",
              value: "medium",
              label: "Medium Effort",
              description: SHORT_HINTS.medium,
            },
            {
              id: "high",
              value: "high",
              label: "High Effort",
              description: SHORT_HINTS.high,
              default: true,
            },
          ],
        },
      ],
    };

    // Fixed pop — positioned above the Grok meta label (not the whole composer)
    const pop = document.createElement("div");
    pop.className = "model-pop hidden";
    pop.setAttribute("role", "dialog");
    pop.setAttribute("aria-label", "Model, effort, and tools");
    pop.setAttribute("aria-hidden", "true");
    document.body.appendChild(pop);

    let open = false;
    let ignoreOutsideUntil = 0;
    /** Frozen screen position while pop is open — avoids jump when meta text width changes */
    let popLock = null;

    /**
     * @param {{ force?: boolean }} [opts]
     */
    function positionPop(opts) {
      if (!open || !metaEl) return;
      const force = !!(opts && opts.force);
      // Keep dropdown glued while user swaps effort/mode (meta chip reflows)
      if (popLock && !force) {
        pop.style.width = popLock.w + "px";
        pop.style.left = popLock.left + "px";
        pop.style.top = popLock.top + "px";
        return;
      }
      const r = metaEl.getBoundingClientRect();
      const pad = 8;
      const gap = 6;
      const w = Math.min(280, window.innerWidth - pad * 2);
      pop.style.width = w + "px";
      // Prefer right-aligned to the meta chip so it sits over the label
      let left = r.right - w;
      // Center on meta if that fits better in a narrow sidebar
      const centered = r.left + r.width / 2 - w / 2;
      if (centered >= pad && centered + w <= window.innerWidth - pad) {
        left = centered;
      }
      if (left < pad) left = pad;
      if (left + w > window.innerWidth - pad) {
        left = window.innerWidth - pad - w;
      }
      const h = pop.offsetHeight || 180;
      let top = r.top - h - gap;
      // If not enough room above, flip just below the label
      if (top < pad) {
        top = r.bottom + gap;
      }
      left = Math.round(left);
      top = Math.round(top);
      pop.style.left = left + "px";
      pop.style.top = top + "px";
      popLock = { left: left, top: top, w: w };
    }

    /** @type {Array<{id:string,value:string,label:string,description?:string,default?:boolean}>} */
    let efforts = [];
    /** Notch positions 0–1 for each effort */
    let notches = [0, 0.5, 1];

    let displayT = 1;
    let targetT = 1;
    let dragging = false;
    let settling = false;
    let dragOriginIdx = 2;
    let pendingSettleIdx = null;
    let rafId = 0;
    let boundSlider = false;

    function currentModel() {
      return (
        state.availableModels.find((m) => m.modelId === state.currentModelId) ||
        state.availableModels[0] ||
        null
      );
    }

    function sortedEfforts(m) {
      const list = (m && m.reasoningEfforts) || [];
      return list.slice().sort((a, b) => {
        const va = String(a.value || a.id || "").toLowerCase();
        const vb = String(b.value || b.id || "").toLowerCase();
        return (RANK[va] ?? 50) - (RANK[vb] ?? 50);
      });
    }

    function effortIndex(id) {
      const i = efforts.findIndex(
        (e) => e.value === id || e.id === id
      );
      return i < 0 ? Math.max(0, efforts.length - 1) : i;
    }

    function tFromIndex(i) {
      if (!notches.length) return 0;
      const n = Math.max(0, Math.min(notches.length - 1, i));
      return notches[n];
    }

    function pctFromT(t) {
      const pad = 3;
      return pad + t * (100 - pad * 2);
    }

    function rebuildNotches() {
      const n = Math.max(1, efforts.length);
      if (n === 1) {
        notches = [1];
        return;
      }
      notches = [];
      for (let i = 0; i < n; i++) {
        notches.push(i / (n - 1));
      }
    }

    /**
     * 50% of each segment: commit to side past midpoint.
     * e.g. 3 tiers → mids at 0.25 and 0.75
     */
    function indexFromHalfThreshold(t) {
      if (efforts.length <= 1) return 0;
      for (let i = 0; i < notches.length - 1; i++) {
        const mid = (notches[i] + notches[i + 1]) / 2;
        if (t < mid) return i;
      }
      return notches.length - 1;
    }

    function shortLabel(e) {
      return String(e.label || e.value || e.id || "").replace(
        /\s*Effort$/i,
        ""
      );
    }

    function shortEffortLabel(effort, model) {
      const list = sortedEfforts(model);
      const opt = list.find((e) => e.value === effort || e.id === effort);
      if (opt?.label) return opt.label.replace(/\s*Effort$/i, "");
      if (!effort) return "";
      return effort.charAt(0).toUpperCase() + effort.slice(1);
    }

    /**
     * Stable meta chip: fixed-width slots for effort + mode so the bar
     * (and the open dropdown above it) don't shift when swapping Low/Med/High.
     */
    function paintMeta() {
      const mode =
        state.permissionMode || (state.alwaysApprove ? "yolo" : "ask");
      const m = currentModel();
      const name = m?.name || state.currentModelId || "Model";
      const effort =
        m?.supportsReasoningEffort && state.reasoningEffort
          ? shortEffortLabel(state.reasoningEffort, m)
          : "";
      const plain = [name]
        .concat(effort ? [effort] : [])
        .concat([mode])
        .join(" · ");

      metaEl.innerHTML =
        '<span class="meta-name">' +
        esc(name) +
        "</span>" +
        (effort
          ? '<span class="meta-sep" aria-hidden="true"> · </span>' +
            '<span class="meta-effort">' +
            esc(effort) +
            "</span>"
          : "") +
        '<span class="meta-sep" aria-hidden="true"> · </span>' +
        '<span class="meta-mode">' +
        esc(mode) +
        "</span>";
      metaEl.title =
        plain + " — click to change (ask · auto · yolo)";
      metaEl.setAttribute("aria-label", plain);
      metaEl.setAttribute("role", "button");
      metaEl.setAttribute("aria-haspopup", "dialog");
      metaEl.setAttribute("aria-expanded", open ? "true" : "false");
      metaEl.tabIndex = 0;
      metaEl.classList.add("meta-btn");
      metaEl.classList.toggle("mode-yolo", mode === "yolo");
      metaEl.classList.toggle("mode-auto", mode === "auto");
      metaEl.classList.toggle("mode-ask", mode === "ask");
      if (metaEl.tagName === "BUTTON") {
        metaEl.type = "button";
      }
    }

    function tierClass(id) {
      const v = String(id || "").toLowerCase();
      if (v === "low" || v === "minimal" || v === "none") return "low";
      if (v === "medium") return "medium";
      return "high";
    }

    /** Prefer short local copy over long ACP descriptions. */
    function shortHint(e) {
      if (!e) return "";
      const key = String(e.value || e.id || "").toLowerCase();
      if (SHORT_HINTS[key]) return SHORT_HINTS[key];
      const raw = String(e.description || "").trim();
      if (!raw) return "";
      // Hard cap: one short line if we ever get unknown tiers
      return raw.length > 28 ? raw.slice(0, 25).trimEnd() + "…" : raw;
    }

    function render() {
      const m = currentModel();
      const models = state.availableModels || [];
      efforts = m?.supportsReasoningEffort ? sortedEfforts(m) : [];
      rebuildNotches();

      // Effort bar only — no model header / name
      let html = "";
      if (efforts.length) {
        const cur =
          state.reasoningEffort ||
          efforts.find((e) => e.default)?.value ||
          efforts[efforts.length - 1]?.value ||
          "high";
        const idx = effortIndex(cur);
        displayT = tFromIndex(idx);
        targetT = displayT;
        const pct = pctFromT(displayT);
        const tier = tierClass(cur);

        html += '<div class="model-pop-pad">';
        html += '<div class="model-pop-hd">Effort</div>';
        html += '<div class="effort-slider">';
        html += '<div class="effort-ticks">';
        for (const e of efforts) {
          const val = e.value || e.id;
          const on = val === cur || e.id === cur;
          html +=
            '<button type="button" class="effort-tick' +
            (on ? " on tier-" + tierClass(val) : "") +
            '" data-effort="' +
            esc(val) +
            '" title="' +
            esc(e.description || e.label || val) +
            '">' +
            esc(shortLabel(e)) +
            "</button>";
        }
        html += "</div>";
        html +=
          '<div class="effort-track" id="effort-track" role="slider" aria-valuemin="0" aria-valuemax="' +
          (efforts.length - 1) +
          '" aria-valuenow="' +
          idx +
          '" aria-label="Reasoning effort">';
        html +=
          '<div class="effort-fill settled digital-idle tier-' +
          tier +
          '" id="effort-fill" data-tier="' +
          tier +
          '" style="width:' +
          pct +
          '%"><span class="effort-sheen"></span></div>';
        html +=
          '<div class="effort-knob" id="effort-knob" style="left:' +
          pct +
          '%"></div>';
        html += "</div>";
        const curOpt = efforts[idx] || efforts[0];
        const hintText = shortHint(curOpt);
        html +=
          '<div class="effort-hint" id="effort-hint">' +
          esc(hintText) +
          "</div>";
        html += "</div></div>";
      }

      // Tools permission — ask / auto / yolo + sliding pill
      const mode =
        state.permissionMode || (state.alwaysApprove ? "yolo" : "ask");
      html += '<div class="model-pop-sep"></div>';
      html += '<div class="model-pop-pad">';
      html += '<div class="model-pop-hd">Tools</div>';
      html +=
        '<div class="perm-mode" role="group" aria-label="Tool permission mode">';
      html += '<div class="perm-mode-pill" id="perm-mode-pill"></div>';
      html +=
        '<button type="button" class="perm-mode-btn' +
        (mode === "ask" ? " on" : "") +
        '" data-perm="ask" title="Prompt before every tool">Ask</button>';
      html +=
        '<button type="button" class="perm-mode-btn' +
        (mode === "auto" ? " on" : "") +
        '" data-perm="auto" title="Allow safe/read tools; prompt for write/shell">Auto</button>';
      html +=
        '<button type="button" class="perm-mode-btn' +
        (mode === "yolo" ? " on" : "") +
        '" data-perm="yolo" title="Skip tool prompts (confirm required)">Yolo</button>';
      html += "</div>";
      html +=
        '<div class="perm-mode-hint">' +
        (PERM_HINTS[mode] || PERM_HINTS.ask) +
        "</div>";
      html += "</div>";

      pop.innerHTML = html;
      boundSlider = false;
      if (efforts.length) bindSlider();
      bindPermMode();
      // Place pill without animating on first paint
      requestAnimationFrame(() => positionPermPill(true));
    }

    function positionPermPill(instant) {
      const container = pop.querySelector(".perm-mode");
      const pill = pop.querySelector("#perm-mode-pill");
      if (!container || !pill) return;
      const active = container.querySelector(".perm-mode-btn.on");
      if (!active) return;
      if (instant) {
        pill.style.transition = "none";
      }
      const barRect = container.getBoundingClientRect();
      const btnRect = active.getBoundingClientRect();
      pill.style.width = btnRect.width + "px";
      pill.style.left = btnRect.left - barRect.left + "px";
      if (instant) {
        void pill.offsetWidth;
        pill.style.transition = "";
      }
    }

    function paintPermMode(mode, opts) {
      const instant = !!(opts && opts.instant);
      const container = pop.querySelector(".perm-mode");
      if (!container) return;
      container.querySelectorAll(".perm-mode-btn").forEach((btn) => {
        const p = btn.getAttribute("data-perm");
        btn.classList.toggle("on", p === mode);
      });
      const hint = pop.querySelector(".perm-mode-hint");
      if (hint) hint.textContent = PERM_HINTS[mode] || PERM_HINTS.ask;
      positionPermPill(instant);
    }

    function bindPermMode() {
      pop.querySelectorAll(".perm-mode-btn").forEach((btn) => {
        btn.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          const mode = btn.getAttribute("data-perm");
          if (!mode || mode === state.permissionMode) return;
          // Optimistic: slide pill immediately (usage-tab style)
          state.permissionMode = mode;
          state.alwaysApprove = mode === "yolo";
          paintPermMode(mode);
          paintMeta();
          post({ type: "setPermissionMode", mode: mode });
        });
      });
    }

    function applyPermissionMode(msg) {
      if (!msg || typeof msg !== "object") return;
      const mode =
        msg.permissionMode === "auto" ||
        msg.permissionMode === "yolo" ||
        msg.permissionMode === "ask"
          ? msg.permissionMode
          : msg.alwaysApprove
            ? "yolo"
            : "ask";
      const prev = state.permissionMode;
      state.permissionMode = mode;
      state.alwaysApprove = mode === "yolo";
      paintMeta();
      if (!open) return;
      // In-place update so the pill can animate (full re-render would snap)
      if (pop.querySelector(".perm-mode")) {
        paintPermMode(mode, { instant: prev === mode });
      } else {
        render();
      }
    }

    function placeKnob(t) {
      const knob = pop.querySelector("#effort-knob");
      if (knob) knob.style.left = pctFromT(t) + "%";
    }

    function paintFillWidth(t, tier) {
      const fill = pop.querySelector("#effort-fill");
      if (!fill) return;
      fill.classList.remove("settled", "digital-burst");
      fill.style.width = pctFromT(t) + "%";
      fill.setAttribute("data-tier", tier);
      fill.classList.remove("tier-low", "tier-medium", "tier-high");
      fill.classList.add("tier-" + tier);
    }

    function playLandEffect(fill) {
      if (!fill) return;
      fill.classList.remove("digital-burst", "digital-idle");
      void fill.offsetWidth;
      requestAnimationFrame(() => {
        fill.classList.add("digital-burst");
        const onEnd = () => {
          fill.classList.remove("digital-burst");
          fill.classList.add("digital-idle");
          fill.removeEventListener("animationend", onEnd);
        };
        fill.addEventListener("animationend", onEnd);
        setTimeout(() => {
          if (fill.classList.contains("digital-burst")) {
            fill.classList.remove("digital-burst");
            fill.classList.add("digital-idle");
            fill.removeEventListener("animationend", onEnd);
          }
        }, 900);
      });
    }

    function onSettledAt(idx) {
      const i = Math.max(0, Math.min(efforts.length - 1, idx));
      const e = efforts[i];
      if (!e) return;
      const val = e.value || e.id;
      const prev = state.reasoningEffort;
      const tier = tierClass(val);

      state.reasoningEffort = val;
      // sync model entry
      const m = currentModel();
      if (m) m.reasoningEffort = val;

      displayT = tFromIndex(i);
      targetT = displayT;
      placeKnob(displayT);

      const fill = pop.querySelector("#effort-fill");
      if (fill) {
        fill.classList.add("settled");
        fill.classList.remove("tier-low", "tier-medium", "tier-high");
        fill.classList.add("tier-" + tier);
        fill.setAttribute("data-tier", tier);
        fill.style.width = pctFromT(displayT) + "%";
        if (prev !== val) {
          playLandEffect(fill);
        } else {
          fill.classList.remove("digital-burst");
          fill.classList.add("digital-idle");
        }
      }

      const track = pop.querySelector("#effort-track");
      if (track) track.setAttribute("aria-valuenow", String(i));

      const ticks = pop.querySelectorAll(".effort-tick");
      ticks.forEach((el) => {
        const id = el.getAttribute("data-effort");
        const on = id === val;
        el.classList.toggle("on", on);
        el.classList.remove("tier-low", "tier-medium", "tier-high");
        if (on) el.classList.add("tier-" + tierClass(id));
      });

      const hint = pop.querySelector("#effort-hint");
      if (hint) hint.textContent = shortHint(e);

      paintMeta();

      if (prev !== val) {
        post({
          type: "setModel",
          modelId: state.currentModelId,
          reasoningEffort: val,
        });
      }
    }

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
          if (Math.abs(err) < 0.004) {
            displayT = targetT;
          } else {
            displayT += err * SETTLE_LERP;
          }
        } else {
          displayT = targetT;
        }
        if (displayT < 0) displayT = 0;
        if (displayT > 1) displayT = 1;

        placeKnob(displayT);

        if (dragging || settling) {
          const origin = efforts[dragOriginIdx];
          const originTier = tierClass(
            origin ? origin.value || origin.id : "high"
          );
          paintFillWidth(displayT, originTier);
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
                : indexFromHalfThreshold(displayT);
            pendingSettleIdx = null;
            onSettledAt(idx);
          }
        }
      }
      rafId = requestAnimationFrame(tick);
    }

    function bindSlider() {
      if (boundSlider) return;
      const track = pop.querySelector("#effort-track");
      const knob = pop.querySelector("#effort-knob");
      if (!track || !efforts.length) return;
      boundSlider = true;

      function tFromClientX(clientX) {
        const r = track.getBoundingClientRect();
        if (r.width <= 0) return displayT;
        const pad = 0.03;
        let raw = (clientX - r.left) / r.width;
        raw = (raw - pad) / (1 - pad * 2);
        return Math.max(0, Math.min(1, raw));
      }

      function setPointerTarget(clientX) {
        targetT = tFromClientX(clientX);
        if (!rafId) startPhysics();
      }

      function startDrag(ev) {
        ev.preventDefault();
        ev.stopPropagation();
        dragging = true;
        settling = false;
        pendingSettleIdx = null;
        dragOriginIdx = effortIndex(state.reasoningEffort);
        track.classList.add("dragging");
        const fill = pop.querySelector("#effort-fill");
        if (fill) {
          fill.classList.remove("settled", "digital-burst");
          const origin = efforts[dragOriginIdx];
          const tier = tierClass(origin ? origin.value || origin.id : "high");
          fill.setAttribute("data-tier", tier);
          fill.classList.remove("tier-low", "tier-medium", "tier-high");
          fill.classList.add("tier-" + tier);
        }
        const cx = ev.touches ? ev.touches[0].clientX : ev.clientX;
        setPointerTarget(cx);
        startPhysics();

        function move(e) {
          if (!dragging) return;
          if (e.cancelable) e.preventDefault();
          setPointerTarget(e.touches ? e.touches[0].clientX : e.clientX);
        }
        function end() {
          if (!dragging) return;
          dragging = false;
          track.classList.remove("dragging");
          const at = indexFromHalfThreshold(displayT);
          pendingSettleIdx = at;
          targetT = tFromIndex(at);
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
          const idx = effortIndex(id);
          dragOriginIdx = effortIndex(state.reasoningEffort);
          pendingSettleIdx = idx;
          targetT = tFromIndex(idx);
          settling = true;
          dragging = false;
          startPhysics();
        });
      });
    }

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
        popLock = null;
        render();
        // After layout, pin drop-up once and freeze until close/resize
        requestAnimationFrame(() => {
          positionPop({ force: true });
          requestAnimationFrame(() => positionPop({ force: true }));
        });
      } else {
        popLock = null;
        stopPhysics();
        dragging = false;
        settling = false;
      }
    }

    function toggle() {
      setOpen(!open);
    }

    function applyModels(msg) {
      if (!msg || typeof msg !== "object") return;
      const available = Array.isArray(msg.availableModels)
        ? msg.availableModels
        : state.availableModels;
      state = {
        currentModelId:
          typeof msg.currentModelId === "string" && msg.currentModelId
            ? msg.currentModelId
            : state.currentModelId,
        reasoningEffort:
          typeof msg.reasoningEffort === "string"
            ? msg.reasoningEffort
            : state.reasoningEffort,
        availableModels: available.length ? available : state.availableModels,
      };
      const cur = currentModel();
      if (!msg.reasoningEffort && cur?.reasoningEffort) {
        state.reasoningEffort = cur.reasoningEffort;
      }
      paintMeta();
      if (open) {
        render();
        // Re-measure only after a full re-render (models list changed)
        requestAnimationFrame(() => positionPop({ force: true }));
      }
    }

    pop.addEventListener("mousedown", (ev) => {
      ev.stopPropagation();
    });
    function onMetaActivate(ev) {
      ev.preventDefault();
      ev.stopPropagation();
      toggle();
    }
    metaEl.addEventListener("click", onMetaActivate);
    metaEl.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        onMetaActivate(ev);
      } else if (ev.key === "Escape" && open) {
        ev.preventDefault();
        setOpen(false);
      }
    });

    document.addEventListener(
      "mousedown",
      (ev) => {
        if (!open) return;
        if (Date.now() < ignoreOutsideUntil) return;
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
        positionPop({ force: true });
        positionPermPill(true);
      }
    });

    paintMeta();
    return {
      applyModels,
      applyPermissionMode,
      setOpen,
      getState: () => state,
    };
  }

  function esc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  W.modelSelector = { mount };
})(typeof window !== "undefined" ? window : globalThis);
