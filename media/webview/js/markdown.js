/**
 * Warp.markdown — markdown → safe HTML for chat cards.
 * Depends on global `marked` (media/webview/lib/marked.umd.js).
 */
(function (global) {
  "use strict";

  const W = (global.Warp = global.Warp || {});

  /** @type {(msg: object) => void | null} */
  let hostPost = null;

  function setPost(fn) {
    hostPost = typeof fn === "function" ? fn : null;
  }

  if (typeof marked !== "undefined" && marked.setOptions) {
    marked.setOptions({ gfm: true, breaks: true });
  }

  function sanitize(html) {
    return String(html || "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
      .replace(/javascript:/gi, "");
  }

  /**
   * @param {string} text raw markdown
   * @returns {string} sanitized HTML
   */
  function toHtml(text) {
    if (!text) {
      return "";
    }
    try {
      if (typeof marked === "undefined") {
        return linkifyPaths(escapeHtml(text).replace(/\n/g, "<br>"));
      }
      const parse = marked.parse || marked;
      return linkifyPaths(sanitize(parse(text)));
    } catch {
      return linkifyPaths(escapeHtml(text).replace(/\n/g, "<br>"));
    }
  }

  /**
   * Turn bare file paths into clickable links (open in IDE via host).
   * Only rewrites text nodes (outside HTML tags) so we never corrupt
   * markup like </p> (old bug matched "/p" as a path).
   */
  function linkifyPaths(html) {
    // Absolute: C:\foo\bar.ts or /home/a/b.ts (2+ segments)
    // Relative: src/foo.ts or .\path\file.js (must end with extension)
    const pathRe =
      /(^|[\s([`"'])((?:[A-Za-z]:[\\/]|[\\/])(?:[\w.@+-]+[\\/]){1,}[\w.@+-]+(?:\.\w{1,12})?|(?:[\w.@+-]+[\\/])+[\w.@+-]+\.\w{1,12})/g;

    return String(html || "")
      .split(/(<[^>]+>)/g)
      .map((part) => {
        if (!part || part.charAt(0) === "<") {
          return part;
        }
        return part.replace(pathRe, (full, pre, p) => {
          if (/^https?:/i.test(p) || p.indexOf("://") >= 0) {
            return full;
          }
          // Ignore tiny / single-segment junk (e.g. /p from </p>)
          const segs = p.split(/[\\/]/).filter(Boolean);
          if (segs.length < 2 && !/\.\w{1,12}$/.test(p)) {
            return full;
          }
          if (segs.length === 1 && segs[0].length < 3) {
            return full;
          }
          const safe = escapeHtml(p);
          return (
            pre +
            '<a href="#" class="file-link" data-path="' +
            safe +
            '" title="Open in editor">' +
            safe +
            "</a>"
          );
        });
      })
      .join("");
  }

  /**
   * Wrap tables so overflow scrolls without breaking column alignment.
   * @param {HTMLElement} root
   */
  function wrapTables(root) {
    if (!root) {
      return;
    }
    root.querySelectorAll("table").forEach((table) => {
      if (
        table.parentElement &&
        table.parentElement.classList.contains("md-table-wrap")
      ) {
        return;
      }
      const wrap = document.createElement("div");
      wrap.className = "md-table-wrap";
      table.parentNode.insertBefore(wrap, table);
      wrap.appendChild(table);
    });
  }

  /**
   * Wire file-link clicks to open in the IDE (host openFile message).
   * @param {HTMLElement} root
   * @param {(msg: object) => void} [post]
   */
  function wireFileLinks(root, post) {
    if (!root || typeof post !== "function") return;
    root.querySelectorAll("a.file-link[data-path]").forEach((a) => {
      if (a.dataset.wired === "1") return;
      a.dataset.wired = "1";
      a.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const p = a.getAttribute("data-path") || "";
        if (p) post({ type: "openFile", path: p });
      });
    });
    // Also markdown links that look like file paths
    root.querySelectorAll("a[href]").forEach((a) => {
      if (a.dataset.wired === "1") return;
      const href = a.getAttribute("href") || "";
      if (/^https?:/i.test(href) || href.startsWith("#") || href.startsWith("mailto:")) {
        return;
      }
      // file:// or relative path
      if (
        href.startsWith("file:") ||
        /^[A-Za-z]:[\\/]/.test(href) ||
        href.startsWith("./") ||
        href.startsWith("../") ||
        href.startsWith("/") ||
        /\.\w{1,12}$/.test(href)
      ) {
        a.dataset.wired = "1";
        a.classList.add("file-link");
        a.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          const p = href.replace(/^file:\/\//, "");
          post({ type: "openFile", path: p });
        });
      }
    });
  }

  /**
   * @param {HTMLElement} el
   * @param {string} text
   * @param {(msg: object) => void} [post]
   */
  function renderInto(el, text, post) {
    if (!el) {
      return;
    }
    el.innerHTML = toHtml(text);
    wrapTables(el);
    wireFileLinks(el, post || hostPost);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  W.markdown = {
    toHtml,
    renderInto,
    wrapTables,
    wireFileLinks,
    linkifyPaths,
    setPost,
    escapeHtml,
    sanitize,
  };
})(typeof window !== "undefined" ? window : globalThis);
