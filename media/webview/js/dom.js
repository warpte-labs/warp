/**
 * Warp.dom — element map for the chat shell.
 */
(function (global) {
  "use strict";

  const W = (global.Warp = global.Warp || {});

  function qs(id) {
    return document.getElementById(id);
  }

  function getEls() {
    return {
      messages: qs("messages"),
      input: qs("input"),
      inputHl: qs("input-hl"),
      send: qs("send"),
      meta: qs("meta"),
      hero: qs("hero"),
      heroGate: qs("hero-gate"),
      authGate: qs("auth-gate"),
      btnContinueGrok: qs("btn-continue-grok"),
      chatTop: qs("chat-top"),
      chatBody: qs("chat-body"),
      btnAuth: qs("btn-auth"),
      ctxUsage: qs("ctx-usage"),
      toast: qs("toast"),
      settingsTitle: qs("settings-title"),
      tray: qs("tray"),
      fileImage: qs("file-image"),
      fileAny: qs("file-any"),
      root: qs("chat-root") || document.querySelector(".chat"),
      historyPanel: qs("history-panel"),
      historyList: qs("history-list"),
      historyDetail: qs("history-detail"),
      historyDetailBody: qs("history-detail-body"),
      historyTitle: qs("history-title"),
      btnHistory: qs("btn-history"),
      btnHistoryBack: qs("btn-history-back"),
      btnHistoryRefresh: qs("btn-history-refresh"),
      btnSettings: qs("btn-settings"),
      btnSettingsBack: qs("btn-settings-back"),
      settingsPanel: qs("settings-panel"),
      settingsList: qs("settings-list"),
      btnNewChat: qs("btn-new-chat"),
      viewer: qs("img-viewer"),
      promptQueue: qs("prompt-queue"),
      compactBar: qs("compact-bar"),
      composerSlot: document.querySelector(".composer-slot"),
      btnPlus: qs("btn-plus"),
      btnAt: qs("btn-at"),
      btnSlash: qs("btn-slash"),
      btnImage: qs("btn-image"),
      tilesData: qs("warp-tiles-data"),
    };
  }

  function parseTiles(el) {
    try {
      return JSON.parse(el?.textContent || "[]");
    } catch {
      return [];
    }
  }

  W.dom = { getEls, parseTiles };
})(typeof window !== "undefined" ? window : globalThis);
