/**
 * Warp webview bootstrap — wire modules only.
 *
 * Module map:
 *   dom, hero, cards, markdown, spinner, tools, transcript,
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
  });

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
        setOpen: function () {},
        getState: function () {
          return null;
        },
      };

  let toastTimer = null;
  function showToast(text) {
    if (!els.toast) return;
    els.toast.textContent = text || "";
    els.toast.hidden = !text;
    if (toastTimer) clearTimeout(toastTimer);
    if (text) {
      toastTimer = setTimeout(() => {
        els.toast.hidden = true;
        els.toast.textContent = "";
      }, 2800);
    }
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
    mentionedPaths,
    showToast,
    onNewChat(info) {
      // New chat while already empty: transcript.clear won't fire empty-change
      if (info && info.wasEmpty && W.hero.replayIntro) {
        W.hero.replayIntro(els.hero, tiles, heroState);
      }
    },
  });

  let signedIn = false;
  let alwaysApprove = true;
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
    alwaysApprove = !!msg.alwaysApprove;
    if (els.permChip) {
      els.permChip.textContent = alwaysApprove ? "yolo" : "ask";
      els.permChip.title = alwaysApprove
        ? "Always-approve on — click to require tool prompts"
        : "Ask mode — click to auto-approve tools";
      els.permChip.classList.toggle("yolo", alwaysApprove);
      els.permChip.classList.toggle("ask", !alwaysApprove);
    }
  }

  function formatTok(n) {
    if (!Number.isFinite(n) || n < 0) return "—";
    if (n < 1000) return String(Math.round(n));
    if (n < 10_000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
    if (n < 1_000_000) return Math.round(n / 1000) + "k";
    return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  }

  function applyContext(msg) {
    if (!els.ctxUsage) return;
    const used = Number(msg.usedTokens) || 0;
    const total = Number(msg.totalTokens) || 0;
    if (!total) {
      els.ctxUsage.textContent = "—";
      els.ctxUsage.title = "Context window";
      els.ctxUsage.classList.remove("warn", "hot");
      return;
    }
    const pct = Math.min(100, Math.round((used / total) * 100));
    // No "ctx" prefix — just used / total · %
    els.ctxUsage.textContent =
      formatTok(used) + " / " + formatTok(total) + " · " + pct + "%";
    els.ctxUsage.title =
      "Context window: " +
      used.toLocaleString() +
      " used of " +
      total.toLocaleString() +
      " tokens (" +
      pct +
      "%). Click: compact · Shift+click: /context";
    els.ctxUsage.classList.toggle("warn", pct >= 70 && pct < 90);
    els.ctxUsage.classList.toggle("hot", pct >= 90);
    els.ctxUsage.style.cursor = "pointer";
  }

  els.btnAuth?.addEventListener("click", () => {
    post({ type: signedIn ? "signOut" : "signIn" });
  });

  els.btnContinueGrok?.addEventListener("click", () => {
    post({ type: "signIn" });
  });

  els.ctxUsage?.addEventListener("click", (e) => {
    if (e.shiftKey) {
      // Run agent /context as a prompt
      post({ type: "prompt", text: "/context", attachments: [], mentions: [] });
      return;
    }
    post({ type: "compact" });
  });

  els.permChip?.addEventListener("click", () => {
    post({ type: "setAlwaysApprove", on: !alwaysApprove });
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
    showToast,
  });

  composer.bind();
  bridge.bind();
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
