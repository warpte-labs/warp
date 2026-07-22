/**
 * Warp.subagents — accordion stack multi-agent UI (live).
 *
 * Header only: "Agent N"  …  "4.2s" | "4.2s · Done"
 * Closed by default. Open for main-agent think (spin + markdown) + plain steps.
 * No left accents, no fill dots inside body.
 */
(function (global) {
  "use strict";

  const W = (global.Warp = global.Warp || {});

  function isMultiAgentTool(p) {
    if (p && p.isSpawn) return true;
    const hay = (
      String(p?.kind || "") +
      " " +
      String(p?.title || "") +
      " " +
      String(p?.label || "")
    ).toLowerCase();
    return (
      hay.includes("spawn_subagent") ||
      hay.includes("spawn_agent") ||
      hay.includes("get_command_or_subagent") ||
      hay.includes("wait_commands_or_subagent") ||
      hay.includes("kill_command_or_subagent") ||
      hay.includes("kill_task") ||
      hay.includes("get_task_output") ||
      hay.includes("task output") ||
      hay.includes("background task") ||
      hay.includes("checking agent") ||
      /\btask_tool\b/.test(hay) ||
      hay.includes("[subagent:") ||
      (/\bmonitor\b/.test(hay) && !hay.includes("permission")) ||
      hay.includes("scheduler_create") ||
      hay.includes("scheduler_delete")
    );
  }

  function isControlTool(p) {
    const hay = (
      String(p?.kind || "") +
      " " +
      String(p?.title || "") +
      " " +
      String(p?.label || "")
    ).toLowerCase();
    return (
      hay.includes("get_command_or_subagent") ||
      hay.includes("wait_commands_or_subagent") ||
      hay.includes("kill_command_or_subagent") ||
      hay.includes("kill_task") ||
      hay.includes("get_task_output") ||
      hay.includes("task output") ||
      hay.includes("background task") ||
      hay.includes("checking agent")
    );
  }

  function isSpawnLike(p) {
    if (p && p.isSpawn) return true;
    const hay = (
      String(p?.kind || "") +
      " " +
      String(p?.title || "") +
      " " +
      String(p?.label || "")
    ).toLowerCase();
    return (
      hay.includes("spawn_subagent") ||
      hay.includes("spawn_agent") ||
      /\btask_tool\b/.test(hay) ||
      (hay.includes("[subagent:") && !isControlTool(p))
    );
  }

  /**
   * @param {object} task
   * @param {{ agentIndex?: number }} [opts]
   */
  function createBlock(task, opts) {
    const t = task || {};
    const id = String(t.id || t.toolCallId || "agent");
    const index =
      typeof opts?.agentIndex === "number" && opts.agentIndex > 0
        ? opts.agentIndex
        : 1;
    const st = normalizeStatus(t.status);

    const el = document.createElement("div");
    el.className = "agent-acc is-collapsed";
    el.dataset.id = id;
    el.dataset.status = st;
    el.dataset.kind = String(t.kind || "subagent");
    el._task = { ...t, id };
    el._steps = {};
    el._t0 = Date.now();
    el._timerIv = null;
    el._agentIndex = index;
    el._userOpened = false;
    el._endSec = null;

    const spin = W.spinner ? W.spinner.html("running") : "";

    el.innerHTML =
      '<button type="button" class="agent-acc-h" data-role="toggle" aria-expanded="false">' +
      '<span class="agent-acc-title" data-role="title">Agent ' +
      index +
      "</span>" +
      '<span class="agent-acc-meta" data-role="meta">0.0s</span>' +
      '<span class="agent-acc-chev" data-role="chev" aria-hidden="true">▸</span>' +
      "</button>" +
      '<div class="agent-acc-b" data-role="body" hidden>' +
      '<div class="agent-think is-streaming" data-role="think">' +
      '<div class="think-hd">' +
      spin +
      '<span class="label" data-role="think-label">Thinking…</span>' +
      '<span class="detail" data-role="think-timer">0.0s</span>' +
      "</div>" +
      '<div class="think-body md muted agent-think-body" data-role="think-body"></div>' +
      "</div>" +
      '<div class="agent-acc-steps" data-role="steps"></div>' +
      "</div>";

    const thinkBody = el.querySelector('[data-role="think-body"]');
    const seed = seedThink(t);
    if (seed && thinkBody) {
      renderMd(thinkBody, seed);
      thinkBody.dataset.seeded = "1";
    }

    el.querySelector('[data-role="toggle"]').addEventListener("click", (e) => {
      e.preventDefault();
      const collapsed = !el.classList.contains("is-collapsed");
      setCollapsed(el, collapsed);
      el._userOpened = !collapsed;
    });

    startTimer(el);
    syncHeader(el);
    return el;
  }

  function setCollapsed(el, collapsed) {
    el.classList.toggle("is-collapsed", collapsed);
    const body = el.querySelector('[data-role="body"]');
    const chev = el.querySelector('[data-role="chev"]');
    const btn = el.querySelector('[data-role="toggle"]');
    if (body) body.hidden = collapsed;
    if (chev) chev.textContent = collapsed ? "▸" : "▾";
    if (btn) btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
  }

  function updateBlock(el, task) {
    if (!el || !task) return;
    const prev = el._task || {};
    const next = { ...prev, ...task };
    el._task = next;
    el.dataset.id = String(next.id || el.dataset.id || "");
    el.dataset.status = normalizeStatus(next.status);
    el.dataset.kind = String(next.kind || "subagent");

    const title = el.querySelector('[data-role="title"]');
    if (title) title.textContent = "Agent " + (el._agentIndex || 1);

    const thinkBody = el.querySelector('[data-role="think-body"]');
    if (thinkBody && !thinkBody.dataset.seeded) {
      const seed = seedThink(next);
      if (seed) {
        renderMd(thinkBody, seed);
        thinkBody.dataset.seeded = "1";
      }
    }

    const terminal =
      el.dataset.status === "done" || el.dataset.status === "error";
    if (terminal) {
      stopTimer(el);
      settleThink(el);
      if (!el._userOpened) setCollapsed(el, true);
    } else {
      startTimer(el);
    }
    syncHeader(el);
  }

  function settleThink(el) {
    const think = el.querySelector('[data-role="think"]');
    if (!think) return;
    think.classList.add("is-done");
    think.classList.remove("is-streaming");
    const wrap = think.querySelector(".agent-think-wrap");
    if (W.spinner) W.spinner.setState(wrap, "complete");
    else if (wrap) wrap.dataset.state = "complete";
    const label = el.querySelector('[data-role="think-label"]');
    if (label) label.textContent = "Thought";
  }

  /** Plain step rows — no dots. Does not open accordion. */
  function upsertStep(block, p) {
    if (!block) return;
    const steps = block.querySelector('[data-role="steps"]');
    if (!steps) return;
    if (isLifecycleNoise(p)) return;

    const id = String(p.id || "step-" + Date.now());
    if (!block._steps) block._steps = {};

    const st = W.tools
      ? W.tools.normalizeStatus(p.status)
      : normalizeStatus(p.status);
    const tool = {
      kind: p.kind || "",
      title: p.title || p.label || "",
      target: p.target || "",
      label: p.label || p.title || "",
    };
    const verb = verbViaTools(tool, st);
    const target = displayTarget(tool);

    let row = block._steps[id];
    if (!row) {
      row = document.createElement("div");
      row.className = "agent-step";
      row.dataset.id = id;
      row.innerHTML =
        '<span class="agent-step-verb"></span> ' +
        '<span class="agent-step-target"></span>';
      block._steps[id] = row;
      steps.appendChild(row);
    }
    row.dataset.status = st;
    row.classList.toggle("is-running", st === "running");
    const vEl = row.querySelector(".agent-step-verb");
    const tEl = row.querySelector(".agent-step-target");
    if (vEl) vEl.textContent = verb;
    if (tEl) {
      tEl.textContent = target;
      tEl.title = tool.target || target;
    }
  }

  function isLifecycleNoise(p) {
    const t = String(p.title || p.label || "").toLowerCase();
    return (
      t === "agent running" ||
      t === "agent finished" ||
      t === "agent pending" ||
      t === "agent failed" ||
      t === "working" ||
      t === "delegating" ||
      t === "delegated"
    );
  }

  function verbViaTools(tool, status) {
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
    if (
      /get_command_or_subagent|get_task_output|task output|background task|checking agent|wait_command|wait_task/.test(
        hay
      )
    ) {
      return running ? "Checking" : "Checked";
    }
    if (/read|readfile|cat\b/.test(hay)) return running ? "Reading" : "Read";
    if (/list|ls\b|dir\b|listdir|glob/.test(hay)) {
      return running ? "Listing" : "Listed";
    }
    if (/search|grep|find|rg\b/.test(hay)) {
      return running ? "Searching" : "Searched";
    }
    if (/edit|write|patch|search_replace/.test(hay)) {
      return running ? "Editing" : "Edited";
    }
    if (/run|shell|bash|terminal|command|execute/.test(hay)) {
      return running ? "Running" : "Ran";
    }
    if (/monitor|watch/.test(hay)) return running ? "Watching" : "Watched";
    if (tool.target && /[/\\]/.test(tool.target) && !tool.kind) {
      return running ? "Inspecting" : "Inspected";
    }
    const lab = (tool.label || tool.title || "").trim();
    if (
      !lab ||
      lab.toLowerCase() === "tool" ||
      /^call-/i.test(lab) ||
      looksSnake(lab)
    ) {
      return running ? "Working" : "Done";
    }
    if (lab.length < 28) {
      return running && !/ing\b/i.test(lab) ? lab.replace(/\.*$/, "") + "…" : lab;
    }
    return running ? "Working" : "Done";
  }

  function looksSnake(s) {
    return /^[a-z][a-z0-9]*(_[a-z0-9]+)+$/i.test(s);
  }

  function displayTarget(tool) {
    let t = String(tool.target || "").trim();
    if (!t) return "";
    const norm = t.replace(/\\/g, "/");
    if (norm.length > 48 && norm.includes("/")) {
      const parts = norm.split("/").filter(Boolean);
      if (parts.length >= 2) return parts.slice(-2).join("/");
    }
    if (t.length > 56) return t.slice(0, 53) + "…";
    return t;
  }

  function seedThink(t) {
    const d = String(t.description || "").trim();
    if (!d) return "";
    if (/^spawn|subagent|call-/i.test(d)) return "";
    if (looksSnake(d)) return "";
    return d;
  }

  function renderMd(el, text) {
    if (!el) return;
    try {
      if (W.markdown && typeof W.markdown.renderInto === "function") {
        W.markdown.renderInto(el, text);
        return;
      }
    } catch {
      /* fall through */
    }
    el.textContent = text;
  }

  function startTimer(el) {
    if (!el || el._timerIv) return;
    if (!el._t0) el._t0 = Date.now();
    const tick = () => {
      if (el._endSec) return;
      syncHeader(el);
      const sec = ((Date.now() - el._t0) / 1000).toFixed(1) + "s";
      const tt = el.querySelector('[data-role="think-timer"]');
      if (tt) tt.textContent = sec;
    };
    tick();
    el._timerIv = window.setInterval(tick, 100);
  }

  function stopTimer(el) {
    if (!el) return;
    if (el._timerIv) {
      clearInterval(el._timerIv);
      el._timerIv = null;
    }
    if (!el._endSec && el._t0) {
      el._endSec = ((Date.now() - el._t0) / 1000).toFixed(1) + "s";
    }
    syncHeader(el);
  }

  function syncHeader(el) {
    const meta = el.querySelector('[data-role="meta"]');
    if (!meta) return;
    const elapsed =
      el._endSec ||
      (el._t0 ? ((Date.now() - el._t0) / 1000).toFixed(1) + "s" : "0.0s");
    const st = el.dataset.status;
    if (st === "done") {
      meta.textContent = elapsed + " · Done";
    } else if (st === "error" || st === "cancelled" || st === "canceled") {
      meta.textContent = elapsed + " · Failed";
    } else {
      meta.textContent = elapsed;
    }
  }

  function settleThink(el) {
    const think = el.querySelector('[data-role="think"]');
    if (!think) return;
    think.classList.add("is-done");
    think.classList.remove("is-streaming");
    const wrap = think.querySelector(".agent-think-wrap");
    if (W.spinner) W.spinner.setState(wrap, "complete");
    else if (wrap) wrap.dataset.state = "complete";
    const label = el.querySelector('[data-role="think-label"]');
    if (label) label.textContent = "Thought";
  }

  function normalizeStatus(s) {
    const v = String(s || "").toLowerCase();
    if (
      !v ||
      v === "pending" ||
      v === "in_progress" ||
      v === "running" ||
      v === "queued"
    ) {
      return "running";
    }
    if (
      v === "failed" ||
      v === "error" ||
      v === "cancelled" ||
      v === "canceled"
    ) {
      return "error"; // includes user interrupt
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

  W.subagents = {
    isMultiAgentTool,
    isControlTool,
    isSpawnLike,
    createBlock,
    updateBlock,
    upsertStep,
    setCollapsed,
  };
})(typeof window !== "undefined" ? window : globalThis);
