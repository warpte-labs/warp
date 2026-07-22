/**
 * Warp.slash — fuzzy slash-command palette (ACP + Warp host commands).
 */
(function (global) {
  "use strict";

  const W = (global.Warp = global.Warp || {});

  /** Host/pager commands Warp handles itself (not only via agent prompt). */
  const HOST_COMMANDS = [
    {
      name: "new",
      description: "Start a new conversation",
      source: "warp",
      aliases: ["clear"],
    },
    {
      name: "compact",
      description: "Compress conversation history",
      inputHint: "optional context to preserve",
      source: "warp",
    },
    {
      name: "resume",
      description: "Open chat history",
      source: "warp",
    },
    {
      name: "history",
      description: "Recall recent prompts in this chat",
      source: "warp",
    },
    {
      name: "export",
      description: "Export conversation to a file",
      source: "warp",
    },
    {
      name: "copy",
      description: "Copy the last assistant reply",
      inputHint: "optional N for Nth-latest",
      source: "warp",
    },
    {
      name: "model",
      description: "Switch model (or open picker)",
      inputHint: "<name> [effort]",
      source: "warp",
      aliases: ["m"],
    },
    {
      name: "effort",
      description: "Set reasoning effort on current model",
      inputHint: "low | medium | high",
      source: "warp",
    },
    {
      name: "always-approve",
      description: "Toggle always-approve (YOLO) tool permissions",
      inputHint: "on | off",
      source: "warp",
    },
    {
      name: "auto",
      description: "Turn off always-approve (ask mode)",
      source: "warp",
    },
    {
      name: "context",
      description: "Show context window usage (agent)",
      source: "agent",
    },
    {
      name: "session-info",
      description: "Show session details (agent)",
      source: "agent",
    },
    {
      name: "rename",
      description: "Rename the current session",
      inputHint: "new title",
      source: "warp",
      aliases: ["title"],
    },
    {
      name: "plan",
      description: "Enter plan mode (agent)",
      inputHint: "optional description",
      source: "agent",
    },
    {
      name: "view-plan",
      description: "View the current plan (agent)",
      source: "agent",
      aliases: ["show-plan", "plan-view"],
    },
    {
      name: "login",
      description: "Sign in to Grok",
      source: "warp",
    },
    {
      name: "logout",
      description: "Sign out of Grok",
      source: "warp",
    },
    {
      name: "multiline",
      description: "Toggle Enter = newline (Shift+Enter send)",
      source: "warp",
      aliases: ["ml"],
    },
    {
      name: "feedback",
      description: "Send feedback about the session (agent)",
      inputHint: "message",
      source: "agent",
    },
    {
      name: "goal",
      description: "Set or manage an autonomous goal (agent)",
      inputHint: "<objective> | status | pause | resume | clear",
      source: "agent",
    },
    {
      name: "loop",
      description: "Run a prompt on a recurring interval (agent)",
      inputHint: "[interval] <prompt>",
      source: "agent",
    },
    {
      name: "plugins",
      description: "Manage plugins (agent)",
      inputHint: "list | reload | …",
      source: "agent",
    },
    {
      name: "reload-plugins",
      description: "Reload plugins from disk (agent)",
      source: "agent",
    },
    {
      name: "help",
      description: "Grok docs help skill (agent)",
      source: "agent",
    },
  ];

  /**
   * @param {{
   *   input: HTMLTextAreaElement,
   *   onPick?: (cmd: {name:string, description?:string}) => void,
   * }} opts
   */
  function mount(opts) {
    const pop = document.createElement("div");
    pop.className = "slash-pop hidden";
    pop.setAttribute("role", "listbox");
    const slot = document.querySelector(".composer-slot") || document.body;
    slot.style.position = slot.style.position || "relative";
    slot.appendChild(pop);

    /** @type {Array<{name:string, description:string, inputHint?:string, source?:string}>} */
    let agentCommands = [];
    /** @type {typeof agentCommands} */
    let filtered = [];
    let open = false;
    let active = 0;
    let query = "";

    function setOpen(v) {
      open = v;
      pop.classList.toggle("hidden", !v);
      if (!v) {
        query = "";
        filtered = [];
      }
    }

    function allCommands() {
      /** @type {Map<string, {name:string, description:string, inputHint?:string, source?:string}>} */
      const map = new Map();
      for (const c of HOST_COMMANDS) {
        map.set(c.name.toLowerCase(), {
          name: c.name,
          description: c.description || "",
          inputHint: c.inputHint,
          source: c.source || "warp",
        });
        for (const a of c.aliases || []) {
          if (!map.has(a.toLowerCase())) {
            map.set(a.toLowerCase(), {
              name: a,
              description: c.description + " (alias of /" + c.name + ")",
              inputHint: c.inputHint,
              source: c.source || "warp",
            });
          }
        }
      }
      for (const c of agentCommands) {
        const key = (c.name || "").toLowerCase();
        if (!key) continue;
        // Prefer host entry when names collide (e.g. compact)
        if (map.has(key) && map.get(key).source === "warp") continue;
        map.set(key, {
          name: c.name,
          description: c.description || "",
          inputHint: c.inputHint,
          source: c.source || "agent",
        });
      }
      return Array.from(map.values());
    }

    function fuzzyScore(name, desc, q) {
      if (!q) return 1;
      const n = name.toLowerCase();
      const d = (desc || "").toLowerCase();
      const qq = q.toLowerCase();
      if (n === qq) return 100;
      if (n.startsWith(qq)) return 80 - Math.min(20, n.length - qq.length);
      if (n.includes(qq)) return 50;
      // subsequence
      let i = 0;
      for (const ch of n) {
        if (ch === qq[i]) i++;
        if (i >= qq.length) return 30;
      }
      if (d.includes(qq)) return 15;
      return 0;
    }

    function filterList(q) {
      const all = allCommands();
      if (!q) {
        // Prefer warp + short agent builtins first
        return all
          .slice()
          .sort((a, b) => {
            const sa = a.source === "warp" ? 0 : a.name.includes(":") ? 2 : 1;
            const sb = b.source === "warp" ? 0 : b.name.includes(":") ? 2 : 1;
            if (sa !== sb) return sa - sb;
            return a.name.localeCompare(b.name);
          })
          .slice(0, 40);
      }
      return all
        .map((c) => ({
          c,
          s: fuzzyScore(c.name, c.description, q),
        }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s || a.c.name.localeCompare(b.c.name))
        .slice(0, 40)
        .map((x) => x.c);
    }

    function render() {
      if (!open) return;
      if (!filtered.length) {
        pop.innerHTML =
          '<div class="slash-empty">No matching commands</div>';
        return;
      }
      pop.innerHTML = filtered
        .map((c, i) => {
          const src = c.source || "agent";
          const hint = c.inputHint
            ? '<span class="slash-hint">' + escapeHtml(c.inputHint) + "</span>"
            : "";
          return (
            '<button type="button" class="slash-item' +
            (i === active ? " on" : "") +
            '" data-i="' +
            i +
            '" role="option">' +
            '<span class="slash-name">/' +
            escapeHtml(c.name) +
            "</span>" +
            '<span class="slash-desc">' +
            escapeHtml(c.description || "") +
            "</span>" +
            hint +
            '<span class="slash-src">' +
            escapeHtml(src) +
            "</span>" +
            "</button>"
          );
        })
        .join("");
      pop.querySelectorAll(".slash-item").forEach((btn) => {
        btn.addEventListener("mousedown", (e) => {
          e.preventDefault();
          pick(Number(btn.getAttribute("data-i")));
        });
      });
      const on = pop.querySelector(".slash-item.on");
      if (on && typeof on.scrollIntoView === "function") {
        on.scrollIntoView({ block: "nearest" });
      }
    }

    function pick(i) {
      const c = filtered[i];
      if (!c) return;
      const ta = opts.input;
      const val = ta.value;
      const caret = ta.selectionStart ?? val.length;
      // Replace from leading / on this line
      const beforeCaret = val.slice(0, caret);
      const m = beforeCaret.match(/(^|\n)\/[^\n]*$/);
      let start = 0;
      if (m) {
        start = beforeCaret.length - m[0].length + (m[1] ? m[1].length : 0);
      } else {
        const slash = beforeCaret.lastIndexOf("/");
        start = slash >= 0 ? slash : 0;
      }
      const after = val.slice(caret);
      // Leave space for args if command accepts input
      const insert = "/" + c.name + (c.inputHint ? " " : "");
      ta.value = val.slice(0, start) + insert + after;
      const pos = start + insert.length;
      ta.setSelectionRange(pos, pos);
      ta.focus();
      setOpen(false);
      if (opts.onPick) opts.onPick(c);
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    }

    function refreshFromQuery() {
      filtered = filterList(query);
      active = 0;
      render();
    }

    function onInput() {
      const ta = opts.input;
      const caret = ta.selectionStart ?? 0;
      const val = ta.value;
      const before = val.slice(0, caret);
      // Slash menu only when current line starts with /
      const lineStart = before.lastIndexOf("\n") + 1;
      const line = before.slice(lineStart);
      const m = line.match(/^\/([^\s]*)$/);
      if (!m) {
        // Still open if "/cmd " mid-args? close — only complete the name
        if (open) setOpen(false);
        return;
      }
      query = m[1] || "";
      setOpen(true);
      refreshFromQuery();
    }

    function onKeydown(e) {
      if (!open) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        active = Math.min(filtered.length - 1, active + 1);
        render();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        active = Math.max(0, active - 1);
        render();
      } else if (e.key === "Enter" || e.key === "Tab") {
        if (filtered[active]) {
          e.preventDefault();
          e.stopPropagation();
          pick(active);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
    }

    function openMenu(seed) {
      const ta = opts.input;
      const caret = ta.selectionStart ?? ta.value.length;
      const val = ta.value;
      if (!val.slice(0, caret).endsWith("/") && !/^\/[^\n]*$/.test(val)) {
        const before = val.slice(0, caret);
        const after = val.slice(caret);
        // Insert / at start of line or after newline
        const lineStart = before.lastIndexOf("\n") + 1;
        const line = before.slice(lineStart);
        if (!line.startsWith("/")) {
          ta.value = before + "/" + after;
          ta.setSelectionRange(caret + 1, caret + 1);
        }
      }
      query = typeof seed === "string" ? seed : "";
      setOpen(true);
      refreshFromQuery();
      ta.focus();
    }

    function setCommands(list) {
      agentCommands = Array.isArray(list)
        ? list.map((c) => ({
            name: String(c.name || ""),
            description: String(c.description || ""),
            inputHint:
              typeof c.inputHint === "string"
                ? c.inputHint
                : c.input && typeof c.input.hint === "string"
                  ? c.input.hint
                  : undefined,
            source: c.source || (String(c.name || "").includes(":") ? "plugin" : "agent"),
          }))
        : [];
      if (open) refreshFromQuery();
    }

    opts.input.addEventListener("input", onInput);
    opts.input.addEventListener("keydown", onKeydown, true);

    return {
      openMenu,
      setCommands,
      close: () => setOpen(false),
      isOpen: () => open,
      hostCommands: HOST_COMMANDS,
    };
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  W.slash = { mount, HOST_COMMANDS };
})(typeof window !== "undefined" ? window : globalThis);
