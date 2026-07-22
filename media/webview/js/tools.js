/**
 * Warp.tools — tool / command / read rows with orange pulse circle.
 */
(function (global) {
  "use strict";

  const W = (global.Warp = global.Warp || {});

  function pulseHtml(state) {
    const s = state || "running";
    return (
      '<div class="tool-pulse" data-state="' +
      s +
      '" aria-hidden="true">' +
      '<span class="tool-pulse-ring"></span>' +
      '<span class="tool-pulse-core"></span>' +
      "</div>"
    );
  }

  /**
   * @param {{ id?: string, title?: string, status?: string, kind?: string, target?: string, label?: string }} p
   */
  function createToolRow(p) {
    const el = document.createElement("div");
    const st = normalizeStatus(p.status);
    el.className = "tool-row" + (st === "running" ? " is-running" : "");
    el.dataset.id = p.id || "";
    el.dataset.status = st;
    el._tool = {
      kind: p.kind || "",
      title: p.title || p.label || "",
      target: p.target || "",
      label: p.label || p.title || "",
    };

    const verb = verbFor(el._tool, st);
    const target = displayTarget(el._tool);

    el.innerHTML =
      '<div class="tool-hd">' +
      pulseHtml(st === "running" ? "running" : st === "error" ? "error" : "done") +
      '<span class="tool-verb"></span>' +
      (target ? '<span class="tool-target"></span>' : "") +
      "</div>";

    el.querySelector(".tool-verb").textContent = verb;
    const tEl = el.querySelector(".tool-target");
    if (tEl) {
      tEl.textContent = target;
      tEl.title = el._tool.target || target;
    }
    return el;
  }

  /**
   * @param {HTMLElement} el
   * @param {{ title?: string, status?: string, kind?: string, target?: string, label?: string }} p
   */
  function updateToolRow(el, p) {
    if (!el) {
      return;
    }
    const prev = el._tool || {};
    // Merge — never let empty/call-id wipe a good target/title
    const next = {
      kind: cleanStr(p.kind) || prev.kind || "",
      title: preferTitle(p.title || p.label, prev.title || prev.label),
      label: preferTitle(p.label || p.title, prev.label || prev.title),
      target: preferTarget(p.target, prev.target, p.title),
    };
    el._tool = next;

    const st = normalizeStatus(p.status);
    el.dataset.status = st;
    el.classList.toggle("is-running", st === "running");
    const pulse = el.querySelector(".tool-pulse");
    if (pulse) {
      pulse.dataset.state =
        st === "running" ? "running" : st === "error" ? "error" : "done";
    }
    const verbEl = el.querySelector(".tool-verb");
    if (verbEl) {
      verbEl.textContent = verbFor(next, st);
    }
    const target = displayTarget(next);
    let tEl = el.querySelector(".tool-target");
    if (target) {
      if (!tEl) {
        tEl = document.createElement("span");
        tEl.className = "tool-target";
        el.querySelector(".tool-hd")?.appendChild(tEl);
      }
      tEl.textContent = target;
      tEl.title = next.target || target;
    }
  }

  function cleanStr(s) {
    const v = String(s || "").trim();
    if (!v || looksLikeCallId(v)) {
      return "";
    }
    return v;
  }

  function preferTitle(incoming, prev) {
    const a = cleanStr(incoming);
    const b = cleanStr(prev);
    if (a && !looksLikeToolSnake(a)) {
      return a;
    }
    if (b && !looksLikeToolSnake(b)) {
      return b;
    }
    return a || b || "";
  }

  function preferTarget(incoming, prev, title) {
    const a = cleanStr(incoming);
    if (a) {
      return a;
    }
    const fromTitle = extractBacktick(title);
    if (fromTitle) {
      return fromTitle;
    }
    return cleanStr(prev) || "";
  }

  function extractBacktick(title) {
    const m = String(title || "").match(/`([^`]+)`/);
    return m ? m[1].trim() : "";
  }

  function looksLikeCallId(s) {
    return /^call-[0-9a-f-]+/i.test(s);
  }

  function looksLikeToolSnake(s) {
    return /^[a-z][a-z0-9]*(_[a-z0-9]+)+$/i.test(s);
  }

  function normalizeStatus(s) {
    const v = String(s || "").toLowerCase();
    if (
      !v ||
      v === "pending" ||
      v === "in_progress" ||
      v === "running" ||
      v === "null"
    ) {
      return "running";
    }
    if (
      v === "failed" ||
      v === "error" ||
      v === "cancelled" ||
      v === "canceled"
    ) {
      return "error";
    }
    if (
      v === "completed" ||
      v === "complete" ||
      v === "success" ||
      v === "done"
    ) {
      return "done";
    }
    return "running";
  }

  /**
   * @param {{ kind?: string, title?: string, label?: string, target?: string }} tool
   * @param {string} status
   */
  function verbFor(tool, status) {
    const running = status === "running";
    const hay = (
      (tool.kind || "") +
      " " +
      (tool.title || "") +
      " " +
      (tool.label || "") +
      " " +
      (tool.target || "")
    ).toLowerCase();

    if (/read|readfile|cat\b|open_page/.test(hay)) {
      return running ? "Reading" : "Read";
    }
    if (/list|listdir|list_dir|ls\b|dir\b|glob/.test(hay)) {
      return running ? "Listing" : "Listed";
    }
    if (/search|grep|find|rg\b/.test(hay)) {
      return running ? "Searching" : "Searched";
    }
    if (/edit|write|patch|apply|search_replace/.test(hay)) {
      return running ? "Editing" : "Edited";
    }
    if (/run|exec|shell|bash|cmd|terminal|command|execute/.test(hay)) {
      return running ? "Running" : "Ran";
    }
    if (/fetch|http|web|curl/.test(hay)) {
      return running ? "Fetching" : "Fetched";
    }
    // Path-only targets (common when kind is empty) — never "Called"
    const tgt = String(tool.target || "").trim();
    if (tgt && (/[/\\]/.test(tgt) || /^[a-z]:\\/i.test(tgt))) {
      if (/\.(md|json|ts|js|tsx|jsx|css|html|toml|yml|yaml|txt)$/i.test(tgt)) {
        return running ? "Reading" : "Read";
      }
      return running ? "Listing" : "Listed";
    }
    // Background task / subagent poll — never show bare "tool"
    if (
      /get_command_or_subagent|get_task_output|task output|wait_command|wait_task|background\s*task|checking agent/.test(
        hay
      )
    ) {
      return running ? "Checking" : "Checked";
    }
    if (/mcp|use_tool/.test(hay) && !/tool_call|tool-row/.test(hay)) {
      return running ? "Calling" : "Called";
    }
    const lab = (tool.label || tool.title || "").trim();
    // ACP SSE often sends title/kind as literally "tool"
    if (
      !lab ||
      lab.toLowerCase() === "tool" ||
      looksLikeCallId(lab) ||
      looksLikeToolSnake(lab)
    ) {
      return running ? "Working" : "Done";
    }
    if (running) {
      return lab.endsWith("ing") ? lab : lab + (lab.length < 12 ? "…" : "");
    }
    return lab;
  }

  function displayTarget(tool) {
    let t = cleanStr(tool.target);
    if (!t) {
      t = extractBacktick(tool.title) || extractBacktick(tool.label);
    }
    if (!t) {
      return "";
    }
    // Shorten absolute paths for display
    const norm = t.replace(/\\/g, "/");
    if (norm.length > 56 && norm.includes("/")) {
      const parts = norm.split("/").filter(Boolean);
      if (parts.length >= 2) {
        return parts.slice(-2).join("/");
      }
    }
    if (t.length > 64) {
      return t.slice(0, 61) + "…";
    }
    return t;
  }

  W.tools = { createToolRow, updateToolRow, pulseHtml, normalizeStatus };
})(typeof window !== "undefined" ? window : globalThis);
