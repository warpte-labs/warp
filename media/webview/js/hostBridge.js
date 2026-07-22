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
   *   applyLicense?: (msg: object) => void,
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
      applyLicense,
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
            subagentId: msg.subagentId,
            subagentType: msg.subagentType,
            isSpawn: msg.isSpawn,
          });
          break;
        case "task":
          W.tasksState = msg.snapshot || W.tasksState;
          if (msg.task) {
            transcript.upsertSubagent(msg.task);
          }
          break;
        case "tasks":
          W.tasksState = {
            tasks: msg.tasks || [],
            running: msg.running || 0,
            updatedAt: msg.updatedAt || Date.now(),
          };
          if (typeof transcript.applyTasksSnapshot === "function") {
            transcript.applyTasksSnapshot(W.tasksState);
          }
          break;
        case "fileList":
          mention.onFiles(msg.files || []);
          break;
        case "turn":
          if (msg.phase === "end") {
            transcript.endTurn();
            composer.setBusy(false);
            composer.drainQueue();
          } else if (msg.phase === "start") {
            composer.setBusy(true);
          }
          break;
        case "cancelled":
          if (typeof transcript.interrupt === "function") {
            transcript.interrupt();
          }
          composer.setBusy(false);
          break;
        case "error":
          transcript.showError(msg.text || "Error");
          composer.setBusy(false);
          break;
        case "notice":
          // Normal white assistant-style reply (trial expired, etc.) — not red error
          if (typeof transcript.showNotice === "function") {
            transcript.showNotice(msg.text || "", {
              action: msg.action || "",
              actionLabel: msg.actionLabel || "Upgrade",
            });
          } else {
            transcript.appendMessage(msg.text || "");
            transcript.endTurn();
          }
          break;
        case "status":
          break;
        case "historyList":
          historyUi.renderList(msg.sessions || [], { live: !!msg.live });
          break;
        case "historyDetail":
          historyUi.renderDetail({
            session: msg.session || null,
            messages: msg.messages || [],
            live: !!msg.live,
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
        case "license":
          if (typeof applyLicense === "function") {
            applyLicense(msg);
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
