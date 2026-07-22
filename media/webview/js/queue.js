/**
 * Warp.queue — local prompt queue (compact numbered list).
 * Mid-turn messages enqueue and drain when the active turn ends.
 */
(function (global) {
  "use strict";

  const W = (global.Warp = global.Warp || {});

  /**
   * @param {{
   *   root: HTMLElement,
   *   onChange?: (n: number) => void,
   * }} opts
   */
  function mount(opts) {
    /** @type {Array<{
     *   id: string,
     *   text: string,
     *   attachments: Array,
     *   mentions: string[],
     *   chipMeta: Array,
     * }>} */
    let items = [];
    let uid = 0;

    function count() {
      return items.length;
    }

    function list() {
      return items.slice();
    }

    function clear() {
      items = [];
      render();
    }

    /**
     * @param {{
     *   text: string,
     *   attachments?: Array,
     *   mentions?: string[],
     *   chipMeta?: Array,
     * }} entry
     */
    function enqueue(entry) {
      items.push({
        id: "q" + ++uid,
        text: entry.text || "",
        attachments: entry.attachments || [],
        mentions: entry.mentions || [],
        chipMeta: entry.chipMeta || [],
      });
      render();
      return items[items.length - 1];
    }

    function dequeue() {
      if (!items.length) {
        return null;
      }
      const next = items.shift();
      render();
      return next;
    }

    function remove(id) {
      const i = items.findIndex((x) => x.id === id);
      if (i < 0) {
        return;
      }
      items.splice(i, 1);
      render();
    }

    function peek() {
      return items[0] || null;
    }

    function render() {
      const root = opts.root;
      if (!root) {
        return;
      }
      if (!items.length) {
        root.hidden = true;
        root.innerHTML = "";
        if (opts.onChange) {
          opts.onChange(0);
        }
        return;
      }
      root.hidden = false;
      root.innerHTML =
        '<div class="pq-hd">Queued <span class="count">' +
        items.length +
        "</span></div>" +
        items
          .map(
            (it, idx) =>
              '<div class="pq-item" data-id="' +
              it.id +
              '">' +
              '<span class="pq-num">' +
              (idx + 1) +
              "</span>" +
              '<span class="pq-txt" title="' +
              escapeAttr(preview(it)) +
              '">' +
              escapeHtml(preview(it)) +
              "</span>" +
              '<button type="button" class="pq-cancel" data-cancel="' +
              it.id +
              '">cancel</button>' +
              "</div>"
          )
          .join("");

      root.querySelectorAll("[data-cancel]").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          remove(btn.getAttribute("data-cancel"));
        });
      });

      if (opts.onChange) {
        opts.onChange(items.length);
      }
    }

    function preview(it) {
      const t = (it.text || "").trim();
      if (t) {
        return t;
      }
      const n = (it.attachments && it.attachments.length) || 0;
      if (n) {
        return n + " attachment" + (n === 1 ? "" : "s");
      }
      return "(empty)";
    }

    function escapeHtml(s) {
      return String(s || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    }

    function escapeAttr(s) {
      return escapeHtml(s).replace(/"/g, "&quot;");
    }

    return {
      enqueue,
      dequeue,
      remove,
      clear,
      count,
      list,
      peek,
      render,
    };
  }

  W.queue = { mount };
})(typeof window !== "undefined" ? window : globalThis);
