/**
 * Warp.settings — drill-in categories (minimal list → two-tone detail).
 * Categories mirror Grok product areas (permissions, models, safety, …).
 */
(function (global) {
  "use strict";

  const W = (global.Warp = global.Warp || {});

  const CATS = [
    {
      id: "account",
      label: "Account & billing",
      dek: "Plan, upgrade to Pro, or manage subscription.",
    },
    {
      id: "permissions",
      label: "Permissions",
      dek: "When tools need your OK.",
    },
    {
      id: "models",
      label: "Models",
      dek: "Default reasoning effort for new turns.",
    },
    {
      id: "safety",
      label: "Safety",
      dek: "Sandbox limits for agent tools.",
    },
    {
      id: "transcript",
      label: "Transcript",
      dek: "How chat and tools look.",
    },
    {
      id: "session",
      label: "Session",
      dek: "Context and compaction.",
    },
    {
      id: "usage",
      label: "Usage",
      dek: "Local sessions, messages, tools on this machine.",
    },
    {
      id: "extensions",
      label: "Extensions",
      dek: "MCP, skills, plugins — via Grok.",
    },
    {
      id: "connection",
      label: "Connection",
      dek: "Only if Grok isn’t found automatically.",
    },
  ];

  /**
   * @param {{
   *   root: HTMLElement,
   *   panel: HTMLElement,
   *   list: HTMLElement,
   *   titleEl?: HTMLElement | null,
   *   btnOpen: HTMLElement,
   *   btnBack: HTMLElement,
   *   post: (msg: object) => void,
   *   onOpenChange?: (open: boolean) => void,
   *   onRunSlash?: (cmd: string) => void,
   *   onPrefs?: (prefs: { showThinking: boolean, groupToolRows: boolean, scrollWithStream: boolean }) => void,
   *   toast?: (text: string) => void,
   * }} opts
   */
  /** These three live in the webview only — host echo was snapping them back On. */
  const UI_TOGGLES = ["showThinking", "groupToolRows", "scrollWithStream"];

  function mount(opts) {
    /** @type {Record<string, unknown>} */
    let snapshot = {
      showThinking: true,
      groupToolRows: true,
      scrollWithStream: true,
    };
    let open = false;
    /** @type {string | null} */
    let catId = null;
    /** Host is watching log + Ably for Usage */
    let usageLiveOn = false;

    // Load Off state before any host message
    loadLocalPrefs();
    applyTranscriptPrefs();
    notifyPrefs();

    function setOpen(v) {
      open = !!v;
      if (!open) {
        stopUsageLive();
        catId = null;
      }
      opts.root.classList.toggle("settings-open", open);
      opts.panel.classList.toggle("hidden", !open);
      opts.panel.setAttribute("aria-hidden", open ? "false" : "true");
      opts.btnOpen.classList.toggle("on", open);
      if (open) {
        opts.post({ type: "getSettings" });
        render();
      }
      if (typeof opts.onOpenChange === "function") {
        opts.onOpenChange(open);
      }
    }

    function stopUsageLive() {
      if (!usageLiveOn) return;
      usageLiveOn = false;
      opts.post({ type: "usageUnsubscribe" });
    }

    function startUsageLive(range) {
      usageLiveOn = true;
      opts.post({
        type: "usageSubscribe",
        range: range || "30d",
      });
    }

    function isOpen() {
      return open;
    }

    function apply(data) {
      if (!data || typeof data !== "object") return;
      // Snapshot account fields before merge — avoid full re-render that restarts ring CSS
      const prevAccount = {
        planKind: snapshot.planKind,
        planLabel: snapshot.planLabel,
        planDetail: snapshot.planDetail,
        planPro: snapshot.planPro,
        billingEmail: snapshot.billingEmail,
        signedIn: snapshot.signedIn,
        version: snapshot.version,
      };
      // Host may send showThinking:true (default) and wipe Off — skip UI toggles.
      Object.keys(data).forEach(function (k) {
        if (k === "type") return;
        if (UI_TOGGLES.indexOf(k) >= 0) return;
        if (data[k] !== undefined) snapshot[k] = data[k];
      });
      // Re-render only when not sitting on the transcript toggles page
      // (full re-render was destroying Off mid-click via host echo).
      // Usage has its own applyUsage path.
      if (open && catId === "account") {
        const same =
          prevAccount.planKind === snapshot.planKind &&
          prevAccount.planLabel === snapshot.planLabel &&
          prevAccount.planDetail === snapshot.planDetail &&
          prevAccount.planPro === snapshot.planPro &&
          prevAccount.billingEmail === snapshot.billingEmail &&
          prevAccount.signedIn === snapshot.signedIn &&
          prevAccount.version === snapshot.version;
        if (same) return; // keep ring animation running
        render();
        return;
      }
      if (open && catId !== "transcript" && catId !== "usage") {
        render();
      }
    }

    /** Host → type: "usage" while Settings → Usage is open (live or first paint) */
    function applyUsage(data) {
      if (!open || catId !== "usage") return;
      const bodyEl = opts.list.querySelector(".set-usage-body");
      const hasUi = bodyEl && bodyEl.querySelector(".usage-wrap");
      if (hasUi && data && data.live && W.usage && typeof W.usage.applyLive === "function") {
        W.usage.applyLive(data);
        return;
      }
      paintUsage(data || {});
    }

    function setTitle(t) {
      if (opts.titleEl) opts.titleEl.textContent = t || "Settings";
    }

    function render() {
      if (!open) return;
      if (catId) renderDetail(catId);
      else renderList();
    }

    function renderList() {
      stopUsageLive();
      setTitle("Settings");
      opts.list.innerHTML =
        '<div class="set-min">' +
        CATS.map(function (c) {
          return (
            '<button type="button" class="set-min-row" data-cat="' +
            c.id +
            '"><span>' +
            esc(c.label) +
            "</span><em>›</em></button>"
          );
        }).join("") +
        "</div>";
      opts.list.querySelectorAll("[data-cat]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          catId = btn.getAttribute("data-cat");
          render();
        });
      });
    }

    function renderDetail(id) {
      const cat = CATS.find(function (c) {
        return c.id === id;
      });
      if (!cat) {
        catId = null;
        renderList();
        return;
      }
      setTitle(cat.label);

      // Usage is async from host — live via log watch + Ably (no Refresh)
      if (id === "usage") {
        opts.list.innerHTML =
          (W.usage && W.usage.loadingHtml
            ? W.usage.loadingHtml()
            : '<div class="usage-loading">Loading usage…</div>');
        const r =
          W.usage && typeof W.usage.getRange === "function"
            ? W.usage.getRange()
            : "30d";
        startUsageLive(r);
        return;
      }

      // Any non-usage detail → stop live feed
      stopUsageLive();

      // Billing: re-sync plan from Stripe when opening Account
      if (id === "account") {
        opts.post({ type: "syncPlan" });
      }

      const s = snapshot;
      const mode = String(s.permissionMode || (s.alwaysApprove ? "yolo" : "ask"));
      let body = "";

      if (id === "permissions") {
        body += fieldSelect(
          "permissionMode",
          "Mode",
          "Ask prompts · Auto allows safe tools · YOLO skips prompts",
          mode,
          [
            { value: "ask", label: "Ask" },
            { value: "auto", label: "Auto" },
            { value: "yolo", label: "Yolo" },
          ]
        );
      } else if (id === "models") {
        body += fieldSelect(
          "defaultEffort",
          "Default effort",
          "Used when a model supports reasoning effort",
          String(s.defaultEffort || "high"),
          [
            { value: "low", label: "Low" },
            { value: "medium", label: "Medium" },
            { value: "high", label: "High" },
          ]
        );
      } else if (id === "safety") {
        body += fieldSelect(
          "sandboxProfile",
          "Sandbox",
          "Limits filesystem / network for agent tools",
          String(s.sandboxProfile || "off"),
          [
            { value: "off", label: "Off" },
            { value: "workspace", label: "Workspace" },
            { value: "read-only", label: "Read-only" },
            { value: "strict", label: "Strict" },
          ]
        );
      } else if (id === "transcript") {
        body += fieldToggle(
          "showThinking",
          "Show thinking",
          "Stream reasoning blocks in chat",
          s.showThinking !== false
        );
        body += fieldToggle(
          "groupToolRows",
          "Group tool rows",
          "Collapse noisy tool activity",
          s.groupToolRows !== false
        );
        body += fieldToggle(
          "scrollWithStream",
          "Scroll with stream",
          "Auto-scroll to bottom while Grok is generating",
          s.scrollWithStream !== false
        );
      } else if (id === "session") {
        const pct =
          typeof s.autoCompactPercent === "number"
            ? s.autoCompactPercent
            : 100;
        body += fieldSlider(
          "autoCompactPercent",
          "Auto-compact at",
          "0% = off · compress when context hits this %",
          pct,
          0,
          100
        );
      } else if (id === "extensions") {
        body += fieldAction(
          "openMcps",
          "MCP servers",
          "Runs /mcps in chat (Grok extensions · MCP tab)"
        );
        body += fieldAction(
          "openSkills",
          "Skills",
          "Runs /skills in chat (list + manage skills)"
        );
        body += fieldAction(
          "openPlugins",
          "Plugins",
          "Runs /plugins in chat (plugins + marketplace)"
        );
      } else if (id === "connection") {
        body += fieldText(
          "binaryPath",
          "Grok path",
          "Empty = auto-detect",
          String(s.binaryPath || ""),
          "Auto-detect"
        );
      } else if (id === "account") {
        // Outline soft containers (mockup 09) — no row dividers
        const isPro = !!(s.planPro || s.planKind === "pro");
        // Pro = green; expired = off-white (not red); trial = default text
        const planTone = isPro
          ? "ok"
          : s.planKind === "expired"
            ? "muted"
            : "";
        const planLabel = String(s.planLabel || "Free trial");
        const planDetail = String(
          s.planDetail ||
            (isPro
              ? "$5/mo · active · cancel anytime"
              : "7 days free · starts on first message · then $5/mo")
        );

        // Plan card: orange ring + dark fill only when trial/pro (not expired)
        // Expired = same plain outline card as Grok account
        const isExpired = s.planKind === "expired";
        const planCardClass = isExpired
          ? "set-card"
          : "set-card set-card-plan";
        let planInner =
          '<div class="set-k">Warp plan</div>' +
          '<div class="set-ro' +
          (planTone ? " " + planTone : "") +
          '">' +
          esc(planLabel) +
          "</div>" +
          '<div class="set-h">' +
          esc(planDetail) +
          "</div>";
        // Billing email only for Pro (paid) — free/trial/expired don't need it
        if (isPro && s.billingEmail) {
          planInner +=
            '<div class="set-meta-row"><span class="set-meta-k">Billing</span><span class="set-meta-v">' +
            esc(String(s.billingEmail)) +
            "</span></div>";
        }
        if (isPro) {
          planInner +=
            '<button type="button" class="set-btn set-btn-soft set-act" data-action="manageBilling">Manage billing</button>';
        } else {
          planInner +=
            '<button type="button" class="set-btn set-btn-soft set-act" data-action="subscribe">Upgrade to Pro</button>';
        }
        if (isExpired) {
          body += '<div class="' + planCardClass + '">' + planInner + "</div>";
        } else {
          body +=
            '<div class="' +
            planCardClass +
            '"><div class="set-card-plan-inner">' +
            planInner +
            "</div></div>";
        }

        // ── Grok card ──
        let grokCard =
          '<div class="set-card">' +
          '<div class="set-k">Grok account</div>' +
          '<div class="set-ro' +
          (s.signedIn ? " ok" : " bad") +
          '">' +
          (s.signedIn ? "Signed in" : "Not signed in") +
          "</div>";
        if (s.version) {
          grokCard +=
            '<div class="set-meta-row"><span class="set-meta-k">Warp</span><span class="set-meta-v">v' +
            esc(String(s.version)) +
            "</span></div>";
        }
        grokCard +=
          '<button type="button" class="set-btn set-btn-ghost set-act" data-action="' +
          (s.signedIn ? "signOut" : "signIn") +
          '">' +
          esc(s.signedIn ? "Sign out" : "Sign in with Grok") +
          "</button></div>";
        body += grokCard;
      }

      const bodyClass =
        id === "account" ? "set-tt-body set-tt-body-cards" : "set-tt-body";
      opts.list.innerHTML =
        '<div class="set-tt">' +
        '<div class="set-tt-band">' +
        "<h3>" +
        esc(cat.label) +
        "</h3>" +
        "<p>" +
        esc(cat.dek) +
        "</p>" +
        "</div>" +
        '<div class="' +
        bodyClass +
        '">' +
        body +
        "</div></div>";

      bindDetail();
    }

    function fieldText(key, label, hint, value, ph) {
      return (
        '<div class="set-tt-blk">' +
        '<div class="set-k">' +
        esc(label) +
        "</div>" +
        (hint ? '<div class="set-h">' + esc(hint) + "</div>" : "") +
        '<input type="text" class="set-tf" data-key="' +
        esc(key) +
        '" value="' +
        attr(value) +
        '" placeholder="' +
        attr(ph || "") +
        '" spellcheck="false" />' +
        '<button type="button" class="set-sv" data-key="' +
        esc(key) +
        '">Save</button>' +
        "</div>"
      );
    }

    function fieldToggle(key, label, hint, on) {
      return (
        '<div class="set-tt-blk">' +
        '<div class="set-k">' +
        esc(label) +
        "</div>" +
        (hint ? '<div class="set-h">' + esc(hint) + "</div>" : "") +
        '<button type="button" class="set-tg' +
        (on ? " on" : "") +
        '" data-key="' +
        esc(key) +
        '" data-on="' +
        (on ? "1" : "0") +
        '" role="switch" aria-checked="' +
        (on ? "true" : "false") +
        '"><b></b><span>' +
        (on ? "On" : "Off") +
        "</span></button></div>"
      );
    }

    function fieldSelect(key, label, hint, value, options) {
      const optsHtml = (options || [])
        .map(function (o) {
          const sel = String(o.value) === String(value) ? " selected" : "";
          return (
            '<option value="' +
            attr(o.value) +
            '"' +
            sel +
            ">" +
            esc(o.label) +
            "</option>"
          );
        })
        .join("");
      return (
        '<div class="set-tt-blk">' +
        '<div class="set-k">' +
        esc(label) +
        "</div>" +
        (hint ? '<div class="set-h">' + esc(hint) + "</div>" : "") +
        '<select class="set-sel" data-key="' +
        esc(key) +
        '">' +
        optsHtml +
        "</select>" +
        "</div>"
      );
    }

    function fieldSlider(key, label, hint, value, min, max) {
      const v = Math.min(max, Math.max(min, Math.round(Number(value) || 0)));
      const live =
        v <= 0 ? "Off" : String(v) + "%";
      return (
        '<div class="set-tt-blk">' +
        '<div class="set-k set-k-row">' +
        "<span>" +
        esc(label) +
        '</span><span class="set-slider-val" data-for="' +
        esc(key) +
        '">' +
        esc(live) +
        "</span></div>" +
        (hint ? '<div class="set-h">' + esc(hint) + "</div>" : "") +
        '<input type="range" class="set-slider" data-key="' +
        esc(key) +
        '" min="' +
        min +
        '" max="' +
        max +
        '" step="1" value="' +
        v +
        '" />' +
        '<div class="set-slider-ends"><span>0% off</span><span>100%</span></div>' +
        "</div>"
      );
    }

    function fieldRo(label, value, tone) {
      return (
        '<div class="set-tt-blk">' +
        '<div class="set-k">' +
        esc(label) +
        "</div>" +
        '<div class="set-ro' +
        (tone ? " " + tone : "") +
        '">' +
        esc(value) +
        "</div></div>"
      );
    }

    function fieldAction(key, label, hint, btnLabel) {
      return (
        '<div class="set-tt-blk">' +
        '<div class="set-k">' +
        esc(label) +
        "</div>" +
        (hint ? '<div class="set-h">' + esc(hint) + "</div>" : "") +
        '<button type="button" class="set-sv set-act" data-action="' +
        esc(key) +
        '">' +
        esc(btnLabel || "Open") +
        "</button>" +
        "</div>"
      );
    }

    function bindDetail() {
      opts.list.querySelectorAll(".set-sv[data-key]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          const key = btn.getAttribute("data-key");
          const input = opts.list.querySelector(
            'input.set-tf[data-key="' + key + '"]'
          );
          if (!key || !input) return;
          opts.post({ type: "updateSetting", key: key, value: input.value });
        });
      });
      opts.list.querySelectorAll("input.set-tf").forEach(function (input) {
        input.addEventListener("keydown", function (e) {
          if (e.key === "Enter") {
            e.preventDefault();
            opts.post({
              type: "updateSetting",
              key: input.getAttribute("data-key"),
              value: input.value,
            });
          }
        });
      });
      opts.list.querySelectorAll(".set-tg").forEach(function (btn) {
        btn.addEventListener("click", function (e) {
          e.preventDefault();
          e.stopPropagation();
          const key = btn.getAttribute("data-key");
          if (!key) return;
          const next = btn.getAttribute("data-on") !== "1";
          snapshot[key] = next;
          paintToggle(btn, next);
          persistLocalPrefs();
          applyTranscriptPrefs();
          notifyPrefs();
          toastToggle(key, next);
          // Persist best-effort — UI does not wait on host
          opts.post({ type: "updateSetting", key: key, value: next });
        });
      });
      opts.list.querySelectorAll("select.set-sel").forEach(function (sel) {
        sel.addEventListener("change", function () {
          const key = sel.getAttribute("data-key");
          let val = sel.value;
          if (key === "autoCompactPercent") {
            val = Number(val);
          }
          if (key) snapshot[key] = val;
          opts.post({ type: "updateSetting", key: key, value: val });
        });
      });
      opts.list.querySelectorAll("input.set-slider").forEach(function (range) {
        let debounce = null;
        function paintVal() {
          const key = range.getAttribute("data-key");
          const n = Number(range.value) || 0;
          const label = opts.list.querySelector(
            '.set-slider-val[data-for="' + key + '"]'
          );
          if (label) {
            label.textContent = n <= 0 ? "Off" : n + "%";
          }
          if (key) snapshot[key] = n;
        }
        range.addEventListener("input", function () {
          paintVal();
          // Live save while dragging (debounced)
          if (debounce) clearTimeout(debounce);
          debounce = setTimeout(function () {
            const key = range.getAttribute("data-key");
            const n = Number(range.value) || 0;
            opts.post({
              type: "updateSetting",
              key: key,
              value: n,
              toast: false,
            });
          }, 120);
        });
        range.addEventListener("change", function () {
          paintVal();
          if (debounce) clearTimeout(debounce);
          const key = range.getAttribute("data-key");
          const n = Number(range.value) || 0;
          opts.post({
            type: "updateSetting",
            key: key,
            value: n,
            toast: true,
          });
        });
      });
      opts.list.querySelectorAll(".set-act").forEach(function (btn) {
        btn.addEventListener("click", function (e) {
          e.preventDefault();
          e.stopPropagation();
          const action = btn.getAttribute("data-action");
          // Extensions: close panel and run real Grok slash in chat
          const slashMap = {
            openMcps: "/mcps",
            openSkills: "/skills",
            openPlugins: "/plugins",
          };
          if (action && slashMap[action]) {
            setOpen(false);
            if (typeof opts.onRunSlash === "function") {
              opts.onRunSlash(slashMap[action]);
            } else {
              opts.post({ type: "settingsAction", action: action });
            }
            return;
          }
          opts.post({ type: "settingsAction", action: action });
        });
      });
    }

    function paintToggle(btn, on) {
      btn.setAttribute("data-on", on ? "1" : "0");
      btn.classList.toggle("on", !!on);
      btn.setAttribute("aria-checked", on ? "true" : "false");
      const span = btn.querySelector("span");
      if (span) span.textContent = on ? "On" : "Off";
    }

    function paintUsage(data) {
      const cat = CATS.find(function (c) {
        return c.id === "usage";
      });
      const band =
        '<div class="set-tt">' +
        '<div class="set-tt-band">' +
        "<h3>" +
        esc(cat ? cat.label : "Usage") +
        "</h3>" +
        "<p>" +
        esc(cat ? cat.dek : "") +
        "</p>" +
        "</div>" +
        '<div class="set-tt-body set-usage-body"></div></div>';
      opts.list.innerHTML = band;
      const bodyEl = opts.list.querySelector(".set-usage-body");
      if (W.usage && typeof W.usage.renderInto === "function" && bodyEl) {
        W.usage.renderInto(bodyEl, data, {
          onRange: function (r) {
            // Live subscription already active — only change range
            opts.post({ type: "getUsage", range: r, rangeOnly: true });
          },
        });
      } else if (bodyEl) {
        bodyEl.innerHTML =
          '<div class="usage-empty">Usage module missing</div>';
      }
    }

    function notifyPrefs() {
      if (typeof opts.onPrefs === "function") {
        opts.onPrefs({
          showThinking: snapshot.showThinking !== false,
          groupToolRows: snapshot.groupToolRows !== false,
          scrollWithStream: snapshot.scrollWithStream !== false,
        });
      }
    }

    /** Bottom toast: "Show thinking enabled" / "… disabled" */
    function toastToggle(key, on) {
      const labels = {
        showThinking: "Show thinking",
        groupToolRows: "Group tool rows",
        scrollWithStream: "Scroll with stream",
      };
      const name = labels[key] || key;
      const text = on ? name + " enabled" : name + " disabled";
      if (typeof opts.toast === "function") {
        opts.toast(text);
      } else {
        opts.post({ type: "toast", text: text });
      }
    }

    function applyTranscriptPrefs() {
      if (!opts.root) return;
      opts.root.classList.toggle(
        "hide-thinking",
        snapshot.showThinking === false
      );
      opts.root.classList.toggle(
        "ungroup-tools",
        snapshot.groupToolRows === false
      );
      opts.root.classList.toggle(
        "no-stream-scroll",
        snapshot.scrollWithStream === false
      );
    }

    function persistLocalPrefs() {
      try {
        localStorage.setItem(
          "warp.uiPrefs",
          JSON.stringify({
            showThinking: snapshot.showThinking === true,
            groupToolRows: snapshot.groupToolRows === true,
            scrollWithStream: snapshot.scrollWithStream === true,
          })
        );
      } catch {
        /* ignore */
      }
    }

    function loadLocalPrefs() {
      try {
        const raw = localStorage.getItem("warp.uiPrefs");
        if (!raw) return;
        const pack = JSON.parse(raw);
        if (typeof pack.showThinking === "boolean") {
          snapshot.showThinking = pack.showThinking;
        }
        if (typeof pack.groupToolRows === "boolean") {
          snapshot.groupToolRows = pack.groupToolRows;
        }
        if (typeof pack.scrollWithStream === "boolean") {
          snapshot.scrollWithStream = pack.scrollWithStream;
        }
      } catch {
        /* ignore */
      }
    }

    function esc(s) {
      return String(s || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    }
    function attr(s) {
      return esc(s).replace(/"/g, "&quot;");
    }

    opts.btnOpen?.addEventListener("click", function () {
      setOpen(!open);
    });
    opts.btnBack?.addEventListener("click", function () {
      if (catId) {
        catId = null;
        render();
        return;
      }
      setOpen(false);
    });

    return {
      setOpen: setOpen,
      isOpen: isOpen,
      apply: apply,
      applyUsage: applyUsage,
    };
  }

  W.settings = { mount: mount };
})(typeof window !== "undefined" ? window : globalThis);
