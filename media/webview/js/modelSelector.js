/**
 * Warp.modelSelector — model + reasoning effort picker.
 *
 * Effort UX (from mockup):
 *  - Thick track, white square knob
 *  - Blue / pink / green tier fills
 *  - Drag follows pointer; 50% threshold commits side
 *  - Color + sheen effect only after settle
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

  /**
   * @param {{
   *   metaEl: HTMLElement | null,
   *   post: (msg: object) => void,
   * }} opts
   */
  function mount(opts) {
    const metaEl = opts.metaEl;
    const post = opts.post;
    if (!metaEl) {
      return {
        applyModels: function () {},
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
              description: "Quick, fast implementations",
            },
            {
              id: "medium",
              value: "medium",
              label: "Medium Effort",
              description: "Balanced effort with standard implementation and testing",
            },
            {
              id: "high",
              value: "high",
              label: "High Effort",
              description:
                "Highest implementation quality with extensive reasoning",
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
    pop.setAttribute("aria-label", "Model and effort");
    pop.setAttribute("aria-hidden", "true");
    document.body.appendChild(pop);

    let open = false;
    let ignoreOutsideUntil = 0;

    function positionPop() {
      if (!open || !metaEl) return;
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
      pop.style.left = Math.round(left) + "px";
      pop.style.top = Math.round(top) + "px";
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

    function labelText() {
      const m = currentModel();
      const name = m?.name || state.currentModelId || "Model";
      if (!m?.supportsReasoningEffort || !state.reasoningEffort) {
        return name;
      }
      return name + " · " + shortEffortLabel(state.reasoningEffort, m);
    }

    function shortEffortLabel(effort, model) {
      const list = sortedEfforts(model);
      const opt = list.find((e) => e.value === effort || e.id === effort);
      if (opt?.label) return opt.label.replace(/\s*Effort$/i, "");
      if (!effort) return "";
      return effort.charAt(0).toUpperCase() + effort.slice(1);
    }

    function paintMeta() {
      metaEl.textContent = labelText();
      metaEl.title = "Model & effort — click to change";
      metaEl.setAttribute("role", "button");
      metaEl.setAttribute("aria-haspopup", "dialog");
      metaEl.setAttribute("aria-expanded", open ? "true" : "false");
      metaEl.tabIndex = 0;
      metaEl.classList.add("meta-btn");
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
        if (curOpt?.description) {
          html +=
            '<div class="effort-hint" id="effort-hint">' +
            esc(curOpt.description) +
            "</div>";
        } else {
          html += '<div class="effort-hint" id="effort-hint"></div>';
        }
        html += "</div></div>";
      }
      pop.innerHTML = html;
      boundSlider = false;
      if (efforts.length) bindSlider();
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
      if (hint) hint.textContent = e.description || "";

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
        render();
        // After layout, pin drop-up to the Grok label
        requestAnimationFrame(() => {
          positionPop();
          requestAnimationFrame(positionPop);
        });
      } else {
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
        requestAnimationFrame(positionPop);
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
        if (t instanceof Node && (pop.contains(t) || metaEl.contains(t))) {
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
      if (open) positionPop();
    });

    paintMeta();
    return {
      applyModels,
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
