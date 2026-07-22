/**
 * Warp.usage — Settings → Usage drill-in (Commerce "Revenue twin" style).
 * Orange ECharts bars · timescale tabs top-right · sliding pill.
 */
(function (global) {
  "use strict";

  const W = (global.Warp = global.Warp || {});

  const RANGES = ["7d", "30d", "90d", "12m", "all"];
  const LABELS = { "7d": "7D", "30d": "30D", "90d": "90D", "12m": "12M", all: "All" };

  const SESS_PAGE_SIZE = 20;

  /** @type {any} */
  let chart = null;
  /** @type {string} */
  let activeRange = "30d";
  /** @type {object|null} */
  let lastData = null;
  /** @type {HTMLElement|null} */
  let hostEl = null;
  /** @type {{ onRefresh?: () => void, onRange?: (r: string) => void }|null} */
  let hooks = null;
  /** 0-based page index for sessions table */
  let sessPage = 0;

  function loadingHtml() {
    return '<div class="usage-loading">Loading usage…</div>';
  }

  /**
   * @param {HTMLElement} el
   * @param {object} data
   * @param {{ onRefresh?: () => void, onRange?: (r: string) => void }} [h]
   */
  function renderInto(el, data, h) {
    hostEl = el;
    hooks = h || null;
    lastData = data && typeof data === "object" ? data : {};
    if (lastData.series && lastData.series.range) {
      activeRange = String(lastData.series.range);
    }
    sessPage = 0;
    paint();
  }

  function paint() {
    if (!hostEl) return;
    disposeChart();
    const data = lastData || {};
    const t = data.totals || {};
    const series = data.series || { labels: [], values: [], range: activeRange };

    let html = "";
    html += '<div class="usage-wrap set-usage">';

    // Commerce layout: label left · tabs right · chart
    html += '<div class="fc-dash-chart-section">';
    html += '<div class="fc-dash-chart-header">';
    html += '<div><span class="fc-section-label">Tokens</span></div>';
    html += timescaleTabsHtml(activeRange);
    html += "</div>";
    html +=
      '<div class="fc-dash-chart-wrap"><div class="chart-el" id="usage-chart"></div></div>';
    html += "</div>";

    // Single bar + % (Grok billing log)
    const cr = data.credits;
    if (cr && typeof cr.creditUsagePercent === "number") {
      const pct = Math.min(
        100,
        Math.max(0, Math.round(Number(cr.creditUsagePercent) || 0))
      );
      const tone = pct >= 90 ? " hot" : pct >= 75 ? " warn" : "";
      html += '<div class="cr">';
      html +=
        '<div class="cr-hd"><span class="cr-k">Credits</span><span class="cr-v">' +
        pct +
        '% <em>used</em></span></div>';
      html +=
        '<div class="cr-track"><div class="cr-fill' +
        tone +
        '" style="width:' +
        pct +
        '%"></div></div>';
      const meta = creditMeta(cr);
      if (meta) {
        html += '<div class="cr-meta">' + esc(meta) + "</div>";
      }
      html += "</div>";
    }

    html += '<div class="usage-stats">';
    html += stat("Tokens", t.tokens ? fmt(t.tokens) : "—");
    html += stat("Turns", t.inferenceTurns ? fmt(t.inferenceTurns) : "—");
    html += stat("Sessions", fmt(t.sessions || 0));
    html += stat("Messages", fmt(t.messages || 0));
    html += "</div>";

    // Dense session table (V6) — reuses section label + stat-k/v tones
    html += sessionsTableHtml(data.sessions || []);

    html +=
      '<button type="button" class="set-sv usage-refresh" data-action="refreshUsage">Refresh</button>';
    html += "</div>";

    hostEl.innerHTML = html;
    wireUi();
    requestAnimationFrame(function () {
      positionPill();
      mountChart(series.labels || [], series.values || []);
    });
  }

  function timescaleTabsHtml(active) {
    const btns = RANGES.map(function (r) {
      return (
        '<button type="button" class="commerce-ts-tab' +
        (r === active ? " active" : "") +
        '" data-range="' +
        r +
        '">' +
        LABELS[r] +
        "</button>"
      );
    }).join("");
    return (
      '<div class="commerce-ts-tabs" id="usage-ts-tabs">' +
      '<div class="commerce-ts-pill" id="usage-ts-pill"></div>' +
      btns +
      "</div>"
    );
  }

  function wireUi() {
    if (!hostEl) return;
    const refresh = hostEl.querySelector("[data-action=refreshUsage]");
    if (refresh) {
      refresh.addEventListener("click", function (e) {
        e.preventDefault();
        if (hooks && typeof hooks.onRefresh === "function") {
          hooks.onRefresh();
        }
      });
    }
    wireSessPager();
    const container = hostEl.querySelector("#usage-ts-tabs");
    if (!container) return;
    container.querySelectorAll(".commerce-ts-tab").forEach(function (tab) {
      tab.addEventListener("click", function () {
        const r = tab.getAttribute("data-range");
        if (!r || r === activeRange) return;
        activeRange = r;
        container.querySelectorAll(".commerce-ts-tab").forEach(function (t) {
          t.classList.remove("active");
        });
        tab.classList.add("active");
        positionPill();
        if (hooks && typeof hooks.onRange === "function") {
          hooks.onRange(r);
        }
      });
    });
  }

  function wireSessPager() {
    if (!hostEl) return;
    hostEl.querySelectorAll("[data-sess-page]").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        const p = Number(btn.getAttribute("data-sess-page"));
        if (!Number.isFinite(p) || p < 0 || p === sessPage) return;
        sessPage = p;
        repaintSessionsOnly();
      });
    });
  }

  /** Update sessions table without remounting the chart. */
  function repaintSessionsOnly() {
    if (!hostEl) return;
    const wrap = hostEl.querySelector(".usage-sess");
    if (!wrap) {
      paint();
      return;
    }
    const tmp = document.createElement("div");
    tmp.innerHTML = sessionsTableHtml((lastData && lastData.sessions) || []);
    const next = tmp.firstElementChild;
    if (!next) return;
    wrap.replaceWith(next);
    wireSessPager();
  }

  function positionPill() {
    if (!hostEl) return;
    const container = hostEl.querySelector("#usage-ts-tabs");
    const pill = hostEl.querySelector("#usage-ts-pill");
    if (!container || !pill) return;
    const activeTab = container.querySelector(".commerce-ts-tab.active");
    if (!activeTab) return;
    const barRect = container.getBoundingClientRect();
    const btnRect = activeTab.getBoundingClientRect();
    pill.style.width = btnRect.width + "px";
    pill.style.left = btnRect.left - barRect.left + "px";
  }

  function disposeChart() {
    if (chart) {
      try {
        chart.dispose();
      } catch (e) {
        /* ignore */
      }
      chart = null;
    }
  }

  function mountChart(labels, values) {
    disposeChart();
    const el = hostEl && hostEl.querySelector("#usage-chart");
    if (!el) return;
    const echarts = global.echarts;
    if (!echarts || typeof echarts.init !== "function") {
      el.innerHTML =
        '<div class="usage-empty" style="padding:40px 12px">Chart library missing</div>';
      return;
    }
    chart = echarts.init(el, null, { renderer: "canvas" });
    chart.setOption(barOption(labels, values));
  }

  function barOption(labels, values) {
    const labs = labels && labels.length ? labels : ["—"];
    const vals = values && values.length ? values : [0];
    return {
      backgroundColor: "transparent",
      animation: true,
      animationDuration: 500,
      animationEasing: "cubicOut",
      tooltip: {
        trigger: "axis",
        backgroundColor: "#1c1c1c",
        borderColor: "#3a3a3a",
        extraCssText: "opacity:1;",
        textStyle: {
          color: "#e8e8e8",
          fontSize: 12,
          fontFamily: "Segoe UI, system-ui, sans-serif",
        },
        formatter: function (params) {
          const p = params[0];
          const n = Number(p.value || 0);
          return (
            '<span style="color:#c8c8c8">' +
            p.name +
            "</span><br/>" +
            '<span style="font-weight:600;font-size:14px;color:#ff5a00">' +
            n.toLocaleString() +
            '</span><span style="color:#c8c8c8"> tokens</span>'
          );
        },
      },
      grid: {
        left: 40,
        right: 10,
        top: 12,
        bottom: 26,
        containLabel: false,
      },
      xAxis: {
        type: "category",
        data: labs,
        axisLine: { show: true, lineStyle: { color: "#3a3a3a" } },
        axisTick: { show: false },
        axisLabel: {
          color: "#b0b0b0",
          fontSize: 11,
          fontFamily: "Segoe UI, system-ui, sans-serif",
          interval: Math.max(Math.floor(labs.length / 6) - 1, 0),
        },
      },
      yAxis: {
        type: "value",
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: "#2a2a2a" } },
        axisLabel: {
          color: "#b0b0b0",
          fontSize: 11,
          fontFamily: "Segoe UI, system-ui, sans-serif",
          formatter: function (v) {
            if (v >= 1_000_000)
              return (v / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
            if (v >= 1000)
              return (v / 1000).toFixed(v >= 10_000 ? 0 : 1).replace(/\.0$/, "") + "k";
            return String(v);
          },
        },
      },
      series: [
        {
          type: "bar",
          data: vals,
          barMaxWidth: 28,
          barMinWidth: 3,
          itemStyle: {
            color: "#ff5a00",
            borderRadius: [3, 3, 0, 0],
            opacity: 0.92,
          },
          emphasis: {
            itemStyle: { color: "#ff7a33", opacity: 1 },
          },
        },
      ],
    };
  }

  /**
   * e.g. "36% left this week · Resets on 24 Jul"
   */
  function creditMeta(cr) {
    const pct = Math.min(
      100,
      Math.max(0, Math.round(Number(cr.creditUsagePercent) || 0))
    );
    const left = Math.max(0, 100 - pct);
    const window = periodWindow(cr.periodType);
    const reset = formatDayMonth(parseUtc(cr.periodEnd));
    let s = left + "% left" + (window ? " " + window : "");
    if (reset) s += " · Resets on " + reset;
    return s;
  }

  function periodWindow(type) {
    const t = String(type || "").toUpperCase();
    if (t.indexOf("WEEK") >= 0) return "this week";
    if (t.indexOf("MONTH") >= 0) return "this month";
    if (t.indexOf("DAY") >= 0) return "today";
    if (t.indexOf("YEAR") >= 0) return "this year";
    return "";
  }

  function parseUtc(iso) {
    if (!iso) return null;
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime())) return d;
    const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return null;
  }

  function formatDayMonth(d) {
    if (!d) return "";
    const months = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    return d.getUTCDate() + " " + months[d.getUTCMonth()];
  }

  function stat(label, value) {
    return (
      '<div class="usage-stat"><div class="usage-stat-v">' +
      esc(value) +
      '</div><div class="usage-stat-k">' +
      esc(label) +
      "</div></div>"
    );
  }

  /**
   * Dense table: Session · Tokens · Turns · When (20 / page + centered numbers).
   * @param {Array<{title?:string,tokens?:number,turns?:number,when?:string}>} rows
   */
  function sessionsTableHtml(rows) {
    const list = Array.isArray(rows) ? rows : [];
    let html = '<div class="usage-sess">';
    html += '<div class="fc-section-label usage-sess-label">Sessions</div>';
    if (!list.length) {
      html +=
        '<div class="usage-empty" style="padding:16px 0">No sessions yet</div>';
      html += "</div>";
      return html;
    }

    const pageCount = Math.max(1, Math.ceil(list.length / SESS_PAGE_SIZE));
    if (sessPage >= pageCount) sessPage = pageCount - 1;
    if (sessPage < 0) sessPage = 0;
    const start = sessPage * SESS_PAGE_SIZE;
    const slice = list.slice(start, start + SESS_PAGE_SIZE);

    html += '<div class="usage-sess-head">';
    html += '<span class="usage-stat-k">Session</span>';
    html += '<span class="usage-stat-k">Tokens</span>';
    html += '<span class="usage-stat-k">Turns</span>';
    html += '<span class="usage-stat-k">When</span>';
    html += "</div>";
    for (let i = 0; i < slice.length; i++) {
      const r = slice[i];
      const tok = Number(r.tokens) || 0;
      const turns = Number(r.turns) || 0;
      html += '<div class="usage-sess-row">';
      html +=
        '<span class="usage-sess-t" title="' +
        esc(r.title || "") +
        '">' +
        esc(r.title || "—") +
        "</span>";
      html +=
        '<span class="usage-sess-tok">' +
        (tok ? esc(fmt(tok)) : "—") +
        "</span>";
      html +=
        '<span class="usage-sess-num">' +
        (turns ? esc(fmt(turns)) : "—") +
        "</span>";
      html +=
        '<span class="usage-sess-num">' + esc(r.when || "—") + "</span>";
      html += "</div>";
    }
    if (pageCount > 1) {
      html += sessPagerHtml(pageCount, sessPage);
    }
    html += "</div>";
    return html;
  }

  /**
   * Centered page numbers. Windowed when many pages.
   * @param {number} pageCount
   * @param {number} page 0-based
   */
  function sessPagerHtml(pageCount, page) {
    const pages = pageNumbersToShow(pageCount, page);
    let html = '<div class="usage-sess-pager" role="navigation" aria-label="Sessions pages">';
    for (let i = 0; i < pages.length; i++) {
      const p = pages[i];
      if (p === "…") {
        html += '<span class="usage-sess-pg-gap" aria-hidden="true">…</span>';
        continue;
      }
      const n = /** @type {number} */ (p);
      const on = n === page ? " on" : "";
      html +=
        '<button type="button" class="usage-sess-pg' +
        on +
        '" data-sess-page="' +
        n +
        '" aria-label="Page ' +
        (n + 1) +
        '"' +
        (on ? ' aria-current="page"' : "") +
        ">" +
        (n + 1) +
        "</button>";
    }
    html += "</div>";
    return html;
  }

  /**
   * @param {number} pageCount
   * @param {number} page 0-based
   * @returns {Array<number|"…">}
   */
  function pageNumbersToShow(pageCount, page) {
    if (pageCount <= 7) {
      const all = [];
      for (let i = 0; i < pageCount; i++) all.push(i);
      return all;
    }
    /** @type {Array<number|"…">} */
    const out = [];
    const add = function (n) {
      if (out.length && out[out.length - 1] === n) return;
      out.push(n);
    };
    add(0);
    const lo = Math.max(1, page - 1);
    const hi = Math.min(pageCount - 2, page + 1);
    if (lo > 1) add("…");
    for (let i = lo; i <= hi; i++) add(i);
    if (hi < pageCount - 2) add("…");
    add(pageCount - 1);
    return out;
  }

  function fmt(n) {
    const x = Number(n) || 0;
    if (x >= 1_000_000)
      return (x / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
    if (x >= 10_000) return Math.round(x / 1000) + "k";
    if (x >= 1000) return (x / 1000).toFixed(1).replace(/\.0$/, "") + "k";
    return String(x);
  }

  function esc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  // Resize chart when settings panel resizes
  if (typeof ResizeObserver !== "undefined") {
    try {
      const ro = new ResizeObserver(function () {
        if (chart) {
          try {
            chart.resize();
            positionPill();
          } catch (e) {
            /* ignore */
          }
        }
      });
      // observe after first paint via interval attach
      setInterval(function () {
        if (hostEl && hostEl.isConnected && !hostEl._usageRo) {
          hostEl._usageRo = true;
          ro.observe(hostEl);
        }
      }, 800);
    } catch (e) {
      /* ignore */
    }
  }

  W.usage = {
    renderInto: renderInto,
    loadingHtml: loadingHtml,
    dispose: disposeChart,
    getRange: function () {
      return activeRange;
    },
  };
})(typeof window !== "undefined" ? window : globalThis);
