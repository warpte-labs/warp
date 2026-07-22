/**
 * Warp webview bootstrap — wire modules only.
 *
 * Module map:
 *   dom, hero, cards, markdown, spinner, agentFill, tools, subagents, transcript,
 *   history, attach, mention, slash, queue, compactBar, modelSelector, composer, hostBridge
 */
(function () {
  "use strict";

  const vscode = acquireVsCodeApi();
  const W = window.Warp;
  const post = (msg) => vscode.postMessage(msg);
  if (W.markdown && typeof W.markdown.setPost === "function") {
    W.markdown.setPost(post);
  }

  const els = W.dom.getEls();
  const tiles = W.dom.parseTiles(els.tilesData);
  /** played = first intro done; forceReplay set when chat has content then clears */
  const heroState = { played: false, forceReplay: false };
  const gateHeroState = { played: false, forceReplay: false };

  W.hero.mount(els.hero, tiles);
  if (els.heroGate) {
    W.hero.mount(els.heroGate, tiles);
  }

  const transcript = new W.Transcript(els.messages, {
    onEmptyChange(empty) {
      // Only animate chat hero when signed in
      if (els.root && els.root.classList.contains("is-signed-out")) {
        return;
      }
      W.hero.setEmpty(els.hero, empty, tiles, heroState);
    },
  });

  /** @type {{ setOpen: (o: boolean) => void, apply: Function }} */
  let settingsUi = {
    setOpen: function () {},
    apply: function () {},
  };

  /** set after composer mounts — Settings → Extensions uses this */
  let runSlashFn = function (/** @type {string} */ _cmd) {};

  /**
   * Top-left primary nav icon:
   *   Settings / History open → chat bubble (back to current chat)
   *   On chat view → plus (new conversation)
   */
  const ICON_PLUS =
    '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path stroke="currentColor" stroke-linecap="round" stroke-width="2" d="M12 5v14M5 12h14"/></svg>';
  const ICON_CHAT =
    '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path stroke="currentColor" stroke-width="1.5" d="M12 22c5.5228 0 10-4.4772 10-10 0-5.52285-4.4772-10-10-10C6.47715 2 2 6.47715 2 12c0 1.5997.37562 3.1116 1.04346 4.4525.17748.3563.23655.7636.13366 1.1481l-.59561 2.2261c-.25856.9663.6255 1.8503 1.59184 1.5918l2.22604-.5956c.38454-.1029.79182-.0438 1.14814.1336C8.88837 21.6244 10.4003 22 12 22Z"/></svg>';

  function syncPrimaryNavBtn() {
    const btn = els.btnNewChat;
    const root = els.root;
    if (!btn || !root) return;
    const overlay =
      root.classList.contains("settings-open") ||
      root.classList.contains("history-open");
    if (overlay) {
      btn.innerHTML = ICON_CHAT;
      btn.title = "Back to chat";
      btn.setAttribute("aria-label", "Back to chat");
      btn.dataset.mode = "back";
    } else {
      btn.innerHTML = ICON_PLUS;
      btn.title = "New conversation";
      btn.setAttribute("aria-label", "New conversation");
      btn.dataset.mode = "new";
    }
  }

  const historyUi = W.history.mount({
    root: els.root,
    panel: els.historyPanel,
    list: els.historyList,
    detail: els.historyDetail,
    detailBody: els.historyDetailBody,
    title: els.historyTitle,
    btnOpen: els.btnHistory,
    btnBack: els.btnHistoryBack,
    btnRefresh: els.btnHistoryRefresh,
    post,
    onOpenChange(open) {
      if (open) settingsUi.setOpen(false);
      syncPrimaryNavBtn();
    },
  });

  settingsUi =
    W.settings && els.settingsPanel
      ? W.settings.mount({
          root: els.root,
          panel: els.settingsPanel,
          list: els.settingsList,
          titleEl: els.settingsTitle,
          btnOpen: els.btnSettings,
          btnBack: els.btnSettingsBack,
          post,
          onOpenChange(open) {
            if (open) historyUi.setOpen(false);
            syncPrimaryNavBtn();
          },
          onRunSlash(cmd) {
            runSlashFn(cmd);
          },
          onPrefs(prefs) {
            if (prefs && typeof prefs.scrollWithStream === "boolean") {
              transcript.setScrollWithStream(prefs.scrollWithStream);
            }
          },
          toast(text) {
            showToast(text);
          },
        })
      : settingsUi;

  syncPrimaryNavBtn();

  const attach = W.attach.mount({
    tray: els.tray,
    inputImage: els.fileImage,
    inputAny: els.fileAny,
    viewer: els.viewer,
  });

  /** @type {Set<string>} */
  const mentionedPaths = new Set();

  const mention = W.mention.mount({
    input: els.input,
    post,
    onPick(file) {
      if (file?.path) {
        mentionedPaths.add(file.path);
      }
    },
  });

  const slash = W.slash
    ? W.slash.mount({
        input: els.input,
      })
    : {
        openMenu: function () {},
        setCommands: function () {},
        close: function () {},
        isOpen: function () {
          return false;
        },
      };

  const promptQueue = W.queue.mount({ root: els.promptQueue });

  const compactBar = W.compactBar
    ? W.compactBar.mount({ root: els.compactBar })
    : { begin: function () {}, end: function () {}, fail: function () {} };

  if (!W.modelSelector || typeof W.modelSelector.mount !== "function") {
    console.error("[warp] modelSelector.js failed to load");
  }
  const modelSelector = W.modelSelector
    ? W.modelSelector.mount({
        metaEl: els.meta,
        post,
      })
    : {
        applyModels: function () {},
        applyPermissionMode: function () {},
        setOpen: function () {},
        getState: function () {
          return null;
        },
      };

  // Sticky toast — stays open until user clicks × (generic notices)
  function showToast(text) {
    if (!els.toast) return;
    const label = text || "";
    if (els.toastText) {
      els.toastText.textContent = label;
    } else {
      els.toast.textContent = label;
    }
    els.toast.hidden = !label;
  }
  function hideToast() {
    if (!els.toast) return;
    els.toast.hidden = true;
    if (els.toastText) els.toastText.textContent = "";
  }
  if (els.toastClose) {
    els.toastClose.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      hideToast();
    });
  }

  /** Banner above the message input when trial expired / chat locked */
  function applyLicense(msg) {
    const bar = els.licenseBar;
    if (!bar) return;
    const kind = String(msg.kind || "");
    const allowed = msg.allowed !== false && msg.allowed !== "false";
    const locked =
      kind === "expired" ||
      (!allowed && kind !== "trial" && kind !== "pro" && kind !== "none");
    // Show when server says expired / not allowed (except fresh "none" waiting trial)
    const show =
      kind === "expired" ||
      (msg.pro !== true &&
        msg.pro !== "true" &&
        allowed === false &&
        kind !== "none");
    if (show) {
      const text =
        msg.detail ||
        msg.label ||
        "Free trial expired. Upgrade to Pro ($5/mo) to keep chatting.";
      if (els.licenseBarText) {
        els.licenseBarText.textContent = text;
      }
      bar.hidden = false;
    } else {
      bar.hidden = true;
    }
  }
  if (els.licenseBarUpgrade) {
    els.licenseBarUpgrade.addEventListener("click", (e) => {
      e.preventDefault();
      post({ type: "settingsAction", action: "subscribe" });
    });
  }

  const composer = W.composer.mount({
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
    onNewChat(info) {
      // New chat while already empty: transcript.clear won't fire empty-change
      if (info && info.wasEmpty && W.hero.replayIntro) {
        W.hero.replayIntro(els.hero, tiles, heroState);
      }
    },
  });

  // Settings → Extensions: run /mcps · /skills · /plugins as real agent turns
  runSlashFn = function (cmd) {
    if (typeof composer.runSlash === "function") {
      composer.runSlash(cmd);
    } else {
      post({ type: "prompt", text: cmd, attachments: [], mentions: [] });
    }
  };

  let signedIn = false;
  let alwaysApprove = false;
  let gateIntroPlayed = false;

  /**
   * Signed-out: mockup 08 — no chrome, small W, tagline, “Continue with Grok”.
   * Signed-in: full chat UI.
   */
  function applyAuth(msg) {
    const next = !!msg.signedIn;
    const changed = next !== signedIn;
    signedIn = next;
    if (els.btnAuth) {
      els.btnAuth.textContent = signedIn ? "Sign out" : "Sign in";
    }
    if (els.root) {
      els.root.classList.toggle("is-signed-out", !signedIn);
    }
    if (!signedIn) {
      // Close history if open
      historyUi?.setOpen?.(false);
      // Spiral on gate W (replay when returning to signed-out)
      if (els.heroGate && W.hero.replayIntro) {
        if (!gateIntroPlayed || changed) {
          gateIntroPlayed = true;
          W.hero.replayIntro(els.heroGate, tiles, gateHeroState);
        }
      } else if (els.heroGate) {
        W.hero.setEmpty(els.heroGate, true, tiles, gateHeroState);
      }
    } else {
      // Enter signed-in empty state with chat hero
      if (transcript.isEmpty()) {
        heroState.forceReplay = true;
        W.hero.setEmpty(els.hero, true, tiles, heroState);
      }
    }
  }

  function applyPermissionMode(msg) {
    const mode =
      msg &&
      (msg.permissionMode === "auto" ||
        msg.permissionMode === "yolo" ||
        msg.permissionMode === "ask")
        ? msg.permissionMode
        : msg && msg.alwaysApprove
          ? "yolo"
          : "ask";
    alwaysApprove = mode === "yolo";
    modelSelector?.applyPermissionMode?.(msg || { permissionMode: mode });
    if (els.root) {
      els.root.classList.toggle("mode-yolo", mode === "yolo");
      els.root.classList.toggle("mode-auto", mode === "auto");
      els.root.classList.toggle("mode-ask", mode === "ask");
    }
  }

  const formatTok = (W.util && W.util.formatTok) || function (n) {
    if (!Number.isFinite(n) || n < 0) return "—";
    if (n < 1000) return String(Math.round(n));
    if (n < 10_000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
    if (n < 1_000_000) return Math.round(n / 1000) + "k";
    return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  };

  /**
   * Footer context line.
   * Grok compact = session/prompt with "/compact" (see acpClient.compact).
   * Stats are display-only; only the "Compact" control starts compaction.
   */
  function applyContext(msg) {
    if (!els.ctxUsage) return;
    const used = Number(msg.usedTokens) || 0;
    const total = Number(msg.totalTokens) || 0;
    if (!total) {
      els.ctxUsage.innerHTML = '<span class="ctx-seg">—</span>';
      els.ctxUsage.title = "Context window";
      els.ctxUsage.classList.remove("warn", "hot");
      return;
    }
    const pct = Math.min(100, Math.round((used / total) * 100));
    // Every piece shares class "ctx-seg" (same font/color/spacing).
    // Separators are their own segs so " · " matches on both sides of Compact.
    // e.g. 120k / 500k · 24% · Compact
    els.ctxUsage.innerHTML =
      '<span class="ctx-seg">' +
      formatTok(used) +
      " / " +
      formatTok(total) +
      "</span>" +
      '<span class="ctx-seg"> · </span>' +
      '<span class="ctx-seg">' +
      pct +
      "%</span>" +
      '<span class="ctx-seg"> · </span>' +
      '<button type="button" class="ctx-seg" data-ctx-compact title="Compress conversation (/compact)">Compact</button>';
    els.ctxUsage.title =
      "Context: " +
      used.toLocaleString() +
      " / " +
      total.toLocaleString() +
      " tokens (" +
      pct +
      "%)";
    els.ctxUsage.classList.toggle("warn", pct >= 70 && pct < 90);
    els.ctxUsage.classList.toggle("hot", pct >= 90);
  }

  els.btnAuth?.addEventListener("click", () => {
    post({ type: signedIn ? "signOut" : "signIn" });
  });

  els.btnContinueGrok?.addEventListener("click", () => {
    post({ type: "signIn" });
  });

  // Compact only when the Compact segment is clicked (not token stats)
  els.ctxUsage?.addEventListener("click", (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    const btn = t.closest("[data-ctx-compact]");
    if (!btn || !els.ctxUsage.contains(btn)) return;
    e.preventDefault();
    e.stopPropagation();
    post({ type: "compact" });
  });


  const bridge = W.hostBridge.mount({
    transcript,
    historyUi,
    mention,
    attach,
    promptQueue,
    composer,
    modelSelector,
    compactBar,
    slash,
    applyAuth,
    applyContext,
    applyPermissionMode,
    applyLicense,
    showToast,
    settingsUi,
  });

  composer.bind();
  bridge.bind();

  // Trial-expired notice → Upgrade button (same path as Settings → Upgrade)
  window.addEventListener("warp-notice-action", (ev) => {
    const action =
      ev && ev.detail && ev.detail.action ? String(ev.detail.action) : "";
    if (action === "subscribe") {
      post({ type: "settingsAction", action: "subscribe" });
    } else if (action) {
      post({ type: "settingsAction", action: action });
    }
  });

  // Start in signed-out gate until host pushes auth
  if (els.root) {
    els.root.classList.add("is-signed-out");
  }
  if (els.heroGate && W.hero.replayIntro) {
    gateIntroPlayed = true;
    W.hero.replayIntro(els.heroGate, tiles, gateHeroState);
  }
  post({ type: "ready" });
})();
