/**
 * Warp.attach — pending image/file tray (filmstrip + doc squares).
 * Matches grokfork_composer_variants #04: 84×84 tiles, float × remove.
 */
(function (global) {
  "use strict";

  const W = (global.Warp = global.Warp || {});

  const MAX_IMAGE_BYTES = 12 * 1024 * 1024; // 12 MB
  const MAX_FILE_BYTES = 4 * 1024 * 1024; // 4 MB for non-image payload to agent
  const MAX_ITEMS = 12;

  /**
   * @param {{
   *   tray: HTMLElement,
   *   inputImage: HTMLInputElement,
   *   inputAny: HTMLInputElement,
   *   viewer?: HTMLElement|null,
   *   onChange?: () => void,
   * }} opts
   */
  function mount(opts) {
    /** @type {Array<{
     *   id: string,
     *   name: string,
     *   mime: string,
     *   size: number,
     *   isImage: boolean,
     *   previewUrl?: string,
     *   dataBase64?: string,
     *   text?: string,
     * }>} */
    let items = [];
    let uid = 0;

    function extOf(name) {
      const i = name.lastIndexOf(".");
      if (i < 0) {
        return "file";
      }
      return name.slice(i + 1).toLowerCase() || "file";
    }

    function fmtSize(n) {
      if (n < 1024) {
        return n + " B";
      }
      if (n < 1024 * 1024) {
        return (n / 1024).toFixed(1) + " KB";
      }
      return (n / (1024 * 1024)).toFixed(1) + " MB";
    }

    function render() {
      const tray = opts.tray;
      if (!tray) {
        return;
      }
      tray.innerHTML = "";
      if (!items.length) {
        return;
      }

      const images = items.filter((a) => a.isImage);
      const docs = items.filter((a) => !a.isImage);

      if (images.length) {
        const film = document.createElement("div");
        film.className = "film";
        for (const a of images) {
          const tile = document.createElement("div");
          tile.className = "film-tile";
          tile.title = a.name + " · " + fmtSize(a.size);
          tile.dataset.id = a.id;
          const img = document.createElement("img");
          img.alt = a.name;
          img.src = a.previewUrl || "";
          tile.appendChild(img);
          tile.appendChild(rmBtn(a.id));
          tile.addEventListener("click", (e) => {
            if (e.target.closest(".rm")) {
              return;
            }
            openViewer(a.previewUrl, a.name);
          });
          film.appendChild(tile);
        }
        tray.appendChild(film);
      }

      if (docs.length) {
        const docsEl = document.createElement("div");
        docsEl.className = "docs";
        for (const a of docs) {
          const sq = document.createElement("div");
          sq.className = "file-sq";
          sq.title = a.name + " · " + fmtSize(a.size);
          sq.dataset.id = a.id;
          sq.innerHTML =
            '<div class="stack">' +
            '<span class="ext"></span>' +
            '<span class="name"></span>' +
            "</div>";
          sq.querySelector(".ext").textContent = extOf(a.name);
          sq.querySelector(".name").textContent = a.name;
          sq.appendChild(rmBtn(a.id));
          docsEl.appendChild(sq);
        }
        tray.appendChild(docsEl);
      }

      if (opts.onChange) {
        opts.onChange();
      }
    }

    function rmBtn(id) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "rm";
      b.setAttribute("aria-label", "Remove");
      b.textContent = "×";
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        remove(id);
      });
      return b;
    }

    function openViewer(url, name) {
      const v = opts.viewer;
      if (!v || !url) {
        return;
      }
      const img = v.querySelector("[data-viewer-img]");
      const nm = v.querySelector("[data-viewer-name]");
      if (img) {
        img.src = url;
        img.alt = name || "";
      }
      if (nm) {
        nm.textContent = name || "image";
      }
      v.classList.add("open");
      v.hidden = false;
    }

    function closeViewer() {
      const v = opts.viewer;
      if (!v) {
        return;
      }
      v.classList.remove("open");
      v.hidden = true;
      const img = v.querySelector("[data-viewer-img]");
      if (img) {
        img.removeAttribute("src");
      }
    }

    function remove(id) {
      const i = items.findIndex((a) => a.id === id);
      if (i < 0) {
        return;
      }
      const [gone] = items.splice(i, 1);
      if (gone.previewUrl) {
        try {
          URL.revokeObjectURL(gone.previewUrl);
        } catch {
          /* ignore */
        }
      }
      render();
    }

    function clear() {
      for (const a of items) {
        if (a.previewUrl) {
          try {
            URL.revokeObjectURL(a.previewUrl);
          } catch {
            /* ignore */
          }
        }
      }
      items = [];
      render();
      closeViewer();
    }

    /**
     * @param {FileList|File[]} fileList
     * @param {boolean} imageOnly
     * @returns {Promise<string|null>} error message if any
     */
    async function addFiles(fileList, imageOnly) {
      const files = Array.from(fileList || []);
      if (!files.length) {
        return null;
      }
      let err = null;
      for (const file of files) {
        if (items.length >= MAX_ITEMS) {
          err = "Max " + MAX_ITEMS + " attachments";
          break;
        }
        // Explorer drops may omit name/type; recover from Electron .path
        const epath = String(/** @type {any} */ (file).path || "");
        let name = file.name || "";
        if (!name && epath) {
          name = epath.split(/[/\\]/).pop() || "file";
        }
        if (!name) name = "file";

        const isImage =
          (file.type || "").startsWith("image/") ||
          /\.(png|jpe?g|gif|webp|bmp|svg|ico|avif|heic)$/i.test(name);
        if (imageOnly && !isImage) {
          continue;
        }
        // size 0 can still be readable via FileReader or host path — don't skip yet
        if (file.size > 0 && isImage && file.size > MAX_IMAGE_BYTES) {
          err = name + " is too large (max 12 MB images)";
          continue;
        }
        if (file.size > 0 && !isImage && file.size > MAX_FILE_BYTES) {
          err = name + " is too large (max 4 MB files)";
          continue;
        }

        const id = "a" + ++uid;
        const base = {
          id,
          name,
          mime:
            file.type ||
            (isImage ? "image/png" : "application/octet-stream"),
          size: file.size || 0,
          isImage,
        };

        try {
          if (isImage) {
            const dataUrl = await readAsDataURL(file);
            if (!dataUrl || dataUrl.length < 32) {
              throw new Error("empty image data");
            }
            const dataBase64 = dataUrl.replace(/^data:[^;]+;base64,/, "");
            let previewUrl = "";
            try {
              previewUrl = URL.createObjectURL(file);
            } catch {
              previewUrl = dataUrl;
            }
            items.push({
              ...base,
              size: base.size || Math.floor((dataBase64.length * 3) / 4),
              previewUrl,
              dataBase64,
            });
          } else if (isProbablyText(file) || isProbablyText({ name, type: file.type })) {
            const text = await readAsText(file);
            items.push({
              ...base,
              size: base.size || text.length,
              text,
            });
          } else {
            const dataUrl = await readAsDataURL(file);
            if (!dataUrl || dataUrl.length < 32) {
              throw new Error("empty file data");
            }
            const dataBase64 = dataUrl.replace(/^data:[^;]+;base64,/, "");
            items.push({
              ...base,
              size: base.size || Math.floor((dataBase64.length * 3) / 4),
              dataBase64,
            });
          }
        } catch (e) {
          err = "Failed to read " + name;
        }
      }
      render();
      return err;
    }

    function isProbablyText(file) {
      const t = String((file && file.type) || "").toLowerCase();
      const name = String((file && file.name) || "");
      if (t.startsWith("text/")) {
        return true;
      }
      if (
        /json|xml|javascript|typescript|csv|yaml|yml|markdown|svg/.test(t)
      ) {
        return true;
      }
      return /\.(txt|md|json|js|ts|tsx|jsx|css|html|xml|yml|yaml|csv|rs|py|go|java|c|cpp|h|hpp|toml|ini|log|sh|ps1|env)$/i.test(
        name
      );
    }

    function readAsDataURL(file) {
      return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result || ""));
        r.onerror = () => reject(r.error || new Error("read failed"));
        r.readAsDataURL(file);
      });
    }

    function readAsText(file) {
      return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result || ""));
        r.onerror = () => reject(r.error || new Error("read failed"));
        r.readAsText(file);
      });
    }

    function pickImage() {
      if (!opts.inputImage) {
        return;
      }
      opts.inputImage.value = "";
      opts.inputImage.click();
    }

    function pickAny() {
      if (!opts.inputAny) {
        return;
      }
      opts.inputAny.value = "";
      opts.inputAny.click();
    }

    if (opts.inputImage) {
      opts.inputImage.addEventListener("change", () => {
        if (opts.inputImage.files?.length) {
          void addFiles(opts.inputImage.files, true);
        }
      });
    }
    if (opts.inputAny) {
      opts.inputAny.addEventListener("change", () => {
        if (opts.inputAny.files?.length) {
          void addFiles(opts.inputAny.files, false);
        }
      });
    }

    /**
     * Host-read attachments (from path drops when FileList is empty).
     * @param {Array<{
     *   name: string,
     *   mime?: string,
     *   size?: number,
     *   isImage?: boolean,
     *   dataBase64?: string,
     *   text?: string,
     * }>} list
     */
    function addFromHost(list) {
      const arr = Array.isArray(list) ? list : [];
      for (const raw of arr) {
        if (items.length >= MAX_ITEMS) break;
        if (!raw || !raw.name) continue;
        const isImage =
          !!raw.isImage ||
          String(raw.mime || "").startsWith("image/") ||
          /\.(png|jpe?g|gif|webp|bmp|svg|ico|avif|heic)$/i.test(raw.name);
        const id = "a" + ++uid;
        /** @type {any} */
        const entry = {
          id,
          name: raw.name,
          mime: raw.mime || (isImage ? "image/png" : "application/octet-stream"),
          size: raw.size || 0,
          isImage,
          dataBase64: raw.dataBase64,
          text: raw.text,
        };
        if (isImage && raw.dataBase64) {
          const mime = entry.mime || "image/png";
          entry.previewUrl = "data:" + mime + ";base64," + raw.dataBase64;
        }
        items.push(entry);
      }
      render();
      return null;
    }
    if (opts.viewer) {
      opts.viewer.addEventListener("click", (e) => {
        const t = e.target;
        if (
          t === opts.viewer ||
          (t && t.getAttribute && t.getAttribute("data-viewer-close") != null)
        ) {
          closeViewer();
        }
      });
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && opts.viewer && !opts.viewer.hidden) {
          closeViewer();
        }
      });
    }

    /** Payload safe to postMessage to the extension host */
    function toPayload() {
      return items.map((a) => ({
        name: a.name,
        mime: a.mime,
        size: a.size,
        isImage: a.isImage,
        dataBase64: a.dataBase64 || undefined,
        text: a.text || undefined,
      }));
    }

    function count() {
      return items.length;
    }

    function list() {
      return items.slice();
    }

    const api = {
      pickImage,
      pickAny,
      addFiles,
      addFromHost,
      clear,
      remove,
      count,
      list,
      toPayload,
      openViewer,
      closeViewer,
      render,
    };
    // Shared for chat-message thumbnails (cards.js)
    W.attach.openViewer = openViewer;
    W.attach.closeViewer = closeViewer;
    return api;
  }

  W.attach = { mount };
})(typeof window !== "undefined" ? window : globalThis);
