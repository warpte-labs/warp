/**
 * Warp.composer — send / queue / attach / @-mention orchestration.
 */
(function (global) {
  "use strict";

  const W = (global.Warp = global.Warp || {});

  /**
   * @param {{
   *   els: object,
   *   post: (msg: object) => void,
   *   transcript: object,
   *   attach: object,
   *   mention: object,
   *   slash?: object,
   *   modelSelector?: object,
   *   promptQueue: object,
   *   historyUi: object,
   *   mentionedPaths: Set<string>,
   *   showToast?: (text: string) => void,
   * }} ctx
   */
  function mount(ctx) {
    const {
      els,
      post,
      transcript,
      attach,
      mention,
      slash,
      modelSelector,
      promptQueue,
      historyUi,
      mentionedPaths,
      showToast,
    } = ctx;

    let busy = false;
    let multiline = false;
    /** @type {string[]} */
    const promptHistory = [];
    let histIdx = -1;
    let histDraft = "";

    function toast(text) {
      if (typeof showToast === "function") showToast(text);
      else if (els.input) {
        const prev = els.input.placeholder;
        els.input.placeholder = text;
        setTimeout(() => {
          if (els.input) {
            els.input.placeholder =
              prev || "Message Grok… · image or + for files";
          }
        }, 2200);
      }
    }

    function isBusy() {
      return busy;
    }

    function setBusy(v) {
      busy = v;
      if (els.send) {
        els.send.disabled = false;
      }
    }

    function autoSize() {
      if (!els.input) {
        return;
      }
      els.input.style.height = "auto";
      els.input.style.height =
        Math.min(els.input.scrollHeight, 120) + "px";
    }

    function clearComposer() {
      if (els.input) {
        els.input.value = "";
      }
      autoSize();
      attach.clear();
      mentionedPaths.clear();
      mention.close();
      slash?.close?.();
      histIdx = -1;
      histDraft = "";
    }

    function collectPayload() {
      const text = (els.input?.value || "").trim();
      const attachments = attach.toPayload();
      const atRefs = text.match(/@([^\s@]+)/g) || [];
      for (const raw of atRefs) {
        mentionedPaths.add(raw.replace(/^@/, ""));
      }
      return {
        text,
        attachments,
        mentions: Array.from(mentionedPaths),
      };
    }

    function chipMetaFrom(payload) {
      const chips = (payload.attachments || []).map((a) => {
        /** @type {{name?:string,isImage?:boolean,previewUrl?:string,mime?:string}} */
        const chip = {
          name: a.name,
          isImage: !!a.isImage,
          mime: a.mime,
        };
        // Keep a viewable data URL for chat thumbnails + maximize
        if (a.isImage && a.dataBase64) {
          const mime = a.mime || "image/png";
          chip.previewUrl = "data:" + mime + ";base64," + a.dataBase64;
        }
        return chip;
      });
      for (const m of payload.mentions || []) {
        chips.push({ name: m, isImage: false });
      }
      return chips;
    }

    function dispatchPrompt(entry) {
      setBusy(true);
      transcript.beginTurn(entry.text, entry.chipMeta || []);
      post({
        type: "prompt",
        text: entry.text,
        attachments: entry.attachments || [],
        mentions: entry.mentions || [],
      });
    }

    function drainQueue() {
      const next = promptQueue.dequeue();
      if (!next) {
        setBusy(false);
        return;
      }
      dispatchPrompt(next);
    }

    /**
     * Host-side slash commands. Return true if handled (do not send as prompt).
     * @param {string} text
     * @returns {boolean}
     */
    function tryHostCommand(text) {
      const raw = String(text || "").trim();
      if (!raw.startsWith("/")) return false;
      const m = raw.match(/^\/([^\s]+)(?:\s+([\s\S]+))?$/);
      if (!m) return false;
      const cmd = m[1].toLowerCase();
      const args = (m[2] || "").trim();

      if (cmd === "compact") {
        post({ type: "compact", hint: args || undefined });
        return true;
      }
      if (cmd === "new" || cmd === "clear") {
        startNewChat();
        return true;
      }
      if (cmd === "resume") {
        historyUi.setOpen(true);
        toast("Opened chat history");
        return true;
      }
      if (cmd === "history") {
        // Leave input empty and seed ↑ recall
        if (promptHistory.length) {
          histIdx = 0;
          histDraft = "";
          if (els.input) {
            els.input.value = promptHistory[promptHistory.length - 1] || "";
            autoSize();
          }
          toast("Prompt history — ↑/↓ to step");
        } else {
          toast("No prompts in this chat yet");
        }
        return true;
      }
      if (cmd === "export") {
        const md = transcript.exportMarkdown?.() || "";
        post({ type: "exportChat", text: md });
        return true;
      }
      if (cmd === "copy") {
        const n = args && /^\d+$/.test(args) ? Number(args) : 1;
        const t = transcript.getLastAssistantText?.(n) || "";
        post({ type: "copyText", text: t });
        return true;
      }
      if (cmd === "model" || cmd === "m") {
        if (!args) {
          modelSelector?.setOpen?.(true);
          toast("Pick a model");
          return true;
        }
        // "/model <id> [effort]"
        const parts = args.split(/\s+/);
        const modelId = parts[0];
        let effort = parts[1];
        if (effort) {
          effort = effort.toLowerCase();
          if (effort === "med") effort = "medium";
        }
        post({
          type: "setModel",
          modelId,
          reasoningEffort: effort || undefined,
        });
        toast("Switching model…");
        return true;
      }
      if (cmd === "effort") {
        const effort = (args || "high").toLowerCase().replace(/^med$/, "medium");
        const state = modelSelector?.getState?.() || {};
        const modelId = state.currentModelId || state.modelId;
        if (!modelId) {
          toast("No model yet — wait for session");
          return true;
        }
        post({ type: "setModel", modelId, reasoningEffort: effort });
        toast("Effort → " + effort);
        return true;
      }
      if (cmd === "always-approve") {
        const a = args.toLowerCase();
        if (a === "on" || a === "true" || a === "1") {
          post({ type: "setAlwaysApprove", on: true });
        } else if (a === "off" || a === "false" || a === "0") {
          post({ type: "setAlwaysApprove", on: false });
        } else {
          post({ type: "setAlwaysApprove" }); // toggle
        }
        return true;
      }
      if (cmd === "auto") {
        post({ type: "setAlwaysApprove", on: false });
        return true;
      }
      if (cmd === "rename" || cmd === "title") {
        post({ type: "renameSession", title: args || undefined });
        return true;
      }
      if (cmd === "login") {
        post({ type: "signIn" });
        return true;
      }
      if (cmd === "logout") {
        post({ type: "signOut" });
        return true;
      }
      if (cmd === "multiline" || cmd === "ml") {
        multiline = !multiline;
        toast(
          multiline
            ? "Multiline on — Enter newline, Shift+Enter send"
            : "Multiline off — Enter sends"
        );
        return true;
      }
      // Everything else (skills, context, plan, goal, …) → agent as normal prompt
      return false;
    }

    function send() {
      if (slash?.isOpen?.()) {
        return;
      }
      const payload = collectPayload();
      if (!payload.text && !payload.attachments.length) {
        return;
      }

      // Host slash intercepts (no attachments)
      if (
        payload.text.startsWith("/") &&
        !payload.attachments.length &&
        tryHostCommand(payload.text)
      ) {
        clearComposer();
        return;
      }

      if (payload.text) {
        promptHistory.push(payload.text);
        if (promptHistory.length > 80) promptHistory.shift();
      }

      const entry = {
        text: payload.text,
        attachments: payload.attachments,
        mentions: payload.mentions,
        chipMeta: chipMetaFrom(payload),
      };
      clearComposer();
      if (busy) {
        promptQueue.enqueue(entry);
        return;
      }
      dispatchPrompt(entry);
    }

    function startNewChat() {
      historyUi.setOpen(false);
      mention.close();
      slash?.close?.();
      promptQueue.clear();
      transcript.clear();
      attach.clear();
      mentionedPaths.clear();
      setBusy(false);
      if (els.input) {
        els.input.value = "";
        autoSize();
        els.input.focus();
      }
      post({ type: "newChat" });
    }

    function bind() {
      els.send?.addEventListener("click", send);
      els.btnNewChat?.addEventListener("click", startNewChat);
      els.input?.addEventListener("input", autoSize);
      els.input?.addEventListener("keydown", (e) => {
        // Slash / mention menus own arrows & enter
        if (slash?.isOpen?.() || mention?.isOpen?.()) {
          return;
        }

        // Prompt history: ↑/↓ on empty or while recalling
        if (
          (e.key === "ArrowUp" || e.key === "ArrowDown") &&
          !e.shiftKey &&
          !e.ctrlKey &&
          !e.metaKey
        ) {
          const val = els.input?.value || "";
          const caret = els.input?.selectionStart ?? 0;
          const atStart = caret === 0;
          const empty = !val.trim();
          if (
            promptHistory.length &&
            (empty || histIdx >= 0 || (e.key === "ArrowUp" && atStart))
          ) {
            e.preventDefault();
            if (histIdx < 0) {
              histDraft = val;
              histIdx = promptHistory.length;
            }
            if (e.key === "ArrowUp") {
              histIdx = Math.max(0, histIdx - 1);
            } else {
              histIdx = Math.min(promptHistory.length, histIdx + 1);
            }
            if (histIdx >= promptHistory.length) {
              histIdx = -1;
              if (els.input) els.input.value = histDraft;
            } else if (els.input) {
              els.input.value = promptHistory[histIdx] || "";
            }
            autoSize();
            return;
          }
        }

        if (e.key === "Enter") {
          if (multiline) {
            if (e.shiftKey) {
              e.preventDefault();
              send();
            }
            // bare Enter inserts newline (default)
            return;
          }
          if (!e.shiftKey) {
            e.preventDefault();
            send();
          }
        }
      });
      els.btnImage?.addEventListener("click", () => attach.pickImage());
      els.btnPlus?.addEventListener("click", () => attach.pickAny());
      els.btnAt?.addEventListener("click", () => mention.openPicker(""));
      els.btnSlash?.addEventListener("click", () => {
        if (!els.input) return;
        if (slash && typeof slash.openMenu === "function") {
          slash.openMenu("");
        } else {
          els.input.value += "/";
          els.input.focus();
        }
        autoSize();
      });

      // ── Drag-and-drop attach (OS Explorer → webview) ──
      // VS Code/Cursor webviews only fire drop if dragover is ALWAYS preventDefault'd.
      const dropShell = els.composerSlot || els.root;
      const sb = dropShell?.querySelector?.(".sb") || null;
      let dragDepth = 0;

      function setDropActive(on) {
        dropShell?.classList.toggle("drop-active", !!on);
        sb?.classList.toggle("drop-active", !!on);
      }

      function pointInComposer(clientX, clientY) {
        const el = dropShell || sb;
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return (
          clientX >= r.left &&
          clientX <= r.right &&
          clientY >= r.top &&
          clientY <= r.bottom
        );
      }

      /** Collect File objects — prefer items API (more reliable in Electron). */
      function collectFiles(dt) {
        /** @type {File[]} */
        const out = [];
        if (!dt) return out;
        try {
          if (dt.items && dt.items.length) {
            for (let i = 0; i < dt.items.length; i++) {
              const item = dt.items[i];
              if (item && item.kind === "file") {
                const f = item.getAsFile();
                if (f) out.push(f);
              }
            }
          }
        } catch {
          /* ignore */
        }
        if (!out.length && dt.files && dt.files.length) {
          for (let i = 0; i < dt.files.length; i++) {
            out.push(dt.files[i]);
          }
        }
        return out;
      }

      function uriPaths(dt) {
        if (!dt || !dt.getData) return [];
        let raw = "";
        try {
          raw = dt.getData("text/uri-list") || dt.getData("text/plain") || "";
        } catch {
          raw = "";
        }
        return raw
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter((s) => s && !s.startsWith("#"))
          .map((s) => {
            try {
              if (/^file:/i.test(s)) {
                const u = new URL(s);
                let p = decodeURIComponent(u.pathname || "");
                // Windows: /C:/... → C:/...
                if (/^\/[A-Za-z]:\//.test(p)) p = p.slice(1);
                return p;
              }
            } catch {
              /* keep */
            }
            return s;
          })
          .filter(Boolean);
      }

      function flashErr(msg) {
        if (!els.input) return;
        const prev = els.input.placeholder;
        els.input.placeholder = msg;
        setTimeout(() => {
          if (els.input) {
            els.input.placeholder =
              prev || "Message Grok… · image or + for files";
          }
        }, 2200);
      }

      async function handleDrop(e) {
        e.preventDefault();
        e.stopPropagation();
        dragDepth = 0;
        setDropActive(false);
        const dt = e.dataTransfer;
        const files = collectFiles(dt);
        if (files.length) {
          const err = await attach.addFiles(files, false);
          if (err) flashErr(err);
          els.input?.focus();
          return;
        }
        // Fallback: file:// URIs (IDE explorer / some OS drops)
        const paths = uriPaths(dt);
        if (paths.length) {
          post({ type: "attachFromPaths", paths });
          els.input?.focus();
        }
      }

      // Capture-phase on document so VS Code doesn't swallow dragover
      document.addEventListener(
        "dragenter",
        (e) => {
          if (!pointInComposer(e.clientX, e.clientY)) return;
          e.preventDefault();
          dragDepth++;
          setDropActive(true);
          if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
        },
        true
      );
      document.addEventListener(
        "dragover",
        (e) => {
          if (!pointInComposer(e.clientX, e.clientY)) {
            if (dragDepth > 0) {
              dragDepth = 0;
              setDropActive(false);
            }
            return;
          }
          // Critical: without this, drop never fires in Electron webviews
          e.preventDefault();
          e.stopPropagation();
          if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
          setDropActive(true);
        },
        true
      );
      document.addEventListener(
        "dragleave",
        (e) => {
          // Only clear when leaving the webview / composer
          if (!pointInComposer(e.clientX, e.clientY)) {
            dragDepth = 0;
            setDropActive(false);
          }
        },
        true
      );
      document.addEventListener(
        "drop",
        (e) => {
          if (!pointInComposer(e.clientX, e.clientY)) return;
          void handleDrop(e);
        },
        true
      );
    }

    return {
      bind,
      send,
      startNewChat,
      drainQueue,
      setBusy,
      isBusy,
      tryHostCommand,
      toast,
      autoSize,
      clearComposer,
    };
  }

  W.composer = { mount };
})(typeof window !== "undefined" ? window : globalThis);
