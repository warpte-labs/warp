/**
 * Warp.hostBridge — host → webview message routing.
 */
(function (global) {
  "use strict";

  const W = (global.Warp = global.Warp || {});

  /**
   * @param {{
   *   transcript: object,
   *   historyUi: object,
   *   mention: object,
   *   attach: object,
   *   promptQueue: object,
   *   composer: object,
   *   modelSelector?: object,
   *   compactBar?: object,
   *   slash?: object,
   *   applyAuth: (msg: object) => void,
   *   applyContext?: (msg: object) => void,
   *   applyPermissionMode?: (msg: object) => void,
   *   showToast?: (text: string) => void,
   *   settingsUi?: object,
   * }} deps
   */
  function mount(deps) {
    const {
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
      settingsUi,
    } = deps;

    function onMessage(msg) {
      if (!msg || typeof msg !== "object") {
        return;
      }
      switch (msg.type) {
        case "auth":
          applyAuth(msg);
          break;
        case "thought":
          transcript.appendThought(msg.text || "");
          break;
        case "message":
          transcript.appendMessage(msg.text || "");
          break;
        case "tool":
          transcript.upsertTool({
            id: msg.id,
            title: msg.title,
            status: msg.status,
            kind: msg.kind,
            target: msg.target,
            label: msg.label,
          });
          break;
        case "fileList":
          mention.onFiles(msg.files || []);
          break;
        case "turn":
          if (msg.phase === "end") {
            transcript.endTurn();
            composer.drainQueue();
          }
          break;
        case "error":
          transcript.showError(msg.text || "Error");
          break;
        case "status":
          break;
        case "historyList":
          historyUi.renderList(msg.sessions || []);
          break;
        case "historyDetail":
          historyUi.renderDetail({
            session: msg.session || null,
            messages: msg.messages || [],
          });
          break;
        case "historyError":
          historyUi.onError(msg.text || "History error");
          break;
        case "chatCleared":
          composer.setBusy(false);
          historyUi.setOpen(false);
          attach.clear();
          promptQueue.clear();
          break;
        case "models":
          modelSelector?.applyModels?.(msg);
          break;
        case "context":
          if (typeof applyContext === "function") {
            applyContext(msg);
          }
          break;
        case "attachments":
          if (attach && typeof attach.addFromHost === "function") {
            attach.addFromHost(msg.items || []);
          }
          break;
        case "compact":
          if (msg.phase === "start") {
            compactBar?.begin?.({
              reason: msg.reason,
              percentage: msg.percentage,
              tokensUsed: msg.tokensUsed,
              contextWindow: msg.contextWindow,
            });
          } else if (msg.phase === "end") {
            compactBar?.end?.({
              tokensBefore: msg.tokensBefore,
              tokensAfter: msg.tokensAfter,
              elapsedMs: msg.elapsedMs,
            });
          } else if (msg.phase === "error") {
            compactBar?.fail?.(msg.error || "Compact failed");
          }
          break;
        case "commands":
          slash?.setCommands?.(msg.commands || []);
          break;
        case "permissionMode":
          if (typeof applyPermissionMode === "function") {
            applyPermissionMode(msg);
          }
          break;
        case "toast":
          if (typeof showToast === "function") {
            showToast(msg.text || "");
          } else {
            composer?.toast?.(msg.text || "");
          }
          break;
        case "settings":
          settingsUi?.apply?.(msg);
          break;
        case "usage":
          // Settings → Usage drill-in
          settingsUi?.applyUsage?.(msg);
          break;
        case "closeSettings":
          settingsUi?.setOpen?.(false);
          break;
        case "runSlash":
          settingsUi?.setOpen?.(false);
          if (typeof composer?.runSlash === "function") {
            composer.runSlash(String(msg.text || ""));
          }
          break;
        default:
          break;
      }
    }

    function bind() {
      window.addEventListener("message", (event) => {
        onMessage(event.data);
      });
    }

    return { bind, onMessage };
  }

  W.hostBridge = { mount };
})(typeof window !== "undefined" ? window : globalThis);
