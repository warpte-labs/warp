/**
 * Warp.cards — DOM factories for user / think / agent surfaces.
 */
(function (global) {
  "use strict";

  const W = (global.Warp = global.Warp || {});
  const md = () => W.markdown;
  const spin = () => W.spinner;

  function openImageViewer(url, name) {
    if (W.attach && typeof W.attach.openViewer === "function") {
      W.attach.openViewer(url, name);
      return;
    }
    // Fallback: drive #img-viewer directly
    const v = document.getElementById("img-viewer");
    if (!v || !url) return;
    const img = v.querySelector("[data-viewer-img]");
    const nm = v.querySelector("[data-viewer-name]");
    if (img) {
      img.src = url;
      img.alt = name || "";
    }
    if (nm) nm.textContent = name || "image";
    v.classList.add("open");
    v.hidden = false;
  }

  function createUserCard(text, attachments) {
    const el = document.createElement("div");
    el.className = "card user";
    el.innerHTML =
      '<div class="who">you</div><div class="md" data-role="body"></div>';
    const body = el.querySelector("[data-role=body]");
    const list = Array.isArray(attachments) ? attachments : [];
    const images = list.filter((a) => a && a.isImage && a.previewUrl);
    const docs = list.filter((a) => a && !a.isImage);
    const label =
      text && String(text).trim()
        ? text
        : list.length
          ? ""
          : "";
    if (label) {
      md().renderInto(body, label);
    } else {
      body.innerHTML = "";
    }
    if (images.length) {
      const film = document.createElement("div");
      film.className = "msg-film";
      for (const a of images) {
        const tile = document.createElement("button");
        tile.type = "button";
        tile.className = "msg-film-tile";
        tile.title = (a.name || "image") + " — click to enlarge";
        const img = document.createElement("img");
        img.alt = a.name || "image";
        img.src = a.previewUrl;
        tile.appendChild(img);
        tile.addEventListener("click", () => {
          openImageViewer(a.previewUrl, a.name || "image");
        });
        film.appendChild(tile);
      }
      el.appendChild(film);
    }
    if (docs.length) {
      const chips = document.createElement("div");
      chips.className = "att-chips";
      for (const a of docs) {
        const chip = document.createElement("span");
        chip.className = "att-chip";
        chip.textContent = "📎 " + (a.name || "file");
        chips.appendChild(chip);
      }
      el.appendChild(chips);
    }
    return el;
  }

  function createThinkCard() {
    const el = document.createElement("div");
    el.className = "card think is-streaming";
    el.dataset.state = "running";
    el.innerHTML =
      '<div class="think-hd">' +
      spin().html("running") +
      '<span class="label" data-role="label">Thinking…</span>' +
      '<span class="detail" data-role="timer">0.0s</span>' +
      '<button type="button" class="chev" data-role="chev" aria-label="toggle thought" hidden>' +
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none">' +
      '<path stroke="currentColor" stroke-width="2" d="M6 9l6 6 6-6"/>' +
      "</svg></button></div>" +
      '<div class="think-body md muted" data-role="body"></div>';

    // Body starts empty but visible during streaming (waiting state)
    el.classList.add("has-body");
    return el;
  }

  function updateThinkBody(card, fullText) {
    if (!card || card.classList.contains("is-done")) {
      return;
    }
    card.classList.add("has-body", "is-streaming");
    card.classList.remove("is-collapsed");
    const body = card.querySelector("[data-role=body]");
    if (!body) {
      return;
    }
    // Prefer markdown; also set text as fallback if render fails
    try {
      md().renderInto(body, fullText);
      if (!body.textContent || !String(body.textContent).trim()) {
        body.textContent = fullText;
      }
    } catch {
      body.textContent = fullText;
    }
  }

  function setThinkTimer(card, seconds) {
    const el = card && card.querySelector("[data-role=timer]");
    if (el && !card.classList.contains("is-done")) {
      el.textContent = Number(seconds).toFixed(1) + "s";
    }
  }

  /**
   * Drop reasoning body; leave "Thought" + time only.
   */
  function finalizeThink(card, elapsedSec) {
    if (!card) {
      return;
    }
    card.dataset.state = "complete";
    card.classList.add("is-done");
    card.classList.remove("has-body", "is-collapsed", "is-streaming");
    const wrap = card.querySelector(".agent-think-wrap");
    spin().setState(wrap, "complete");
    const label = card.querySelector("[data-role=label]");
    if (label) {
      label.textContent = "Thought";
    }
    const timer = card.querySelector("[data-role=timer]");
    if (timer) {
      timer.textContent = Number(elapsedSec).toFixed(1) + "s";
    }
    const body = card.querySelector("[data-role=body]");
    if (body) {
      body.innerHTML = "";
      body.style.display = "none";
    }
  }

  function createAgentCard() {
    const el = document.createElement("div");
    el.className = "reply";
    el.innerHTML =
      '<div class="who">grok</div><div class="md" data-role="body"></div>';
    return el;
  }

  function updateAgentBody(card, fullText) {
    md().renderInto(card.querySelector("[data-role=body]"), fullText);
  }

  function createErrorCard(text) {
    const el = document.createElement("div");
    el.className = "card error";
    el.innerHTML =
      '<div class="who">error</div><div class="md" data-role="body"></div>';
    md().renderInto(el.querySelector("[data-role=body]"), text || "Error");
    return el;
  }

  W.cards = {
    createUserCard,
    createThinkCard,
    updateThinkBody,
    setThinkTimer,
    finalizeThink,
    createAgentCard,
    updateAgentBody,
    createErrorCard,
  };
})(typeof window !== "undefined" ? window : globalThis);
