/**
 * Warp.mention — @ workspace file picker.
 */
(function (global) {
  "use strict";

  const W = (global.Warp = global.Warp || {});

  /**
   * @param {{
   *   input: HTMLTextAreaElement,
   *   post: (msg: object) => void,
   *   onPick?: (file: {path:string,name:string}) => void,
   * }} opts
   */
  function mount(opts) {
    const pop = document.createElement("div");
    pop.className = "mention-pop hidden";
    pop.setAttribute("role", "listbox");
    // Insert near composer
    const slot = document.querySelector(".composer-slot") || document.body;
    slot.style.position = slot.style.position || "relative";
    slot.appendChild(pop);

    /** @type {Array<{path:string,name:string,dir?:string}>} */
    let files = [];
    let open = false;
    let active = 0;
    let query = "";
    let atStart = -1;

    function setOpen(v) {
      open = v;
      pop.classList.toggle("hidden", !v);
      if (!v) {
        atStart = -1;
        query = "";
      }
    }

    function request(q) {
      opts.post({ type: "listFiles", query: q || "" });
    }

    function render() {
      if (!open) {
        return;
      }
      if (!files.length) {
        pop.innerHTML =
          '<div class="mention-empty">No matching files</div>';
        return;
      }
      // Compact rows: full path + ext (variant 02) — no dual name/path lines
      pop.innerHTML = files
        .map((f, i) => {
          const path = f.path || f.name || "";
          const ext = extOf(path);
          return (
            '<button type="button" class="mention-item compact' +
            (i === active ? " on" : "") +
            '" data-i="' +
            i +
            '" role="option" title="' +
            escapeHtml(path) +
            '">' +
            '<span class="mn">' +
            escapeHtml(path) +
            "</span>" +
            (ext
              ? '<span class="ext">' + escapeHtml(ext) + "</span>"
              : "") +
            "</button>"
          );
        })
        .join("");
      pop.querySelectorAll(".mention-item").forEach((btn) => {
        btn.addEventListener("mousedown", (e) => {
          e.preventDefault();
          const i = Number(btn.getAttribute("data-i"));
          pick(i);
        });
      });
      // Keep keyboard selection in view (scroll without showing a bar)
      const on = pop.querySelector(".mention-item.on");
      if (on && typeof on.scrollIntoView === "function") {
        on.scrollIntoView({ block: "nearest" });
      }
    }

    function extOf(path) {
      const base = String(path || "").split(/[/\\]/).pop() || "";
      const i = base.lastIndexOf(".");
      if (i <= 0 || i === base.length - 1) {
        return "";
      }
      return base.slice(i + 1).toLowerCase();
    }

    function pick(i) {
      const f = files[i];
      if (!f) {
        return;
      }
      const ta = opts.input;
      const val = ta.value;
      const caret = ta.selectionStart ?? val.length;
      let start = atStart;
      if (start < 0) {
        // find last @ before caret
        start = val.lastIndexOf("@", caret - 1);
      }
      if (start < 0) {
        start = caret;
      }
      const before = val.slice(0, start);
      const after = val.slice(caret);
      const insert = "@" + f.path + " ";
      ta.value = before + insert + after;
      const pos = (before + insert).length;
      ta.setSelectionRange(pos, pos);
      ta.focus();
      setOpen(false);
      if (opts.onPick) {
        opts.onPick(f);
      }
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    }

    function onFiles(list) {
      files = Array.isArray(list) ? list : [];
      active = 0;
      if (open) {
        render();
      }
    }

    function openPicker(seed) {
      query = seed || "";
      // If not already on @, insert @
      const ta = opts.input;
      const caret = ta.selectionStart ?? ta.value.length;
      const ch = caret > 0 ? ta.value[caret - 1] : "";
      if (ch !== "@") {
        const before = ta.value.slice(0, caret);
        const after = ta.value.slice(caret);
        ta.value = before + "@" + after;
        ta.setSelectionRange(caret + 1, caret + 1);
        atStart = caret;
      } else {
        atStart = caret - 1;
      }
      setOpen(true);
      request(query);
      render();
      ta.focus();
      // Fire input so composer highlight mirror redraws (textarea text is transparent)
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    }

    function onInput() {
      const ta = opts.input;
      const caret = ta.selectionStart ?? 0;
      const val = ta.value;
      const before = val.slice(0, caret);
      const m = before.match(/(^|[\s])@([^\s@]*)$/);
      if (!m) {
        if (open) {
          setOpen(false);
        }
        return;
      }
      atStart = before.length - m[2].length - 1;
      query = m[2] || "";
      setOpen(true);
      request(query);
    }

    function onKeydown(e) {
      if (!open) {
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        active = Math.min(files.length - 1, active + 1);
        render();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        active = Math.max(0, active - 1);
        render();
      } else if (e.key === "Enter" || e.key === "Tab") {
        if (files[active]) {
          e.preventDefault();
          pick(active);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
    }

    opts.input.addEventListener("input", onInput);
    opts.input.addEventListener("keydown", onKeydown);

    return {
      openPicker,
      onFiles,
      close: () => setOpen(false),
      isOpen: () => open,
    };
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  W.mention = { mount };
})(typeof window !== "undefined" ? window : globalThis);
