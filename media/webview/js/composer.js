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
   *   settingsUi?: { setOpen?: (o: boolean) => void },
   *   mentionedPaths: Set<string>,
   *   showToast?: (text: string) => void,
   *   onNewChat?: () => void,
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
      settingsUi,
      mentionedPaths,
      showToast,
      onNewChat,
    } = ctx;

    let busy = false;
    let multiline = false;
    /** @type {string[]} */
    const promptHistory = [];
    let histIdx = -1;
    let histDraft = "";

    const ICON_SEND =
      '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true"><path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19V5m0 0-6 6m6-6 6 6"/></svg>';
    const ICON_STOP =
      '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" stroke="currentColor" stroke-width="1"/></svg>';

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
      busy = !!v;
      if (!els.send) return;
      els.send.disabled = false;
      els.send.classList.toggle("is-stop", busy);
      els.send.title = busy ? "Stop" : "Send";
      els.send.setAttribute("aria-label", busy ? "Stop" : "Send");
      els.send.innerHTML = busy ? ICON_STOP : ICON_SEND;
    }

    function stopTurn() {
      if (!busy) return;
      post({ type: "cancel" });
      if (typeof transcript.interrupt === "function") {
        transcript.interrupt();
      }
      // Optimistic: host will also send cancelled + turn end
      setBusy(false);
    }

    function autoSize() {
      if (!els.input) {
        return;
      }
      els.input.style.height = "auto";
      els.input.style.height =
        Math.min(els.input.scrollHeight, 120) + "px";
      syncInputHighlight();
    }

    function escHl(s) {
      return String(s || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    }

    /**
     * Mirror textarea into #input-hl; paint known /command tokens orange.
     */
    function syncInputHighlight() {
      const ta = els.input;
      const hl = els.inputHl;
      if (!ta || !hl) return;
      const val = ta.value || "";
      if (!val) {
        hl.innerHTML = "";
        return;
      }
      const known =
        slash && typeof slash.knownNames === "function"
          ? slash.knownNames()
          : new Set();
      // Orange for known /cmd (and aliases) at line start or after whitespace
      let html = "";
      let i = 0;
      const re = /(^|[\s])(\/[A-Za-z0-9_.:-]+)/g;
      let m;
      while ((m = re.exec(val))) {
        const pre = m[1] || "";
        const token = m[2];
        const name = token.slice(1).toLowerCase();
        const start = m.index;
        html += escHl(val.slice(i, start));
        html += escHl(pre);
        if (known.has(name)) {
          html += '<span class="input-slash">' + escHl(token) + "</span>";
        } else {
          html += escHl(token);
        }
        i = start + pre.length + token.length;
      }
      html += escHl(val.slice(i));
      if (val.endsWith("\n")) html += "\n";
      hl.innerHTML = html;
      hl.scrollTop = ta.scrollTop;
      hl.scrollLeft = ta.scrollLeft;
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
      if (cmd === "always-approve" || cmd === "yolo") {
        const a = args.toLowerCase();
        if (a === "on" || a === "true" || a === "1" || !a) {
          post({ type: "setPermissionMode", mode: "yolo" });
        } else if (a === "off" || a === "false" || a === "0") {
          post({ type: "setPermissionMode", mode: "ask" });
        } else {
          post({ type: "setPermissionMode", mode: "yolo" });
        }
        return true;
      }
      if (cmd === "ask") {
        post({ type: "setPermissionMode", mode: "ask" });
        return true;
      }
      if (cmd === "auto") {
        post({ type: "setPermissionMode", mode: "auto" });
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
      // Enter while running + text → queue; empty Enter while running → stop
      if (busy) {
        const payload = collectPayload();
        if (!payload.text && !payload.attachments.length) {
          stopTurn();
          return;
        }
        if (payload.text) {
          promptHistory.push(payload.text);
          if (promptHistory.length > 80) promptHistory.shift();
        }
        promptQueue.enqueue({
          text: payload.text,
          attachments: payload.attachments,
          mentions: payload.mentions,
          chipMeta: chipMetaFrom(payload),
        });
        clearComposer();
        toast("Queued");
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
      dispatchPrompt(entry);
    }

    function isOverlayOpen() {
      const root = els.root;
      if (!root || !root.classList) return false;
      return (
        root.classList.contains("settings-open") ||
        root.classList.contains("history-open")
      );
    }

    /** Settings/History → back to chat only. Chat view → new conversation. */
    function onPrimaryNavClick() {
      if (isOverlayOpen()) {
        historyUi?.setOpen?.(false);
        settingsUi?.setOpen?.(false);
        if (els.input) {
          try {
            els.input.focus();
          } catch (e) {
            /* ignore */
          }
        }
        return;
      }
      startNewChat();
    }

    function startNewChat() {
      // Leave history / settings so the empty chat is visible
      historyUi?.setOpen?.(false);
      settingsUi?.setOpen?.(false);
      mention.close();
      slash?.close?.();
      promptQueue.clear();
      const wasEmpty = transcript.isEmpty();
      transcript.clear();
      attach.clear();
      mentionedPaths.clear();
      setBusy(false);
      if (els.input) {
        els.input.value = "";
        autoSize();
        els.input.focus();
      }
      syncInputHighlight();
      // Spiral W intro: setEmpty handles empty-after-content; if already empty, force replay
      if (typeof onNewChat === "function") {
        onNewChat({ wasEmpty: !!wasEmpty });
      }
      post({ type: "newChat" });
    }

    function bind() {
      els.send?.addEventListener("click", () => {
        if (busy) stopTurn();
        else send();
      });
      els.btnNewChat?.addEventListener("click", onPrimaryNavClick);
      els.input?.addEventListener("input", autoSize);
      els.input?.addEventListener("scroll", () => {
        if (els.inputHl && els.input) {
          els.inputHl.scrollTop = els.input.scrollTop;
          els.inputHl.scrollLeft = els.input.scrollLeft;
        }
      });
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
            // history branch continues below; highlight refreshed via input/autoSize
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
      els.btnAt?.addEventListener("click", () => {
        mention.openPicker("");
        // Mirror highlight (textarea glyphs are transparent via #input-hl)
        autoSize();
      });
      els.btnSlash?.addEventListener("click", () => {
        if (!els.input) return;
        if (slash && typeof slash.openMenu === "function") {
          slash.openMenu("");
        } else {
          els.input.value += "/";
          els.input.focus();
          els.input.dispatchEvent(new Event("input", { bubbles: true }));
        }
        autoSize();
      });

      // ── Drag-and-drop attach (OS File Explorer → webview) ──
      // VS Code/Cursor: must preventDefault on dragover or drop never fires.
      // Explorer often gives empty File blobs — prefer Electron file.path / URIs → host.
      const dropRoot = els.root || document.body;
      const dropShell = els.composerSlot || dropRoot;
      const sb = dropShell?.querySelector?.(".sb") || null;
      let dragDepth = 0;

      function setDropActive(on) {
        dropRoot?.classList.toggle("drop-active", !!on);
        dropShell?.classList.toggle("drop-active", !!on);
        sb?.classList.toggle("drop-active", !!on);
      }

      function isFileDrag(dt) {
        if (!dt) return false;
        try {
          if (dt.types) {
            for (let i = 0; i < dt.types.length; i++) {
              const t = String(dt.types[i] || "").toLowerCase();
              if (
                t === "files" ||
                t === "application/x-moz-file" ||
                t.indexOf("uri-list") >= 0 ||
                t === "text/plain"
              ) {
                return true;
              }
            }
          }
        } catch {
          /* ignore */
        }
        return !!(dt.files && dt.files.length);
      }

      /** @returns {{ files: File[], paths: string[] }} */
      function collectDropPayload(dt) {
        /** @type {File[]} */
        const files = [];
        /** @type {string[]} */
        const paths = [];
        if (!dt) return { files, paths };

        // 1) DataTransferItemList (Electron / Chromium)
        try {
          if (dt.items && dt.items.length) {
            for (let i = 0; i < dt.items.length; i++) {
              const item = dt.items[i];
              if (!item || item.kind !== "file") continue;
              const f = item.getAsFile();
              if (!f) continue;
              // Electron: File has non-standard .path from OS explorer
              const p =
                /** @type {any} */ (f).path ||
                /** @type {any} */ (f).webkitRelativePath;
              if (typeof p === "string" && p.length > 2 && /[/\\]/.test(p)) {
                paths.push(p);
              } else if (f.size > 0 || (f.name && f.name.length)) {
                files.push(f);
              }
            }
          }
        } catch {
          /* ignore */
        }

        // 2) FileList fallback
        try {
          if (dt.files && dt.files.length) {
            for (let i = 0; i < dt.files.length; i++) {
              const f = dt.files[i];
              if (!f) continue;
              const p = /** @type {any} */ (f).path;
              if (typeof p === "string" && p.length > 2 && /[/\\]/.test(p)) {
                if (paths.indexOf(p) < 0) paths.push(p);
              } else if (
                (f.size > 0 || (f.name && f.name.length)) &&
                !files.includes(f)
              ) {
                files.push(f);
              }
            }
          }
        } catch {
          /* ignore */
        }

        // 3) URI list / plain text paths (Windows Explorer, some IDEs)
        for (const p of uriPaths(dt)) {
          if (paths.indexOf(p) < 0) paths.push(p);
        }

        return { files, paths };
      }

      function uriPaths(dt) {
        if (!dt || !dt.getData) return [];
        const chunks = [];
        const tryTypes = [
          "text/uri-list",
          "text/plain",
          "URL",
          "text/x-moz-url",
        ];
        for (const t of tryTypes) {
          try {
            const raw = dt.getData(t);
            if (raw && String(raw).trim()) chunks.push(String(raw));
          } catch {
            /* type not available until drop on some browsers */
          }
        }
        const out = [];
        for (const raw of chunks) {
          for (const line of raw.split(/\r?\n/)) {
            let s = line.trim();
            if (!s || s.startsWith("#")) continue;
            // text/x-moz-url: url\ntitle pairs
            if (/^https?:/i.test(s) && !/^file:/i.test(s)) continue;
            try {
              if (/^file:/i.test(s)) {
                // file:///C:/Users/... or file://localhost/C:/...
                s = s.replace(/^file:\/\/\/?/i, "");
                s = decodeURIComponent(s);
                if (/^\/[A-Za-z]:/.test(s)) s = s.slice(1); // /C:/ → C:/
                s = s.replace(/\//g, "\\"); // Windows display
                // Keep as path with backslashes; host normalizes
              }
            } catch {
              /* keep s */
            }
            // Windows path C:\... or UNC \\server\share
            if (
              /^[A-Za-z]:[\\/]/.test(s) ||
              /^\\\\/.test(s) ||
              s.indexOf("/") >= 0 ||
              s.indexOf("\\") >= 0
            ) {
              out.push(s);
            }
          }
        }
        return out;
      }

      function flashErr(msg) {
        if (typeof toast === "function") {
          toast(msg);
          return;
        }
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
        if (!dt) return;

        const { files, paths } = collectDropPayload(dt);

        // Prefer host path read (reliable for Explorer on Windows/Electron)
        if (paths.length) {
          post({ type: "attachFromPaths", paths });
          els.input?.focus();
          // Also try File blobs if any are readable (mixed drops)
          if (files.length) {
            const err = await attach.addFiles(files, false);
            if (err) flashErr(err);
          }
          return;
        }

        if (files.length) {
          const err = await attach.addFiles(files, false);
          if (err) flashErr(err);
          els.input?.focus();
          return;
        }

        flashErr("Could not read dropped files — try the + or image button");
      }

      // Capture phase on document — must cover whole webview for Explorer drops
      document.addEventListener(
        "dragenter",
        (e) => {
          if (!isFileDrag(e.dataTransfer)) return;
          e.preventDefault();
          e.stopPropagation();
          dragDepth++;
          setDropActive(true);
          if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
        },
        true
      );
      document.addEventListener(
        "dragover",
        (e) => {
          if (!isFileDrag(e.dataTransfer)) return;
          // Critical: without preventDefault, drop never fires in Electron webviews
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
          if (!isFileDrag(e.dataTransfer) && dragDepth === 0) return;
          // relatedTarget null often means left the webview
          const rel = e.relatedTarget;
          if (rel && dropRoot && dropRoot.contains(/** @type {Node} */ (rel))) {
            return;
          }
          dragDepth = Math.max(0, dragDepth - 1);
          if (dragDepth === 0) setDropActive(false);
        },
        true
      );
      document.addEventListener(
        "drop",
        (e) => {
          if (!isFileDrag(e.dataTransfer) && !(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length)) {
            // Still try — Explorer may not expose types until drop
            if (!e.dataTransfer) return;
          }
          e.preventDefault();
          e.stopPropagation();
          void handleDrop(e);
        },
        true
      );
    }

    /**
     * Run a slash (or freeform) as a user turn — used by Settings → Extensions.
     * @param {string} text
     */
    function runSlash(text) {
      const t = String(text || "").trim();
      if (!t) return;
      // Local-only host commands never hit the agent
      if (t.startsWith("/") && tryHostCommand(t)) {
        return;
      }
      if (busy) {
        promptQueue.enqueue({
          text: t,
          attachments: [],
          mentions: [],
          chipMeta: [],
        });
        toast("Queued " + t);
        return;
      }
      dispatchPrompt({
        text: t,
        attachments: [],
        mentions: [],
        chipMeta: [],
      });
    }

    return {
      bind,
      send,
      startNewChat,
      drainQueue,
      setBusy,
      isBusy,
      tryHostCommand,
      runSlash,
      toast,
      autoSize,
      clearComposer,
    };
  }

  W.composer = { mount };
})(typeof window !== "undefined" ? window : globalThis);
