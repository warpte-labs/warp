/**
 * Warp.hero — empty-state W logo + spiral intro + slow molasses trail stream
 * + trail push-away hover (far-right pixels repel from cursor).
 *
 * Full mark stays painted (shape never hollows). Trail-region copies stream
 * slowly to the right forever and respawn (mockup V3 · Slow molasses).
 */
(function (global) {
  "use strict";

  const W = (global.Warp = global.Warp || {});

  const VIEW = { x: 70, y: 130, w: 390, h: 230 };
  const EXIT_X = VIEW.x + VIEW.w + 8;
  const TRAIL_CUT = 337;
  const REPEL_R = 72;

  /** Slow molasses (mockup V3) */
  const STREAM = {
    speed: 6,
    speedJitter: 0.05,
    yJitter: 0,
    fadeOut: 0.55,
    fadeIn: 0.35,
    density: 0.8,
  };

  /** @type {{
   *   heroEl: HTMLElement,
   *   svg: SVGElement,
   *   particles: Array<any>,
   *   templates: Array<{x:number,y:number,w:number,h:number}>,
   *   last: number,
   *   raf: number,
   *   running: boolean,
   *   hover: { onMove: Function, onEnter: Function, onLeave: Function } | null,
   *   pointer: { x: number, y: number, active: boolean } | null
   * } | null} */
  let engine = null;

  function prefersReducedMotion() {
    try {
      return (
        typeof matchMedia === "function" &&
        matchMedia("(prefers-reduced-motion: reduce)").matches
      );
    } catch (_) {
      return false;
    }
  }

  function hash01(i) {
    const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
    return x - Math.floor(x);
  }

  /**
   * @param {Array<{x:number,y:number,w:number,h:number}>} tiles
   * @returns {string} SVG markup
   */
  function buildSvg(tiles) {
    const list = tiles || [];
    const cores = list
      .map((t, i) => {
        const isTrail = t.x >= TRAIL_CUT;
        const cx = t.x + t.w / 2;
        const cy = t.y + t.h / 2;
        return (
          '<rect class="w-tile core' +
          (isTrail ? " trail" : "") +
          '" data-i="' +
          i +
          '" data-x="' +
          t.x +
          '" data-y="' +
          t.y +
          '" data-cx="' +
          cx +
          '" data-cy="' +
          cy +
          '" x="' +
          t.x +
          '" y="' +
          t.y +
          '" width="' +
          t.w +
          '" height="' +
          t.h +
          '" rx="1.2"/>'
        );
      })
      .join("");
    return (
      '<svg class="hero-svg" viewBox="' +
      VIEW.x +
      " " +
      VIEW.y +
      " " +
      VIEW.w +
      " " +
      VIEW.h +
      '" xmlns="http://www.w3.org/2000/svg" aria-label="Warp">' +
      '<g class="core-layer">' +
      cores +
      "</g>" +
      '<g class="particle-layer"></g>' +
      "</svg>"
    );
  }

  function spiralOrder(tiles) {
    const n = tiles.length || 1;
    const midX = tiles.reduce((s, t) => s + t.x + t.w / 2, 0) / n;
    const midY = tiles.reduce((s, t) => s + t.y + t.h / 2, 0) / n;
    return tiles
      .map((t, i) => {
        const dx = t.x + t.w / 2 - midX;
        const dy = t.y + t.h / 2 - midY;
        return { i, r: Math.hypot(dx, dy), a: Math.atan2(dy, dx) };
      })
      .sort((a, b) => Math.floor(a.r / 20) - Math.floor(b.r / 20) || a.a - b.a)
      .map((o) => o.i);
  }

  /**
   * @param {HTMLElement} heroEl
   * @param {Array<{x:number,y:number,w:number,h:number}>} tiles
   */
  function mount(heroEl, tiles) {
    if (!heroEl) {
      return;
    }
    stopStream();
    heroEl.innerHTML = buildSvg(tiles);
  }

  /**
   * @param {HTMLElement} heroEl
   * @param {Array<{x:number,y:number,w:number,h:number}>} tiles
   * @param {() => void} [onDone]
   */
  function playSpiral(heroEl, tiles, onDone) {
    if (!heroEl) {
      if (onDone) {
        onDone();
      }
      return;
    }
    const rects = heroEl.querySelectorAll(".w-tile.core");
    if (!rects.length) {
      if (onDone) {
        onDone();
      }
      return;
    }
    rects.forEach((el) => {
      el.style.transition = "none";
      el.style.opacity = "0";
    });
    void heroEl.offsetHeight;
    const order = spiralOrder(tiles);
    const step = 4;
    const fade = 90;
    let lastDelay = 0;
    order.forEach((tileIndex, rank) => {
      const el = rects[tileIndex];
      if (!el) {
        return;
      }
      const delay = rank * step + 10;
      lastDelay = delay;
      setTimeout(() => {
        el.style.transition = "opacity " + fade + "ms ease";
        el.style.opacity = "1";
      }, delay);
    });
    setTimeout(() => {
      if (onDone) {
        onDone();
      }
    }, lastDelay + fade + 40);
  }

  function trailTemplates(tiles) {
    return (tiles || []).filter((t) => t.x >= TRAIL_CUT);
  }

  function makeParticle(template, i, seed) {
    const h = hash01(i + template.x * 0.1 + template.y * 0.3);
    const h2 = hash01(i + 17);
    const speed =
      STREAM.speed * (1 + (h - 0.5) * 2 * STREAM.speedJitter);
    const spawnX = template.x + 6 + h2 * 8;
    const yJ = (h2 - 0.5) * 2 * STREAM.yJitter;
    const lifeSpan = (EXIT_X - spawnX) / Math.max(4, speed);
    const x = seed
      ? spawnX + h * Math.max(16, EXIT_X - spawnX)
      : spawnX;
    return {
      x,
      y: template.y + yJ,
      w: template.w,
      h: template.h,
      speed,
      age: seed ? h * lifeSpan : 0,
      phase: h,
      template: template,
      el: null,
      /** hover repel offset applied in paint */
      hx: 0,
      hy: 0,
    };
  }

  function ensureParticleEls(eng) {
    const layer = eng.svg.querySelector(".particle-layer");
    if (!layer) {
      return;
    }
    const ns = "http://www.w3.org/2000/svg";
    while (layer.children.length < eng.particles.length) {
      const r = document.createElementNS(ns, "rect");
      r.setAttribute("class", "w-tile particle");
      r.setAttribute("rx", "1.2");
      layer.appendChild(r);
    }
    while (layer.children.length > eng.particles.length) {
      layer.lastChild.remove();
    }
    eng.particles.forEach((p, i) => {
      p.el = layer.children[i];
    });
  }

  function paintParticle(p) {
    if (!p.el) {
      return;
    }
    const span = EXIT_X - TRAIL_CUT || 1;
    const progress = Math.min(1, Math.max(0, (p.x - TRAIL_CUT) / span));
    let op = 1;
    if (progress < STREAM.fadeIn) {
      op *= progress / Math.max(0.001, STREAM.fadeIn);
    }
    if (progress > 1 - STREAM.fadeOut) {
      op *= (1 - progress) / Math.max(0.001, STREAM.fadeOut);
    }
    p.el.setAttribute("x", p.x.toFixed(2));
    p.el.setAttribute("y", p.y.toFixed(2));
    p.el.setAttribute("width", p.w.toFixed(2));
    p.el.setAttribute("height", p.h.toFixed(2));
    p.el.setAttribute("opacity", Math.max(0, Math.min(1, op)).toFixed(3));
    if (p.hx || p.hy) {
      p.el.style.transform =
        "translate(" + p.hx.toFixed(2) + "px," + p.hy.toFixed(2) + "px)";
    } else {
      p.el.style.transform = "";
    }
  }

  function respawn(p, eng, salt) {
    const templates = eng.templates;
    const t =
      templates[
        Math.floor(hash01(salt + p.phase * 99) * templates.length) %
          templates.length
      ];
    const fresh = makeParticle(
      t,
      Math.floor(salt) + Math.floor(p.phase * 1000),
      false
    );
    fresh.el = p.el;
    return fresh;
  }

  function svgPoint(svg, clientX, clientY) {
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) {
      return null;
    }
    return pt.matrixTransform(ctm.inverse());
  }

  function applyTrailRepel(eng) {
    if (!eng || !eng.svg) {
      return;
    }
    const ptr = eng.pointer;
    const trailCores = eng.svg.querySelectorAll(".w-tile.core.trail");

    if (!ptr || !ptr.active) {
      trailCores.forEach((el) => {
        el.style.transform = "";
        el.style.fill = "";
      });
      eng.particles.forEach((p) => {
        p.hx = 0;
        p.hy = 0;
      });
      return;
    }

    const px = ptr.x;
    const py = ptr.y;

    trailCores.forEach((el) => {
      const cx = Number(el.getAttribute("data-cx"));
      const cy = Number(el.getAttribute("data-cy"));
      const dx = cx - px;
      const dy = cy - py;
      const dist = Math.hypot(dx, dy);
      if (dist < REPEL_R && dist > 0.15) {
        const fall = 1 - dist / REPEL_R;
        const f = fall * fall * 18;
        const ox = (dx / dist) * f + fall * 6;
        const oy = (dy / dist) * f;
        const scale = 1 + fall * 0.12;
        el.style.transform =
          "translate(" +
          ox.toFixed(2) +
          "px," +
          oy.toFixed(2) +
          "px) scale(" +
          scale.toFixed(3) +
          ")";
        const g = Math.round(0x6e + fall * 0.45 * 60);
        el.style.fill = "rgb(" + g + "," + g + "," + g + ")";
      } else {
        el.style.transform = "";
        el.style.fill = "";
      }
    });

    eng.particles.forEach((p) => {
      const cx = p.x + p.w / 2;
      const cy = p.y + p.h / 2;
      const dx = cx - px;
      const dy = cy - py;
      const dist = Math.hypot(dx, dy);
      if (dist < REPEL_R && dist > 0.15) {
        const fall = 1 - dist / REPEL_R;
        const f = fall * fall * 20;
        p.hx = (dx / dist) * f + fall * 8;
        p.hy = (dy / dist) * f;
      } else {
        p.hx = 0;
        p.hy = 0;
      }
    });
  }

  function bindHover(eng) {
    unbindHover(eng);
    const svg = eng.svg;
    if (!svg || prefersReducedMotion()) {
      return;
    }

    eng.pointer = { x: 0, y: 0, active: false };

    const onMove = (e) => {
      const pt = svgPoint(svg, e.clientX, e.clientY);
      if (!pt) {
        return;
      }
      eng.pointer = { x: pt.x, y: pt.y, active: true };
      applyTrailRepel(eng);
    };
    const onEnter = (e) => onMove(e);
    const onLeave = () => {
      eng.pointer = { x: 0, y: 0, active: false };
      applyTrailRepel(eng);
    };

    svg.addEventListener("pointermove", onMove);
    svg.addEventListener("pointerenter", onEnter);
    svg.addEventListener("pointerleave", onLeave);
    eng.hover = { onMove: onMove, onEnter: onEnter, onLeave: onLeave };
  }

  function unbindHover(eng) {
    if (!eng || !eng.hover || !eng.svg) {
      return;
    }
    eng.svg.removeEventListener("pointermove", eng.hover.onMove);
    eng.svg.removeEventListener("pointerenter", eng.hover.onEnter);
    eng.svg.removeEventListener("pointerleave", eng.hover.onLeave);
    eng.hover = null;
    eng.pointer = null;
    if (eng.svg) {
      eng.svg.querySelectorAll(".w-tile.core.trail").forEach((el) => {
        el.style.transform = "";
        el.style.fill = "";
      });
    }
  }

  function tick(now) {
    if (!engine || !engine.running) {
      return;
    }
    if (!engine.last) {
      engine.last = now;
    }
    let dt = (now - engine.last) / 1000;
    if (dt > 0.05) {
      dt = 0.05;
    }
    engine.last = now;

    for (let i = 0; i < engine.particles.length; i++) {
      let p = engine.particles[i];
      p.age += dt;
      p.x += p.speed * dt;
      if (p.x > EXIT_X) {
        p = respawn(p, engine, now + i);
        engine.particles[i] = p;
      }
    }

    // Repel after positions update so stream copies push away correctly
    if (engine.pointer && engine.pointer.active) {
      applyTrailRepel(engine);
    } else {
      engine.particles.forEach((p) => {
        p.hx = 0;
        p.hy = 0;
      });
    }

    for (let i = 0; i < engine.particles.length; i++) {
      paintParticle(engine.particles[i]);
    }

    engine.raf = requestAnimationFrame(tick);
  }

  /**
   * @param {HTMLElement} heroEl
   * @param {Array<{x:number,y:number,w:number,h:number}>} tiles
   */
  function startStream(heroEl, tiles) {
    stopStream();
    if (!heroEl || prefersReducedMotion()) {
      return;
    }
    const svg = heroEl.querySelector("svg.hero-svg");
    if (!svg) {
      return;
    }
    const templates = trailTemplates(tiles);
    if (!templates.length) {
      return;
    }
    const n = Math.max(8, Math.round(templates.length * STREAM.density));
    const particles = [];
    for (let i = 0; i < n; i++) {
      particles.push(makeParticle(templates[i % templates.length], i, true));
    }
    engine = {
      heroEl: heroEl,
      svg: svg,
      particles: particles,
      templates: templates,
      last: 0,
      raf: 0,
      running: true,
      hover: null,
      pointer: null,
    };
    ensureParticleEls(engine);
    particles.forEach(paintParticle);
    bindHover(engine);
    engine.raf = requestAnimationFrame(tick);
  }

  function stopStream() {
    if (!engine) {
      return;
    }
    engine.running = false;
    if (engine.raf) {
      cancelAnimationFrame(engine.raf);
    }
    unbindHover(engine);
    const layer = engine.svg && engine.svg.querySelector(".particle-layer");
    if (layer) {
      layer.innerHTML = "";
    }
    engine = null;
  }

  /**
   * @param {HTMLElement} heroEl
   * @param {boolean} empty
   * @param {Array} tiles
   * @param {{played?:boolean, forceReplay?:boolean}} [state]
   */
  function setEmpty(heroEl, empty, tiles, state) {
    if (!heroEl) {
      return;
    }
    heroEl.classList.toggle("hidden", !empty);
    if (!empty) {
      stopStream();
      // Next time we return to empty (new chat), replay spiral intro
      if (state) {
        state.forceReplay = true;
      }
      return;
    }
    const force = !!(state && state.forceReplay);
    const first = !state || !state.played;
    if (force || first) {
      if (state) {
        state.played = true;
        state.forceReplay = false;
      }
      stopStream();
      // Reset cores so spiral fade-in is visible every time
      const cores = heroEl.querySelectorAll(".w-tile.core");
      cores.forEach((el) => {
        el.style.transition = "none";
        el.style.opacity = "0";
      });
      void heroEl.offsetHeight;
      playSpiral(heroEl, tiles, () => {
        if (!heroEl.classList.contains("hidden")) {
          startStream(heroEl, tiles);
        }
      });
    } else {
      const cores = heroEl.querySelectorAll(".w-tile.core");
      cores.forEach((el) => {
        el.style.opacity = "1";
        el.style.transition = "none";
      });
      if (!engine || !engine.running) {
        startStream(heroEl, tiles);
      }
    }
  }

  /**
   * Force the spiral intro + stream (e.g. New chat while already empty).
   * @param {HTMLElement} heroEl
   * @param {Array} tiles
   * @param {{played?:boolean, forceReplay?:boolean}} [state]
   */
  function replayIntro(heroEl, tiles, state) {
    if (!heroEl) return;
    if (state) {
      state.forceReplay = true;
      state.played = true;
    }
    heroEl.classList.remove("hidden");
    setEmpty(heroEl, true, tiles, state || { played: true, forceReplay: true });
  }

  W.hero = {
    mount: mount,
    playSpiral: playSpiral,
    setEmpty: setEmpty,
    replayIntro: replayIntro,
    spiralOrder: spiralOrder,
    buildSvg: buildSvg,
    startStream: startStream,
    stopStream: stopStream,
  };
})(typeof window !== "undefined" ? window : globalThis);
