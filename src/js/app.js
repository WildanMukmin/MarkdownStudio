/* =========================================================
   5. Application
   ========================================================= */
(function () {
  const $ = s => document.querySelector(s);
  const ed = $("#editor"), preview = $("#preview"), previewPane = $("#previewPane"),
    mirror = $("#mirror"), panes = $("#panes"), body = document.body;

  const KEY = "md-studio-v1";
  const DEFAULTS = { theme: "light", view: "split", split: 50, edSize: 14, pvSize: 16,
    wrap: true, sync: true, wide: false, sidebar: true, lang: "auto", pip: false };
  let state = { docs: [], active: null, settings: Object.assign({}, DEFAULTS) };
  let saveTimer = null, renderTimer = null, lineMap = [], mirrorStale = true, mirrorStyleStale = true, mirrorW = -1, storageWarned = false;

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  /* ---------- dialogs ---------- */
  /* The browser's own confirm() and prompt() are a different window, in a different
     style, in the browser's language, and in the exe they flash a native box over the
     app. These are the app's own: one at a time, answered as a promise, so the call
     reads the way the native one did - `if (!(await askConfirm(...))) return;`.
     Esc and the backdrop cancel, Enter accepts, Tab stays inside, and focus goes back
     to where it was. */
  let dlgOpen = null;
  function askDialog(o) {
    if (dlgOpen) dlgOpen.close(o.input ? null : false);
    return new Promise(resolve => {
      const back = document.createElement("div");
      back.className = "overlay dlg-back";
      const box = document.createElement("div");
      box.className = "sheet dlg";
      box.setAttribute("role", o.danger ? "alertdialog" : "dialog");
      box.setAttribute("aria-modal", "true");
      const id = "dlg" + Date.now().toString(36);
      const msg = document.createElement("div");
      msg.className = "dlg-msg"; msg.id = id;
      msg.textContent = o.message;
      box.setAttribute("aria-labelledby", id);
      box.appendChild(msg);
      let field = null;
      if (o.input) {
        field = document.createElement("input");
        field.type = "text"; field.className = "dlg-in";
        field.value = o.value || "";
        field.setAttribute("aria-labelledby", id);
        field.spellcheck = false;
        box.appendChild(field);
      }
      const row = document.createElement("div");
      row.className = "dlg-row";
      const no = document.createElement("button");
      no.type = "button"; no.className = "btn btn-out"; no.textContent = tr("Cancel");
      const yes = document.createElement("button");
      yes.type = "button"; yes.className = "btn btn-pri" + (o.danger ? " dlg-danger" : "");
      yes.textContent = o.ok || tr("OK");
      row.appendChild(no); row.appendChild(yes);
      box.appendChild(row);
      back.appendChild(box);

      const was = document.activeElement;
      let done = false;
      const api = {
        close(v) {
          if (done) return;
          done = true;
          dlgOpen = null;
          back.remove();
          try { if (was && was.focus && document.contains(was)) was.focus(); } catch (e) { }
          resolve(v);
        }
      };
      const accept = () => api.close(o.input ? field.value : true);
      const cancel = () => api.close(o.input ? null : false);
      yes.addEventListener("click", accept);
      no.addEventListener("click", cancel);
      back.addEventListener("mousedown", e => { if (e.target === back) cancel(); });
      back.addEventListener("keydown", e => {
        e.stopPropagation();                      /* nothing behind the dialog hears keys */
        if (e.key === "Escape") { e.preventDefault(); cancel(); }
        else if (e.key === "Enter" && !(e.target === no)) { e.preventDefault(); accept(); }
        else if (e.key === "Tab") {
          const f = [field, no, yes].filter(Boolean);
          const i = f.indexOf(document.activeElement);
          e.preventDefault();
          f[(i + (e.shiftKey ? f.length - 1 : 1)) % f.length].focus();
        }
      });
      dlgOpen = api;
      document.body.appendChild(back);
      /* a destructive question starts on Cancel, so a held Enter cannot confirm it */
      const first = field || (o.danger ? no : yes);
      first.focus();
      if (field) field.select();
    });
  }
  const askConfirm = (message, opts) => askDialog(Object.assign({ message: message }, opts));
  const askInput = (message, value) => askDialog({ message: message, input: true, value: value });

  /* ---------- toast ---------- */
  let toastTimer;
  function toast(msg, ms) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    /* an error has to stay up long enough to be read out to someone */
    toastTimer = setTimeout(() => t.classList.remove("show"), ms || 2100);
  }

  /* The guide comes in the interface's language. Resolved from the setting rather
     than the current language, because the first run writes it before the language
     has been applied. */
  function guideText() {
    const id = I18N.resolve(state.settings.lang) === "id";
    const el = document.getElementById(id ? "seed-id" : "seed");
    /* Parts of the guide only hold for the exe - Docs as files, Open with, the
       documents folder - and sit between "exe" comment markers; what the page opened
       on its own does instead sits between "web" ones. Only the half that is true
       here is kept, so the guide never describes something you cannot do. The
       markers are spelt out at run time: the comment opener written literally in a
       script can change how the HTML around it is parsed. */
    const C = "<" + "!-- ", E = " --" + ">";
    const drop = SRV_KEY ? "web" : "exe";
    const any = C + "/?(?:exe|web)" + E, open = C + drop + E, shut = C + "/" + drop + E;
    const text = (el.textContent || "").replace(/^\n/, "")
      /* a block on lines of its own goes with its line breaks, so a table row taken
         out of the middle of a table does not leave a blank line splitting it... */
      .replace(new RegExp("^" + open + /\n[\s\S]*?\n/.source + shut + /\n/.source, "gm"), "")
      /* ...while one inside a sentence leaves the line it is on alone */
      .replace(new RegExp(open + /[\s\S]*?/.source + shut, "g"), "")
      .replace(new RegExp("^" + any + /\n/.source, "gm"), "")
      .replace(new RegExp(any, "g"), "");
    return {
      text: text,
      name: id ? "Selamat datang" : "Welcome",
      guide: id ? "Panduan selamat datang" : "Welcome guide"
    };
  }

  /* ---------- persistence ---------- */
  function load() {
    let raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { }
    if (raw) {
      try {
        const d = JSON.parse(raw);
        if (d && Array.isArray(d.docs)) {
          state.docs = d.docs;
          state.active = d.active;
          state.settings = Object.assign({}, DEFAULTS, d.settings || {});
        }
      } catch (e) { }
    }
    if (!state.docs.length) {
      const g = guideText();
      state.docs = [{ id: uid(), name: g.name, content: g.text, created: Date.now(), updated: Date.now(), seed: true }];
      state.active = state.docs[0].id;
    }
    if (!state.docs.some(d => d.id === state.active)) state.active = state.docs[0].id;
  }
  function persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      updateSaveUI();
    } catch (e) {
      updateSaveUI();
      /* warn once, not on every debounced save */
      if (!storageWarned) {
        storageWarned = true;
        toast(tr("Browser storage unavailable - use Ctrl+S to save files"));
      }
    }
  }
  function queueSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persist, 500);
  }
  /* One place decides how "saved" is shown: status bar, Save badge and tab title. */
  function updateSaveUI() {
    const t = active();
    const dirty = isDirty(t);
    let kind, text, tip;

    if (dirty) {
      kind = "dirty";
      text = tr("Unsaved changes");
      tip = tr("Ctrl+S writes them to ") + (t.path || t.name);
    } else if (writable(t)) {
      kind = "ok";
      text = tr("Saved");
      tip = tr("In sync with ") + (t.path || t.name);
    } else if (t && t.kind === "file") {
      kind = "warn";
      text = tr("Read-only copy");
      tip = tr("Opened without write access - Ctrl+S saves a copy instead");
    } else if (t && t.kind === "local" && LIB.ok && libDocOf(t) && libDocOf(t).file) {
      const d = libDocOf(t);
      kind = d.err ? "warn" : "ok";
      text = tr(d.err ? "Not written" : "Saved");
      tip = tr(d.err ? "Could not write " : "Written as you type to ") +
        LIB.path + "\\" + String(d.file).replace(/\//g, "\\");
    } else if (storageWarned) {
      kind = "warn";
      text = tr("Not saved");
      tip = tr("Browser storage is unavailable here - use Ctrl+S to save a real file");
    } else {
      kind = "browser";
      text = tr("Browser only");
      tip = tr("Autosaved in this browser. Ctrl+S saves it as a real .md file on disk");
    }

    const el = $("#saveState");
    el.className = dirty ? "is-dirty" : "";
    el.title = tip;
    el.innerHTML = '<span class="dot ' + kind + '"></span>' + MD.escape(text);
    $("#btnSave").classList.toggle("pending", dirty);
    $("#btnSave").title = tr(dirty ? "Save changes (Ctrl+S)"
      : writable(t) ? "Already in sync (Ctrl+S)" : "Save as .md file (Ctrl+S)");
    document.title = (dirty ? "● " : "") + (t ? t.name : "Markdown Studio") + " - Markdown Studio";
  }
  /* Deliberately no doc() helper taking no argument: that resolved via state.active,
     which still names a stored document while a FILE tab is on screen. This one goes
     through the tab, so it can only ever name the document actually on screen. */
  const libDocOf = t => (t && t.kind === "local"
    ? state.docs.find(x => x.id === t.docId) || null : null);

  /* ---------- settings ---------- */
  function applySettings() {
    const s = state.settings;
    document.documentElement.setAttribute("data-theme", s.theme);
    body.classList.remove("view-split", "view-edit", "view-preview");
    body.classList.add("view-" + s.view);
    body.classList.toggle("nowrap", !s.wrap);
    body.classList.toggle("wide", !!s.wide);
    body.classList.toggle("no-sidebar", !s.sidebar);
    panes.style.setProperty("--split", s.split + "%");
    document.documentElement.style.setProperty("--ed-size", s.edSize + "px");
    document.documentElement.style.setProperty("--pv-size", s.pvSize + "px");
    document.querySelectorAll("[data-view]").forEach(b => b.classList.toggle("on", b.dataset.view === s.view));
    settingsUI();
    pipUI();
    pipSync();
    mirrorStale = true; mirrorStyleStale = true;
    if (s.view !== "split" || !s.sync) clearHl();
    if (findHL && !previewMode()) paintHits();
    scheduleFindRepaint(220);   /* again once the sidebar transition has finished */
  }

  /* ---------- rendering ---------- */
  function renderNow() {
    const src = ed.value;
    const r = MD.render(src);
    preview.innerHTML = r.html;
    lineMap = Array.prototype.map.call(preview.querySelectorAll("[data-src-line]"),
      el => ({ line: +el.dataset.srcLine, el: el }));
    lineMap.sort((a, b) => a.line - b.line);
    buildToc(r.headings);
    updateStats(src);
    mirrorStale = true;
    /* innerHTML wiped the classes, so put the selection highlight back */
    hlEls = [];
    if (document.activeElement === ed && ed.selectionStart !== ed.selectionEnd) syncSelection(true);
    /* innerHTML wiped the preview hits too */
    if (findHL && previewMode()) { pvMarks = []; runFind(true); }
    pipSync();
  }
  function queueRender() {
    clearTimeout(renderTimer);
    /* big documents cost more to re-parse, so wait for a longer pause */
    renderTimer = setTimeout(renderNow, ed.value.length > 40000 ? 240 : 90);
  }

  /* one pass, no intermediate arrays - this runs on every render */
  function scan(s) {
    let words = 0, lines = 1, inWord = false;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c === 10) { lines++; inWord = false; continue; }
      const isW = (c > 47 && c < 58) || (c > 64 && c < 91) || (c > 96 && c < 123) ||
        c === 95 || c === 39 || c === 45 || c > 127;
      if (isW) { if (!inWord) { words++; inWord = true; } } else inWord = false;
    }
    return { words: words, lines: lines };
  }
  function updateStats(src) {
    /* an embedded picture is one long line of base64, not thousands of words */
    const s = scan(src.indexOf("data:") < 0 ? src : src.replace(/^ {0,3}\[[^\]]+\]:[ \t]*data:\S*$/gm, ""));
    $("#stWords").textContent = s.words.toLocaleString();
    $("#stChars").textContent = src.length.toLocaleString();
    $("#stLines").textContent = (src ? s.lines : 0).toLocaleString();
    $("#stRead").textContent = Math.max(1, Math.round(s.words / 225));
  }
  function updateCursor() {
    const pos = ed.selectionStart;
    const start = ed.value.lastIndexOf("\n", pos - 1) + 1;
    const sel = ed.selectionEnd - pos;
    $("#stCursor").textContent = tr("Ln") + " " + (lineOf(pos) + 1) + ", " +
      tr("Col") + " " + (pos - start + 1) +
      (sel > 0 ? "  (" + sel + " " + tr("selected") + ")" : "");
  }

  /* ---------- sidebar ---------- */
  function timeAgo(t) {
    const s = Math.floor((Date.now() - t) / 1000);
    if (s < 60) return tr("just now");
    if (s < 3600) return Math.floor(s / 60) + tr("m ago");
    if (s < 86400) return Math.floor(s / 3600) + tr("h ago");
    if (s < 604800) return Math.floor(s / 86400) + tr("d ago");
    return new Date(t).toLocaleDateString();
  }
  function renderDocs() {
    const q = $("#docSearch").value.trim().toLowerCase();
    const list = $("#docList");
    const items = state.docs
      .slice()
      .sort((a, b) => b.updated - a.updated)
      .filter(d => !q || d.name.toLowerCase().includes(q) || (d.content || "").toLowerCase().includes(q));
    if (!items.length) {
      list.innerHTML = '<div class="empty">' + MD.escape(tr("No documents match.")) + "</div>";
      return;
    }
    list.innerHTML = items.map(d => {
      const words = ((d.content || "").trim().match(/\S+/g) || []).length;
      return '<div class="doc' + (d.id === state.active ? " active" : "") + '" data-id="' + d.id + '"' +
        (d.file && LIB.ok ? ' title="' + MD.escape(LIB.path + "\\" + d.file) + '"' : "") + ">" +
        '<div class="doc-main"><div class="doc-name">' + MD.escape(d.name || "Untitled") + "</div>" +
        '<div class="doc-meta">' + timeAgo(d.updated) + " &middot; " + words + " " + MD.escape(tr("words")) +
        (d.file && LIB.ok ? " &middot; " + MD.escape(d.file) : "") + "</div></div>" +
        '<button class="doc-del" data-del="' + d.id + '" title="' + MD.escape(tr("Delete")) + '">' +
        '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg></button></div>';
    }).join("");
  }
  let tocData = [];
  function buildToc(hs) {
    tocData = hs || [];
    if ($("#paneToc").hidden) return;   /* rebuilt when the Outline tab is opened */
    const el = $("#tocList");
    if (!hs.length) { el.innerHTML = '<div class="empty">No headings yet.<br>Add <b>#</b> headings to build an outline.</div>'; return; }
    el.innerHTML = hs.map(h =>
      '<button class="toc-item toc-l' + h.level + '" data-line="' + h.line + '" data-id="' + h.id + '">' +
      MD.escape(h.text || "(untitled)") + "</button>").join("");
  }

  /* =========================================================
     workspace: folder tree + editor tabs
     ========================================================= */
  const MD_EXT = /\.(md|markdown|mdown|mkd|mdwn|mdx|txt)$/i;
  const SKIP_DIR = /^(node_modules|\.git|\.svn|\.hg|vendor|dist|build|out|target|\.next|\.nuxt|\.cache|__pycache__|\.venv|venv)$/i;
  const esc = MD.escape;

  let root = null;            /* {name, handle, mode:'fs'|'flat', readonly} */
  let tree = null;            /* root tree node */
  let tabs = [], activeTab = null, reopen = null;
  const nodeByPath = new Map();

  const active = () => tabs.find(t => t.id === activeTab) || null;
  const bufOf = t => (t.id === activeTab ? ed.value : t.content);
  /* A tab is "bound" once it maps to a real file on disk - only then can it be out
     of sync. An unbound scratch document autosaves into the browser instead, so it
     is never "unsaved"; it just has nowhere on disk to be out of sync with. */
  const isBound = t => !!t && (t.kind === "file" || !!t.handle);
  /* can Ctrl+S write straight back? either a folder handle, or a file the exe
     is serving for us */
  const writable = t => !!t && (!!t.handle || !!t.srv);
  const isDirty = t => isBound(t) && bufOf(t) !== t.saved;
  const activeName = () => { const t = active(); return t ? t.name : "untitled"; };

  const ICO_CHEV = '<svg class="tree-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>';
  const ICO_DIR = '<svg class="tree-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>';
  const ICO_FILE = '<svg class="tree-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z"/><path d="M14 3v5h5"/></svg>';
  const ICO_IMG = '<svg class="tree-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 16l-5-5L5 21"/></svg>';
  const ICO_TAB_F = '<svg class="etab-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z"/><path d="M14 3v5h5"/></svg>';
  const ICO_TAB_D = '<svg class="etab-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>';

  /* ---------- tiny IndexedDB store, so the folder survives a reload ---------- */
  function idb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open("md-studio", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("kv");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function idbSet(k, v) {
    try { const db = await idb(); db.transaction("kv", "readwrite").objectStore("kv").put(v, k); } catch (e) { }
  }
  async function idbGet(k) {
    try {
      const db = await idb();
      return await new Promise(res => {
        const rq = db.transaction("kv", "readonly").objectStore("kv").get(k);
        rq.onsuccess = () => res(rq.result);
        rq.onerror = () => res(null);
      });
    } catch (e) { return null; }
  }

  /* ---------- opening a folder ---------- */
  async function openFolder() {
    if (window.showDirectoryPicker) {
      try {
        const h = await window.showDirectoryPicker({ mode: "readwrite" });
        await useFolder(h);
        idbSet("root", h);
        return;
      } catch (e) {
        if (e && e.name === "AbortError") return;
      }
    }
    $("#dirPick").click();   /* file:// and older browsers: read-only folder pick */
  }

  async function useFolder(handle) {
    let perm = "granted";
    try {
      if (handle.queryPermission) perm = await handle.queryPermission({ mode: "readwrite" });
      if (perm !== "granted" && handle.requestPermission) perm = await handle.requestPermission({ mode: "readwrite" });
    } catch (e) { perm = "denied"; }
    dropSearchCache();
    root = { name: handle.name, handle: handle, mode: "fs", readonly: perm !== "granted" };
    tree = { name: handle.name, path: "", kind: "dir", handle: handle, kids: null, open: true };
    await loadDir(tree);
    showSideTab("files");
    renderTree();
    toast(tr("Opened ") + handle.name + (root.readonly ? " (read-only)" : ""));
  }

  async function loadDir(node) {
    const dirs = [], files = [];
    try {
      for await (const h of node.handle.values()) {
        if (h.kind === "directory") {
          if (SKIP_DIR.test(h.name)) continue;
          dirs.push({ name: h.name, path: node.path ? node.path + "/" + h.name : h.name, kind: "dir", handle: h, kids: null, open: false });
        } else if (MD_EXT.test(h.name)) {
          files.push({ name: h.name, path: node.path ? node.path + "/" + h.name : h.name, kind: "file", handle: h });
        } else if (inAssets(node.path + "/x")) {
          /* "img", never "file": search and link-following only ever read "file" */
          files.push({ name: h.name, path: node.path ? node.path + "/" + h.name : h.name, kind: "img", handle: h });
        }
      }
    } catch (e) { toast(tr("Could not read that folder")); }
    const by = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
    dirs.sort(by); files.sort(by);
    node.kids = dirs.concat(files);
  }

  /* re-reads the folder from disk, keeping expanded directories expanded */
  async function refreshTree(node) {
    /* the exe sends the whole listing in one go, so re-fetch it instead of walking */
    if (root && root.mode === "server") { await loadServerWorkspace(false); return; }
    if (node.kind !== "dir" || !node.handle) return;
    const wasOpen = {};
    (function walk(n) { if (n.kind === "dir") { wasOpen[n.path] = n.open; (n.kids || []).forEach(walk); } })(node);
    await loadDir(node);
    for (const k of node.kids) {
      if (k.kind === "dir" && wasOpen[k.path]) { k.open = true; await refreshTree(k); }
    }
  }

  /* fallback: <input webkitdirectory> gives a flat FileList, so rebuild the tree */
  function useFlatFolder(fileList) {
    const files = Array.prototype.slice.call(fileList);
    if (!files.length) return;
    const rootName = (files[0].webkitRelativePath || files[0].name).split("/")[0] || "folder";
    const rootNode = { name: rootName, path: "", kind: "dir", kids: [], open: true };
    const dirs = { "": rootNode };
    let count = 0;

    files.forEach(f => {
      const parts = (f.webkitRelativePath || f.name).split("/");
      const pic = !MD_EXT.test(f.name) && inAssets(parts.slice(1).join("/"));
      if (!MD_EXT.test(f.name) && !pic) return;
      if (parts.slice(1, -1).some(p => SKIP_DIR.test(p))) return;
      let cur = rootNode, prefix = "";
      for (let i = 1; i < parts.length - 1; i++) {
        prefix = prefix ? prefix + "/" + parts[i] : parts[i];
        let node = dirs[prefix];
        if (!node) {
          node = { name: parts[i], path: prefix, kind: "dir", kids: [], open: false };
          dirs[prefix] = node;
          cur.kids.push(node);
        }
        cur = node;
      }
      cur.kids.push({ name: f.name, path: parts.slice(1).join("/"), kind: pic ? "img" : "file", file: f });
      if (!pic) count++;
    });

    if (!count) { toast(tr("No Markdown files found in that folder")); return; }
    const by = (a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }) : a.kind === "dir" ? -1 : 1);
    (function sortAll(n) { if (!n.kids) return; n.kids.sort(by); n.kids.forEach(sortAll); })(rootNode);

    dropSearchCache();
    root = { name: rootName, handle: null, mode: "flat", readonly: true };
    tree = rootNode;
    showSideTab("files");
    renderTree();
    toast(tr("Opened ") + rootName + " (" + count + " files, read-only)");
  }

  /* ---------- a folder served by MarkdownStudio.exe ---------- */
  /* Right-clicking a .md and picking "Open with -> Markdown Studio" hands the exe a
     path. A browser cannot reach a path on its own, so the launcher serves that
     file's folder as a workspace and these two calls are the read and the write.
     The key comes in on the launch URL: without it the endpoints refuse, so another
     page that guessed the port still cannot touch your files. One exe can serve
     several windows, each on its own folder, so "w" says which one is ours. */
  const SRV_KEY = (function () {
    try { return new URLSearchParams(location.search).get("k") || ""; } catch (e) { return ""; }
  })();
  const SRV_WS = (function () {
    try { return new URLSearchParams(location.search).get("w") || ""; } catch (e) { return ""; }
  })();
  const srvUrl = (p, path) => p + "?k=" + encodeURIComponent(SRV_KEY) +
    (SRV_WS ? "&w=" + encodeURIComponent(SRV_WS) : "") +
    (path == null ? "" : "&p=" + encodeURIComponent(path));

  async function srvRead(path) {
    const r = await fetch(srvUrl("/__file", path));
    if (!r.ok) throw new Error((await r.text()) || r.status);
    return r.text();
  }
  async function srvWrite(path, text) {
    const r = await fetch(srvUrl("/__file", path), {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: text
    });
    if (!r.ok) throw new Error((await r.text()) || r.status);
  }

  /* ---------- the library: real files behind the Docs list ---------- */
  /* Documents used to live only in this browser profile's localStorage. Nothing on
     disk matched them, so every save had to ask where to put a copy, and closing the
     app felt like losing them. The exe now always serves one folder - the library,
     under the fixed workspace id "lib" - and each document is a real .md file in it:
     written as you type, found by Windows Search, and opened from Explorer like any
     other file. Without the exe (the page served by laragon, or opened straight from
     disk) there is no library and documents stay where they were, in this browser. */
  const LIB = { ok: false, name: "", path: "", files: [], assets: [] };
  const libUrl = (p, file) => p + "?k=" + encodeURIComponent(SRV_KEY) + "&w=lib" +
    (file == null ? "" : "&p=" + encodeURIComponent(file));

  async function libRead(file) {
    const r = await fetch(libUrl("/__file", file));
    if (!r.ok) throw new Error((await r.text()) || r.status);
    return normText(await r.text());
  }
  async function libWrite(file, text) {
    const r = await fetch(libUrl("/__file", file), {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: text
    });
    if (!r.ok) throw new Error((await r.text()) || r.status);
    if (LIB.files.indexOf(file) < 0) LIB.files.push(file);
  }
  async function libDelete(file) {
    const r = await fetch(libUrl("/__file", file), { method: "DELETE" });
    if (!r.ok && r.status !== 404) throw new Error((await r.text()) || r.status);
    LIB.files = LIB.files.filter(f => f !== file);
  }

  /* A file name for a document, from its title. Collisions get a number rather
     than overwriting the other document's file. */
  function libNameFor(name, exceptId) {
    const base = safeName(String(name || "Untitled").replace(MD_EXT, "")) || "Untitled";
    const taken = new Set();
    LIB.files.forEach(f => taken.add(f.toLowerCase()));
    state.docs.forEach(d => { if (d.file) taken.add(d.file.toLowerCase()); });
    const mine = state.docs.find(d => d.id === exceptId);
    if (mine && mine.file) taken.delete(mine.file.toLowerCase());
    let file = base + ".md";
    for (let n = 2; taken.has(file.toLowerCase()); n++) file = base + " " + n + ".md";
    return file;
  }

  /* Opening the library folder itself in the Explorer would give the same file two
     editors: a document tab autosaving it, and a file tab the user saves by hand.
     The file tab wins - it is the one being typed into - and the document's
     autosave stands down for as long as it is open. */
  function libClash(file) {
    return !!(root && root.mode === "server" && root.disk && LIB.path &&
      root.disk.toLowerCase() === LIB.path.toLowerCase() &&
      tabs.some(t => t.kind === "file" && String(t.path).toLowerCase() === file.toLowerCase()));
  }

  /* Pairs the stored documents with the files in the folder, both ways: a document
     that has never been written gets a file, and a file no document knows about
     becomes one - which is how a .md dropped into the folder from Explorer turns up
     in the list. Where both exist the file wins, because that is the copy every other
     program, and the end of the last session, saw.

     A document whose file has gone is written again rather than dropped: losing
     notes because a folder was moved or synced away would be far worse than a file
     coming back. Deleting one for good is what the Docs list's own delete is for. */
  async function libSync(restoreMissing) {
    if (!SRV_KEY) return;
    let ws;
    try {
      const r = await fetch(libUrl("/__ws", null));
      if (!r.ok) return;
      ws = await r.json();
    } catch (e) { return; }
    if (!ws || !ws.path) return;                  /* an exe from before the library */

    LIB.ok = true;
    LIB.name = ws.root || "Markdown Studio";
    LIB.path = ws.path;
    LIB.files = (ws.files || []).slice();
    LIB.assets = (ws.assets || []).slice();

    /* the whole folder in one response, rather than a request per document */
    let all = {};
    try {
      const r = await fetch(libUrl("/__all", null));
      if (r.ok) all = await r.json();
    } catch (e) { }
    const textOf = async f => (typeof all[f] === "string" ? normText(all[f]) : libRead(f));

    const loose = new Map();
    LIB.files.forEach(f => loose.set(f.toLowerCase(), f));

    const gone = [];
    for (const d of state.docs) {
      if (!d.file) continue;
      const on = loose.get(String(d.file).toLowerCase());
      if (!on) {
        /* On an ordinary start a file that is gone was deleted on purpose (Explorer,
           another program): the document goes with it instead of being written back.
           After choosing another folder, or when the folder is empty or unreadable,
           the document is kept and written again, as before. */
        if (!restoreMissing && LIB.files.length) { gone.push(d); continue; }
        d.file = null; continue;
      }
      d.file = on;
      loose.delete(on.toLowerCase());
      try {
        const text = await textOf(on);
        if (text !== d.content) { d.content = text; d.updated = Date.now(); }
      } catch (e) { }
    }
    if (gone.length) {
      state.docs = state.docs.filter(d => gone.indexOf(d) < 0);
      tabs = tabs.filter(t => !(t.kind === "local" && gone.some(d => d.id === t.docId)));
      if (gone.some(d => d.id === state.active)) state.active = null;
    }
    /* The guide a first run writes is for an empty library. Run with a fresh
       browser profile - a reinstall, cleared site data - against a folder that
       already holds notes, it would only pile another Welcome beside the one there
       from last time. So an untouched one is dropped when the folder has anything. */
    if (LIB.files.length) {
      const fresh = state.docs.filter(d => d.seed && !d.file && d.content === guideText().text);
      if (fresh.length) {
        state.docs = state.docs.filter(d => fresh.indexOf(d) < 0);
        if (fresh.some(d => d.id === state.active)) state.active = null;
      }
    }
    for (const d of state.docs) {
      if (d.file) continue;
      const file = libNameFor(d.name, d.id);
      try { await libWrite(file, d.content || ""); d.file = file; } catch (e) { }
    }
    for (const f of loose.values()) {
      let text;
      try { text = await textOf(f); } catch (e) { continue; }
      state.docs.push({
        id: uid(), name: f.replace(/^.*\//, "").replace(MD_EXT, ""), file: f,
        content: text, created: Date.now(), updated: Date.now()
      });
    }
    persist();
    libHome();
  }
  /* The path itself belongs in Settings, not under the search box: it is long, it is
     read far less often than it was written, and it is a setting. */
  function libHome() {
    const el = $("#docHome");
    el.hidden = !LIB.ok;
    if (!LIB.ok) return;
    el.innerHTML = MD.escape(tr("Each of these is a file")) +
      ' <button type="button" id="libWhere" title="' + MD.escape(tr("Show me where")) +
      '">' + MD.escape(tr("in here")) + "</button>";
  }

  /* Opening the folder is the exe's to do - a page cannot reach Explorer. */
  async function libReveal() {
    if (!LIB.ok) return;
    try {
      const r = await fetch(libUrl("/__reveal", null), { method: "POST" });
      if (!r.ok) throw new Error((await r.text()) || r.status);
    } catch (e) { toast(tr("Could not open that folder")); }
  }

  /* Picking where the documents live. The folder browser belongs to the exe, not to
     the page: a browser can hand back a folder to read, but never its path, and the
     path is exactly what the exe needs to serve it again on the next launch. So the
     page asks, the exe shows the dialog, moves the notes and writes the choice down,
     and the page re-reads the folder it gets back. */
  let libPicking = false;
  async function libChooseFolder() {
    if (!LIB.ok || libPicking) return;      /* the dialog is already up somewhere */
    libPicking = true;
    try {
      /* whatever is still on a timer belongs in the move, not in the old folder */
      for (const id of Array.from(libTimers.keys())) await libFlush(id);

      let res;
      try {
        /* this waits for as long as the folder dialog is open, which is the point */
        const r = await fetch(libUrl("/__libdir", null), { method: "POST" });
        if (!r.ok) throw new Error((await r.text()) || r.status);
        res = await r.json();
      } catch (e) { toast(tr("Could not open the folder picker")); return; }

      if (!res || res.cancelled) return;
      if (res.error) { toast(tr("Could not use that folder: ") + res.error); return; }

      /* a note whose name was taken in the new folder arrived under another one */
      Object.keys(res.renamed || {}).forEach(old => {
        const d = state.docs.find(x => x.file && x.file.toLowerCase() === old.toLowerCase());
        if (d) d.file = res.renamed[old];
      });

      /* re-reading a folder of notes is not instant, so say what is happening */
      toast(res.moved ? "Moving your documents..." : "Reading " + res.root + "...");
      await libSync(true);
      dropImages();
      renderNow();
      renderDocs();
      renderLibAssets();
      updateSaveUI();
      settingsUI();
      toast(res.moved
        ? "Documents are now in " + res.root + " - " + res.moved + " file" +
          (res.moved === 1 ? "" : "s") + " moved"
        : "Documents are now in " + res.root);
    } finally { libPicking = false; }
  }

  /* Documents are written as they are typed, so there is never a copy on screen
     that disk does not have. The debounce is per document: editing one must not
     postpone another's write. */
  const libTimers = new Map();
  function libQueue(docId) {
    if (!LIB.ok || !docId) return;
    clearTimeout(libTimers.get(docId));
    libTimers.set(docId, setTimeout(() => { libTimers.delete(docId); libFlush(docId); }, 500));
  }
  async function libFlush(docId) {
    if (!LIB.ok) return;
    clearTimeout(libTimers.get(docId));
    libTimers.delete(docId);
    const d = state.docs.find(x => x.id === docId);
    if (!d) return;
    if (!d.file) d.file = libNameFor(d.name, d.id);
    if (libClash(d.file)) return;
    try {
      await libWrite(d.file, d.content || "");
      d.err = false;
      const t = tabs.find(x => x.kind === "local" && x.docId === docId);
      if (t) t.saved = t.content;
    } catch (e) { d.err = true; }
    updateSaveUI();
  }

  /* Renaming a document renames its file, so the two never drift apart. Debounced
     like the title itself: typing "Meeting notes" should leave one file behind,
     not one per keystroke. */
  let libRenameTimer = null;
  function libQueueRename(docId) {
    if (!LIB.ok) return;
    clearTimeout(libRenameTimer);
    libRenameTimer = setTimeout(() => libRename(docId), 900);
  }
  async function libRename(docId) {
    const d = state.docs.find(x => x.id === docId);
    if (!d || !d.file || !LIB.ok || libClash(d.file)) return;
    const want = libNameFor(d.name, d.id);
    if (want.toLowerCase() === String(d.file).toLowerCase()) return;
    const old = d.file;
    try {
      await libWrite(want, d.content || "");
      d.file = want;
      await libDelete(old);
      renderDocs();
      updateSaveUI();
    } catch (e) { toast(tr("Could not rename the file on disk")); }
  }

  /* A reload or a closed window must not lose the last few hundred milliseconds of
     typing. beforeunload cannot wait for a fetch, but a beacon is handed to the
     browser to deliver after the page is gone. */
  function libFlushNow() {
    if (!LIB.ok || !navigator.sendBeacon) return;
    for (const id of Array.from(libTimers.keys())) {
      clearTimeout(libTimers.get(id));
      const d = state.docs.find(x => x.id === id);
      if (!d || !d.file || libClash(d.file)) continue;
      try {
        navigator.sendBeacon(libUrl("/__file", d.file),
          new Blob([d.content || ""], { type: "text/plain;charset=utf-8" }));
      } catch (e) { }
    }
    libTimers.clear();
  }

  /* the same tree shape loadDir() builds, from the flat list of paths the exe sends */
  function treeFromPaths(rootName, paths, pics) {
    const rootNode = { name: rootName, path: "", kind: "dir", kids: [], open: true };
    const dirs = { "": rootNode };
    const isPic = new Set(pics || []);
    paths.concat(pics || []).forEach(p => {
      const parts = String(p).split("/");
      let cur = rootNode, prefix = "";
      for (let i = 0; i < parts.length - 1; i++) {
        prefix = prefix ? prefix + "/" + parts[i] : parts[i];
        let node = dirs[prefix];
        if (!node) {
          node = { name: parts[i], path: prefix, kind: "dir", kids: [], open: false };
          dirs[prefix] = node;
          cur.kids.push(node);
        }
        cur = node;
      }
      cur.kids.push({ name: parts[parts.length - 1], path: p, kind: isPic.has(p) ? "img" : "file", srv: true });
    });
    const by = (a, b) => (a.kind === b.kind
      ? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })
      : a.kind === "dir" ? -1 : 1);
    (function sortAll(n) { if (!n.kids) return; n.kids.sort(by); n.kids.forEach(sortAll); })(rootNode);
    return rootNode;
  }

  /* keepCache: a picture was just added, and nothing already read has changed */
  async function loadServerWorkspace(openFiles, keepCache) {
    if (!SRV_KEY) return false;
    let ws;
    try {
      const r = await fetch(srvUrl("/__ws", null));
      if (!r.ok) return false;
      ws = await r.json();
    } catch (e) { return false; }
    if (!ws || !ws.root) return false;               /* launched with no file */

    /* a refresh should not collapse every folder you had expanded */
    const wasOpen = {};
    if (tree && root && root.mode === "server")
      (function walk(n) { if (n.kind === "dir") { wasOpen[n.path] = n.open; (n.kids || []).forEach(walk); } })(tree);

    if (!keepCache) dropSearchCache();
    root = { name: ws.root, handle: null, mode: "server", readonly: false, disk: ws.path || "" };
    tree = treeFromPaths(ws.root, ws.files || [], ws.assets || []);
    (function walk(n) {
      if (n.kind === "dir" && wasOpen[n.path] !== undefined) n.open = wasOpen[n.path];
      (n.kids || []).forEach(walk);
    })(tree);

    showSideTab("files");
    renderTree();

    if (openFiles) {
      for (const p of (ws.open || [])) {
        const n = await findFileNode(p);
        if (n) await openFileNode(n);
        else toast(tr("Could not find ") + p);
      }
    }
    return true;
  }

  async function closeFolder() {
    if (tabs.some(t => t.kind === "file" && isDirty(t)) &&
      !(await askConfirm(tr("Some open files have unsaved changes. Close the folder anyway?"),
        { danger: true, ok: tr("Close folder") }))) return;
    tabs.filter(t => t.kind === "file").forEach(t => { tabs = tabs.filter(x => x.id !== t.id); });
    root = null; tree = null; reopen = null;
    dropSearchCache();
    idbSet("root", null);
    if (!$("#paneSearch").hidden) runFolderSearch();
    if (!tabs.length) ensureTab(); else activateTab(tabs[0].id, true);
    renderTree();
    toast(tr("Folder closed"));
  }

  /* `dir` is the folder it goes in ("" or nothing for the top), from the tree's
     right-click menu. A name already there is refused, never written over - writing
     the new file used to replace one of the same name without a word. */
  async function newFileInFolder(dir) {
    if (!root || root.readonly || (root.mode !== "fs" && root.mode !== "server")) return;
    let name = await askInput(tr("New file name:"), "untitled.md");
    if (!name) return;
    name = name.trim().replace(/[\\/:*?"<>|]/g, "-");
    if (!MD_EXT.test(name)) name += ".md";
    const path = (dir ? dir + "/" : "") + name;
    const body = "# " + name.replace(MD_EXT, "") + "\n\n";
    if (await findFileNode(path)) { toast(tr("A file named ") + name + tr(" is already there.")); return; }

    if (root.mode === "server") {
      try {
        await srvWrite(path, body);
        await loadServerWorkspace(false, true);
        await revealInTree(path);
        const n = await findFileNode(path);
        if (n) openFileNode(n);
      } catch (e) { toast(tr("Could not create file: ") + (e.message || e.name)); }
      return;
    }

    try {
      const parent = dir ? await parentDirHandle(path) : root.handle;
      let taken = false;
      try { await parent.getFileHandle(name); taken = true; } catch (e) { }
      if (taken) { toast(tr("A file named ") + name + tr(" is already there.")); return; }
      const h = await parent.getFileHandle(name, { create: true });
      const w = await h.createWritable();
      await w.write(body);
      await w.close();
      await refreshTree(tree);
      await revealInTree(path);
      openFileNode({ name: name, path: path, kind: "file", handle: h });
    } catch (e) { toast(tr("Could not create file: ") + (e.message || e.name)); }
  }

  /* ---------- tree rendering ---------- */
  function renderTree() {
    const el = $("#treeBody");
    if (!root) {
      el.innerHTML =
        '<div class="empty" style="padding:18px 6px">' + esc(tr("No folder open.")) +
        "<br>" + esc(tr("Open one to browse and edit")) + "<br>" +
        esc(tr("all its Markdown files.")) + "</div>" +
        '<button class="btn btn-pri" data-fs="open" style="width:100%">' + esc(tr("Open Folder")) + "</button>" +
        (reopen ? '<button class="btn btn-out" data-fs="reopen" style="width:100%;margin-top:6px">' +
          esc(tr("Reopen ")) + esc(reopen.name) + "</button>" : "") +
        (location.protocol === "file:"
          ? '<div class="hint">Opened straight from a file, so folders here are <b>read-only</b>. To edit files in place, serve this app with laragon at <code>http://localhost/MDpreviewer/</code>.</div>'
          : "");
      return;
    }
    nodeByPath.clear();
    el.innerHTML =
      '<div class="root-bar"><span class="root-name" title="' + esc(root.disk || root.name) + '">' + esc(root.name) +
      (root.readonly ? tr(" (read-only)") : "") + "</span>" +
      ((root.mode === "fs" || root.mode === "server") && !root.readonly
        ? '<button class="ibtn" data-fs="new" title="' + esc(tr("New file")) + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></button>'
        : "") +
      (root.mode === "fs" || root.mode === "server"
        ? '<button class="ibtn" data-fs="refresh" title="' + esc(tr("Refresh")) + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 11-2.6-6.4M21 3v6h-6"/></svg></button>'
        : "") +
      '<button class="ibtn" data-fs="close" title="' + esc(tr("Close folder")) + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button></div>' +
      (tree.kids && tree.kids.length ? tree.kids.map(renderNode).join("")
        : '<div class="empty">' + esc(tr("No Markdown files here.")) + "</div>");
  }

  function renderNode(n) {
    nodeByPath.set(n.path, n);
    if (n.kind === "dir") {
      return '<div class="tree-row' + (n.open ? " open" : "") + (n.path === treeSel ? " selected" : "") + '" data-path="' + esc(n.path) + '">' +
        ICO_CHEV + ICO_DIR + '<span class="tree-name">' + esc(n.name) + "</span></div>" +
        (n.open ? '<div class="tree-kids">' + (n.kids || []).map(renderNode).join("") + "</div>" : "");
    }
    if (n.kind === "img") {
      return '<div class="tree-row img' + (flashing.has(n.path) ? " flash" : "") + (n.path === treeSel ? " selected" : "") +
        '" data-path="' + esc(n.path) + '" title="' + esc(n.path) + '">' +
        '<span class="tree-pad"></span>' + (IMG_EXT.test(n.name) ? ICO_IMG : ICO_FILE) + '<span class="tree-name">' + esc(n.name) + "</span></div>";
    }
    const tab = tabs.find(t => t.kind === "file" && t.path === n.path);
    return '<div class="tree-row' + (tab && tab.id === activeTab ? " active" : "") + (n.path === treeSel ? " selected" : "") +
      (tab && isDirty(tab) ? " dirty" : "") + '" data-path="' + esc(n.path) + '" title="' + esc(n.path) + '">' +
      '<span class="tree-pad"></span>' + ICO_FILE + '<span class="tree-name">' + esc(n.name) + "</span></div>";
  }

  /* ---------- tabs ---------- */
  function rememberOpenFiles() {
    if (root && root.mode === "fs") idbSet("tabs", tabs.filter(t => t.kind === "file").map(t => t.path));
  }
  function renderTabs() {
    rememberOpenFiles();
    const bar = $("#tabbar");
    /* always there, as in Chrome: its empty part is where a copied tab is pasted */
    const show = tabs.length > 0;
    $("#tabwrap").hidden = !show;
    if (!show) { bar.innerHTML = ""; return; }
    bar.innerHTML = tabs.map(t => {
      const d = isDirty(t);
      return '<div class="etab' + (t.id === activeTab ? " active" : "") + (d ? " dirty" : "") +
        '" data-tab="' + t.id + '" role="tab" title="' + esc(t.path || t.name) + '">' +
        (t.kind === "file" ? ICO_TAB_F : ICO_TAB_D) +
        '<span class="etab-name">' + esc(t.name) + "</span>" +
        (d ? '<span class="etab-dot"></span>' : "") +
        '<button class="etab-x" data-close="' + t.id + '" aria-label="Close ' + esc(t.name) + '">&#10005;</button></div>';
    }).join("");
    const cur = bar.querySelector(".etab.active");
    if (cur) cur.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  function stashActive() {
    const t = active();
    if (!t) return;
    t.content = ed.value;
    t.scrollTop = ed.scrollTop;
    t.cursor = ed.selectionStart;
  }

  function activateTab(id, skipStash) {
    if (activeTab && activeTab !== id && !skipStash) stashActive();
    const t = tabs.find(x => x.id === id);
    if (!t) return;
    activeTab = id;
    ed.value = t.content;
    const title = $("#docTitle");
    title.value = t.name;
    title.readOnly = isBound(t);
    title.title = t.path || t.name;
    if (t.kind === "local") state.active = t.docId;
    renderNow();
    ed.scrollTop = t.scrollTop || 0;
    previewPane.scrollTop = 0;
    try { ed.setSelectionRange(t.cursor || 0, t.cursor || 0); } catch (e) { }
    renderTabs(); renderTree(); renderDocs(); updateCursor();
    /* the hits belong to the document we just left, so recompute against this one */
    if (findHL && !previewMode()) runFind();
    updateSaveUI();
  }

  function closeTab(id) {
    const t = tabs.find(x => x.id === id);
    if (!t) return;
    if (t.id === activeTab) stashActive();
    if (!isDirty(t)) { closeTabNow(id); return; }
    askConfirm('"' + t.name + '" ' + tr("has unsaved changes. Close it anyway?"),
      { danger: true, ok: tr("Close anyway") }).then(ok => { if (ok) closeTabNow(id); });
  }
  function closeTabNow(id) {
    const i = tabs.findIndex(t => t.id === id);
    if (i < 0) return;
    const t = tabs[i];
    const wasActive = activeTab === id;
    rememberClosed(t);
    tabs.splice(i, 1);
    if (!wasActive) { renderTabs(); renderTree(); return; }
    activeTab = null;
    if (tabs.length) activateTab(tabs[Math.min(i, tabs.length - 1)].id, true);
    else ensureTab();
  }

  /* one confirm for the lot instead of one per unsaved tab */
  async function closeAllTabs() {
    stashActive();
    const n = tabs.length;
    const dirty = tabs.filter(isDirty);
    /* one sentence with the number in it, rather than English plural machinery that
       no other language would follow */
    if (dirty.length && !(await askConfirm(
      tr("%n open files have unsaved changes. Close all tabs anyway?")
        .replace("%n", dirty.length), { danger: true, ok: tr("Close all") }))) return;
    tabs.forEach(rememberClosed);
    tabs = []; activeTab = null;
    ensureTab();
    toast(tr("Closed ") + n + " tab" + (n === 1 ? "" : "s"));
  }

  function cycleTab(d) {
    if (tabs.length < 2) return;
    const i = tabs.findIndex(t => t.id === activeTab);
    activateTab(tabs[(i + d + tabs.length) % tabs.length].id);
  }

  async function openFileNode(n) {
    const open = tabs.find(t => t.kind === "file" && t.path === n.path);
    if (open) { activateTab(open.id); return; }
    let text = "";
    try { text = await readNodeText(n); }
    catch (e) { toast(tr("Could not read ") + n.name); return; }
    /* Windows editors like to prefix UTF-8 with a BOM; left in, it sits invisibly
       in front of the first "#" and stops it being read as a heading */
    const bom = text.charCodeAt(0) === 0xFEFF;
    text = text.replace(/^﻿/, "");
    /* A textarea silently drops the \r from CRLF, so a Windows file compared
       against what it was read as looks edited the instant it opens. Edit in LF
       and put the file's own convention back when it is written. */
    const eol = /\r\n/.test(text) ? "\r\n" : "\n";
    text = text.replace(/\r\n?/g, "\n");
    stashActive();
    const tab = {
      id: uid(), kind: "file", name: n.name, path: n.path,
      handle: n.handle || null, srv: !!n.srv, readonly: !n.handle && !n.srv,
      content: text, saved: text, eol: eol, bom: bom, scrollTop: 0, cursor: 0
    };
    tabs.push(tab);
    activateTab(tab.id, true);
  }

  /* The raw text on disk, whichever way the folder was opened. Decoded by hand with
     ignoreBOM: response.text() and file.text() silently drop a byte-order mark, so a
     file that had one was never seen to have it - and lost it on the first save. */
  async function readNodeText(n) {
    let bytes;
    if (n.srv) {
      const r = await fetch(srvUrl("/__file", n.path));
      if (!r.ok) throw new Error((await r.text()) || r.status);
      bytes = await r.arrayBuffer();
    } else {
      bytes = await (n.handle ? await n.handle.getFile() : n.file).arrayBuffer();
    }
    return new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
  }

  /* ---------- searching every file in the opened folder ---------- */
  /* Files are read once and cached, so typing a query does not re-read the whole
     folder on every key. An open tab is searched by its buffer instead, so hits
     line up with what is in the editor, unsaved edits included. */
  const fileCache = new Map();          /* path -> text, LF and no BOM, as on disk */
  const FS_MAX_ROWS = 1500;
  let fsRun = 0, fsTimer = null, fsLast = null, fsNodes = new Map(), fsShut = new Set();

  let fsBulk = null, cacheGen = 0;      /* the exe's one-shot read of the whole folder */

  const normText = s => s.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  function dropSearchCache() { fileCache.clear(); fsBulk = null; cacheGen++; dropImages(); }

  /* The exe can send every file in one response; without that, a folder of a
     few hundred notes costs a few hundred requests. Anything it leaves out
     (a size cap, or an older exe with no /__all) is read one by one after.
     Shared as a promise, so a search typed while it loads waits for it too. */
  function prefetchServerFiles() {
    if (!root || root.mode !== "server") return Promise.resolve();
    if (!fsBulk) fsBulk = (async () => {
      const gen = cacheGen;
      try {
        const r = await fetch(srvUrl("/__all", null));
        if (!r.ok) return;
        const all = await r.json();
        if (gen !== cacheGen) return;            /* the folder was reloaded meanwhile */
        Object.keys(all).forEach(p => { if (!fileCache.has(p)) fileCache.set(p, normText(all[p])); });
      } catch (e) { }
    })();
    return fsBulk;
  }

  async function allFileNodes() {
    const out = [];
    async function walk(n) {
      if (n.kind === "file") { out.push(n); return; }
      if (n.kids === null && n.handle) await loadDir(n);
      for (const k of n.kids || []) await walk(k);
    }
    if (tree) await walk(tree);
    return out;
  }

  async function searchText(n) {
    const tab = tabs.find(t => t.kind === "file" && t.path === n.path);
    if (tab) return bufOf(tab);
    if (fileCache.has(n.path)) return fileCache.get(n.path);
    const text = normText(await readNodeText(n));
    fileCache.set(n.path, text);
    return text;
  }

  function searchRegex(q, cs, re) {
    try { return new RegExp(re ? q : q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g" + (cs ? "" : "i")); }
    catch (e) { return null; }
  }

  /* hits grouped by line: [{line, pos (offset of the first hit), ord, text, spans}] */
  function hitsByLine(text, rx) {
    const rows = [];
    let m, guard = 0, ord = 0, line = 0, ls = 0, row = null;
    rx.lastIndex = 0;
    while ((m = rx.exec(text)) !== null && guard++ < 20000) {
      if (m[0] === "") { rx.lastIndex++; continue; }
      const at = m.index;
      /* matches only move forward, so walk the line counter along with them */
      let nl;
      while ((nl = text.indexOf("\n", ls)) !== -1 && nl < at) { line++; ls = nl + 1; }
      if (!row || row.line !== line) {
        let le = text.indexOf("\n", ls);
        if (le === -1) le = text.length;
        row = { line: line, pos: at, ord: ord, text: text.slice(ls, le), spans: [] };
        rows.push(row);
      }
      row.spans.push([at - ls, Math.min(at - ls + m[0].length, row.text.length)]);
      ord++;
    }
    return { rows: rows, count: ord };
  }

  /* a window of the line around the first hit, with every hit in it marked */
  function snippet(row) {
    const L = row.text;
    let s = Math.max(0, row.spans[0][0] - 28);
    if (s === 0) s = L.length - L.replace(/^\s+/, "").length;
    if (s > row.spans[0][0]) s = row.spans[0][0];
    const e = Math.min(L.length, s + 180);
    let out = s > 0 && /\S/.test(L.slice(0, s)) ? "&hellip;" : "", cx = s;
    row.spans.forEach(sp => {
      const a = Math.max(sp[0], cx), b = Math.min(sp[1], e);
      if (b <= a) return;
      out += esc(L.slice(cx, a)) + "<mark>" + esc(L.slice(a, b)) + "</mark>";
      cx = b;
    });
    return out + esc(L.slice(cx, e));
  }

  function queueFolderSearch(delay) {
    clearTimeout(fsTimer);
    fsTimer = setTimeout(runFolderSearch, delay == null ? 250 : delay);
  }

  async function runFolderSearch() {
    clearTimeout(fsTimer);
    const run = ++fsRun;
    const q = $("#fsInput").value, cs = $("#fsCase").checked, re = $("#fsRe").checked;
    const sum = $("#fsSummary"), out = $("#fsResults");
    if (!root) {
      sum.textContent = "";
      out.innerHTML = '<div class="empty">Open a folder to search<br>across all of its files.</div>' +
        '<button class="btn btn-pri" data-fs-open style="width:100%">Open Folder</button>';
      return;
    }
    if (!q) { sum.textContent = ""; out.innerHTML = ""; fsLast = null; return; }
    const rx = searchRegex(q, cs, re);
    if (!rx) { sum.textContent = "Invalid regular expression"; out.innerHTML = ""; return; }

    sum.textContent = "Searching...";
    stashActive();
    const nodes = await allFileNodes();
    await prefetchServerFiles();
    if (run !== fsRun) return;

    const found = [];
    let hits = 0, rows = 0, failed = 0;
    /* a few reads at a time: quick on a local disk, polite to the exe's server */
    for (let i = 0; i < nodes.length; i += 8) {
      const batch = nodes.slice(i, i + 8);
      const texts = await Promise.all(batch.map(n => searchText(n).catch(() => null)));
      if (run !== fsRun) return;                     /* a newer query took over */
      texts.forEach((text, j) => {
        if (text == null) { failed++; return; }
        const r = hitsByLine(text, rx);
        if (!r.count) return;
        hits += r.count;
        found.push({ node: batch[j], rows: r.rows, count: r.count });
        rows += r.rows.length;
      });
    }

    fsLast = { q: q, cs: cs, re: re };
    fsNodes = new Map(found.map(f => [f.node.path, f.node]));
    sum.textContent = hits
      ? hits.toLocaleString() + " result" + (hits === 1 ? "" : "s") + " in " + found.length +
        " file" + (found.length === 1 ? "" : "s") + (failed ? " (" + failed + " unreadable)" : "")
      : "No results in " + nodes.length + " file" + (nodes.length === 1 ? "" : "s");

    let shown = 0;
    out.innerHTML = found.map(f => {
      const p = f.node.path, i = p.lastIndexOf("/");
      let html = '<div class="sr-file' + (fsShut.has(p) ? " shut" : "") + '" data-sr-file="' + esc(p) + '" title="' + esc(p) + '">' +
        ICO_CHEV + ICO_FILE + '<span class="sr-name">' + esc(f.node.name) + "</span>" +
        '<span class="sr-dir">' + (i > 0 ? esc(p.slice(0, i)) : "") + "</span>" +
        '<span class="sr-n">' + f.count + "</span></div><div class=\"sr-hits\">";
      for (const r of f.rows) {
        if (shown >= FS_MAX_ROWS) break;
        shown++;
        html += '<div class="sr-hit" data-sr-path="' + esc(p) + '" data-sr-pos="' + r.pos + '" data-sr-ord="' + r.ord +
          '" title="' + esc(r.text.trim().slice(0, 300)) + '"><span class="sr-ln">' + (r.line + 1) + "</span>" +
          '<span class="sr-txt">' + snippet(r) + "</span></div>";
      }
      return html + "</div>";
    }).join("") + (shown < rows ? '<div class="sr-more">Showing the first ' + FS_MAX_ROWS.toLocaleString() +
      " lines - narrow the search to see the rest</div>" : "");
  }

  /* opens the file and hands the query to the find bar, landing on that exact hit */
  async function openSearchHit(el) {
    const n = fsNodes.get(el.dataset.srPath);
    if (!n || !fsLast) return;
    const pos = +el.dataset.srPos, ord = +el.dataset.srOrd;
    document.querySelectorAll(".sr-hit.cur").forEach(x => x.classList.remove("cur"));
    el.classList.add("cur");
    await openFileNode(n);

    $("#findInput").value = fsLast.q;
    $("#findCase").checked = fsLast.cs;
    $("#findRe").checked = fsLast.re;
    $("#findbar").hidden = false;
    findHL = true;
    setReplaceEnabled(!previewMode());
    runFind();
    const n2 = totalHits();
    if (!n2) return;
    if (previewMode()) mIndex = Math.min(ord, n2 - 1);
    else {
      const k = matches.findIndex(m => m[0] === pos);
      mIndex = k >= 0 ? k : Math.min(ord, n2 - 1);
    }
    $("#findCount").textContent = (mIndex + 1) + " / " + n2;
    if (previewMode()) pvFocus(); else focusMatch();
    autoCloseSide();
  }

  function showFolderSearch() {
    if (!state.settings.sidebar) setSidebar(true);
    const sel = ed.value.slice(ed.selectionStart, ed.selectionEnd);
    if (sel && sel.length < 90 && sel.indexOf("\n") === -1) $("#fsInput").value = sel.trim();
    showSideTab("search");
    $("#fsInput").focus();
    $("#fsInput").select();
  }

  /* ---------- following links from one file to another ---------- */

  /* "../notes.md" seen from "docs/guide.md" -> "notes.md" */
  function resolveRel(fromPath, href) {
    const base = fromPath ? fromPath.split("/").slice(0, -1) : [];
    const out = href.charAt(0) === "/" ? [] : base.slice();
    const segs = href.replace(/^\/+/, "").split("/");
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      if (!s || s === ".") continue;
      if (s === "..") { out.pop(); continue; }
      out.push(s);
    }
    return out.join("/");
  }

  /* walks the tree by path, opening directories on the way if needed */
  async function findFileNode(path) {
    if (!tree) return null;
    const parts = path.split("/").filter(p => p);
    if (!parts.length) return null;
    let node = tree;
    for (let i = 0; i < parts.length; i++) {
      if (!node.kids && node.handle) await loadDir(node);
      const kids = node.kids || [];
      const last = i === parts.length - 1;
      const want = parts[i].toLowerCase();
      let next = kids.find(k => k.name.toLowerCase() === want &&
        (last ? k.kind === "file" : k.kind === "dir"));
      /* a link written without the extension still finds the file */
      if (!next && last && want.indexOf(".") === -1)
        next = kids.find(k => k.kind === "file" &&
          k.name.toLowerCase().replace(MD_EXT, "") === want);
      if (!next) return null;
      node = next;
    }
    return node.kind === "file" ? node : null;
  }

  function scrollToAnchor(id) {
    if (!id) return;
    let el = null;
    try {
      el = preview.querySelector('[id="' + CSS.escape(MD.ID_PREFIX + id) + '"]') ||
        preview.querySelector('[id="' + CSS.escape(id) + '"]');
    } catch (e) { }
    if (!el) return;
    /* measured from the rects, so it does not depend on which ancestor happens
       to be positioned, and assigned directly because it always takes effect */
    const delta = el.getBoundingClientRect().top - previewPane.getBoundingClientRect().top;
    previewPane.scrollTop = Math.max(0, previewPane.scrollTop + delta - 16);
  }

  /* Opens the linked file as a tab instead of letting the browser navigate away,
     which would throw the whole app (and anything unsaved) out of the window. */
  async function followLink(href) {
    const h = href.indexOf("#");
    const hash = h >= 0 ? href.slice(h + 1) : "";
    let path = h >= 0 ? href.slice(0, h) : href;
    try { path = decodeURIComponent(path); } catch (e) { }

    if (!path) { scrollToAnchor(hash); return; }           /* plain #anchor */
    if (IMG_EXT.test(path) && imgBase(active())) {
      const b = imgBase(active());
      showImage(b.ws + ":" + resolveRel(b.doc, path)); return;
    }
    if (!root) { toast(tr("Open a folder first to follow links between files")); return; }

    const t = active();
    const target = resolveRel(t && t.kind === "file" ? t.path : "", path);
    const node = await findFileNode(target);
    if (!node) { toast('"' + path + '" is not in the opened folder'); return; }

    const already = tabs.some(x => x.kind === "file" && x.path === node.path && x.id === activeTab);
    await openFileNode(node);
    if (hash) setTimeout(() => scrollToAnchor(hash), already ? 0 : 140);
  }

  /* ---------- pictures: pasting, dropping and showing them ---------- */
  /* A screenshot pasted into the editor becomes a real image file next to the
     document - "assets/notes-20261011-153012.png" - and a link to it, the way Word
     drops a picture where the caret is. Files and Docs from the exe go through the
     launcher, a folder opened in the browser goes through its handle, and anything
     with no folder behind it (a browser-only document, a read-only folder) gets the
     picture embedded in the text instead, so a paste never just fails. */
  const IMG_EXT = /\.(png|jpe?g|gif|webp|bmp|svg|avif|ico)$/i;
  const IMG_TYPE = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp",
    "image/bmp": "bmp", "image/svg+xml": "svg", "image/avif": "avif", "image/x-icon": "ico" };
  const ASSET_DIR = "assets";
  /* Outside the documents, the tree shows only what is in an assets folder - at any
     depth, and every kind of file in it, so you can see what is really in there. */
  const inAssets = path => String(path).split("/").slice(0, -1)
    .some(s => s.toLowerCase() === ASSET_DIR);
  const ICO_DOC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z"/><path d="M14 3v5h5"/></svg>';
  const isRelUrl = u => !!u && !/^[a-z][a-z0-9+.-]*:/i.test(u) && u.indexOf("//") !== 0 && u.charAt(0) !== "#";
  const assetUrl = (ws, path) => "/__asset?k=" + encodeURIComponent(SRV_KEY) +
    "&w=" + encodeURIComponent(ws) + "&p=" + encodeURIComponent(path);

  /* Which folder a tab's pictures are read from: the exe's workspace ("ws"), a
     folder handle ("fs"), or none. `doc` is the document's own path in it, which
     relative image paths are resolved against. */
  function imgBase(t) {
    if (!t) return null;
    if (t.kind === "file" && t.srv && root && root.mode === "server")
      return { ws: SRV_WS, doc: t.path, write: true };
    if (t.kind === "file" && t.handle && root && root.mode === "fs")
      return { ws: "fs", doc: t.path, write: !root.readonly };
    if (t.kind === "file" && root && root.mode === "flat")
      return { ws: "flat", doc: t.path, write: false };
    if (t.kind === "local" && LIB.ok) {
      const d = libDocOf(t);
      if (d && d.file) return { ws: "lib", doc: d.file, write: !libClash(d.file) };
    }
    return null;
  }

  /* Pictures are read once and kept as blob: URLs. The preview is rebuilt on every
     pause in typing, and a plain URL would be fetched again each time - with the
     picture blinking out while it was. Keyed "ws:path". */
  const imgs = new Map();         /* key -> { url, size } | { failed: true } | { p: Promise } */
  function dropImages() {
    imgs.forEach(v => { if (v.url) URL.revokeObjectURL(v.url); });
    imgs.clear();
  }
  async function fsFileAt(path) {
    const parts = path.split("/");
    let dir = root.handle;
    for (let i = 0; i < parts.length - 1; i++) dir = await dir.getDirectoryHandle(parts[i]);
    return (await dir.getFileHandle(parts[parts.length - 1])).getFile();
  }
  async function imgFetch(key) {
    const i = key.indexOf(":"), ws = key.slice(0, i), path = key.slice(i + 1);
    if (ws === "fs") {
      if (!root || root.mode !== "fs") throw new Error("no folder");
      return fsFileAt(path);
    }
    if (ws === "flat") {
      const n = treeNodeAt(path);
      if (!n || !n.file) throw new Error("not in the folder");
      return n.file;
    }
    const r = await fetch(assetUrl(ws, path));
    if (!r.ok) throw new Error(r.status);
    return r.blob();
  }
  function imgPut(key, blob) {
    const old = imgs.get(key);
    if (old && old.url) URL.revokeObjectURL(old.url);
    const v = { url: URL.createObjectURL(blob), size: blob.size };
    imgs.set(key, v);
    return v;
  }
  /* fills in every picture on screen that was waiting for this one */
  function imgPaint(key) {
    const v = imgs.get(key);
    preview.querySelectorAll("img[data-img]").forEach(el => {
      if (el.dataset.img !== key) return;
      if (v && v.url) { el.src = v.url; el.classList.remove("img-missing"); }
      else { el.classList.add("img-missing"); el.title = tr("Image not found: ") + key.slice(key.indexOf(":") + 1); }
    });
  }
  function imgLoad(key) {
    const have = imgs.get(key);
    if (have) return have.p || Promise.resolve(have);
    const p = imgFetch(key)
      .then(b => imgPut(key, b))
      .catch(() => { const v = { failed: true }; imgs.set(key, v); return v; })
      .then(v => { imgPaint(key); return v; });
    imgs.set(key, { p: p });
    return p;
  }
  MD.setImageHook(url => {
    if (!isRelUrl(url)) return null;
    const base = imgBase(active());
    if (!base) return null;
    let rel = url.replace(/[?#].*$/, "");
    try { rel = decodeURIComponent(rel); } catch (e) { }
    const path = resolveRel(base.doc, rel);
    if (!path || !IMG_EXT.test(path)) return null;
    const key = base.ws + ":" + path;
    const v = imgs.get(key);
    if (v && v.url) return { src: v.url, key: key };
    imgLoad(key);
    return { src: null, key: key };
  });
  /* Coming back to the window is when a picture may have been edited elsewhere -
     touched up in Paint, say - so re-read the ones on file and swap any that changed. */
  async function imgRecheck() {
    for (const [key, v] of Array.from(imgs)) {
      if (!v.url) { if (v.failed) imgs.delete(key); continue; }
      try {
        const b = await imgFetch(key);
        if (b.size !== v.size) { imgPut(key, b); imgPaint(key); }
      } catch (e) { }
    }
    if (preview.querySelector("img.img-missing")) renderNow();
  }

  /* "notes-20261011-153012.png": the document's name, so a folder of assets still
     says what each picture belongs to, and the time, so names never collide. */
  function imgName(file, docPath) {
    const ext = IMG_TYPE[file.type] || ((file.name || "").match(/\.([a-z0-9]+)$/i) || [])[1] || "png";
    const clean = s => String(s).normalize("NFC").replace(/[^\p{L}\p{N}._-]+/gu, "-")
      .replace(/-+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 60);
    /* a dropped file keeps its own name; a pasted one is always "image.png" */
    const own = file.name && !/^image\.\w+$/i.test(file.name) ? clean(file.name.replace(/\.[^.]+$/, "")) : "";
    if (own) return own + "." + ext.toLowerCase();
    const d = new Date(), p = n => String(n).padStart(2, "0");
    const stamp = d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" +
      p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
    const doc = clean((docPath || "").replace(/^.*\//, "").replace(MD_EXT, "")) || "image";
    return doc + "-" + stamp + "." + ext.toLowerCase();
  }

  /* Writes the picture beside the document and answers its path from the document,
     e.g. "assets/notes-20261011-153012.png". Throws if it could not be written. */
  async function imgWrite(base, file) {
    const dir = base.doc.split("/").slice(0, -1).join("/");
    const want = (dir ? dir + "/" : "") + ASSET_DIR + "/" + imgName(file, base.doc);
    let written;
    if (base.ws === "fs") {
      let h = root.handle;
      const segs = want.split("/");
      for (let i = 0; i < segs.length - 1; i++) h = await h.getDirectoryHandle(segs[i], { create: true });
      /* never over another picture: a taken name gets a number */
      let name = segs[segs.length - 1];
      const stem = name.replace(/\.[^.]+$/, ""), ext = name.slice(stem.length);
      for (let n = 2; ; n++) {
        try { await h.getFileHandle(name); name = stem + "-" + n + ext; } catch (e) { break; }
      }
      const fh = await h.getFileHandle(name, { create: true });
      const w = await fh.createWritable();
      await w.write(file);
      await w.close();
      written = segs.slice(0, -1).concat(name).join("/");
    } else {
      const r = await fetch(assetUrl(base.ws, want), { method: "POST", body: file });
      if (!r.ok) throw new Error((await r.text()) || r.status);
      written = (await r.json()).path || want;
    }
    imgPut(base.ws + ":" + written, file);     /* on screen at once, no round trip */
    imgListed(base.ws, written);
    return dir ? written.slice(dir.length + 1) : written;
  }

  /* With nowhere to put a file, the picture goes in the text itself. As a reference
     at the very end, so the paragraph it sits in reads "![image][img-1]" and not a
     hundred thousand characters of base64. Big screenshots are re-encoded as WebP
     when that is smaller, since all of this lives in browser storage. */
  async function imgDataUrl(file) {
    const read = b => new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result));
      fr.onerror = () => rej(fr.error);
      fr.readAsDataURL(b);
    });
    if (file.size > 150 * 1024 && /^image\/(png|bmp)$/.test(file.type) && window.createImageBitmap) {
      try {
        const bmp = await createImageBitmap(file);
        const c = document.createElement("canvas");
        c.width = bmp.width; c.height = bmp.height;
        c.getContext("2d").drawImage(bmp, 0, 0);
        const webp = await new Promise(res => c.toBlob(res, "image/webp", 0.9));
        if (webp && webp.type === "image/webp" && webp.size < file.size) return read(webp);
      } catch (e) { }
    }
    return read(file);
  }
  function embedImage(alt, dataUrl) {
    const used = (ed.value.match(/^\[img-(\d+)\]:/gm) || []).map(x => parseInt(x.replace(/\D/g, ""), 10));
    const n = (used.length ? Math.max.apply(null, used) : 0) + 1;
    insertImageText("![" + alt + "][img-" + n + "]");
    const at = ed.selectionStart;
    const tail = (ed.value.endsWith("\n") ? "" : "\n") + "\n[img-" + n + "]: " + dataUrl;
    ed.setSelectionRange(ed.value.length, ed.value.length);
    insert(tail);
    ed.setSelectionRange(at, at);
    ed.focus();
  }

  /* an image on a line of its own, whatever the caret was in the middle of */
  function insertImageText(md) {
    const v = ed.value, s = ed.selectionStart, e = ed.selectionEnd;
    const before = s > 0 && v[s - 1] !== "\n" ? "\n" : "";
    const after = e < v.length && v[e] !== "\n" ? "\n" : "";
    insert(before + md + after);
    if (after) ed.setSelectionRange(ed.selectionStart - 1, ed.selectionStart - 1);
  }

  let imgBusy = false;
  async function addImages(files) {
    const t = active();
    if (!t || !files.length) return;
    if (imgBusy) return;
    imgBusy = true;
    /* the caret may move while a file is written, so put it back where the paste was */
    const s = ed.selectionStart, e = ed.selectionEnd, tabId = t.id;
    const base = imgBase(t);
    let saved = 0, embedded = 0, last = "";
    try {
      for (const f of files) {
        const alt = f.name && !/^image\.\w+$/i.test(f.name) ? f.name.replace(/\.[^.]+$/, "").replace(/[\[\]]/g, "") : "image";
        let rel = null;
        if (base && base.write) {
          try { rel = await imgWrite(base, f); }
          catch (err) { toast(tr("Could not save the image: ") + (err.message || err.name)); return; }
        }
        let data = null;
        if (!rel) data = await imgDataUrl(f);
        if (activeTab !== tabId) return;          /* switched documents meanwhile */
        if (saved + embedded === 0) ed.setSelectionRange(s, e);
        if (rel) {
          /* the launcher names a clash "shot 2.png", and a space would end the link */
          insertImageText("![" + alt + "](" + rel.replace(/ /g, "%20") + ")");
          saved++; last = rel;
        } else { embedImage(alt, data); embedded++; }
      }
    } finally { imgBusy = false; }
    /* the library's list was drawn when the file was written, before the link went
       in - drawn again now, or a picture just pasted reads "not used" for a second */
    if (saved && base && base.ws === "lib") renderLibAssets();
    if (saved === 1) toast(tr("Image saved as ") + last);
    else if (saved) toast(tr("Images saved: ") + saved + " → " + ASSET_DIR + "/");
    if (embedded) toast(tr("Image embedded in the document - open a folder to keep pictures as files"));
  }

  /* ---------- seeing what pictures there are ---------- */
  /* The Explorer lists pictures beside the documents, so an assets folder shows what
     is in it, and the Docs pane lists the library's own under its documents - each
     with the document that shows it, or a warning that none does. Clicking either
     opens the picture with its size, where it is, and a button to put it in the
     document you are writing. */
  function treeNodeAt(path) {
    let hit = null;
    (function walk(n) {
      if (hit || !n) return;
      if (n.path === path && n.kind !== "dir") { hit = n; return; }
      (n.kids || []).forEach(walk);
    })(tree);
    return hit;
  }
  function treeImgKey(n) {
    const ws = root.mode === "server" ? SRV_WS : root.mode === "fs" ? "fs" : "flat";
    return ws + ":" + n.path;
  }

  /* a new picture belongs in whichever list shows its folder */
  /* The first paste into a document creates its assets folder, and a folder that has
     just appeared arrives closed - so the tree changed, but all you saw was a new
     folder name, or nothing if another pane was showing. So the new file is shown:
     every folder on its way is opened, and the row is scrolled to and flashed. */
  async function imgListed(ws, path) {
    if (ws === "lib") {
      if (LIB.assets.indexOf(path) < 0) { LIB.assets.push(path); LIB.assets.sort(); }
      $("#docAssets").classList.remove("shut");
      markFlash(path);
      renderLibAssets();
      flashRow($('#docAssets [data-as="' + CSS.escape(path) + '"]'));
      /* the library itself may also be the folder open in the Explorer */
      if (root && root.mode === "server" && root.disk && LIB.path &&
          root.disk.toLowerCase() === LIB.path.toLowerCase()) {
        await loadServerWorkspace(false, true);
        await revealInTree(path);
      }
      return;
    }
    if (ws === "fs" && root && root.mode === "fs") await refreshTree(tree);
    else if (root && root.mode === "server" && ws === SRV_WS) await loadServerWorkspace(false, true);
    else return;
    showSideTab("files");
    await revealInTree(path);
  }

  async function revealInTree(path) {
    if (!tree) return;
    const parts = path.split("/");
    let n = tree;
    for (let i = 0; i < parts.length - 1; i++) {
      const want = parts.slice(0, i + 1).join("/");
      const next = (n.kids || []).find(k => k.kind === "dir" && k.path === want);
      if (!next) break;
      next.open = true;
      if (next.kids === null && next.handle) await loadDir(next);
      n = next;
    }
    markFlash(path);
    renderTree();
    flashRow($('#treeBody .tree-row[data-path="' + CSS.escape(path) + '"]'));
  }

  /* Remembered rather than only set on the element: inserting the link marks the file
     as edited, which redraws the tree straight away and would wipe the class. */
  const flashing = new Map();
  function markFlash(path) {
    clearTimeout(flashing.get(path));
    flashing.set(path, setTimeout(() => flashing.delete(path), 1800));
  }
  function flashRow(el) {
    if (!el) return;
    el.scrollIntoView({ block: "nearest" });
    el.classList.remove("flash");
    void el.offsetWidth;                 /* restart the animation for a second paste */
    el.classList.add("flash");
  }

  /* "assets/a.png" as the document at "notes/x.md" would write it: "../assets/a.png" */
  function relFrom(docPath, target) {
    const from = docPath.split("/").slice(0, -1), to = target.split("/");
    let i = 0;
    while (i < from.length && i < to.length - 1 && from[i] === to[i]) i++;
    return "../".repeat(from.length - i) + to.slice(i).join("/");
  }

  /* which documents show this picture - the library's are all in memory already */
  function libUsers(path) {
    const name = path.replace(/^.*\//, "");
    const enc = name.replace(/ /g, "%20");
    return state.docs.filter(d => {
      const c = d.content || "";
      return c.indexOf(name) >= 0 || c.indexOf(enc) >= 0;
    });
  }

  function renderLibAssets() {
    const box = $("#docAssets");
    const list = LIB.ok ? LIB.assets : [];
    box.hidden = !list.length;
    if (!list.length) { box.innerHTML = ""; return; }
    const q = $("#docSearch").value.trim().toLowerCase();
    const shown = list.filter(p => !q || p.toLowerCase().includes(q));
    box.innerHTML =
      '<button type="button" class="as-head" data-as-toggle>' + ICO_CHEV +
      esc(ASSET_DIR) + " (" + list.length + ")</button>" +
      '<div class="as-list">' + shown.map(p => {
        const users = libUsers(p);
        const dir = p.indexOf("/") >= 0 ? p.replace(/\/[^/]*$/, "") + "/" : "";
        const meta = users.length
          ? tr("in ") + users.map(d => d.name || tr("Untitled")).join(", ")
          : tr("not used in any document");
        return '<div class="as-row' + (flashing.has(p) ? " flash" : "") + '" data-as="' + esc(p) + '" title="' + esc(LIB.path + "\\" + p.replace(/\//g, "\\")) + '">' +
          (IMG_EXT.test(p) ? '<img class="as-th" data-as-th="' + esc(p) + '" alt="">'
            : '<span class="as-th as-file">' + ICO_DOC + "</span>") +
          '<div class="as-main"><div class="as-name">' + esc(p.replace(/^.*\//, "")) + "</div>" +
          '<div class="as-meta' + (users.length ? "" : " unused") + '">' + (dir ? esc(dir) + " · " : "") + esc(meta) + "</div></div></div>";
      }).join("") + "</div>";
    if (box.classList.contains("shut")) return;
    /* thumbnails as they arrive, from the same cache the preview uses */
    box.querySelectorAll("img[data-as-th]").forEach(el => {
      imgLoad("lib:" + el.dataset.asTh).then(v => { if (v && v.url) el.src = v.url; });
    });
  }

  let ivKey = null;
  async function showImage(key, label) {
    const i = key.indexOf(":"), ws = key.slice(0, i), path = key.slice(i + 1);
    ivKey = key;
    const disk = ws === "lib" ? LIB.path : (root && root.mode === "server" && ws === SRV_WS ? root.disk : "");
    const full = disk ? disk + "\\" + path.replace(/\//g, "\\") : (root ? root.name + "/" : "") + path;
    $("#ivName").textContent = path.replace(/^.*\//, "");
    $("#ivPath").textContent = full;
    $("#ivPath").title = full;
    $("#ivImg").removeAttribute("src");
    $("#ivInfo").textContent = tr("Loading...");

    /* insert only where the link would resolve: the same folder as the document */
    const base = imgBase(active());
    const can = !!base && base.ws === ws;
    $("#ivInsert").disabled = !can;
    $("#ivInsert").title = can ? relFrom(base.doc, path)
      : tr("Open a document from the same folder to insert this picture");
    $("#imgView").hidden = false;

    /* anything else in an assets folder: where it is, and a link to it */
    $("#ivImg").hidden = !IMG_EXT.test(path);
    if (!IMG_EXT.test(path)) {
      $("#ivInfo").textContent = tr("No preview for this kind of file");
      return;
    }
    const v = await imgLoad(key);
    if (ivKey !== key) return;                     /* another one was opened meanwhile */
    if (!v || !v.url) { $("#ivInfo").textContent = tr("Image not found: ") + path; return; }
    const img = $("#ivImg");
    img.src = v.url;
    await new Promise(res => { if (img.complete) res(); else { img.onload = res; img.onerror = res; } });
    if (ivKey !== key) return;
    const kb = v.size < 1024 * 1024 ? Math.max(1, Math.round(v.size / 1024)) + " KB"
      : (v.size / 1024 / 1024).toFixed(1) + " MB";
    let info = (img.naturalWidth ? img.naturalWidth + " × " + img.naturalHeight + " px · " : "") + kb;
    if (ws === "lib") {
      const users = libUsers(path);
      info += " · " + (users.length ? tr("in ") + users.map(d => d.name || tr("Untitled")).join(", ")
        : tr("not used in any document"));
    }
    $("#ivInfo").textContent = info;
  }
  function hideImage() { $("#imgView").hidden = true; ivKey = null; }

  /* What a paste is carrying, if it is pictures. Copying from Excel or Word puts a
     picture of the selection on the clipboard alongside the text, and the text is
     what was meant - so a picture only counts when there is no text with it. */
  function clipImages(dt) {
    if (!dt) return [];
    const text = dt.getData("text/plain");
    if (text && text.trim()) return [];
    const out = [];
    Array.prototype.forEach.call(dt.items || [], it => {
      if (it.kind !== "file" || !/^image\//.test(it.type)) return;
      const f = it.getAsFile();
      if (f) out.push(f);
    });
    return out;
  }

  /* The export is a single file to send to someone, so pictures go inside it. The
     preview's own addresses would mean nothing on another machine - and the
     launcher's carry the key. */
  async function inlineImages(box) {
    for (const el of Array.from(box.querySelectorAll("img[data-img]"))) {
      const v = await imgLoad(el.dataset.img);
      el.removeAttribute("data-img");
      if (!v || !v.url) continue;
      try {
        const b = await (await fetch(v.url)).blob();
        el.src = await new Promise((res, rej) => {
          const fr = new FileReader();
          fr.onload = () => res(String(fr.result));
          fr.onerror = () => rej(fr.error);
          fr.readAsDataURL(b);
        });
      } catch (e) { }
    }
  }

  /* ---------- the right-click menu and what it does to files ---------- */
  /* VS Code's Explorer menu: Open, Reveal in File Explorer, Copy Path, Copy Relative
     Path, Rename (F2) and Delete, on files, on what is in an assets folder, on Docs and
     on editor tabs. Renaming happens in place in the tree, the name selected without
     its extension; links that pointed at the old name are offered an update, the way
     VS Code's Markdown support does. Files from the exe go through /__entry (the
     Recycle Bin for a delete); a folder opened in the browser goes through its handle,
     where a delete cannot be undone and says so. */
  const entryUrl = (ws, p, op, to) => "/__entry?k=" + encodeURIComponent(SRV_KEY) +
    "&w=" + encodeURIComponent(ws) + "&p=" + encodeURIComponent(p) +
    (op ? "&op=" + op : "") + (to != null ? "&to=" + encodeURIComponent(to) : "");
  const canEdit = () => !!root && !root.readonly && (root.mode === "server" || root.mode === "fs");
  const winPath = p => String(p).replace(/\//g, "\\");

  /* the full path of a tree entry or document, as far as this page can know it */
  function fullPathOf(o) {
    if (o.doc) return LIB.ok && o.doc.file ? LIB.path + "\\" + winPath(o.doc.file) : o.doc.name;
    if (root && root.mode === "server" && root.disk) return root.disk + "\\" + winPath(o.path);
    return (root ? root.name + "/" : "") + o.path;
  }
  function relPathOf(o) {
    if (o.doc) return o.doc.file || o.doc.name;
    return root && root.mode === "server" ? winPath(o.path) : o.path;
  }

  let ctxEl = null;
  function hideCtx() { if (ctxEl) { ctxEl.remove(); ctxEl = null; } }
  function showCtx(x, y, items) {
    hideCtx();
    const m = document.createElement("div");
    m.className = "ctx";
    m.setAttribute("role", "menu");
    items.forEach(it => {
      if (it === "-") { m.appendChild(Object.assign(document.createElement("div"), { className: "ctx-sep" })); return; }
      const b = document.createElement("button");
      b.type = "button";
      b.className = "ctx-i";
      b.disabled = !!it.disabled;
      b.setAttribute("role", "menuitem");
      b.innerHTML = "<span>" + esc(tr(it.label)) + "</span>" + (it.keys ? "<kbd>" + esc(it.keys) + "</kbd>" : "");
      b.addEventListener("click", () => { hideCtx(); it.run(); });
      m.appendChild(b);
    });
    document.body.appendChild(m);
    const r = m.getBoundingClientRect();
    m.style.left = Math.max(4, Math.min(x, innerWidth - r.width - 4)) + "px";
    m.style.top = Math.max(4, Math.min(y, innerHeight - r.height - 4)) + "px";
    ctxEl = m;
    const first = m.querySelector(".ctx-i:not(:disabled)");
    if (first) first.focus();
  }
  async function copyOut(text, what) { await copyText(text, tr(what) + ": " + text); }

  /* which row of the tree is selected, so F2, Delete and Enter there act on it */
  let treeSel = null;
  function selectRow(path) {
    treeSel = path;
    document.querySelectorAll("#treeBody .tree-row.selected").forEach(r => r.classList.remove("selected"));
    const r = treeRowEl(path);
    if (r) r.classList.add("selected");
  }
  const treeRowEl = p => document.querySelector('#treeBody .tree-row[data-path="' + CSS.escape(p) + '"]');

  function treeItems(n) {
    const exe = root && root.mode === "server";
    const common = [
      { label: "Reveal in File Explorer", keys: "Shift+Alt+R", run: () => revealEntry(n), disabled: !exe || n.kind === "dir" },
      "-",
      { label: "Copy Path", keys: "Shift+Alt+C", run: () => copyOut(fullPathOf(n), "Copied") },
      { label: "Copy Relative Path", keys: "Ctrl+Shift+Alt+C", run: () => copyOut(relPathOf(n), "Copied") }
    ];
    if (n.kind === "dir") {
      return [{ label: "New File…", run: () => newFileInFolder(n.path), disabled: !canEdit() }, "-"].concat(common.slice(2));
    }
    const head = n.kind === "img"
      ? [{ label: "Open", run: () => showImage(treeImgKey(n), n.path) },
         { label: "Insert into document", run: () => insertEntryLink(n), disabled: !imgBase(active()) || imgBase(active()).ws !== treeImgKey(n).split(":")[0] }]
      : [{ label: "Open", run: () => openFileNode(n) }];
    return head.concat(["-"], common, ["-",
      { label: "Rename…", keys: "F2", run: () => startRename(n.path), disabled: !canEdit() },
      { label: "Delete", keys: "Delete", run: () => deleteEntry(n), disabled: !canEdit() }]);
  }
  function docItems(d) {
    return [
      { label: "Open", run: () => openDoc(d.id) },
      "-",
      { label: "Reveal in File Explorer", keys: "Shift+Alt+R", run: () => revealDoc(d), disabled: !(LIB.ok && d.file) },
      { label: "Copy Path", keys: "Shift+Alt+C", run: () => copyOut(fullPathOf({ doc: d }), "Copied"), disabled: !(LIB.ok && d.file) },
      "-",
      { label: "Rename…", keys: "F2", run: () => renameDoc(d) },
      { label: "Delete", run: () => deleteDoc(d.id) }
    ];
  }
  function tabItems(t) {
    const n = t.kind === "file" ? nodeOfPath(t.path) : null;
    const d = libDocOf(t);
    return [
      { label: "Close", keys: "Ctrl+W", run: () => closeTab(t.id) },
      { label: "Close Others", run: () => closeOthers(t.id), disabled: tabs.length < 2 },
      { label: "Close All", keys: "Ctrl+K Ctrl+W", run: closeAllTabs },
      "-",
      { label: "Copy Tab", run: () => copyTab(t) },
      { label: "Paste Tab", run: pasteTab, disabled: !tabClip },
      "-",
      { label: "Copy Path", keys: "Shift+Alt+C", run: () => copyOut(n ? fullPathOf(n) : fullPathOf({ doc: d || { name: t.name } }), "Copied") },
      { label: "Copy Relative Path", keys: "Ctrl+Shift+Alt+C", run: () => copyOut(n ? relPathOf(n) : relPathOf({ doc: d || { name: t.name } }), "Copied") },
      { label: "Reveal in File Explorer", keys: "Shift+Alt+R", run: () => n ? revealEntry(n) : revealDoc(d),
        disabled: n ? !(root && root.mode === "server") : !(d && LIB.ok && d.file) },
      "-",
      { label: "Rename…", keys: "F2", run: () => renameTab(t), disabled: t.kind === "file" && !canEdit() }
    ];
  }

  function nodeOfPath(p) {
    let hit = null;
    (function walk(n) { if (hit || !n) return; if (n.path === p && n.kind !== "dir") { hit = n; return; } (n.kids || []).forEach(walk); })(tree);
    return hit;
  }

  function insertEntryLink(n) {
    const base = imgBase(active());
    if (!base) return;
    const name = n.name, link = relFrom(base.doc, n.path).replace(/ /g, "%20");
    ed.focus();
    insertImageText(IMG_EXT.test(name) ? "![" + name.replace(/\.[^.]+$/, "") + "](" + link + ")" : "[" + name + "](" + link + ")");
  }

  async function revealEntry(n) {
    try {
      const r = await fetch(entryUrl(SRV_WS, n.path, "reveal"), { method: "POST" });
      if (!r.ok) throw new Error(await r.text());
    } catch (e) { toast(tr("Could not open that folder")); }
  }
  async function revealDoc(d) {
    if (!d || !LIB.ok || !d.file) return;
    libFlush(d.id);
    try {
      const r = await fetch(entryUrl("lib", d.file, "reveal"), { method: "POST" });
      if (!r.ok) throw new Error(await r.text());
    } catch (e) { toast(tr("Could not open that folder")); }
  }

  /* a document's name is its title, so renaming one is the title box */
  function renameDoc(d) {
    if (!(active() && active().kind === "local" && active().docId === d.id)) openDoc(d.id);
    const ti = $("#docTitle");
    ti.focus();
    ti.select();
  }
  function renameTab(t) {
    if (t.kind === "local") { const d = libDocOf(t); if (d) renameDoc(d); return; }
    if (!canEdit()) return;
    showSideTab("files");
    if (!state.settings.sidebar) setSidebar(true);
    startRename(t.path);
  }

  /* VS Code renames in place: the row becomes a box with the name selected up to
     its extension. Enter or leaving the box keeps it, Esc puts the name back. */
  async function startRename(path) {
    if (!canEdit()) return;
    await revealInTree(path);
    const row = treeRowEl(path), n = nodeOfPath(path);
    if (!row || !n) return;
    selectRow(path);
    const name = row.querySelector(".tree-name");
    const box = document.createElement("input");
    box.className = "tree-rename";
    box.value = n.name;
    box.spellcheck = false;
    name.replaceWith(box);
    box.focus();
    const dot = n.name.lastIndexOf(".");
    box.setSelectionRange(0, dot > 0 ? dot : n.name.length);
    let done = false;
    const finish = keep => {
      if (done) return;
      done = true;
      if (keep && box.value.trim() && box.value.trim() !== n.name) renameEntry(n, box.value.trim());
      else renderTree();
    };
    box.addEventListener("keydown", e => {
      e.stopPropagation();
      if (e.key === "Enter") { e.preventDefault(); finish(true); }
      else if (e.key === "Escape") { e.preventDefault(); finish(false); }
    });
    box.addEventListener("blur", () => finish(true));
    box.addEventListener("click", e => e.stopPropagation());
  }

  async function parentDirHandle(path) {
    let h = root.handle;
    const segs = path.split("/").slice(0, -1);
    for (const s of segs) h = await h.getDirectoryHandle(s);
    return h;
  }

  async function renameEntry(n, name) {
    if (/[\\/:*?"<>|]/.test(name) || /[. ]$/.test(name)) {
      toast(tr("That is not a valid file name.")); renderTree(); return;
    }
    /* a document keeps being one: typing "notes" means "notes.md" */
    if (n.kind === "file" && !MD_EXT.test(name)) {
      if (!/\.[^.]+$/.test(name)) name += (n.name.match(/\.[^.]+$/) || [".md"])[0];
      else { toast(tr("A document has to keep a Markdown extension such as .md.")); renderTree(); return; }
    }
    const dir = n.path.indexOf("/") >= 0 ? n.path.replace(/\/[^/]*$/, "") + "/" : "";
    const oldPath = n.path, newPath = dir + name;
    let newHandle = null;
    try {
      if (root.mode === "server") {
        const r = await fetch(entryUrl(SRV_WS, oldPath, "rename", name), { method: "POST" });
        if (!r.ok) throw new Error(await r.text());
      } else {
        const parent = await parentDirHandle(oldPath);
        const caseOnly = name.toLowerCase() === n.name.toLowerCase();
        if (!caseOnly) {
          let taken = false;
          try { await parent.getFileHandle(name); taken = true; } catch (e) { }
          if (taken) throw new Error(tr("A file named ") + name + tr(" is already there."));
        }
        if (n.handle && n.handle.move) { await n.handle.move(name); newHandle = n.handle; }
        else {
          newHandle = await parent.getFileHandle(name, { create: true });
          const w = await newHandle.createWritable();
          await w.write(await n.handle.getFile());
          await w.close();
          await parent.removeEntry(n.name);
        }
      }
    } catch (e) {
      toast(tr("Could not rename: ") + (e.message || e.name));
      renderTree();
      return;
    }
    /* everything that knew the old name follows */
    tabs.forEach(t => {
      if (t.kind === "file" && t.path === oldPath) {
        t.path = newPath; t.name = name;
        if (newHandle) t.handle = newHandle;
        if (t.id === activeTab) { $("#docTitle").value = name; $("#docTitle").title = newPath; }
      }
    });
    closedTabs.forEach(c => { if (c.path === oldPath) c.path = newPath; });
    if (fileCache.has(oldPath)) { fileCache.set(newPath, fileCache.get(oldPath)); fileCache.delete(oldPath); }
    const ws = root.mode === "server" ? SRV_WS : "fs", ok = imgs.get(ws + ":" + oldPath);
    if (ok) { imgs.set(ws + ":" + newPath, ok); imgs.delete(ws + ":" + oldPath); }
    if (root.mode === "server") await loadServerWorkspace(false, true);
    else { await refreshTree(tree); renderTree(); }
    selectRow(newPath);
    renderTabs(); updateSaveUI();
    toast(tr("Renamed to ") + name);
    await offerLinkUpdate(oldPath, newPath);
    renderNow();
  }

  /* Links to the old name, in every document of the folder: [x](old.md),
     ![x](assets/old.png), [x]: old.md and src="old.png". Extension-less links to a
     document are matched too, and keep having no extension. */
  function rewriteLinks(text, docPath, oldPath, newPath) {
    let count = 0;
    const lo = oldPath.toLowerCase(), loBare = lo.replace(MD_EXT, "");
    const fix = url => {
      let u = url, angle = false;
      if (u.startsWith("<") && u.endsWith(">")) { u = u.slice(1, -1); angle = true; }
      if (!isRelUrl(u)) return url;
      const cut = u.search(/[?#]/), tail = cut >= 0 ? u.slice(cut) : "", p = cut >= 0 ? u.slice(0, cut) : u;
      let dec = p;
      try { dec = decodeURIComponent(p); } catch (e) { }
      const res = resolveRel(docPath, dec).toLowerCase();
      const bare = !/\.[^./]+$/.test(dec);
      if (res !== lo && !(bare && MD_EXT.test(oldPath) && res === loBare)) return url;
      let nu = relFrom(docPath, newPath);
      if (bare) nu = nu.replace(MD_EXT, "");
      if (!angle) nu = nu.replace(/ /g, "%20");
      count++;
      return (angle ? "<" + nu + ">" : nu) + tail;
    };
    const out = text
      .replace(/(\]\()(<[^>]*>|[^)\s]+)/g, (m, a, u) => a + fix(u))
      .replace(/^( {0,3}\[[^\]^][^\]]*\]:[ \t]*)(<[^>]*>|\S+)/gm, (m, a, u) => a + fix(u))
      .replace(/(\s(?:src|href)=")([^"]+)(")/gi, (m, a, u, b) => a + fix(u) + b);
    return { text: out, count: count };
  }

  async function offerLinkUpdate(oldPath, newPath) {
    let nodes;
    try { nodes = await allFileNodes(); } catch (e) { return; }
    const edits = [];
    for (const f of nodes) {
      let text;
      try { text = await searchText(f); } catch (e) { continue; }
      const r = rewriteLinks(text, f.path, oldPath, newPath);
      if (r.count) edits.push({ f: f, count: r.count });
    }
    if (!edits.length) return;
    const links = edits.reduce((a, e) => a + e.count, 0);
    if (!(await askConfirm(tr("Update %n links in %m files to the new name?")
      .replace("%n", links).replace("%m", edits.length), { ok: tr("Update links") }))) return;
    let done = 0;
    for (const e of edits) {
      const t = tabs.find(x => x.kind === "file" && x.path === e.f.path);
      try {
        if (t) {
          /* an open file is changed in the editor and left for you to save, as in VS Code */
          if (t.id === activeTab) {
            const r = rewriteLinks(ed.value, t.path, oldPath, newPath);
            const top = ed.scrollTop, at = ed.selectionStart;
            ed.focus(); ed.setSelectionRange(0, ed.value.length); insert(r.text);
            ed.setSelectionRange(Math.min(at, ed.value.length), Math.min(at, ed.value.length)); ed.scrollTop = top;
          } else t.content = rewriteLinks(t.content, t.path, oldPath, newPath).text;
        } else {
          /* a closed one is written straight back, its own line endings and BOM kept */
          const raw = await readNodeText(e.f);
          const r = rewriteLinks(raw, e.f.path, oldPath, newPath);
          if (e.f.srv) await srvWrite(e.f.path, r.text);
          else await writeHandle(e.f.handle, r.text);
          fileCache.set(e.f.path, normText(r.text));
        }
        done++;
      } catch (err) { }
    }
    renderTabs(); renderTree(); updateSaveUI();
    toast(tr("Updated links in ") + done + " " + tr(done === 1 ? "file" : "files"));
  }

  async function deleteEntry(n) {
    if (!canEdit()) return;
    const exe = root.mode === "server";
    if (!(await askConfirm(tr("Delete") + ' "' + n.name + '"? ' +
      tr(exe ? "It goes to the Recycle Bin." : "This cannot be undone."),
      { danger: true, ok: tr("Delete") }))) return;
    try {
      if (exe) {
        const r = await fetch(entryUrl(SRV_WS, n.path), { method: "DELETE" });
        if (!r.ok && r.status !== 404) throw new Error(await r.text());
      } else {
        await (await parentDirHandle(n.path)).removeEntry(n.name);
      }
    } catch (e) { toast(tr("Could not delete: ") + (e.message || e.name)); return; }
    /* its tab goes too - asking about unsaved changes to a file that is gone helps nobody */
    const t = tabs.find(x => x.kind === "file" && x.path === n.path);
    if (t) {
      const was = t.id === activeTab;
      tabs = tabs.filter(x => x !== t);
      if (was) { activeTab = null; if (tabs.length) activateTab(tabs[0].id, true); else ensureTab(); }
    }
    fileCache.delete(n.path);
    if (exe) await loadServerWorkspace(false, true); else { await refreshTree(tree); renderTree(); }
    renderTabs();
    toast(tr("Deleted ") + n.name);
  }

  /* ---------- closed editors, and closing more than one ---------- */
  const closedTabs = [];
  function rememberClosed(t) {
    closedTabs.push(t.kind === "file" ? { kind: "file", path: t.path } : { kind: "local", docId: t.docId });
    if (closedTabs.length > 30) closedTabs.shift();
  }
  async function reopenClosed() {
    while (closedTabs.length) {
      const c = closedTabs.pop();
      if (c.kind === "local") { if (state.docs.some(d => d.id === c.docId)) { openDoc(c.docId); return; } continue; }
      const n = await findFileNode(c.path);
      if (n) { await openFileNode(n); return; }
    }
  }
  async function closeOthers(id) {
    stashActive();
    const others = tabs.filter(t => t.id !== id);
    const dirty = others.filter(isDirty);
    if (dirty.length && !(await askConfirm(tr("%n open files have unsaved changes. Close all tabs anyway?")
      .replace("%n", dirty.length), { danger: true, ok: tr("Close all") }))) return;
    others.forEach(rememberClosed);
    tabs = tabs.filter(t => t.id === id);
    activateTab(id, true);
  }

  /* ---------- moving tabs, as Chrome does ----------
     A tab is picked up by dragging it along the bar: it follows the pointer, and the
     others make room as it passes their middle. Ctrl+Shift+PageUp/PageDown moves the
     current one a place at a time, VS Code's keys for the same thing. */
  function moveTab(id, to) {
    const i = tabs.findIndex(t => t.id === id);
    if (i < 0) return;
    to = Math.max(0, Math.min(tabs.length - 1, to));
    if (to === i) return;
    const t = tabs.splice(i, 1)[0];
    tabs.splice(to, 0, t);
    renderTabs();
  }
  function moveActiveTab(d) {
    const i = tabs.findIndex(t => t.id === activeTab);
    if (i >= 0) moveTab(activeTab, i + d);
  }
  let tabDrag = null;
  function tabDragStart(e) {
    /* a finger on the bar scrolls it; only a mouse or pen picks a tab up */
    if (e.button !== 0 || e.pointerType === "touch" || e.target.closest("[data-close]")) return;
    const el = e.target.closest("[data-tab]");
    if (!el) return;
    tabDrag = { order0: tabs.map(t => t.id), id: el.dataset.tab, el: el, x0: e.clientX, y0: e.clientY, grab: e.clientX - el.getBoundingClientRect().left, on: false, pid: e.pointerId };
  }
  function tabDragMove(e) {
    const d = tabDrag;
    if (!d || e.pointerId !== d.pid) return;
    const bar = $("#tabbar");
    if (!d.on) {
      if (Math.abs(e.clientX - d.x0) < 6 && Math.abs(e.clientY - d.y0) < 6) return;
      d.on = true;
      try { d.el.setPointerCapture(e.pointerId); } catch (err) { }
      d.el.classList.add("dragging");
      bar.classList.add("dragging");
      document.body.classList.add("tab-dragging");
      hideCtx();
    }
    const br = bar.getBoundingClientRect();
    /* Carried off the bar, the tab is on its way somewhere else: a folder in the
       Explorer, or the Docs pane. It goes back to its place on the bar meanwhile. */
    const wrap = $("#tabwrap").getBoundingClientRect();
    const out = e.clientY < br.top - 18 || e.clientY > br.bottom + 18 ||
      e.clientX < wrap.left - 12 || e.clientX > wrap.right + 12;
    if (out) {
      d.el.style.transform = "";
      dropOver(d, e.clientX, e.clientY);
      return;
    }
    if (d.ghost) dropClear(d);
    if (e.clientX < br.left + 24) bar.scrollLeft -= 14;
    else if (e.clientX > br.right - 24) bar.scrollLeft += 14;
    const left = Math.max(br.left, Math.min(br.right - d.el.offsetWidth, e.clientX - d.grab));
    const right = left + d.el.offsetWidth;
    const all = Array.prototype.slice.call(bar.querySelectorAll(".etab"));
    const cur = all.indexOf(d.el), others = all.filter(x => x !== d.el);
    /* a tab to the left is passed when the carried tab's left edge crosses its middle,
       one to the right when the right edge does - so a wide tab still reaches the ends */
    const at = others.filter((x, k) => {
      const r = x.getBoundingClientRect(), c = r.left + r.width / 2;
      return k < cur ? left >= c : right > c;
    }).length;
    const ref = others[at] || null;
    if (d.el.nextElementSibling !== ref) bar.insertBefore(d.el, ref);
    d.el.style.transform = "";
    d.el.style.transform = "translateX(" + (left - d.el.getBoundingClientRect().left) + "px)";
  }
  function tabDragEnd(e) {
    const d = tabDrag;
    if (!d || (e && e.pointerId !== d.pid)) return;
    tabDrag = null;
    if (!d.on) return;
    const bar = $("#tabbar");
    d.el.style.transform = "";
    d.el.classList.remove("dragging");
    bar.classList.remove("dragging");
    document.body.classList.remove("tab-dragging");
    const order = Array.prototype.map.call(bar.querySelectorAll(".etab"), x => x.dataset.tab);
    tabs.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    /* where it is let go decides, not where it was last seen */
    if (d.ghost && e && e.type === "pointerup") dropOver(d, e.clientX, e.clientY);
    const target = d.ghost && e && e.type === "pointerup" ? d.target : null;
    /* passing over other tabs on the way out shuffled them; a drop off the bar puts
       them back - on a folder it is a move, anywhere else nothing happened */
    if (d.ghost) tabs.sort((a, b) => d.order0.indexOf(a.id) - d.order0.indexOf(b.id));
    dropClear(d);
    const t = tabs.find(x => x.id === d.id);
    if (target && t) { renderTabs(); moveTabTo(t, target); return; }
    /* the tab that was carried is the one you are looking at, as in Chrome */
    if (d.id !== activeTab) activateTab(d.id); else renderTabs();
  }

  /* ---------- dropping a tab somewhere else: moving where it is stored ----------
     A tab dropped on a folder in the Explorer moves its file into that folder; one
     dropped on the Docs pane becomes a Doc. It is a move, not a copy: the file is
     written in the new place, its pictures still show from there, and the old file
     goes - to the Recycle Bin from the exe. Holding a tab over a closed folder opens
     it, and over the Explorer or Docs button switches to that pane, as in VS Code. */
  function dropTargetAt(t, x, y) {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    if (el.closest("#paneDocs, #tabDocs"))
      return t.kind === "local" ? null : { docs: true, el: el.closest("#tabDocs") || $("#paneDocs") };
    const tb = el.closest("#treeBody");
    if (!tb || !root || !canEdit()) return null;
    const row = el.closest(".tree-row");
    let dir = "", hit;
    if (row) {
      const n = nodeByPath.get(row.dataset.path);
      if (!n) return null;
      dir = n.kind === "dir" ? n.path : n.path.split("/").slice(0, -1).join("/");
      hit = n.kind === "dir" ? row : (dir ? treeRowEl(dir) : tb.querySelector(".root-bar"));
    } else hit = tb.querySelector(".root-bar");
    /* already there */
    if (t.kind === "file" && t.path.split("/").slice(0, -1).join("/") === dir) return null;
    return { dir: dir, el: hit, row: row };
  }
  function dropOver(d, x, y) {
    const t = tabs.find(z => z.id === d.id);
    if (!t) return;
    if (!d.ghost) {
      d.ghost = document.createElement("div");
      d.ghost.className = "tab-ghost";
      document.body.appendChild(d.ghost);
    }
    const target = dropTargetAt(t, x, y);
    const under = document.elementFromPoint(x, y);
    const sideBtn = under && under.closest("#tabFiles, #tabDocs");
    const key = (target ? (target.docs ? "docs" : "dir:" + target.dir + ":" + (target.row ? target.row.dataset.path : "")) : "") +
      (sideBtn ? ":" + sideBtn.id : "");
    if (key !== d.key) {
      if (d.target && d.target.el) d.target.el.classList.remove("drop-on");
      if (target && target.el) target.el.classList.add("drop-on");
      d.key = key;
      d.ghost.textContent = target
        ? tr("Move to ") + (target.docs ? tr("Docs") : (target.dir || root.name))
        : t.name;
      clearTimeout(d.hoverTimer);
      /* lingering on a closed folder opens it; on a sidebar button, shows that pane */
      const n = target && target.row ? nodeByPath.get(target.row.dataset.path) : null;
      if (sideBtn) d.hoverTimer = setTimeout(() => { showSideTab(sideBtn.id === "tabDocs" ? "docs" : "files"); d.key = null; }, 450);
      else if (n && n.kind === "dir" && !n.open) d.hoverTimer = setTimeout(async () => {
        n.open = true;
        if (n.kids === null) await loadDir(n);
        renderTree(); d.key = null;
      }, 650);
    }
    d.target = target;
    d.ghost.classList.toggle("ok", !!target);
    d.ghost.style.left = (x + 14) + "px";
    d.ghost.style.top = (y + 12) + "px";
  }
  function dropClear(d) {
    clearTimeout(d.hoverTimer);
    document.querySelectorAll(".drop-on").forEach(x => x.classList.remove("drop-on"));
    if (d.ghost) d.ghost.remove();
    d.ghost = null; d.target = null; d.key = "";
  }

  /* a tab taken off the bar with nothing asked - its content has already gone elsewhere */
  function forgetTab(t) {
    tabs = tabs.filter(x => x !== t);
    if (activeTab === t.id) activeTab = null;
    if (t.kind === "file") fileCache.delete(t.path);
  }
  async function removeEntryAt(path) {
    if (root.mode === "server") {
      const r = await fetch(entryUrl(SRV_WS, path), { method: "DELETE" });
      if (!r.ok && r.status !== 404) throw new Error(await r.text());
    } else await (await parentDirHandle(path)).removeEntry(path.replace(/^.*\//, ""));
  }
  function placeTab(nt, at) {
    tabs.splice(tabs.indexOf(nt), 1);
    tabs.splice(Math.max(0, Math.min(at, tabs.length)), 0, nt);
  }
  async function moveTabTo(t, dest) {
    if (t.id === activeTab) stashActive();
    const at = tabs.indexOf(t), from = imgBase(t);
    let lost = 0;
    const onLost = () => lost++;
    const lostNote = () => lost ? " - " + lost + tr(" picture(s) could not be copied") : "";

    if (dest.docs) {
      if (t.kind !== "file") return;
      const d = newDoc(t.name.replace(MD_EXT, ""), t.content, true);
      const nt = tabs.find(x => x.kind === "local" && x.docId === d.id);
      if (from && nt) {
        const text = await carryImages(t.content, from, imgBase(nt), onLost);
        if (text !== t.content) {
          d.content = text; nt.content = text; nt.saved = text;
          if (activeTab === nt.id) { ed.value = text; renderNow(); }
          libFlush(d.id);
        }
      }
      /* the original goes only when it can be written to; a read-only one stays */
      let moved = false;
      if (writable(t)) { try { await removeEntryAt(t.path); moved = true; } catch (e) { } }
      forgetTab(t);
      if (nt) { placeTab(nt, at); activateTab(nt.id, true); }
      persist();
      if (moved) { if (root.mode === "server") await loadServerWorkspace(false, true); else { await refreshTree(tree); renderTree(); } }
      renderDocs(); renderTabs();
      showSideTab("docs");
      toast((moved ? tr("Moved to Docs: ") : tr("Copied to Docs (the original is read-only): ")) +
        (d.file || d.name) + lostNote());
      return;
    }

    /* into a folder of the open workspace */
    const doc = t.kind === "local" ? libDocOf(t) : null;
    const want = t.kind === "file" ? t.name
      : (safeName((doc && doc.file ? doc.file.replace(/^.*\//, "") : t.name).replace(MD_EXT, "")) || "Untitled") + ".md";
    const stem = want.replace(/\.[^.]+$/, ""), ext = want.slice(stem.length) || ".md";
    const pre = dest.dir ? dest.dir + "/" : "";
    let path = pre + want;
    for (let n = 2; await findFileNode(path); n++) path = pre + stem + " " + n + ext;
    const to = { ws: root.mode === "server" ? SRV_WS : "fs", doc: path, write: true };
    const text = from ? await carryImages(t.content, from, to, onLost) : t.content;
    const out = outText({ content: text, eol: t.eol, bom: t.bom });
    try {
      if (root.mode === "server") await srvWrite(path, out);
      else {
        const h = await (await parentDirHandle(path)).getFileHandle(path.replace(/^.*\//, ""), { create: true });
        await writeHandle(h, out);
      }
    } catch (e) { toast(tr("Could not move: ") + (e.message || e.name)); return; }
    const oldPath = t.kind === "file" ? t.path : null;
    let removed = true;
    try {
      if (oldPath) {
        if (writable(t)) await removeEntryAt(oldPath); else removed = false;
      } else if (doc) {
        state.docs = state.docs.filter(x => x.id !== doc.id);
        if (doc.file && LIB.ok) await libDelete(doc.file);
        persist();
      }
    } catch (e) { removed = false; }
    forgetTab(t);
    if (root.mode === "server") await loadServerWorkspace(false, true); else await refreshTree(tree);
    await revealInTree(path);
    renderTree();
    const n = await findFileNode(path);
    if (n) {
      await openFileNode(n);
      const nt = tabs.find(x => x.kind === "file" && x.path === path);
      if (nt) placeTab(nt, at);
    }
    if (!state.docs.length) state.docs.push({ id: uid(), name: "Untitled", content: "", created: Date.now(), updated: Date.now() });
    ensureTab();
    if (oldPath) closedTabs.forEach(c => { if (c.path === oldPath) c.path = path; });
    renderTabs(); renderDocs(); renderLibAssets(); updateSaveUI();
    showSideTab("files");
    toast((removed ? tr("Moved to ") : tr("Copied to ")) + path + lostNote());
    /* other documents that linked to the old place can follow it, as after a rename */
    if (oldPath && removed) await offerLinkUpdate(oldPath, path);
  }

  /* ---------- copying a tab ----------
     Copy Tab remembers what the tab holds; Paste Tab, on an empty part of the tab bar,
     opens it again as a new document of its own. The copy is not the same file: it
     is a new Doc, so it is saved where Docs are - a file of its own in the documents
     folder from the exe, this browser's storage otherwise - and editing it never
     touches the original. Pictures the original shows from beside it (assets/...)
     would not be beside the copy, so they are copied along and the links pointed at
     the copies; with nowhere to put a file, they go into the text itself. */
  let tabClip = null;
  function copyTab(t) {
    if (t.id === activeTab) stashActive();
    tabClip = { name: t.name, content: t.content, base: imgBase(t) };
    toast(tr("Tab copied - right-click an empty part of the tab bar to paste it"));
  }
  async function pasteTab() {
    const c = tabClip;
    if (!c) return;
    const name = String(c.name || "Untitled").replace(MD_EXT, "") + tr(" (copy)");
    const d = newDoc(name, c.content, true);
    const t = tabs.find(x => x.kind === "local" && x.docId === d.id);
    if (!c.base || !t) { toast(tr("Pasted as ") + name); return; }
    let lost = 0;
    const text = await carryImages(c.content, c.base, imgBase(t), () => lost++);
    if (text !== c.content) {
      d.content = text; d.updated = Date.now();
      t.content = text;
      if (activeTab === t.id) { const s = ed.selectionStart; ed.value = text; try { ed.setSelectionRange(s, s); } catch (e) { } renderNow(); }
      libFlush(d.id);
      persist();
    }
    toast(lost ? tr("Pasted as ") + name + " - " + lost + tr(" picture(s) could not be copied")
      : tr("Pasted as ") + name);
  }
  /* every picture link in a text - ![alt](url), [ref]: url and <img src="url"> - with
     fn(url) answering what to put there instead */
  function mapImageUrls(text, fn) {
    return text
      .replace(/(!\[(?:[^\]\\]|\\.)*\]\(\s*)(<[^>]*>|[^)\s]+)/g, (m, a, u) =>
        u.charAt(0) === "<" ? a + "<" + fn(u.slice(1, -1)) + ">" : a + fn(u))
      .replace(/^( {0,3}\[[^\]]+\]:[ \t]*)(<[^>]*>|\S+)/gm, (m, a, u) =>
        u.charAt(0) === "<" ? a + "<" + fn(u.slice(1, -1)) + ">" : a + fn(u))
      .replace(/(<img\b[^>]*?\bsrc\s*=\s*)(["'])(.*?)\2/gi, (m, a, q, u) => a + q + fn(u) + q);
  }
  async function carryImages(text, from, to, onLost) {
    /* a Doc copied to a Doc: both sit in the same folder, so the links already work */
    const dirOf = p => p.split("/").slice(0, -1).join("/");
    if (to && to.ws === from.ws && dirOf(to.doc) === dirOf(from.doc)) return text;
    const want = new Map();
    mapImageUrls(text, u => {
      if (!isRelUrl(u)) return u;
      let rel = u.replace(/[?#].*$/, "");
      try { rel = decodeURIComponent(rel); } catch (e) { }
      const path = resolveRel(from.doc, rel);
      if (path && IMG_EXT.test(path)) want.set(u, path);
      return u;
    });
    if (!want.size) return text;
    const got = new Map();
    for (const [u, path] of want) {
      /* moving within one folder tree: the picture stays where it is, only the link
         changes, so it still reaches it from the new place */
      if (to && to.ws === from.ws) { got.set(u, relFrom(to.doc, path).split("/").map(encodeURIComponent).join("/")); continue; }
      try {
        const blob = await imgFetch(from.ws + ":" + path);
        const file = new File([blob], path.replace(/^.*\//, ""), { type: blob.type || "" });
        if (to && to.write) got.set(u, (await imgWrite(to, file)).split("/").map(encodeURIComponent).join("/"));
        else got.set(u, await imgDataUrl(file));
      } catch (e) { onLost(); }
    }
    return mapImageUrls(text, u => got.has(u) ? got.get(u) : u);
  }
  function tabBarItems() {
    return [
      { label: "Paste Tab", run: pasteTab, disabled: !tabClip },
      "-",
      { label: "New document", keys: "Alt+N", run: () => newDoc() },
      { label: "Reopen closed editor", keys: "Ctrl+Shift+T", run: reopenClosed, disabled: !closedTabs.length }
    ];
  }

  /* ---------- editing commands, as VS Code has them ---------- */
  function selectLine() {
    const v = ed.value;
    let s = v.lastIndexOf("\n", ed.selectionStart - 1) + 1;
    let e = v.indexOf("\n", ed.selectionEnd === ed.selectionStart ? ed.selectionEnd : ed.selectionEnd - 1);
    e = e === -1 ? v.length : e + 1;
    /* again on a whole-line selection takes the next line too */
    if (ed.selectionStart === s && ed.selectionEnd === e && e < v.length) {
      const n = v.indexOf("\n", e);
      e = n === -1 ? v.length : n + 1;
    }
    ed.setSelectionRange(s, e);
  }
  function deleteLine() {
    const [ls, le] = lineRange();
    ed.setSelectionRange(ls > 0 && le >= ed.value.length ? ls - 1 : ls, Math.min(ed.value.length, le + 1));
    insert("");
    const p = ed.value.lastIndexOf("\n", ed.selectionStart - 1) + 1;
    ed.setSelectionRange(Math.max(p, ed.selectionStart), Math.max(p, ed.selectionStart));
  }
  function copyLine(down) {
    const [ls, le] = lineRange();
    const block = ed.value.slice(ls, le);
    const off = ed.selectionStart - ls, len = ed.selectionEnd - ed.selectionStart;
    ed.setSelectionRange(le, le);
    insert("\n" + block);
    const base = down ? le + 1 : ls;
    ed.setSelectionRange(base + off, base + off + len);
  }
  function moveLine(up) {
    const v = ed.value;
    const [ls, le] = lineRange();
    if (up && ls === 0) return;
    if (!up && le >= v.length) return;
    const block = v.slice(ls, le);
    const off = ed.selectionStart - ls, len = ed.selectionEnd - ed.selectionStart;
    if (up) {
      const ps = v.lastIndexOf("\n", ls - 2) + 1;
      const prev = v.slice(ps, ls - 1);
      ed.setSelectionRange(ps, le);
      insert(block + "\n" + prev);
      ed.setSelectionRange(ps + off, ps + off + len);
    } else {
      let ne = v.indexOf("\n", le + 1);
      if (ne === -1) ne = v.length;
      const next = v.slice(le + 1, ne);
      ed.setSelectionRange(ls, ne);
      insert(next + "\n" + block);
      const ns = ls + next.length + 1;
      ed.setSelectionRange(ns + off, ns + off + len);
    }
    buildMirror();
  }
  function newLine(above) {
    const [ls, le] = lineRange();
    const ind = (ed.value.slice(ls, le).match(/^[ \t]*/) || [""])[0];
    if (above) { ed.setSelectionRange(ls, ls); insert(ind + "\n"); ed.setSelectionRange(ls + ind.length, ls + ind.length); }
    else { ed.setSelectionRange(le, le); insert("\n" + ind); }
  }
  function indentLines(out) {
    prefixLines(l => out ? l.replace(/^(?: {1,2}|\t)/, "") : (l.trim() ? "  " + l : l));
  }
  /* Ctrl+D: the word under the caret first; with a selection, the next place the same
     text appears. A textarea has one caret, so this moves rather than adds. */
  function selectNext() {
    const v = ed.value, s = ed.selectionStart, e = ed.selectionEnd;
    if (s === e) {
      const isW = c => /[\p{L}\p{N}_]/u.test(c || "");
      let a = s, b = s;
      while (a > 0 && isW(v[a - 1])) a--;
      while (b < v.length && isW(v[b])) b++;
      if (a !== b) ed.setSelectionRange(a, b);
      return;
    }
    const word = v.slice(s, e);
    let at = v.indexOf(word, e);
    if (at < 0) at = v.indexOf(word);
    if (at >= 0) { ed.setSelectionRange(at, at + word.length); revealCaret(); }
  }
  function revealCaret() {
    const top = lineTop(lineOf(ed.selectionStart)), h = ed.clientHeight;
    if (top < ed.scrollTop || top > ed.scrollTop + h - 40) ed.scrollTop = Math.max(0, top - h / 3);
  }
  /* Ctrl+/: Markdown's comment is an HTML one */
  function toggleComment() {
    const s = ed.selectionStart, e = ed.selectionEnd;
    const [ls, le] = s === e ? lineRange() : [s, e];
    const text = ed.value.slice(ls, le);
    const m = /^(\s*)<!--\s?([\s\S]*?)\s?-->(\s*)$/.exec(text);
    ed.setSelectionRange(ls, le);
    insert(m ? m[1] + m[2] + m[3] : "<!-- " + text + " -->");
    ed.setSelectionRange(ls, ls + (m ? m[1].length + m[2].length + m[3].length : text.length + 9));
  }
  /* Ctrl+Shift+] / [ as Markdown All in One: a heading one level bigger / smaller */
  function headingStep(up) {
    prefixLines(l => {
      const m = /^(#{1,6}) +(.*)$/.exec(l);
      const lv = m ? m[1].length : 0, text = m ? m[2] : l;
      if (!l.trim()) return l;
      const nl = up ? (lv === 0 ? 1 : Math.max(1, lv - 1)) : (lv === 0 ? 0 : lv + 1);
      return nl === 0 || nl > 6 ? text : "#".repeat(nl) + " " + text;
    });
  }
  /* Alt+C: tick or untick the task on this line */
  function toggleTask() {
    prefixLines(l => {
      if (/^\s*(?:[-*+]|\d+[.)])\s+\[ \]/.test(l)) return l.replace("[ ]", "[x]");
      if (/^\s*(?:[-*+]|\d+[.)])\s+\[[xX]\]/.test(l)) return l.replace(/\[[xX]\]/, "[ ]");
      if (/^\s*(?:[-*+]|\d+[.)])\s+/.test(l)) return l.replace(/^(\s*(?:[-*+]|\d+[.)])\s+)/, "$1[ ] ");
      return l;
    });
  }
  /* Ctrl+C / Ctrl+X with nothing selected take the whole line, as in VS Code */
  function lineClip(cut) {
    if (ed.selectionStart !== ed.selectionEnd) return false;
    const v = ed.value, [ls, le] = lineRange();
    const text = v.slice(ls, le) + "\n";
    const at = ed.selectionStart;
    copyText(text, cut ? tr("Line cut") : tr("Line copied"));
    if (cut) { ed.setSelectionRange(ls, Math.min(v.length, le + 1)); insert(""); }
    else ed.setSelectionRange(at, at);
    return true;
  }
  function saveAs() {
    stashActive();
    const t = active();
    if (!t) return;
    const name = safeName(t.name).replace(MD_EXT, "") + ".md";
    (async () => {
      if (window.showSaveFilePicker) {
        try {
          const h = await window.showSaveFilePicker({ suggestedName: name,
            types: [{ description: "Markdown", accept: { "text/markdown": [".md", ".markdown"] } }] });
          await writeHandle(h, outText(t) || ed.value);
          toast(tr("Saved a copy as ") + h.name);
          return;
        } catch (e) { if (e && e.name === "AbortError") return; }
      }
      download(name, ed.value, "text/markdown");
      toast(tr("Downloaded ") + name);
    })();
  }
  function copyActivePath(rel) {
    const t = active();
    if (!t) return;
    const n = t.kind === "file" ? nodeOfPath(t.path) : null;
    const o = n || { doc: libDocOf(t) || { name: t.name } };
    copyOut(rel ? relPathOf(o) : fullPathOf(o), "Copied");
  }
  function revealActive() {
    const t = active();
    if (!t) return;
    if (t.kind === "file") { const n = nodeOfPath(t.path); if (n && root.mode === "server") revealEntry(n); }
    else revealDoc(libDocOf(t));
  }
  function renameActive() {
    if (document.activeElement && document.activeElement.id === "treeBody" && treeSel) { startRename(treeSel); return; }
    const t = active();
    if (t) renameTab(t);
  }

  /* ---------- every command, and its keys ---------- */
  /* One list drives the keyboard, the command palette (Ctrl+Shift+P) and the
     shortcut sheet. Keys are VS Code's defaults wherever there is one, the formatting
     ones are those of its Markdown All in One extension, and a few of this app's
     older keys stay as second bindings. "editor" means only while typing in the
     editor; "notEditor" only outside it - Ctrl+B is bold in the editor and toggles
     the sidebar anywhere else, exactly as in VS Code with that extension. */
  const ed1 = fn => () => { ed.focus(); fn(); };
  const COMMANDS = [
    /* file */
    { g: "File", id: "newDoc", label: "New document", keys: ["Ctrl+N", "Alt+N"], run: () => newDoc() },
    { g: "File", id: "openFile", label: "Open file…", keys: ["Ctrl+O"], run: () => $("#filePick").click() },
    { g: "File", id: "openFolder", label: "Open folder…", keys: ["Ctrl+K Ctrl+O"], run: openFolder },
    { g: "File", id: "save", label: "Save", keys: ["Ctrl+S"], run: saveMarkdown },
    { g: "File", id: "saveAs", label: "Save as…", keys: ["Ctrl+Shift+S"], run: saveAs },
    { g: "File", id: "saveAll", label: "Save all", keys: ["Ctrl+K S", "Ctrl+Alt+S"], run: saveAll },
    { g: "File", id: "close", label: "Close editor", keys: ["Ctrl+W", "Ctrl+F4", "Ctrl+Alt+W"], run: () => activeTab && closeTab(activeTab) },
    { g: "File", id: "closeAll", label: "Close all editors", keys: ["Ctrl+K Ctrl+W", "Ctrl+Alt+Shift+W"], run: closeAllTabs },
    { g: "File", id: "closeOthers", label: "Close other editors", keys: [], run: () => activeTab && closeOthers(activeTab) },
    { g: "File", id: "reopen", label: "Reopen closed editor", keys: ["Ctrl+Shift+T"], run: reopenClosed },
    { g: "File", id: "copyTab", label: "Copy tab", keys: [], run: () => active() && copyTab(active()) },
    { g: "File", id: "pasteTab", label: "Paste tab as a new document", keys: [], run: pasteTab },
    { g: "File", id: "history", label: "Version history…", keys: ["Ctrl+K H"], run: showHistory },
    { g: "File", id: "rename", label: "Rename file", keys: ["F2"], run: renameActive },
    { g: "File", id: "copyPath", label: "Copy path of active file", keys: ["Shift+Alt+C"], run: () => copyActivePath(false) },
    { g: "File", id: "copyRel", label: "Copy relative path of active file", keys: ["Ctrl+Shift+Alt+C"], run: () => copyActivePath(true) },
    { g: "File", id: "reveal", label: "Reveal active file in File Explorer", keys: ["Shift+Alt+R"], run: revealActive },
    { g: "File", id: "exportHtml", label: "Export as HTML", keys: [], run: exportHtml },
    { g: "File", id: "print", label: "Print / Save as PDF", keys: [], run: () => window.print() },
    { g: "File", id: "copyHtml", label: "Copy HTML to clipboard", keys: [], run: () => menuAct("copy-html") },
    { g: "File", id: "duplicate", label: "Duplicate as new document", keys: [], run: () => menuAct("duplicate") },
    { g: "File", id: "backup", label: "Download backup (all docs)", keys: [], run: () => menuAct("backup") },
    { g: "File", id: "import", label: "Import backup (.json)", keys: [], run: () => $("#jsonPick").click() },
    { g: "File", id: "newFile", label: "New file in folder…", keys: [], run: () => newFileInFolder() },
    /* go */
    { g: "Go", id: "quickOpen", label: "Go to file…", keys: ["Ctrl+P", "Ctrl+E"], run: () => openPalette("") },
    { g: "Go", id: "palette", label: "Show all commands", keys: ["Ctrl+Shift+P", "F1"], run: () => openPalette(">") },
    { g: "Go", id: "gotoHeading", label: "Go to heading…", keys: ["Ctrl+Shift+O"], run: () => openPalette("@") },
    { g: "Go", id: "gotoLine", label: "Go to line…", keys: ["Ctrl+G"], run: () => openPalette(":") },
    { g: "Go", id: "nextTab", label: "Next editor", keys: ["Ctrl+PageDown", "Ctrl+Tab", "Ctrl+Alt+Right"], run: () => cycleTab(1) },
    { g: "Go", id: "prevTab", label: "Previous editor", keys: ["Ctrl+PageUp", "Ctrl+Shift+Tab", "Ctrl+Alt+Left"], run: () => cycleTab(-1) },
    { g: "Go", id: "moveTabLeft", label: "Move tab left", keys: ["Ctrl+Shift+PageUp"], run: () => moveActiveTab(-1) },
    { g: "Go", id: "moveTabRight", label: "Move tab right", keys: ["Ctrl+Shift+PageDown"], run: () => moveActiveTab(1) },
    { g: "Go", id: "tabN", label: "Open editor 1–9", keys: ["Alt+1…9"], help: true },
    { g: "Go", id: "lastTab", label: "Open last editor", keys: ["Alt+0"], run: () => tabs.length && activateTab(tabs[tabs.length - 1].id) },
    /* view */
    { g: "View", id: "explorer", label: "Show Explorer", keys: ["Ctrl+Shift+E"], run: () => { if (!state.settings.sidebar) setSidebar(true); showSideTab("files"); } },
    { g: "View", id: "search", label: "Search in folder", keys: ["Ctrl+Shift+F"], run: showFolderSearch },
    { g: "View", id: "docs", label: "Show Docs", keys: [], run: () => { if (!state.settings.sidebar) setSidebar(true); showSideTab("docs"); } },
    { g: "View", id: "outline", label: "Show Outline", keys: [], run: () => { if (!state.settings.sidebar) setSidebar(true); showSideTab("toc"); } },
    { g: "View", id: "sidebar", label: "Toggle sidebar", keys: ["Ctrl+B"], when: "notEditor", run: () => setSidebar(!state.settings.sidebar) },
    { g: "View", id: "editOnly", label: "Editor only", keys: ["Ctrl+1"], run: () => setView("edit") },
    { g: "View", id: "split", label: "Preview to the side", keys: ["Ctrl+K V", "Ctrl+2", "Ctrl+\\"], run: () => setView("split") },
    { g: "View", id: "previewOnly", label: "Preview only", keys: ["Ctrl+3"], run: () => setView("preview") },
    { g: "View", id: "togglePreview", label: "Toggle preview", keys: ["Ctrl+Shift+V"], run: () => setView(state.settings.view === "preview" ? "edit" : "preview") },
    { g: "View", id: "wrap", label: "Toggle word wrap", keys: ["Alt+Z"], run: () => setAct("wrap") },
    { g: "View", id: "wide", label: "Toggle wide layout", keys: [], run: () => setAct("wide") },
    { g: "View", id: "sync", label: "Toggle sync scroll & selection", keys: [], run: () => setAct("sync") },
    { g: "View", id: "theme", label: "Toggle dark mode", keys: ["Ctrl+K Ctrl+T"], run: toggleTheme },
    { g: "View", id: "pip", label: "Picture-in-picture", keys: ["Ctrl+Alt+P"], run: togglePip },
    { g: "View", id: "settings", label: "Settings", keys: ["Ctrl+,"], run: () => showSettings($("#settings").hidden) },
    { g: "View", id: "shortcuts", label: "Keyboard shortcuts", keys: ["Ctrl+K Ctrl+S"], run: () => { $("#help").hidden = false; } },
    { g: "View", id: "guide", label: "Welcome guide", keys: [], run: openGuide },
    /* find */
    { g: "Find", id: "find", label: "Find", keys: ["Ctrl+F"], run: () => showFind(true) },
    { g: "Find", id: "replace", label: "Replace", keys: ["Ctrl+H"], run: () => { showFind(true); if (!previewMode()) $("#replInput").focus(); } },
    { g: "Find", id: "findNext", label: "Find next", keys: ["F3"], run: () => { if ($("#findbar").hidden) showFind(true); else step(1); } },
    { g: "Find", id: "findPrev", label: "Find previous", keys: ["Shift+F3"], run: () => { if ($("#findbar").hidden) showFind(true); else step(-1); } },
    /* editing */
    { g: "Editing", id: "selectNext", label: "Select word / next occurrence", keys: ["Ctrl+D"], when: "editor", run: selectNext },
    { g: "Editing", id: "selectLine", label: "Select line", keys: ["Ctrl+L"], when: "editor", run: selectLine },
    { g: "Editing", id: "deleteLine", label: "Delete line", keys: ["Ctrl+Shift+K", "Ctrl+Shift+D"], when: "editor", run: deleteLine },
    { g: "Editing", id: "moveUp", label: "Move line up", keys: ["Alt+Up"], when: "editor", run: () => moveLine(true) },
    { g: "Editing", id: "moveDown", label: "Move line down", keys: ["Alt+Down"], when: "editor", run: () => moveLine(false) },
    { g: "Editing", id: "copyUp", label: "Copy line up", keys: ["Shift+Alt+Up"], when: "editor", run: () => copyLine(false) },
    { g: "Editing", id: "copyDown", label: "Copy line down", keys: ["Shift+Alt+Down"], when: "editor", run: () => copyLine(true) },
    { g: "Editing", id: "lineBelow", label: "Insert line below", keys: ["Ctrl+Enter"], when: "editor", run: () => newLine(false) },
    { g: "Editing", id: "lineAbove", label: "Insert line above", keys: ["Ctrl+Shift+Enter"], when: "editor", run: () => newLine(true) },
    { g: "Editing", id: "indent", label: "Indent line", keys: ["Ctrl+]", "Tab"], when: "editor", run: () => indentLines(false) },
    { g: "Editing", id: "outdent", label: "Outdent line", keys: ["Ctrl+[", "Shift+Tab"], when: "editor", run: () => indentLines(true) },
    { g: "Editing", id: "comment", label: "Toggle comment", keys: ["Ctrl+/"], when: "editor", run: toggleComment },
    { g: "Editing", id: "cutLine", label: "Cut line (nothing selected)", keys: ["Ctrl+X"], when: "editor", run: () => lineClip(true) },
    { g: "Editing", id: "copyLineClip", label: "Copy line (nothing selected)", keys: ["Ctrl+C"], when: "editor", run: () => lineClip(false) },
    { g: "Editing", id: "undo", label: "Undo / redo", keys: ["Ctrl+Z / Ctrl+Y"], help: true },
    /* formatting */
    { g: "Formatting", id: "bold", label: "Bold", keys: ["Ctrl+B"], when: "editor", run: () => wrap("**", "**", "bold text") },
    { g: "Formatting", id: "italic", label: "Italic", keys: ["Ctrl+I"], when: "editor", run: () => wrap("*", "*", "italic text") },
    { g: "Formatting", id: "strike", label: "Strikethrough", keys: ["Alt+S", "Ctrl+Shift+X"], when: "editor", run: () => wrap("~~", "~~", "struck") },
    { g: "Formatting", id: "code", label: "Inline code", keys: ["Ctrl+`"], when: "editor", run: () => wrap("`", "`", "code") },
    { g: "Formatting", id: "highlight", label: "Highlight", keys: [], run: ed1(() => wrap("==", "==", "highlight")) },
    { g: "Formatting", id: "link", label: "Insert link", keys: [], run: ed1(insertLink) },
    { g: "Formatting", id: "image", label: "Insert image", keys: [], run: ed1(insertImage) },
    { g: "Formatting", id: "pasteImage", label: "Paste image / URL as link", keys: ["Ctrl+V"], help: true },
    { g: "Formatting", id: "headingUp", label: "Heading up (bigger)", keys: ["Ctrl+Shift+]"], when: "editor", run: () => headingStep(true) },
    { g: "Formatting", id: "headingDown", label: "Heading down (smaller)", keys: ["Ctrl+Shift+["], when: "editor", run: () => headingStep(false) },
    { g: "Formatting", id: "heading", label: "Heading 1–6", keys: ["Ctrl+Alt+1…6"], help: true },
    { g: "Formatting", id: "bullet", label: "Bullet list", keys: ["Ctrl+Shift+8"], when: "editor", run: bulletList },
    { g: "Formatting", id: "ordered", label: "Numbered list", keys: ["Ctrl+Shift+7"], when: "editor", run: orderedList },
    { g: "Formatting", id: "task", label: "Toggle task", keys: ["Alt+C"], when: "editor", run: toggleTask },
    { g: "Formatting", id: "quote", label: "Blockquote", keys: ["Ctrl+Shift+."], when: "editor", run: () => togglePrefix("> ") },
    { g: "Formatting", id: "table", label: "Insert table", keys: [], run: ed1(() => insert(TABLE)) },
    { g: "Formatting", id: "codeBlock", label: "Insert code block", keys: [], run: ed1(() => wrap("```\n", "\n```", "code here")) },
    { g: "Formatting", id: "hr", label: "Insert horizontal rule", keys: [], run: ed1(() => insert("\n---\n")) },
    { g: "Formatting", id: "footnote", label: "Insert footnote", keys: [], run: ed1(insertFootnote) }
  ];
  /* Alt+1..9 and Ctrl+Alt+1..6 are one row each on the sheet, nine and six keys here */
  for (let i = 1; i <= 9; i++) COMMANDS.push({ g: "Go", id: "tab" + i, label: "Open editor " + i, keys: ["Alt+" + i], hidden: true, run: () => tabs[i - 1] && activateTab(tabs[i - 1].id) });
  for (let i = 1; i <= 6; i++) COMMANDS.push({ g: "Formatting", id: "h" + i, label: "Heading " + i, keys: ["Ctrl+Alt+" + i], when: "editor", hidden: true, run: () => toggleHeading(i) });

  /* "Shift+Alt+C" and "Ctrl+Shift+Alt+C" written in VS Code's order, matched in one */
  function normCombo(s) {
    const parts = s.split("+"), key = parts.pop() || "+";
    const has = m => parts.some(p => p.toLowerCase() === m);
    return (has("ctrl") ? "Ctrl+" : "") + (has("shift") ? "Shift+" : "") + (has("alt") ? "Alt+" : "") + key;
  }
  const CODE_KEY = { Backquote: "`", Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]", Backslash: "\\",
    Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/", Space: "Space", IntlBackslash: "\\" };
  const SHIFTED = { "~": "`", "_": "-", "+": "=", "{": "[", "}": "]", "|": "\\", ":": ";", '"': "'", "<": ",",
    ">": ".", "?": "/", "!": "1", "@": "2", "#": "3", "$": "4", "%": "5", "^": "6", "&": "7", "*": "8", "(": "9", ")": "0" };
  const KEY_NAME = { ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right", " ": "Space", Esc: "Escape" };
  /* The key as printed on it, from the physical position where there is one, so
     Ctrl+Shift+] is still ] and not the } the shift turned it into */
  function comboOf(e) {
    let k;
    if (e.code && /^Key[A-Z]$/.test(e.code)) k = e.code.slice(3);
    else if (e.code && /^Digit\d$/.test(e.code)) k = e.code.slice(5);
    else if (e.code && CODE_KEY[e.code]) k = CODE_KEY[e.code];
    else {
      k = KEY_NAME[e.key] || e.key || "";
      if (k.length === 1) k = SHIFTED[k] || k.toUpperCase();
    }
    if (!k || /^(Control|Shift|Alt|Meta|AltGraph|CapsLock|Dead|Unidentified|Process)$/.test(k)) return null;
    return (e.ctrlKey || e.metaKey ? "Ctrl+" : "") + (e.shiftKey ? "Shift+" : "") + (e.altKey ? "Alt+" : "") + k;
  }
  const BINDINGS = new Map();          /* "Ctrl+K Ctrl+O" or "Ctrl+S" -> [command, ...] */
  const CHORD_FIRST = new Set();
  COMMANDS.forEach(c => (c.run ? c.keys : []).forEach(k => {
    if (k.indexOf("…") >= 0 || k.indexOf(" / ") >= 0) return;
    const seq = k.split(" ").map(normCombo).join(" ");
    if (!BINDINGS.has(seq)) BINDINGS.set(seq, []);
    BINDINGS.get(seq).push(c);
    if (seq.indexOf(" ") > 0) CHORD_FIRST.add(seq.split(" ")[0]);
  }));
  const cmdById = id => COMMANDS.find(c => c.id === id);
  const keysOf = id => { const c = cmdById(id); return c && c.keys[0] ? c.keys[0] : ""; };

  let chord = null, chordTimer = null;
  function runCommand(c, e) {
    const r = c.run();
    if (r !== false && e) e.preventDefault();
  }
  function onKeys(e) {
    if (e.defaultPrevented || e.isComposing) return;
    const combo = comboOf(e);
    if (!combo) return;
    const inEditor = e.target === ed;
    const tag = (e.target && e.target.tagName) || "";
    const inField = !inEditor && (/^(INPUT|TEXTAREA|SELECT)$/.test(tag) || (e.target && e.target.isContentEditable));
    let seq = combo;
    if (chord) {
      seq = chord + " " + combo;
      chord = null; clearTimeout(chordTimer); chordHint(null);
      e.preventDefault();
      const list = BINDINGS.get(seq);
      if (!list) { toast(tr("The key combination (%s) is not a command.").replace("%s", seq.replace(" ", ", "))); return; }
      const c = list.find(x => matchesWhen(x, inEditor));
      if (c) runCommand(c, e);
      return;
    }
    if (CHORD_FIRST.has(combo) && !BINDINGS.has(combo)) {
      if (inField && !/^Ctrl\+/.test(combo)) return;
      e.preventDefault();
      chord = combo;
      chordHint(combo);
      chordTimer = setTimeout(() => { chord = null; chordHint(null); }, 5000);
      return;
    }
    const list = BINDINGS.get(seq);
    if (!list) return;
    /* typing in a box keeps its own keys: only modifier and function-key commands apply */
    if (inField && !/^(Ctrl\+|Alt\+|Shift\+Alt\+|F\d)/.test(combo)) return;
    if (inField && /^Ctrl\+[ACVXZY]$/.test(combo)) return;
    const c = list.find(x => matchesWhen(x, inEditor));
    if (c) runCommand(c, e);
  }
  function matchesWhen(c, inEditor) {
    if (c.when === "editor") return inEditor;
    if (c.when === "notEditor") return !inEditor;
    return true;
  }
  function chordHint(first) {
    const el = $("#stCursor");
    if (!el) return;
    if (first) { el.dataset.was = el.textContent; el.textContent = "(" + first + ") " + tr("was pressed. Waiting for second key of chord..."); el.classList.add("chord"); }
    else if (el.classList.contains("chord")) { el.classList.remove("chord"); updateCursor(); }
  }

  /* ---------- Quick Open and the command palette ---------- */
  /* One box, VS Code's prefixes: nothing for files, ">" for commands, "@" for the
     headings of this document, ":" for a line number. */
  let palItems = [], palIndex = 0, palFiles = null;
  async function openPalette(prefix) {
    const box = $("#palette"), input = $("#palInput");
    box.hidden = false;
    input.value = prefix;
    palFiles = null;
    input.focus();
    paletteRender();
    /* the folder's files may still have to be read; the list fills in when they are */
    try { palFiles = await allFileNodes(); } catch (e) { palFiles = []; }
    if (!box.hidden) paletteRender();
  }
  function closePalette(back) {
    $("#palette").hidden = true;
    if (back !== false && !previewMode()) ed.focus();
  }
  /* letters in order, closer together and at word starts scoring higher */
  function fuzzy(q, s) {
    if (!q) return { score: 0, at: [] };
    const lq = q.toLowerCase(), ls = s.toLowerCase();
    let i = 0, score = 0, last = -2;
    const at = [];
    for (let j = 0; j < ls.length && i < lq.length; j++) {
      if (ls[j] !== lq[i]) continue;
      score += (j === last + 1 ? 5 : 1) + (j === 0 || /[\s/\\._-]/.test(s[j - 1]) ? 3 : 0);
      at.push(j); last = j; i++;
    }
    return i === lq.length ? { score: score - s.length * 0.01, at: at } : null;
  }
  const mark = (s, at) => { let o = ""; for (let i = 0; i < s.length; i++) o += at.indexOf(i) >= 0 ? "<b>" + esc(s[i]) + "</b>" : esc(s[i]); return o; };
  function paletteRender() {
    const v = $("#palInput").value;
    let items = [];
    if (v.startsWith(">")) {
      const q = v.slice(1).trim();
      COMMANDS.filter(c => c.run && !c.hidden).forEach(c => {
        const label = tr(c.label), f = fuzzy(q, label);
        if (f) items.push({ label: mark(label, f.at), hint: c.keys.filter(k => k.indexOf("…") < 0).join("  ·  "), score: f.score, run: () => c.run() });
      });
      items.sort((a, b) => b.score - a.score);
    } else if (v.startsWith("@")) {
      const q = v.slice(1).trim();
      tocData.forEach(h => {
        const f = fuzzy(q, h.text || "");
        if (f) items.push({ label: "&nbsp;".repeat((h.level - 1) * 3) + mark(h.text || "", f.at), hint: "H" + h.level, score: q ? f.score : -h.line,
          run: () => { goToLine(h.line); const el = preview.querySelector('[id="' + CSS.escape(h.id) + '"]'); if (el) previewPane.scrollTop = el.offsetTop - 16; } });
      });
      if (v.slice(1).trim()) items.sort((a, b) => b.score - a.score);
      if (!items.length) items.push({ label: esc(tr("No headings in this document")), hint: "", run: () => { } });
    } else if (v.startsWith(":")) {
      const n = parseInt(v.slice(1), 10), total = ed.value.split("\n").length;
      items.push(n > 0
        ? { label: esc(tr("Go to line ") + Math.min(n, total)), hint: "", run: () => { ed.focus(); goToLine(Math.min(n, total) - 1); } }
        : { label: esc(tr("Type a line number between 1 and ") + total), hint: "", run: () => { } });
    } else {
      const q = v.trim(), seen = new Set();
      const add = (name, hint, key, run, boost) => {
        if (seen.has(key)) return;
        seen.add(key);
        const f = fuzzy(q, name) || (q && fuzzy(q, hint + "/" + name));
        if (!f) return;
        items.push({ label: mark(name, fuzzy(q, name) ? f.at : []), hint: hint, score: f.score + (boost || 0), run: run });
      };
      tabs.forEach((t, i) => add(t.name, t.kind === "file" ? (t.path.indexOf("/") >= 0 ? t.path.replace(/\/[^/]*$/, "") : root ? root.name : "") : tr("Docs"),
        t.kind === "file" ? "f:" + t.path : "d:" + t.docId, () => activateTab(t.id), q ? 0 : 100 - i));
      (palFiles || []).forEach(n => add(n.name, n.path.indexOf("/") >= 0 ? n.path.replace(/\/[^/]*$/, "") : root ? root.name : "", "f:" + n.path, () => openFileNode(n)));
      state.docs.forEach(d => add(d.name || tr("Untitled"), tr("Docs"), "d:" + d.id, () => openDoc(d.id)));
      if (tree) (function walk(n) { if (n.kind === "img") add(n.name, n.path.replace(/\/[^/]*$/, ""), "i:" + n.path, () => showImage(treeImgKey(n), n.path), -1); (n.kids || []).forEach(walk); })(tree);
      if (q) items.sort((a, b) => b.score - a.score);
      if (!items.length) items.push({ label: esc(tr("No matching files")), hint: "", run: () => { } });
    }
    palItems = items.slice(0, 60);
    palIndex = 0;
    $("#palList").innerHTML = palItems.map((it, i) =>
      '<div class="pal-i' + (i === 0 ? " on" : "") + '" data-i="' + i + '"><span class="pal-l">' + it.label +
      '</span><span class="pal-h">' + esc(it.hint || "") + "</span></div>").join("");
  }
  function paletteMove(d) {
    if (!palItems.length) return;
    palIndex = (palIndex + d + palItems.length) % palItems.length;
    document.querySelectorAll("#palList .pal-i").forEach((el, i) => el.classList.toggle("on", i === palIndex));
    const on = document.querySelector("#palList .pal-i.on");
    if (on) on.scrollIntoView({ block: "nearest" });
  }
  function paletteRun(i) {
    const it = palItems[i == null ? palIndex : i];
    if (!it) return;
    const toEditor = $("#palInput").value.startsWith(":") || $("#palInput").value.startsWith("@");
    closePalette(toEditor);
    it.run();
  }

  /* ---------- picture-in-picture ---------- */
  /* Google Meet's floating window: a small window that stays on top of every other
     app, showing the document you are in - read it in Preview, or switch to Edit and
     keep writing while another program has the screen. What is typed in it goes into
     the main editor as if typed there, so saving, autosave and the unsaved marks all
     behave as usual. Settings > Window turns the feature on.

     It comes in two forms with the same insides:
     - From the exe, it is one of our own app windows, opened on this page in its
       floating mode (?pip=...) and pinned on top by the launcher. The browser's own
       picture-in-picture prints the page's address - "127.0.0.1:41873" - in its title
       bar and cannot be told otherwise; this one's title bar says "Markdown Studio", and
       the launcher keeps it out of Alt+Tab and off the taskbar. The two windows talk
       over a BroadcastChannel.
     - Opened as a plain page, there is no launcher to pin a window, so it is the
       browser's Document Picture-in-Picture (Edge and Chrome 116+). Opening that always
       takes a click or a key: a browser only lets a video call open one by itself. */
  const PIP_EXE = !!SRV_KEY;
  const PIP_OK = PIP_EXE || (typeof window.documentPictureInPicture === "object" && !!window.isSecureContext);
  let pipWin = null, pipMode = "preview";          /* the browser's own window, when that is the form */
  let pipChan = null, pipLive = false, pipTimer = null, pipStarting = false;   /* the launcher's window */

  function pipOn() { return !!state.settings.pip && PIP_OK; }
  /* "starting" counts: until the window says hello it is not live yet, and a second
     press in that gap used to open a second window */
  function pipOpen() { return !!pipWin || pipLive || pipStarting; }
  function pipUI() {
    const b = $("#btnPip"), m = document.querySelector('[data-act="pip"]');
    if (b) { b.hidden = !pipOn(); b.classList.toggle("on", pipOpen()); }
    if (m) m.hidden = !pipOn();
  }

  /* The floating window's insides, the same in both forms. `on` says what to do with
     what happens in it: edit(text), task(line), link(href), save(), back(), close(). */
  function floatBuild(d, w, on) {
    d.body.className = "pip-body";
    d.body.innerHTML =
      '<div class="pip"><div class="pip-bar"><span class="pip-name"></span>' +
      '<button type="button" class="pip-btn" data-pip="mode"></button>' +
      '<button type="button" class="pip-btn" data-pip="back" title="' + esc(tr("Back to Markdown Studio")) + '">' +
      '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 010 12h-3"/></svg></button>' +
      '</div><div class="pip-main"><article id="preview" class="pip-pv"></article>' +
      '<textarea class="pip-ed" spellcheck="false" hidden></textarea></div></div>';
    const ta = d.querySelector(".pip-ed");
    ta.addEventListener("input", () => on.edit(ta.value));
    d.addEventListener("click", e => {
      const b = e.target.closest("[data-pip]");
      if (b && b.dataset.pip === "mode") { on.mode(); return; }
      if (b && b.dataset.pip === "back") { on.back(); return; }
      /* a task ticked in the floating window is ticked in the document */
      const box = e.target.closest("[data-task-line]");
      if (box) { e.preventDefault(); on.task(box.dataset.taskLine); return; }
      const a = e.target.closest("a");
      if (a) {
        e.preventDefault();
        const href = a.getAttribute("href") || "";
        if (href.charAt(0) === "#") {
          const el = d.getElementById(MD.ID_PREFIX + href.slice(1)) || d.getElementById(href.slice(1));
          if (el) el.scrollIntoView();
        } else if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.indexOf("//") === 0) w.open(href, "_blank", "noopener");
        else on.link(href);
      }
    });
    d.addEventListener("keydown", e => {
      const c = comboOf(e);
      if (c === "Ctrl+S") { e.preventDefault(); on.save(); }
      else if (c === "Ctrl+Alt+P") { e.preventDefault(); on.close(); }
    });
  }
  /* s: { name, theme, css, html, text, mode } */
  function floatPaint(d, s, full) {
    d.title = PIP_EXE ? "Markdown Studio" : s.name;
    d.querySelector(".pip-name").textContent = s.name;
    d.documentElement.setAttribute("data-theme", s.theme);
    d.documentElement.style.cssText = s.css;
    const pv = d.querySelector(".pip-pv"), ta = d.querySelector(".pip-ed"), main = d.querySelector(".pip-main");
    const mode = d.querySelector('[data-pip="mode"]');
    mode.textContent = tr(s.mode === "preview" ? "Edit" : "Preview");
    mode.title = tr(s.mode === "preview" ? "Write in this window" : "Show the finished page");
    /* switching between Edit and Preview keeps the same place in the document: the
       source line at the top of the view being left is put at the top of the other */
    const was = pv.hidden ? "edit" : "preview";
    const line = was === s.mode ? -1 : was === "preview" ? floatPvLine(pv, main) : floatEdLine(d, ta);
    pv.hidden = s.mode !== "preview";
    ta.hidden = s.mode !== "edit";
    if (s.mode === "preview") {
      const top = main.scrollTop;
      pv.innerHTML = s.html;
      /* the main window's selection highlight and find marks are not this window's */
      pv.querySelectorAll(".sync-hl").forEach(el => el.classList.remove("sync-hl"));
      pv.querySelectorAll("mark.pv-hit").forEach(mk => mk.replaceWith(d.createTextNode(mk.textContent)));
      main.scrollTop = line >= 0 ? floatPvTop(pv, main, line) : top;
    } else {
      if ((full || d.activeElement !== ta) && ta.value !== s.text) {
        const top = ta.scrollTop;
        ta.value = s.text;
        ta.scrollTop = top;
      }
      if (line >= 0) {
        main.scrollTop = 0;
        ta.scrollTop = floatEdTop(d, ta, line);
        /* the caret goes to that line too, so focusing the editor does not jump to the top */
        const v = ta.value;
        let p = 0;
        for (let n = Math.floor(line); n > 0 && p >= 0; n--) { p = v.indexOf("\n", p); if (p >= 0) p++; }
        p = p < 0 ? v.length : p;
        ta.setSelectionRange(p, p);
      }
    }
  }
  /* The preview's blocks carry the source line they came from (data-src-line), so a
     position in it maps to a fractional source line, and back. */
  function floatPvMap(pv, main) {
    const base = main.getBoundingClientRect().top - main.scrollTop;
    return Array.prototype.map.call(pv.querySelectorAll("[data-src-line]"),
      el => { const r = el.getBoundingClientRect(); return { line: +el.dataset.srcLine, top: r.top - base, h: r.height }; })
      .sort((a, b) => a.line - b.line || a.top - b.top);
  }
  function floatPvLine(pv, main) {
    const map = floatPvMap(pv, main), y = main.scrollTop;
    if (!map.length) return 0;
    let i = 0;
    while (i + 1 < map.length && map[i + 1].top <= y) i++;
    const a = map[i], b = map[i + 1];
    if (y <= a.top) return i === 0 ? 0 : a.line;
    const bo = b ? b.top : a.top + a.h, span = (b ? b.line : a.line + 1) - a.line;
    return a.line + span * Math.min(1, Math.max(0, bo > a.top ? (y - a.top) / (bo - a.top) : 0));
  }
  function floatPvTop(pv, main, line) {
    const map = floatPvMap(pv, main);
    if (!map.length || line <= map[0].line) return line <= 0 || !map.length ? 0 : map[0].top;
    let i = 0;
    while (i + 1 < map.length && map[i + 1].line <= line) i++;
    const a = map[i], b = map[i + 1];
    const bo = b ? b.top : a.top + a.h, span = (b ? b.line : a.line + 1) - a.line;
    return Math.max(0, a.top + (bo - a.top) * Math.min(1, Math.max(0, (line - a.line) / (span || 1))));
  }
  /* The editor wraps long lines, so where a line sits is measured on a hidden copy of
     the text laid out exactly like the textarea, one div per line. */
  function floatEdRows(d, ta) {
    let m = d.querySelector(".pip-measure");
    if (!m) {
      m = d.createElement("div");
      m.className = "pip-measure";
      m.setAttribute("aria-hidden", "true");
      d.body.appendChild(m);
    }
    const cs = d.defaultView.getComputedStyle(ta);
    m.style.cssText = "position:absolute;left:-99999px;top:0;visibility:hidden;white-space:pre-wrap;" +
      "overflow-wrap:break-word;word-wrap:break-word;box-sizing:border-box;width:" + ta.clientWidth + "px;" +
      "padding:" + cs.padding + ";font:" + cs.font + ";line-height:" + cs.lineHeight + ";letter-spacing:" +
      cs.letterSpacing + ";tab-size:" + cs.tabSize + ";";
    m.innerHTML = ta.value.split("\n").map(l => "<div>" + (l ? esc(l) : "&#8203;") + "</div>").join("");
    return m.children;
  }
  function floatEdLine(d, ta) {
    const rows = floatEdRows(d, ta), y = ta.scrollTop;
    if (!rows.length || y <= 0) return 0;
    let lo = 0, hi = rows.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (rows[mid].offsetTop <= y) lo = mid; else hi = mid - 1; }
    const r = rows[lo];
    return lo + Math.min(1, Math.max(0, (y - r.offsetTop) / (r.offsetHeight || 1)));
  }
  function floatEdTop(d, ta, line) {
    if (line <= 0) return 0;
    const rows = floatEdRows(d, ta);
    if (!rows.length) return 0;
    const n = Math.min(rows.length - 1, Math.floor(line)), r = rows[n];
    return Math.max(0, r.offsetTop + (r.offsetHeight || 0) * (line - n));
  }
  function floatState() {
    const t = active();
    return { name: t ? t.name : "Markdown Studio", theme: state.settings.theme,
      css: document.documentElement.style.cssText, html: preview.innerHTML, text: ed.value, mode: pipMode };
  }
  /* what the floating window asks of the document */
  const floatDo = {
    edit(text) { if (ed.value === text) return; ed.value = text; ed.dispatchEvent(new Event("input", { bubbles: true })); },
    task(line) { const real = preview.querySelector('[data-task-line="' + line + '"]'); if (real) real.click(); },
    link(href) { followLink(href); },
    save() { saveMarkdown(); }
  };

  async function togglePip() {
    if (pipOpen()) { closePip(); return; }
    if (!PIP_OK) { toast(tr("Picture-in-picture needs Edge or Chrome 116 or newer")); return; }
    if (!state.settings.pip) {
      toast(tr("Picture-in-picture is off - turn it on in Settings"));
      showSettings(true);
      return;
    }
    if (PIP_EXE) openFloatWindow(); else await openBrowserPip();
  }

  /* ----- the launcher's window ----- */
  function openFloatWindow() {
    const id = uid().replace(/[^a-z0-9]/gi, "");
    if (pipChan) pipChan.close();
    pipChan = new BroadcastChannel("md-pip-" + id);
    pipChan.onmessage = e => {
      const m = e.data || {};
      if (m.type === "hello") {
        pipLive = true; pipStarting = false; clearTimeout(pipTimer); pipUI();
        pipChan.postMessage(Object.assign({ type: "state", full: true }, floatState()));
      } else if (m.type === "mode") { pipMode = pipMode === "preview" ? "edit" : "preview"; pipSync(true); }
      else if (m.type === "edit") floatDo.edit(m.text);
      else if (m.type === "task") floatDo.task(m.line);
      else if (m.type === "link") floatDo.link(m.href);
      else if (m.type === "save") floatDo.save();
      else if (m.type === "back") { fetch(floatUrl("front"), { method: "POST" }).catch(() => { }); closePip(); }
      else if (m.type === "close") closePip();
      else if (m.type === "closed") { pipLive = false; pipUI(); }
    };
    pipStarting = true;
    pipUI();
    fetch(floatUrl("open", id), { method: "POST" }).catch(() => {
      pipStarting = false; pipUI();
      toast(tr("Could not open the picture-in-picture window: ") + "launcher");
    });
    clearTimeout(pipTimer);
    pipTimer = setTimeout(() => {
      if (pipLive) return;
      pipStarting = false; pipUI();
      toast(tr("Could not open the picture-in-picture window: ") + tr("it did not start"));
    }, 12000);
  }
  const floatUrl = (op, id) => "/__float?k=" + encodeURIComponent(SRV_KEY) + "&op=" + op + (id ? "&id=" + id : "");

  /* ----- the browser's own window ----- */
  async function openBrowserPip() {
    let w;
    try { w = await window.documentPictureInPicture.requestWindow({ width: 420, height: 560, preferInitialWindowPlacement: true }); }
    catch (e) { toast(tr("Could not open the picture-in-picture window: ") + (e.message || e.name)); return; }
    pipWin = w;
    const d = w.document;
    /* the window starts empty: it gets this page's styles */
    document.querySelectorAll('style, link[rel="stylesheet"]').forEach(n => d.head.appendChild(n.cloneNode(true)));
    floatBuild(d, w, Object.assign({}, floatDo, {
      mode() { pipMode = pipMode === "preview" ? "edit" : "preview"; pipSync(true); if (pipMode === "edit") d.querySelector(".pip-ed").focus({ preventScroll: true }); },
      back() { window.focus(); closePip(); },
      close() { closePip(); }
    }));
    w.addEventListener("pagehide", () => { pipWin = null; pipUI(); });
    pipSync(true);
    pipUI();
  }

  function closePip() {
    if (pipWin) { try { pipWin.close(); } catch (e) { } }
    pipWin = null;
    if (pipLive || pipChan) {
      if (pipChan) pipChan.postMessage({ type: "close" });
      fetch(floatUrl("close"), { method: "POST" }).catch(() => { });
    }
    pipLive = false; pipStarting = false;
    clearTimeout(pipTimer);
    pipUI();
  }
  /* called after every render, tab switch and theme change */
  function pipSync(full) {
    if (pipWin) floatPaint(pipWin.document, floatState(), full);
    else if (pipLive && pipChan) pipChan.postMessage(Object.assign({ type: "state", full: !!full }, floatState()));
  }

  /* The page in floating mode: what the launcher's small window shows. It is this same
     file, so it has every style already; it only draws what the main window sends. */
  function initFloat(id) {
    document.title = "Markdown Studio";
    /* the interface language the main window is in */
    try { I18N.set((JSON.parse(localStorage.getItem(KEY)) || {}).settings.lang); } catch (e) { }
    const ch = new BroadcastChannel("md-pip-" + id);
    let last = null;
    floatBuild(document, window, {
      edit: text => ch.postMessage({ type: "edit", text: text }),
      task: line => ch.postMessage({ type: "task", line: line }),
      link: href => ch.postMessage({ type: "link", href: href }),
      save: () => ch.postMessage({ type: "save" }),
      mode: () => ch.postMessage({ type: "mode" }),
      back: () => ch.postMessage({ type: "back" }),
      close: () => ch.postMessage({ type: "close" })
    });
    ch.onmessage = e => {
      const m = e.data || {};
      if (m.type === "state") {
        const was = last && last.mode;
        last = m;
        floatPaint(document, m, m.full || was !== m.mode);
        if (was && was !== m.mode && m.mode === "edit") document.querySelector(".pip-ed").focus({ preventScroll: true });
      } else if (m.type === "close") window.close();
    };
    window.addEventListener("pagehide", () => ch.postMessage({ type: "closed" }));
    ch.postMessage({ type: "hello" });
  }

  /* ---------- local (browser-stored) documents ---------- */
  function openDoc(id) {
    const d = state.docs.find(x => x.id === id);
    if (!d) return;
    const open = tabs.find(t => t.kind === "local" && t.docId === id);
    if (open) { open.content = d.content || ""; activateTab(open.id); return; }
    stashActive();
    const tab = {
      id: uid(), kind: "local", docId: id, name: d.name || "Untitled", path: "",
      content: d.content || "", saved: d.content || "", scrollTop: 0, cursor: 0
    };
    tabs.push(tab);
    activateTab(tab.id, true);
    persist();
  }
  function newDoc(name, content, silent) {
    const d = { id: uid(), name: name || "Untitled", content: content || "", created: Date.now(), updated: Date.now() };
    state.docs.unshift(d);
    /* give it a file straight away, so it exists on disk before the first keystroke */
    libFlush(d.id);
    openDoc(d.id);
    if (!silent) { $("#docTitle").focus(); $("#docTitle").select(); }
    return d;
  }
  async function deleteDoc(id) {
    const d = state.docs.find(x => x.id === id);
    if (!d) return;
    if (!(await askConfirm(tr("Delete") + ' "' + (d.name || tr("Untitled")) + '"? ' +
      (d.file && LIB.ok ? d.file + tr(" goes to the Recycle Bin.")
        : tr("This cannot be undone.")), { danger: true, ok: tr("Delete") }))) return;
    /* a failed delete must not leave the file behind: it would come back as a new
       document on the next start */
    if (d.file && LIB.ok) {
      clearTimeout(libTimers.get(id)); libTimers.delete(id);
      try { await libDelete(d.file); }
      catch (e) { toast(tr("Could not delete: ") + (e.message || e.name)); return; }
    }
    state.docs = state.docs.filter(x => x.id !== id);
    const tab = tabs.find(t => t.kind === "local" && t.docId === id);
    if (tab) {
      const wasActive = tab.id === activeTab;
      tabs = tabs.filter(t => t.id !== tab.id);
      if (wasActive) { activeTab = null; if (tabs.length) activateTab(tabs[0].id, true); else ensureTab(); }
      else renderTabs();
    }
    if (!state.docs.length && !tabs.length) newDoc("Untitled", "", true);
    renderDocs();
    renderLibAssets();
    persist();
    toast(d.file && LIB.ok ? "Deleted " + d.file + " (in the Recycle Bin)" : "Document deleted");
  }

  /* falls back to a browser document when every tab is closed */
  function ensureTab() {
    if (tabs.length) return;
    if (!state.docs.length) state.docs.push({ id: uid(), name: "Untitled", content: "", created: Date.now(), updated: Date.now() });
    openDoc(state.docs.some(d => d.id === state.active) ? state.active : state.docs[0].id);
  }

  function showSideTab(which) {
    const map = { files: ["#tabFiles", "#paneFiles"], docs: ["#tabDocs", "#paneDocs"], toc: ["#tabToc", "#paneToc"], search: ["#tabSearch", "#paneSearch"] };
    Object.keys(map).forEach(k => {
      const on = k === which;
      $(map[k][0]).setAttribute("aria-selected", on ? "true" : "false");
      $(map[k][1]).hidden = !on;
    });
    if (which === "toc") buildToc(tocData);
    /* edits may have moved things since the last run, so search again */
    if (which === "search") runFolderSearch();
    if (window.matchMedia("(max-width:780px)").matches) sideScrollTop();
  }
  function sideScrollTop() { const b = $(".side-body:not([hidden])"); if (b) b.scrollTop = 0; }

  /* ---------- editing helpers ---------- */
  function insert(text) {
    ed.focus();
    let ok = false;
    try { ok = document.execCommand("insertText", false, text); } catch (e) { ok = false; }
    if (!ok) {
      const s = ed.selectionStart, e = ed.selectionEnd;
      ed.setRangeText(text, s, e, "end");
      ed.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }
  function wrap(before, after, placeholder) {
    const s = ed.selectionStart, e = ed.selectionEnd;
    let sel = ed.value.slice(s, e);
    const outer = ed.value.slice(Math.max(0, s - before.length), s) === before &&
      ed.value.slice(e, e + after.length) === after;
    if (outer) {
      ed.setSelectionRange(s - before.length, e + after.length);
      insert(sel);
      ed.setSelectionRange(s - before.length, e - before.length);
      return;
    }
    const empty = !sel;
    if (empty) sel = placeholder || "";
    insert(before + sel + after);
    const end = ed.selectionStart;
    ed.setSelectionRange(end - after.length - sel.length, end - after.length);
  }
  function lineRange() {
    const v = ed.value;
    let s = v.lastIndexOf("\n", ed.selectionStart - 1) + 1;
    let e = v.indexOf("\n", ed.selectionEnd);
    if (e === -1) e = v.length;
    return [s, e];
  }
  function prefixLines(fn) {
    const [s, e] = lineRange();
    const block = ed.value.slice(s, e);
    const out = block.split("\n").map(fn).join("\n");
    ed.setSelectionRange(s, e);
    insert(out);
    ed.setSelectionRange(s, s + out.length);
  }
  function togglePrefix(p) {
    const [s, e] = lineRange();
    const lines = ed.value.slice(s, e).split("\n");
    const rx = new RegExp("^\\s*" + p.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + " ?");
    const all = lines.every(l => !l.trim() || rx.test(l));
    prefixLines(l => (all ? l.replace(rx, "") : (l.trim() ? p + l : l)));
  }
  function toggleHeading(n) {
    const [s, e] = lineRange();
    const lines = ed.value.slice(s, e).split("\n");
    const mark = "#".repeat(n) + " ";
    const all = lines.every(l => !l.trim() || l.startsWith(mark));
    prefixLines(l => {
      const bare = l.replace(/^#{1,6} +/, "");
      return !l.trim() ? l : all ? bare : mark + bare;
    });
  }
  /* strips any existing list marker (bullet, number, task) so the three
     list buttons convert between each other instead of stacking markers */
  const LIST_RX = /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/;
  function bare(l) {
    const ind = (l.match(/^[ \t]*/) || [""])[0];
    const m = LIST_RX.exec(l);
    return [ind, m ? l.slice(m[0].length) : l.slice(ind.length)];
  }
  function bulletList() {
    const [s, e] = lineRange();
    const lines = ed.value.slice(s, e).split("\n");
    const all = lines.every(l => !l.trim() || /^[ \t]*[-*+][ \t]+(?!\[[ xX]\][ \t])/.test(l));
    prefixLines(l => {
      if (!l.trim()) return l;
      const [ind, txt] = bare(l);
      return all ? ind + txt : ind + "- " + txt;
    });
  }
  function orderedList() {
    const [s, e] = lineRange();
    const lines = ed.value.slice(s, e).split("\n");
    const all = lines.every(l => !l.trim() || /^[ \t]*\d{1,9}[.)][ \t]+/.test(l));
    let n = 0;
    prefixLines(l => {
      if (!l.trim()) return l;
      const [ind, txt] = bare(l);
      if (all) return ind + txt;
      n++;
      return ind + n + ". " + txt;
    });
  }
  function taskList() {
    const [s, e] = lineRange();
    const lines = ed.value.slice(s, e).split("\n");
    const all = lines.every(l => !l.trim() || /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+\[[ xX]\][ \t]+/.test(l));
    prefixLines(l => {
      if (!l.trim()) return l;
      const [ind, txt] = bare(l);
      return all ? ind + "- " + txt : ind + "- [ ] " + txt;
    });
  }

  const TABLE = "\n| Column A | Column B | Column C |\n| -------- | -------- | -------- |\n| Cell     | Cell     | Cell     |\n| Cell     | Cell     | Cell     |\n";

  /* ---------- toolbar ---------- */
  const I = d => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + d + "</svg>";
  const TOOLS = [
    { t: "H1", label: "Heading 1", txt: 1, run: () => toggleHeading(1) },
    { t: "H2", label: "Heading 2", txt: 1, run: () => toggleHeading(2) },
    { t: "H3", label: "Heading 3", txt: 1, run: () => toggleHeading(3) },
    { sep: 1 },
    { i: '<path d="M7 5h6.5a3.5 3.5 0 010 7H7zM7 12h7.5a3.5 3.5 0 010 7H7z"/>', label: "Bold (Ctrl+B)", run: () => wrap("**", "**", "bold text") },
    { i: '<path d="M19 4h-9M14 20H5M15 4L9 20"/>', label: "Italic (Ctrl+I)", run: () => wrap("*", "*", "italic text") },
    { i: '<path d="M6 12h12M16.5 6.5C15.6 5.2 14 4.5 12 4.5c-2.5 0-4.5 1.2-4.5 3S9 10 12 10.5m-4.5 7c.9 1.3 2.5 2 4.5 2 2.5 0 4.5-1.2 4.5-3"/>', label: "Strikethrough (Alt+S)", run: () => wrap("~~", "~~", "struck") },
    { i: '<path d="M4 6h16v12H4zM8 10l-2 2 2 2m8-4l2 2-2 2"/>', label: "Inline code (Ctrl+`)", run: () => wrap("`", "`", "code") },
    { i: '<path d="M3 5h10M3 5v14M3 19h10M17 5v14M14 5h6M14 19h6"/>', label: "Highlight", run: () => wrap("==", "==", "highlight") },
    { sep: 1 },
    { i: '<path d="M10.5 13.5a5 5 0 007 0l2.5-2.5a5 5 0 00-7-7l-1.2 1.2"/><path d="M13.5 10.5a5 5 0 00-7 0L4 13a5 5 0 007 7l1.2-1.2"/>', label: "Link (paste a URL over words)", run: insertLink },
    { i: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 16l-5-5L5 21"/>', label: "Image (or paste a screenshot)", run: insertImage },
    { sep: 1 },
    { i: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>', label: "Bullet list (Ctrl+Shift+8)", run: bulletList },
    { i: '<path d="M10 6h11M10 12h11M10 18h11M4 5h1v4M4 15h2v1.5H4V18h2"/>', label: "Numbered list (Ctrl+Shift+7)", run: orderedList },
    { i: '<path d="M9 11.5l2.5 2.5L21 4.5"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>', label: "Task list (Alt+C)", run: taskList },
    { i: '<path d="M6 7h3v5c0 2-1 3.5-3 4.5M15 7h3v5c0 2-1 3.5-3 4.5"/>', label: "Blockquote (Ctrl+Shift+.)", run: () => togglePrefix("> ") },
    { sep: 1 },
    { i: '<rect x="3" y="5" width="18" height="14" rx="1.5"/><path d="M3 10h18M9 10v9M15 10v9"/>', label: "Table", run: () => insert(TABLE) },
    { i: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 9l-2.5 3L9 15m6-6l2.5 3L15 15"/>', label: "Code block", run: () => wrap("```\n", "\n```", "code here") },
    { i: '<path d="M3 12h18"/>', label: "Horizontal rule", run: () => insert("\n---\n") },
    { i: '<path d="M12 3v18M3 8h4a3 3 0 010 6H3"/>', label: "Footnote", run: insertFootnote }
  ];
  function buildToolbar() {
    $("#toolbar").innerHTML = TOOLS.map((t, k) =>
      t.sep ? '<span class="sep"></span>'
        : '<button class="tb' + (t.txt ? " txt" : "") + '" data-tool="' + k +
        '" title="' + esc(tr(t.label)) + '" aria-label="' + esc(tr(t.label)) +
        '" type="button">' + (t.txt ? t.t : I(t.i)) + "</button>").join("");
  }
  /* the dialog takes focus away, so the selection is remembered and put back */
  function restoreSel(a, b) { ed.focus(); try { ed.setSelectionRange(a, b); } catch (e) { } }
  async function insertLink() {
    const a = ed.selectionStart, b = ed.selectionEnd;
    const sel = ed.value.slice(a, b);
    const url = await askInput(tr("Link URL:"), /^https?:|^\//.test(sel) ? sel : "https://");
    if (url === null) { restoreSel(a, b); return; }
    if (/^https?:|^\//.test(sel)) { restoreSel(a, b); wrap("[", "](" + url + ")", "link text"); return; }
    let label = sel;
    if (!label) {
      label = await askInput(tr("Link text:"), "link text");
      if (label === null) { restoreSel(a, b); return; }
    }
    restoreSel(a, b);
    insert("[" + (label || "link") + "](" + url + ")");
  }
  async function insertImage() {
    const a = ed.selectionStart, b = ed.selectionEnd;
    const url = await askInput(tr("Image URL or path:"), "https://");
    if (url === null) { restoreSel(a, b); return; }
    let alt = ed.value.slice(a, b);
    if (!alt) {
      alt = await askInput(tr("Alt text:"), "image");
      if (alt === null) { restoreSel(a, b); return; }
    }
    restoreSel(a, b);
    insert("![" + (alt || "image") + "](" + url + ")");
  }
  function insertFootnote() {
    const used = (ed.value.match(/\[\^(\d+)\]/g) || []).map(x => parseInt(x.replace(/\D/g, ""), 10));
    const n = (used.length ? Math.max.apply(null, used) : 0) + 1;
    insert("[^" + n + "]");
    const at = ed.selectionStart;
    const tail = (ed.value.endsWith("\n") ? "" : "\n") + "\n[^" + n + "]: Footnote text.";
    ed.setSelectionRange(ed.value.length, ed.value.length);
    insert(tail);
    ed.setSelectionRange(at, at);
    ed.focus();
  }

  /* ---------- scroll sync ---------- */
  /* repaints the hit layer once a layout change has settled (sidebar slide,
     splitter drag, view or font change) - nothing else calls buildMirror then */
  let repaintTimer = null;
  function scheduleFindRepaint(delay) {
    if (!findHL || previewMode()) return;
    clearTimeout(repaintTimer);
    repaintTimer = setTimeout(paintHits, delay || 0);
  }

  function buildMirror() {
    /* A changed width means changed wrapping, so the layer must be rebuilt.
       Checking here makes it self-healing whenever the mirror is actually used. */
    if (mirrorStyleStale || ed.clientWidth !== mirrorW) {
      const cs = getComputedStyle(ed);
      mirrorW = ed.clientWidth;
      mirrorStale = true;
      mirror.style.width = mirrorW + "px";
      mirror.style.paddingTop = cs.paddingTop;
      mirror.style.paddingRight = cs.paddingRight;
      mirror.style.paddingBottom = cs.paddingBottom;
      mirror.style.paddingLeft = cs.paddingLeft;
      mirror.style.fontSize = cs.fontSize;
      mirror.style.lineHeight = cs.lineHeight;
      mirror.style.whiteSpace = cs.whiteSpace;
      mirrorStyleStale = false;
    }
    if (!mirrorStale) return;
    mirror.innerHTML = findHL && matches.length ? hitsHtml() : plainHtml();
    mirrorStale = false;
  }
  function plainHtml() {
    return ed.value.split("\n").map(l => "<div>" + (l ? esc(l) : "&#8203;") + "</div>").join("");
  }
  /* same per-line divs, but with the search hits wrapped in <mark> */
  function hitsHtml() {
    const lines = ed.value.split("\n");
    let out = "", pos = 0, h = 0;
    for (let li = 0; li < lines.length; li++) {
      const L = lines[li], s = pos, e = pos + L.length;
      while (h < matches.length && matches[h][1] <= s) h++;
      let row = "", cx = 0, k = h;
      while (k < matches.length && matches[k][0] < e) {
        const a = Math.max(matches[k][0] - s, 0), b = Math.min(matches[k][1] - s, L.length);
        if (b > a) {
          row += esc(L.slice(cx, a)) +
            '<mark' + (k === mIndex ? ' class="cur"' : "") + ">" + esc(L.slice(a, b)) + "</mark>";
          cx = b;
        }
        if (matches[k][1] > e) break;   /* hit continues onto the next line */
        k++;
      }
      row += esc(L.slice(cx));
      out += "<div>" + (row || "&#8203;") + "</div>";
      pos = e + 1;
    }
    return out;
  }
  function paintHits() {
    const on = findHL && matches.length > 0 && ed.value.length <= 400000;
    mirror.classList.toggle("hl", on);
    if (!on) {
      mirror.style.transform = "";
      mirrorStale = true;      /* drop the previous document's marks */
      buildMirror();
      return;
    }
    mirrorStale = true;
    buildMirror();
    trackMirror();
  }
  /* the mirror is not a scroll container, so it follows the textarea by transform */
  function trackMirror() {
    mirror.style.transform = "translate(" + (-ed.scrollLeft) + "px," + (-ed.scrollTop) + "px)";
  }
  function lineTop(n) {
    const kids = mirror.children;
    if (!kids.length) return 0;
    const el = kids[Math.max(0, Math.min(kids.length - 1, n))];
    return el ? el.offsetTop : 0;
  }
  function lineAtY(y) {
    const kids = mirror.children;
    if (!kids.length) return 0;
    let lo = 0, hi = kids.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (kids[mid].offsetTop <= y) lo = mid; else hi = mid - 1;
    }
    const top = kids[lo].offsetTop, h = kids[lo].offsetHeight || 1;
    return lo + Math.min(1, Math.max(0, (y - top) / h));
  }
  function elForLine(line) {
    if (!lineMap.length) return null;
    let lo = 0, hi = lineMap.length - 1;
    if (line <= lineMap[0].line) return { a: lineMap[0], b: lineMap[1] || null, t: 0 };
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineMap[mid].line <= line) lo = mid; else hi = mid - 1;
    }
    const a = lineMap[lo], b = lineMap[lo + 1] || null;
    const span = b ? (b.line - a.line) || 1 : 1;
    return { a: a, b: b, t: b ? Math.min(1, Math.max(0, (line - a.line) / span)) : 0 };
  }
  /* Only one pane drives scrolling at a time. Without this the programmatic
     scroll of one pane fires the other's scroll handler, which scrolls the
     first one back - a reflow loop on every frame, which felt like lag. */
  let holdUntil = 0, owner = null, ownerTimer = null, queued = 0;
  function claimScroll(who) {
    if (owner && owner !== who) return false;
    owner = who;
    clearTimeout(ownerTimer);
    ownerTimer = setTimeout(() => { owner = null; }, 180);
    return true;
  }

  /* where the preview must be scrolled to for a source line to sit at its top */
  function previewTopFor(line) {
    const r = elForLine(line);
    if (!r) return null;
    const ao = r.a.el.offsetTop;
    const bo = r.b ? r.b.el.offsetTop : ao + r.a.el.offsetHeight;
    return Math.max(0, ao + (bo - ao) * r.t - 20);
  }
  /* and the reverse: the source line the preview is showing at y */
  function previewLineAt(y) {
    if (!lineMap.length) return -1;
    let lo = 0, hi = lineMap.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineMap[mid].el.offsetTop <= y) lo = mid; else hi = mid - 1;
    }
    const a = lineMap[lo], b = lineMap[lo + 1];
    const ao = a.el.offsetTop, bo = b ? b.el.offsetTop : ao + a.el.offsetHeight;
    const t = bo > ao ? Math.min(1, Math.max(0, (y - ao) / (bo - ao))) : 0;
    return a.line + ((b ? b.line : a.line + 1) - a.line) * t;
  }

  function syncToPreview() {
    if (!state.settings.sync || state.settings.view !== "split") return;
    if (Date.now() < holdUntil) return;
    buildMirror();
    const top = previewTopFor(lineAtY(ed.scrollTop));
    if (top != null) previewPane.scrollTop = top;
  }
  function syncToEditor() {
    if (!state.settings.sync || state.settings.view !== "split") return;
    if (Date.now() < holdUntil) return;
    buildMirror();
    const line = previewLineAt(previewPane.scrollTop + 20);
    if (line < 0) return;
    ed.scrollTop = Math.max(0, lineTop(Math.floor(line)));
  }
  /* ---------- selecting text in the editor highlights it in the preview ---------- */
  let selTimer = null, hlEls = [];

  function lineOf(pos) {
    const v = ed.value;
    let n = 0;
    const end = Math.min(pos, v.length);
    for (let i = 0; i < end; i++) if (v.charCodeAt(i) === 10) n++;
    return n;
  }
  /* tracked rather than queried, so a plain caret move costs nothing */
  function clearHl() {
    for (let i = 0; i < hlEls.length; i++) hlEls[i].classList.remove("sync-hl");
    hlEls = [];
  }
  /* scrolls the preview only when the block is not already on screen */
  function reveal(el) {
    const pr = previewPane.getBoundingClientRect();
    const er = el.getBoundingClientRect();
    if (er.top >= pr.top + 8 && er.bottom <= pr.bottom - 8) return;
    holdUntil = Date.now() + 700;
    previewPane.scrollTo({
      top: Math.max(0, previewPane.scrollTop + (er.top - pr.top) - pr.height * 0.28),
      behavior: "smooth"
    });
  }
  function syncSelection(noScroll) {
    if (state.settings.view !== "split" || !state.settings.sync) return;
    if (document.activeElement !== ed) return;
    clearHl();
    const s = ed.selectionStart, e = ed.selectionEnd;
    if (s === e || !lineMap.length) return;          /* a caret alone syncs nothing */

    const a = lineOf(s), b = lineOf(e);
    let els = [];
    for (let i = 0; i < lineMap.length; i++) {
      const m = lineMap[i];
      if (m.line >= a && m.line <= b) els.push(m.el);
    }
    /* a list and its items both carry a line; keep the outermost so a whole
       selected list reads as one highlight instead of striped children */
    els = els.filter(el => !els.some(o => o !== el && o.contains(el)));
    if (!els.length) {
      const r = elForLine(a);
      if (r && r.a) els = [r.a.el];
    }
    if (!els.length || els.length > 25) return;      /* select-all is just noise */
    els.forEach(el => el.classList.add("sync-hl"));
    hlEls = els;
    if (!noScroll) reveal(els[0]);
  }
  function queueSelSync() {
    if (document.activeElement !== ed) return;
    clearTimeout(selTimer);
    selTimer = setTimeout(syncSelection, 70);
  }

  function goToLine(line) {
    buildMirror();
    ed.scrollTop = Math.max(0, lineTop(line) - 40);
    const pos = ed.value.split("\n").slice(0, line).join("\n").length + (line ? 1 : 0);
    ed.setSelectionRange(pos, pos);
    updateCursor();
  }

  /* =========================================================
     searching the rendered preview (read-only, so no replace)
     ========================================================= */
  let pvMarks = [];
  const previewMode = () => state.settings.view === "preview";
  const totalHits = () => (previewMode() ? pvMarks.length : matches.length);

  function pvClear() {
    const marks = preview.querySelectorAll("mark.pv-hit");
    for (let i = 0; i < marks.length; i++) {
      const mk = marks[i];
      mk.parentNode.replaceChild(document.createTextNode(mk.textContent), mk);
    }
    if (marks.length) preview.normalize();   /* re-join split text nodes */
    pvMarks = [];
  }

  /* Matches are found against the whole rendered text, so a phrase still hits
     when it runs across bold/links, then each covered text node is wrapped. */
  function pvPaint(rx) {
    pvClear();
    if (!rx) return 0;
    const walker = document.createTreeWalker(preview, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        const p = n.nodeValue && n.parentElement;
        if (!p || p.closest(".anchor,.cb-c,.cb-l,.fnback")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const nodes = [];
    let full = "", n;
    while ((n = walker.nextNode())) {
      nodes.push({ node: n, start: full.length, len: n.nodeValue.length });
      full += n.nodeValue;
    }

    const hits = [];
    let m, guard = 0;
    rx.lastIndex = 0;
    while ((m = rx.exec(full)) !== null && guard++ < 5000) {
      if (m[0] === "") { rx.lastIndex++; continue; }
      hits.push([m.index, m.index + m[0].length]);
    }
    if (!hits.length) return 0;

    const per = new Map();
    for (let hi = 0; hi < hits.length; hi++) {
      const h = hits[hi];
      for (let i = 0; i < nodes.length; i++) {
        const ns = nodes[i].start, ne = ns + nodes[i].len;
        if (ne <= h[0]) continue;
        if (ns >= h[1]) break;
        const a = Math.max(h[0] - ns, 0), b = Math.min(h[1] - ns, nodes[i].len);
        if (b > a) { if (!per.has(i)) per.set(i, []); per.get(i).push({ a: a, b: b, hi: hi }); }
      }
    }

    pvMarks = hits.map(() => []);
    per.forEach(function (ranges, i) {
      ranges.sort((x, y) => y.a - x.a);     /* back to front keeps earlier offsets valid */
      const node = nodes[i].node;
      for (let r = 0; r < ranges.length; r++) {
        const rg = ranges[r];
        node.splitText(rg.b);
        const mid = node.splitText(rg.a);
        const mk = document.createElement("mark");
        mk.className = "pv-hit";
        mid.parentNode.insertBefore(mk, mid);
        mk.appendChild(mid);
        pvMarks[rg.hi].push(mk);
      }
    });
    pvMarks.forEach(list => list.sort((a, b) =>
      (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1));
    return hits.length;
  }

  function pvFocus() {
    for (let i = 0; i < pvMarks.length; i++)
      for (let j = 0; j < pvMarks[i].length; j++) pvMarks[i][j].classList.remove("cur");
    const list = pvMarks[mIndex];
    if (!list || !list.length) return;
    list.forEach(mk => mk.classList.add("cur"));
    const pr = previewPane.getBoundingClientRect(), er = list[0].getBoundingClientRect();
    if (er.top < pr.top + 16 || er.bottom > pr.bottom - 16) {
      previewPane.scrollTop += (er.top - pr.top) - pr.height * 0.3;
    }
  }

  function setReplaceEnabled(on) {
    $("#replInput").disabled = !on;
    $("#replOne").disabled = !on;
    $("#replAll").disabled = !on;
    $("#findMode").hidden = on;
  }

  /* ---------- find & replace ---------- */
  let matches = [], mIndex = -1, findHL = false;
  function findRegex() {
    const q = $("#findInput").value;
    if (!q) return null;
    const flags = "g" + ($("#findCase").checked ? "" : "i");
    try {
      return new RegExp($("#findRe").checked ? q : q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
    } catch (e) { return null; }
  }
  function runFind(keepIndex) {
    const rx = findRegex();

    /* in preview-only mode the editor is not on screen, so search what is */
    if (previewMode()) {
      matches = [];
      const count = pvPaint(rx);
      if (!keepIndex) mIndex = count ? 0 : -1;
      if (mIndex >= count) mIndex = count - 1;
      $("#findCount").textContent = count ? (mIndex + 1) + " / " + count
        : ($("#findInput").value ? "no results" : "");
      if (count && mIndex >= 0) pvFocus();
      return;
    }

    pvClear();
    matches = [];
    if (rx) {
      let m, guard = 0;
      while ((m = rx.exec(ed.value)) !== null && guard++ < 20000) {
        matches.push([m.index, m.index + m[0].length]);
        if (m[0] === "") rx.lastIndex++;
      }
    }
    if (!keepIndex) mIndex = matches.length ? 0 : -1;
    if (mIndex >= matches.length) mIndex = matches.length - 1;
    $("#findCount").textContent = matches.length ? (mIndex + 1) + " / " + matches.length
      : ($("#findInput").value ? "no results" : "");
    if (matches.length && mIndex >= 0) focusMatch(); else paintHits();
  }
  /* Never steals focus: the search box must keep it so you can carry on typing.
     Chrome hides the selection of an unfocused textarea, which is why the hits
     are painted on the mirror layer instead. */
  function focusMatch() {
    const m = matches[mIndex];
    if (!m) return;
    ed.setSelectionRange(m[0], m[1]);
    paintHits();
    buildMirror();
    const top = lineTop(lineOf(m[0]));
    const h = ed.clientHeight;
    if (top < ed.scrollTop + 16 || top > ed.scrollTop + h - 60) {
      ed.scrollTop = Math.max(0, top - Math.round(h * 0.35));
      trackMirror();
    }
    updateCursor();
  }
  function step(d) {
    const n = totalHits();
    if (!n) return;
    mIndex = (mIndex + d + n) % n;
    $("#findCount").textContent = (mIndex + 1) + " / " + n;
    if (previewMode()) pvFocus(); else focusMatch();
  }
  function replaceOne() {
    if (mIndex < 0 || !matches[mIndex]) return;
    const m = matches[mIndex];
    ed.focus();
    ed.setSelectionRange(m[0], m[1]);
    insert(expandRepl(ed.value.slice(m[0], m[1])));
    runFind(true);
    /* after the click settles, so nothing synchronous can steal it back */
    setTimeout(() => $("#replInput").focus(), 0);
  }
  /* In regex mode $1 / $& are backreferences; in plain mode a $ is just a $.
     Replace and Replace-All must agree on that, or one of them mangles text. */
  function expandRepl(matchedText) {
    const repl = $("#replInput").value;
    if (!$("#findRe").checked) return repl;
    const rx = findRegex();
    if (!rx) return repl;
    rx.lastIndex = 0;
    return matchedText.replace(rx, repl);
  }
  function replaceAll() {
    const rx = findRegex();
    if (!rx) return;
    const before = ed.value;
    const repl = $("#findRe").checked
      ? $("#replInput").value
      : $("#replInput").value.replace(/\$/g, "$$$$");   /* keep $ literal */
    const after = before.replace(rx, repl);
    if (after === before) { toast(tr("No matches")); return; }
    const n = matches.length;
    ed.setSelectionRange(0, before.length);
    insert(after);
    runFind();
    setTimeout(() => $("#replInput").focus(), 0);
    toast(tr("Replaced ") + n + " occurrence" + (n === 1 ? "" : "s"));
  }
  function showFind(show) {
    $("#findbar").hidden = !show;
    if (show) {
      findHL = true;
      setReplaceEnabled(!previewMode());
      const sel = previewMode()
        ? String(window.getSelection() || "")
        : ed.value.slice(ed.selectionStart, ed.selectionEnd);
      if (sel && sel.length < 90 && sel.indexOf(String.fromCharCode(10)) === -1) $("#findInput").value = sel.trim();
      $("#findInput").focus();
      $("#findInput").select();
      runFind();
    } else {
      findHL = false;
      matches = [];
      mIndex = -1;
      paintHits();
      pvClear();
      mirrorStale = true;
      if (!previewMode()) ed.focus();
    }
  }

  /* ---------- diagrams ---------- */
  /* A diagram on the page is drawn by the stylesheet, which a file saved out of it
     would not have. So every element's computed style is written onto the copy -
     exact, and it comes out matching the theme you are looking at. */
  function mmdSvgText(fig) {
    const src = fig.querySelector("svg");
    if (!src) return null;
    const copy = src.cloneNode(true);
    const props = ["fill", "stroke", "stroke-width", "stroke-dasharray", "stroke-linecap",
      "stroke-linejoin", "font-family", "font-size", "font-weight", "text-anchor", "opacity"];
    const flat = el => {
      const cs = getComputedStyle(el);
      let out = "";
      for (const p of props) { const v = cs.getPropertyValue(p); if (v) out += p + ":" + v + ";"; }
      return out;
    };
    const a = src.querySelectorAll("*"), b = copy.querySelectorAll("*");
    for (let i = 0; i < a.length && i < b.length; i++) b[i].setAttribute("style", flat(a[i]));
    copy.setAttribute("style", flat(src));
    copy.removeAttribute("class");
    copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    return new XMLSerializer().serializeToString(copy);
  }
  const mmdName = () => safeName(activeName()).replace(MD_EXT, "") + "-diagram";

  function mmdSaveSvg(fig) {
    const text = mmdSvgText(fig);
    if (!text) { toast(tr("Nothing to save")); return; }
    download(mmdName() + ".svg", '<?xml version="1.0" encoding="UTF-8"?>\n' + text, "image/svg+xml");
    toast(tr("Saved ") + mmdName() + ".svg");
  }

  /* Straight to a canvas, at twice the size so it still looks sharp pasted into a
     document. Everything is inline, so the canvas is never tainted. */
  function mmdSavePng(fig) {
    const text = mmdSvgText(fig);
    const svg = fig.querySelector("svg");
    if (!text || !svg) { toast(tr("Nothing to save")); return; }
    const box = svg.viewBox.baseVal;
    const w = box && box.width ? box.width : svg.clientWidth;
    const h = box && box.height ? box.height : svg.clientHeight;
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.ceil(w * 2));
      c.height = Math.max(1, Math.ceil(h * 2));
      const g = c.getContext("2d");
      g.fillStyle = getComputedStyle(body).backgroundColor || "#fff";
      g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, 0, 0, c.width, c.height);
      try {
        c.toBlob(bl => {
          if (!bl) { toast(tr("Could not make a PNG")); return; }
          const url = URL.createObjectURL(bl);
          const a = document.createElement("a");
          a.href = url;
          a.download = mmdName() + ".png";
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1500);
          toast(tr("Saved ") + mmdName() + ".png");
        }, "image/png");
      } catch (e) { toast(tr("Could not make a PNG")); }
    };
    img.onerror = () => toast(tr("Could not make a PNG"));
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(text);
  }

  function mmdAct(btn) {
    const fig = btn.closest(".mmd");
    if (!fig) return;
    const act = btn.dataset.mmd;
    const view = fig.querySelector(".mmd-view"), src = fig.querySelector(".mmd-src");
    if (act === "code") {
      const showing = !src.hidden;
      src.hidden = showing;
      if (view) view.hidden = !showing;
      btn.textContent = tr(showing ? "Code" : "Diagram");
      return;
    }
    if (act === "copy") { copyText(src.textContent, "Mermaid source copied"); return; }
    if (act === "svg") { mmdSaveSvg(fig); return; }
    if (act === "png") { mmdSavePng(fig); return; }
  }

  /* ---------- export ---------- */
  function download(name, text, mime) {
    const blob = new Blob([text], { type: (mime || "text/plain") + ";charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
  const safeName = n => (String(n || "untitled").replace(/[\\/:*?"<>|]+/g, "-").trim() || "untitled").slice(0, 80);
  /* what actually goes to disk: the buffer, back in the file's own line endings */
  function outText(t) {
    if (!t) return "";
    const body = t.eol === "\r\n" ? t.content.replace(/\n/g, "\r\n") : t.content;
    return (t.bom ? "﻿" : "") + body;
  }

  /* writes straight back to the file on disk when the tab came from an
     opened folder; otherwise falls back to the save dialog / a download */
  async function writeHandle(handle, text) {
    if (handle.queryPermission) {
      let p = await handle.queryPermission({ mode: "readwrite" });
      if (p !== "granted" && handle.requestPermission) p = await handle.requestPermission({ mode: "readwrite" });
      if (p !== "granted") throw new Error("write permission denied");
    }
    const w = await handle.createWritable();
    await w.write(text);
    await w.close();
  }

  async function saveMarkdown() {
    stashActive();
    const t = active();

    /* already bound to a file: write straight back, no dialog - just a sync */
    if (writable(t)) {
      try {
        if (t.srv) await srvWrite(t.path, outText(t));
        else await writeHandle(t.handle, outText(t));
        t.saved = t.content;
        if (t.kind === "file") fileCache.set(t.path, t.content);
        renderTabs(); renderTree(); updateSaveUI();
        toast(tr("Saved ") + t.name);
      } catch (e) { toast(tr("Could not save: ") + (e.message || e.name)); }
      return;
    }

    /* A document already has a file of its own in the library and is written as it
       is typed; Ctrl+S just does it now instead of in half a second. Asking where to
       put a copy - which is all the picker below could do - is what made documents
       feel unsaved in the first place. */
    if (t && t.kind === "local" && LIB.ok) {
      const d = state.docs.find(x => x.id === t.docId);
      if (d) {
        d.content = ed.value;
        d.updated = Date.now();
        await libFlush(d.id);
        renderDocs();
        toast(d.err ? "Could not write " + d.file : "Saved " + d.file + " in " + LIB.name);
        return;
      }
    }

    const name = safeName(t ? t.name : "untitled").replace(MD_EXT, "") + ".md";
    if (window.showSaveFilePicker) {
      try {
        const h = await window.showSaveFilePicker({
          suggestedName: name,
          types: [{ description: "Markdown", accept: { "text/markdown": [".md", ".markdown"] } }]
        });
        await writeHandle(h, ed.value);
        bindTabToFile(t, h);
        toast(tr("Saved ") + h.name + " - Ctrl+S now updates it directly");
        return;
      } catch (e) {
        if (e && e.name === "AbortError") return;   /* user cancelled the picker */
      }
    }
    /* file:// pages are refused the save picker, so this lands in Downloads */
    download(name, ed.value, "text/markdown");
    toast(location.protocol === "file:"
      ? "Downloaded " + name + " - open via laragon to choose a folder"
      : "Downloaded " + name);
  }

  /* after this, the tab is tied to that file and Ctrl+S writes to it silently */
  function bindTabToFile(t, h) {
    if (!t) return;
    t.handle = h;
    t.readonly = false;
    t.name = h.name;
    t.path = t.path || h.name;
    t.content = ed.value;
    t.saved = ed.value;
    if (t.kind === "local") {
      const d = state.docs.find(x => x.id === t.docId);
      if (d) { d.name = h.name; d.content = ed.value; d.updated = Date.now(); }
      persist();
    }
    const title = $("#docTitle");
    title.value = t.name;
    title.readOnly = true;
    title.title = t.path || t.name;
    renderTabs(); renderTree(); renderDocs(); updateSaveUI();
  }

  async function saveAll() {
    stashActive();
    const list = tabs.filter(t => t.kind === "file" && writable(t) && isDirty(t));
    if (!list.length) { toast(tr("Nothing to save")); return; }
    let ok = 0;
    for (const t of list) {
      try {
        if (t.srv) await srvWrite(t.path, outText(t));
        else await writeHandle(t.handle, outText(t));
        t.saved = t.content; fileCache.set(t.path, t.content); ok++;
      } catch (e) { toast(tr("Could not save ") + t.name); }
    }
    renderTabs(); renderTree();
    updateSaveUI();
    toast(tr("Saved ") + ok + " file" + (ok === 1 ? "" : "s"));
  }

  function exportCss() {
    const keep = [];
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch (e) { continue; }
      if (!rules) continue;
      for (const r of rules) {
        const sel = r.selectorText || "";
        if (r.type === 1) {
          if (sel.startsWith(":root") || /#preview|\.cb|\.mmd|\.t-|\.anchor|\.callout|\.task|\.footnotes|\.fn|\.tw/.test(sel)) {
            keep.push(r.cssText.replace(/#preview/g, ".md"));
          }
        } else if (r.type === 4) {
          if (r.cssText.includes("#preview")) keep.push(r.cssText.replace(/#preview/g, ".md"));
        }
      }
    }
    return keep.join("\n");
  }
  /* the exported page is the whole document, so its ids go back to the plain names its links use */
  function plainIds(box) {
    box.querySelectorAll('[id^="' + MD.ID_PREFIX + '"]').forEach(el => { el.id = el.id.slice(MD.ID_PREFIX.length); });
    return box;
  }
  async function exportHtml() {
    const r = MD.render(ed.value);
    const box = document.createElement("div");
    box.innerHTML = r.html;
    await inlineImages(box);
    plainIds(box);
    r.html = box.innerHTML;
    const title = (r.headings[0] && r.headings[0].level === 1 ? r.headings[0].text : activeName()) || "Document";
    const html = "<!DOCTYPE html>\n" +
      '<html lang="en" data-theme="' + state.settings.theme + '">\n<head>\n<meta charset="utf-8">\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
      "<title>" + MD.escape(title) + "</title>\n<style>\n" +
      "*,*::before,*::after{box-sizing:border-box}\n" +
      "body{margin:0;background:var(--bg);color:var(--fg);font-family:var(--f-ui);}\n" +
      ".md{max-width:820px;margin:0 auto;padding:48px 28px 96px;font-size:16px;line-height:1.7}\n" +
      ".md .cb-c,.md .anchor{display:none}\n" +
      exportCss() +
      "\n</style>\n</head>\n<body>\n<article class=\"md\">\n" + r.html + "\n</article>\n</body>\n</html>";
    download(safeName(activeName()).replace(MD_EXT, "") + ".html", html, "text/html");
    toast(tr("Exported HTML"));
  }
  async function copyText(text, msg) {
    try {
      await navigator.clipboard.writeText(text);
      toast(msg);
      return;
    } catch (e) { }
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;left:-9999px;top:0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); toast(msg); } catch (e2) { toast(tr("Copy failed")); }
    ta.remove();
  }

  /* ---------- file input ---------- */
  function readFiles(files) {
    const list = Array.prototype.filter.call(files, f => /\.(md|markdown|mdown|mkd|txt)$/i.test(f.name) || f.type.startsWith("text/"));
    if (!list.length) { toast(tr("No Markdown or text files found")); return; }
    let done = 0, last = null;
    list.forEach(f => {
      const fr = new FileReader();
      fr.onload = () => {
        last = newDoc(f.name.replace(/\.(md|markdown|mdown|mkd|txt)$/i, ""), String(fr.result || ""), true);
        if (++done === list.length) {
          openDoc(last.id);
          toast(tr("Opened ") + done + " file" + (done === 1 ? "" : "s"));
        }
      };
      fr.readAsText(f);
    });
  }

  /* ---------- menu ---------- */
  const MENU_EDGE = 8, MENU_GAP = 6;
  function showMenu(show) {
    const m = $("#menu");
    if (!show) { m.hidden = true; return; }
    m.hidden = false;
    m.style.maxHeight = "none";                      /* measure it unconstrained */
    const want = m.offsetHeight;
    const r = $("#btnMenu").getBoundingClientRect();
    const below = window.innerHeight - r.bottom - MENU_GAP - MENU_EDGE;
    /* hangs under the button while it fits; otherwise it takes the whole column
       and scrolls, instead of running off the bottom of a short window */
    const top = want <= below ? r.bottom + MENU_GAP
      : Math.max(MENU_EDGE, window.innerHeight - MENU_EDGE - want);
    m.style.top = top + "px";
    m.style.maxHeight = (window.innerHeight - top - MENU_EDGE) + "px";
    m.style.left = Math.max(MENU_EDGE, Math.min(r.right - m.offsetWidth, window.innerWidth - m.offsetWidth - MENU_EDGE)) + "px";
    m.scrollTop = 0;
  }

  /* A horizontal strip ignores a normal wheel unless Shift is held, which leaves
     tabs past the right edge unreachable with a plain mouse. */
  function wheelScrollsX(el) {
    el.addEventListener("wheel", e => {
      if (e.ctrlKey) return;                         /* leave zoom alone */
      const max = el.scrollWidth - el.clientWidth;
      if (max <= 0) return;
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      const step = e.deltaMode === 1 ? d * 24 : d;   /* some mice report lines */
      const next = Math.max(0, Math.min(max, el.scrollLeft + step));
      if (next === el.scrollLeft) return;            /* at an end - let it bubble */
      el.scrollLeft = next;
      e.preventDefault();
    }, { passive: false });
  }
  function menuAct(a) {
    switch (a) {
      case "open-folder": openFolder(); break;
      case "save-all": saveAll(); break;
      case "close-all": showMenu(false); closeAllTabs(); return;
      case "search-folder": showMenu(false); showFolderSearch(); return;
      case "find": showMenu(false); showFind(true); return;
      case "theme": toggleTheme(); return;
      case "pip": showMenu(false); togglePip(); return;
      case "import": $("#jsonPick").click(); break;
      case "export-md": saveMarkdown(); break;
      case "export-html": exportHtml(); break;
      case "print": window.print(); break;
      case "copy-html": {
        const box = document.createElement("div");
        box.innerHTML = MD.render(ed.value).html;
        copyText(plainIds(box).innerHTML, tr("HTML copied"));
        break;
      }
      case "duplicate":
        newDoc(String(activeName()).replace(MD_EXT, "") + " (copy)", ed.value, true);
        toast(tr("Duplicated"));
        break;
      case "backup":
        download("markdown-studio-backup-" + new Date().toISOString().slice(0, 10) + ".json",
          JSON.stringify(state, null, 2), "application/json");
        toast(tr("Backup downloaded"));
        break;
      case "settings": showMenu(false); showSettings(true); return;
      case "help": $("#help").hidden = false; break;
      case "quick-open": showMenu(false); openPalette(""); return;
      case "palette": showMenu(false); openPalette(">"); return;
      case "guide": showMenu(false); openGuide(); return;
    }
    showMenu(false);
  }

  /* The Welcome document is only written on the very first run, so an older copy
     never learns about anything added since. This opens the guide as this version
     has it - the copy already made if it is untouched, a fresh one otherwise, so
     your own edits to an old one are never overwritten. */
  function openGuide() {
    const g = guideText();
    const same = state.docs.find(d => (d.content || "") === g.text);
    if (same) { openDoc(same.id); return; }
    newDoc(g.guide, g.text, true);
    renderDocs();
    toast(tr("Opened the latest Welcome guide"));
  }

  /* ---------- help ---------- */
  /* The sheet is drawn from COMMANDS, so it can never list a key that does
     something else. Where the first key is one the browser keeps for itself
     (Ctrl+N, Ctrl+W, Ctrl+Tab...) the one that always works is shown beside it. */
  const BROWSER_KEEPS = new Set(["Ctrl+N", "Ctrl+W", "Ctrl+F4", "Ctrl+Tab", "Ctrl+Shift+Tab", "Ctrl+Shift+T",
    "Ctrl+PageDown", "Ctrl+PageUp"]);
  const kbdHtml = keys => keys.split(" / ").map(alt => alt.split(" ").map(step =>
    step.split("+").filter((x, i, a) => x || i === a.length - 1).map(k => "<kbd>" + MD.escape(k || "+") + "</kbd>").join("")
  ).join('<span class="kb-then"></span>')).join('<span class="kb-or">/</span>');
  function buildHelp() {
    const groups = ["File", "Go", "View", "Find", "Editing", "Formatting"];
    const extra = { Editing: [["Continue list", "Enter"]], View: [["Close panel", "Escape"]] };
    $("#kbGrid").innerHTML = groups.map(g => {
      const rows = COMMANDS.filter(c => c.g === g && !c.hidden && c.keys.length).map(c => {
        let k = c.keys[0];
        if (BROWSER_KEEPS.has(k) && c.keys[1]) k += " / " + c.keys[c.keys.length - 1];
        return [c.label, k];
      }).concat(extra[g] || []);
      return '<div class="kbsec"><h3>' + MD.escape(tr(g)) + "</h3>" +
        rows.map(r => '<div class="kbrow"><span>' + MD.escape(tr(r[0])) + "</span>" + kbdHtml(r[1]) + "</div>").join("") +
        "</div>";
    }).join("") +
      '<p class="kb-note">' + MD.escape(tr("The same keys as VS Code. Press Ctrl+Shift+P to search every command; a key the browser keeps for itself has a second one that always works.")) + "</p>";
  }

  /* ---------- key handling in editor ---------- */
  function onEditorKey(e) {
    const mod = e.ctrlKey || e.metaKey;

    if (e.key === "Tab") {
      e.preventDefault();
      const s = ed.selectionStart, en = ed.selectionEnd;
      if (s !== en && ed.value.slice(s, en).includes("\n")) {
        prefixLines(l => e.shiftKey ? l.replace(/^(?: {1,2}|\t)/, "") : (l.trim() ? "  " + l : l));
      } else if (e.shiftKey) {
        const [ls] = lineRange();
        const line = ed.value.slice(ls, s);
        const m = /^( {1,2}|\t)/.exec(line);
        if (m) {
          ed.setSelectionRange(ls, ls + m[1].length);
          insert("");
        }
      } else insert("  ");
      return;
    }

    if (e.key === "Enter" && !e.shiftKey && !mod) {
      const s = ed.selectionStart;
      const start = ed.value.lastIndexOf("\n", s - 1) + 1;
      const line = ed.value.slice(start, s);
      const m = /^(\s*)(?:([-*+])|(\d{1,9})([.)]))(\s+)(\[[ xX]\]\s+)?(.*)$/.exec(line);
      if (m) {
        const rest = m[7];
        if (!rest.trim() && !m[6]) {
          e.preventDefault();
          ed.setSelectionRange(start, s);
          insert("");
          return;
        }
        if (!rest.trim() && m[6]) {
          e.preventDefault();
          ed.setSelectionRange(start, s);
          insert(m[1]);
          return;
        }
        e.preventDefault();
        const bullet = m[2] ? m[2] : (parseInt(m[3], 10) + 1) + m[4];
        insert("\n" + m[1] + bullet + m[5] + (m[6] ? "[ ] " : ""));
        return;
      }
      const q = /^(\s*>\s?)(.*)$/.exec(line);
      if (q) {
        e.preventDefault();
        if (!q[2].trim()) { ed.setSelectionRange(start, s); insert(""); }
        else insert("\n" + q[1]);
        return;
      }
      const ind = /^([ \t]+)\S/.exec(line);
      if (ind) { e.preventDefault(); insert("\n" + ind[1]); return; }
      return;
    }

    /* every other key is a command - see COMMANDS */
  }

  /* ---------- version history ---------- */
  /* A document is written to disk as you type, so one slip would otherwise be
     permanent: there is no earlier copy anywhere. A snapshot is taken once typing has
     paused, kept per document (or per file in an opened folder) in IndexedDB, and any
     of them can be put back. Restoring first snapshots what is there now, so a
     restore can itself be undone from the same list. */
  const HIST_IDLE = 15000, HIST_GAP = 90000, HIST_MAX = 60, HIST_BYTES = 3000000;
  let histTimer = null, histCur = null, histSel = -1;

  function histKeyOf(t) {
    if (!t) return null;
    if (t.kind === "local") return t.docId ? "hist:d:" + t.docId : null;
    return t.path ? "hist:f:" + (root ? root.name : "") + ":" + t.path : null;
  }
  async function histList(key) {
    try { const v = await idbGet(key); return Array.isArray(v) ? v : []; } catch (e) { return []; }
  }
  /* keeps the newest, and stops at a size so a huge document cannot fill the profile */
  function histTrim(list) {
    while (list.length > HIST_MAX) list.shift();
    let bytes = 0;
    for (let i = list.length - 1; i >= 0; i--) {
      bytes += list[i].c.length;
      if (bytes > HIST_BYTES && i < list.length - 1) { list.splice(0, i + 1); break; }
    }
    return list;
  }
  async function histSnap(t, force) {
    const key = histKeyOf(t);
    if (!key || typeof t.content !== "string" || !t.content.trim()) return false;
    const list = await histList(key);
    const last = list[list.length - 1];
    if (last && last.c === t.content) return false;
    if (last && !force && Date.now() - last.t < HIST_GAP) return false;
    list.push({ t: Date.now(), c: t.content });
    await idbSet(key, histTrim(list));
    return true;
  }
  function histQueue() {
    clearTimeout(histTimer);
    const t = active();
    if (!t) return;
    histTimer = setTimeout(() => { histSnap(t, false); }, HIST_IDLE);
  }
  /* lines gained and lost, by counting - cheap, and enough to tell versions apart */
  function histDiff(a, b) {
    const x = a.split("\n"), y = b.split("\n"), seen = new Map();
    x.forEach(l => seen.set(l, (seen.get(l) || 0) + 1));
    let same = 0;
    y.forEach(l => { const n = seen.get(l); if (n) { same++; seen.set(l, n - 1); } });
    return { added: y.length - same, removed: x.length - same };
  }
  async function showHistory() {
    const t = active();
    const key = histKeyOf(t);
    if (!t || !key) { toast(tr("Nothing to show history for")); return; }
    await histSnap(t, true);                    /* what is on screen now is the newest entry */
    histCur = { t: t, key: key, list: await histList(key) };
    $("#histTitle").textContent = tr("Version history") + " - " + (t.name || tr("Untitled"));
    renderHistory();
    $("#history").hidden = false;
    const first = $("#histList").querySelector("button");
    if (first) first.focus();
  }
  function renderHistory() {
    const box = $("#histList"), list = histCur.list;
    box.textContent = "";
    if (list.length < 2) {
      const d = document.createElement("div");
      d.className = "hist-empty";
      d.textContent = tr("No earlier versions yet. They are saved as you pause while typing.");
      box.appendChild(d);
    }
    for (let i = list.length - 1; i >= 0; i--) {
      const b = document.createElement("button");
      b.className = "hist-item"; b.type = "button";
      b.textContent = (i === list.length - 1 ? tr("Current") + " - " : "") + timeAgo(list[i].t);
      const sm = document.createElement("small");
      const d = i > 0 ? histDiff(list[i - 1].c, list[i].c) : null;
      sm.textContent = new Date(list[i].t).toLocaleString() + (d ? "  +" + d.added + " -" + d.removed : "");
      b.appendChild(sm);
      b.addEventListener("click", () => pickHistory(i));
      box.appendChild(b);
    }
    pickHistory(list.length - 1);
  }
  function pickHistory(i) {
    histSel = i;
    const e = histCur.list[i];
    $("#histPre").textContent = e ? e.c : "";
    $("#histInfo").textContent = e ? new Date(e.t).toLocaleString() + " - " + e.c.length + " " + tr("characters") : "";
    $("#histRestore").disabled = !e || i === histCur.list.length - 1;
    const items = $("#histList").querySelectorAll(".hist-item");
    items.forEach((el, n) => el.setAttribute("aria-current", histCur.list.length - 1 - n === i ? "true" : "false"));
  }
  async function restoreHistory() {
    const e = histCur && histCur.list[histSel];
    if (!e) return;
    const t = histCur.t;
    if (active() !== t) { toast(tr("That editor is no longer the active one")); return; }
    await histSnap(t, true);                    /* so the restore can be undone from here */
    ed.value = e.c;
    ed.dispatchEvent(new Event("input", { bubbles: true }));
    $("#history").hidden = true;
    toast(tr("Restored the version from ") + new Date(e.t).toLocaleString());
  }

  /* ---------- global keys ---------- */
  /* Esc closes whatever is on top; everything else goes through the command list. */
  function onGlobalKey(e) {
    if (e.key === "Escape") {
      if (chord) { chord = null; chordHint(null); return; }
      if (ctxEl) { hideCtx(); return; }
      if (!$("#palette").hidden) { closePalette(); return; }
      if (!$("#imgView").hidden) { hideImage(); return; }
      if (!$("#settings").hidden) { showSettings(false); return; }
      if (!$("#history").hidden) { $("#history").hidden = true; return; }
      if (!$("#help").hidden) { $("#help").hidden = true; return; }
      if (!$("#menu").hidden) { showMenu(false); return; }
      if (!$("#findbar").hidden) { showFind(false); return; }
      return;
    }
    if (!$("#palette").hidden && e.target === $("#palInput")) return;
    onKeys(e);
  }

  /* A hidden pane is display:none, and that is enough for the browser to forget
     where it was scrolled to - which is why every switch used to land back at the
     first line. So note the line the visible pane is showing, and put both panes
     back on it afterwards. Not their pixel offsets: the editor wraps differently at
     half width than at full, and the preview measures nothing at all while it is
     hidden, so only the line survives the switch. */
  function viewAnchor(view) {
    const a = { edLine: -1, pvLine: -1, edTop: ed.scrollTop, pvTop: previewPane.scrollTop };
    try {
      if (view !== "preview") { buildMirror(); a.edLine = lineAtY(ed.scrollTop); }
      if (view !== "edit") a.pvLine = previewLineAt(previewPane.scrollTop + 20);
    } catch (e) { }
    return a;
  }
  /* Each pane goes back to its own line, and only borrows the other's when it was
     not on screen to have one. Keeping them apart is what makes this work with sync
     scrolling turned off, where the two panes are deliberately in different places. */
  function viewRestore(was, now, a) {
    const edBefore = was !== "preview", edNow = now !== "preview";
    const pvBefore = was !== "edit", pvNow = now !== "edit";
    /* the scrolling below must not set the panes syncing each other around */
    holdUntil = Date.now() + 400;

    if (edNow) {
      buildMirror();
      const line = a.edLine >= 0 ? a.edLine : a.pvLine;
      ed.scrollTop = Math.max(0, line >= 0 ? lineTop(Math.floor(line)) : a.edTop);
      if (findHL) trackMirror();
    }
    if (pvNow) {
      const line = a.pvLine >= 0 ? a.pvLine : a.edLine;
      const top = line >= 0 ? previewTopFor(line) : null;
      previewPane.scrollTop = Math.max(0, top == null ? a.pvTop : top);
    }
    if (edNow && !edBefore) fadeIn($("#editorPane"));
    if (pvNow && !pvBefore) fadeIn(previewPane);
  }
  function fadeIn(el) {
    el.classList.remove("pane-in");
    void el.offsetWidth;                 /* restart the animation, not resume it */
    el.classList.add("pane-in");
    clearTimeout(el._fade);
    el._fade = setTimeout(() => el.classList.remove("pane-in"), 260);
  }

  function setView(v) {
    const was = state.settings.view;
    if (was === v) { if (v !== "preview") ed.focus(); return; }
    const anchor = viewAnchor(was);
    state.settings.view = v;
    applySettings();
    /* Focusing a textarea scrolls its caret into view, so it has to happen before
       the scroll is put back - the other way round it lands on the caret, which is
       what "back to the top" really was most of the time. */
    const toFind = !$("#findbar").hidden;
    if (!toFind && v !== "preview") ed.focus();
    viewRestore(was, v, anchor);
    persist();
    if (toFind) {
      /* hand the search over to whichever pane is now on screen */
      if (was === "preview") pvClear(); else { matches = []; paintHits(); }
      setReplaceEnabled(v !== "preview");
      runFind();
      $("#findInput").focus();
    }
  }
  /* ---------- language ---------- */
  /* The chrome is translated where it stands. Its English is the key, so the original
     is kept beside each node and the same pass can put it back - no second copy of the
     markup, and a string nobody translated simply stays as it was.

     Only these roots. Never the editor or the preview: those hold the user's own
     words, and a dictionary has no business anywhere near them. */
  const LANG_ROOTS = ["#sidebar", "#topbar", "#status", "#menu", "#settings", "#help", "#imgView", "#palette",
                      "#findbar", "#tabwrap", "#drop"];
  /* written by JavaScript, which translates them itself - a sweep would only put its
     own stale copy back */
  const LANG_SKIP = "#kbGrid,#palList,#toolbar,#treeBody,#docList,#docAssets,#ivName,#ivPath,#ivInfo,#tocList,#fsResults,#tabbar," +
    "#docHome,#fsSummary,#stCursor,#stWords,#stChars,#stLines,#stRead,#saveState," +
    "#findCount,#setPath,#setEdSize,#setPvSize";
  const langWas = new Map();

  function sweepLang() {
    LANG_ROOTS.forEach(sel => {
      const root = $(sel);
      if (!root) return;
      const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = walk.nextNode())) {
        const host = n.parentElement;
        if (!host || host.closest(LANG_SKIP)) continue;
        let was = langWas.get(n);
        if (was === undefined) {
          const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(n.nodeValue);
          const mid = m[2].replace(/\s+/g, " ");
          /* the spacing around it is the layout's, not the sentence's */
          was = /[A-Za-z]/.test(mid) ? { pre: m[1], en: mid, post: m[3] } : null;
          langWas.set(n, was);
        }
        if (!was) continue;
        const out = was.pre + tr(was.en) + was.post;
        if (n.nodeValue !== out) n.nodeValue = out;
      }
      root.querySelectorAll("[title],[placeholder],[aria-label]").forEach(el => {
        if (el.closest(LANG_SKIP)) return;
        ["title", "placeholder", "aria-label"].forEach(a => {
          if (!el.hasAttribute(a)) return;
          const slot = "en" + a.replace(/(^|-)(\w)/g, (x, d, c) => c.toUpperCase());
          if (el.dataset[slot] === undefined) el.dataset[slot] = el.getAttribute(a);
          el.setAttribute(a, tr(el.dataset[slot]));
        });
      });
    });
  }

  function initLang() {
    I18N.set(state.settings.lang);
    document.documentElement.lang = I18N.cur();
    sweepLang();
  }
  /* Everything drawn from JavaScript has to be drawn again, or half the window would
     change language and the other half would not. */
  function applyLang() {
    initLang();
    buildToolbar();
    buildHelp();
    renderTabs();
    renderTree();
    renderDocs();
    libHome();
    settingsUI();
    updateSaveUI();
    updateCursor();
    if (!$("#paneSearch").hidden) runFolderSearch();
  }

  /* ---------- settings panel ---------- */
  function showSettings(on) {
    $("#settings").hidden = !on;
    if (on) { settingsUI(); $("#setClose").focus(); }
    else if (!previewMode()) ed.focus();
  }
  /* Called from applySettings, so the panel is right whichever way a setting was
     changed - the toolbar, a shortcut, or the panel itself. */
  function settingsUI() {
    const s = state.settings;
    const on = (k, v) => {
      const el = document.querySelector('.tgl[data-set="' + k + '"]');
      if (el) { el.classList.toggle("on", !!v); el.setAttribute("aria-checked", v ? "true" : "false"); }
    };
    on("wrap", s.wrap);
    on("sync", s.sync);
    on("wide", s.wide);
    on("theme", s.theme === "dark");
    on("pip", pipOn());
    const pt = document.querySelector('.tgl[data-set="pip"]');
    if (pt) pt.disabled = !PIP_OK;
    const ph = $("#setPipHint");
    if (ph && !PIP_OK) ph.textContent = tr("This browser has no picture-in-picture for pages. It needs Edge or Chrome 116 or newer, which the desktop app uses.");
    const a = $("#setEdSize"), b = $("#setPvSize"), l = $("#setLang");
    if (a) a.textContent = s.edSize;
    if (b) b.textContent = s.pvSize;
    if (l) l.value = s.lang || "auto";
    /* Without the exe there is no documents folder to show, move or open, so the
       section is not there at all rather than two buttons that never work. */
    $("#setDocs").hidden = !LIB.ok;
    const p = $("#setPath");
    if (!p || !LIB.ok) return;
    p.textContent = LIB.path;
  }
  function setAct(k) {
    const s = state.settings;
    if (k === "wrap") s.wrap = !s.wrap;
    else if (k === "sync") s.sync = !s.sync;
    else if (k === "wide") s.wide = !s.wide;
    else if (k === "theme") s.theme = s.theme === "dark" ? "light" : "dark";
    else if (k === "pip") {
      if (!PIP_OK) { toast(tr("Picture-in-picture needs Edge or Chrome 116 or newer")); return; }
      s.pip = !s.pip;
      if (!s.pip) closePip();
      else toast(tr("Picture-in-picture is on - open it with the button in the top bar or Ctrl+Alt+P"));
    }
    else if (k === "font+") s.edSize = Math.min(24, s.edSize + 1);
    else if (k === "font-") s.edSize = Math.max(10, s.edSize - 1);
    else if (k === "pfont+") s.pvSize = Math.min(26, s.pvSize + 1);
    else if (k === "pfont-") s.pvSize = Math.max(12, s.pvSize - 1);
    else return;
    applySettings();
    persist();
  }
  function toggleTheme() {
    state.settings.theme = state.settings.theme === "dark" ? "light" : "dark";
    applySettings();
    persist();
  }
  function setSidebar(on) {
    state.settings.sidebar = on;
    applySettings();
    persist();
  }
  const isMobile = () => window.matchMedia("(max-width:780px)").matches;
  /* on a phone the sidebar covers the editor, so get out of the way once used */
  function autoCloseSide() { if (isMobile() && state.settings.sidebar) setSidebar(false); }

  /* =========================================================
     wire everything up
     ========================================================= */
  /* A startup step that fails is reported and skipped, so the steps after it - and
     above all the event wiring at the end of init - still happen. */
  function report(where, e) {
    const msg = (e && (e.message || e.reason)) || String(e || "");
    /* the browser's own harmless layout notice, not ours to worry anyone with */
    if (/ResizeObserver loop/.test(msg)) return;
    try { console.error("Markdown Studio" + (where ? " (" + where + ")" : "") + ":", e); } catch (x) { }
    toast(tr("Something went wrong: ") + msg + (where ? " [" + where + "]" : ""), 9000);
  }
  function startStep(where, fn) {
    try {
      const r = fn();
      return r && typeof r.then === "function" ? r.catch(e => report(where, e)) : r;
    } catch (e) { report(where, e); }
  }

  async function init() {
    load();
    initLang();
    buildToolbar();
    buildHelp();
    if (isMobile()) {
      /* the drawer starts closed, and split collapses to a single pane */
      state.settings.sidebar = false;
      if (state.settings.view === "split") state.settings.view = "edit";
    }
    applySettings();
    /* Anything that goes wrong from here on is said on screen. Before this, an error
       thrown by some document's contents stopped startup on the spot - and with it
       every button wired up further down, so Settings, the menu and the rest simply
       did nothing, with no sign of why. */
    window.addEventListener("error", e => report("", e.error || e.message));
    window.addEventListener("unhandledrejection", e => report("", e.reason));
    /* before the first tab is opened, so it opens the document as disk has it */
    await startStep("libSync", libSync);
    startStep("ensureTab", ensureTab);
    startStep("renderDocs", renderDocs);
    startStep("renderLibAssets", renderLibAssets);
    startStep("renderTree", renderTree);
    startStep("updateSaveUI", updateSaveUI);
    startStep("updateCursor", updateCursor);
    /* A reload used to leave only a "Reopen" button. When the browser still holds the
       permission the folder, and the files that were open in it, come straight back. */
    idbGet("root").then(async h => {
      if (!h || root) return;
      reopen = { name: h.name, handle: h };
      let perm = "prompt";
      try { perm = h.queryPermission ? await h.queryPermission({ mode: "readwrite" }) : "prompt"; } catch (e) { }
      if (perm !== "granted") { renderTree(); return; }
      try {
        await useFolder(h);
        reopen = null;
        const saved = (await idbGet("tabs")) || [];
        for (const pth of saved) {
          const n = await findFileNode(pth);
          if (n) await openFileNode(n);
        }
      } catch (e) { renderTree(); }
    });
    /* launched as "Open with" from Explorer: the exe is serving that file's folder */
    loadServerWorkspace(true);

    wheelScrollsX($("#tabbar"));
    wheelScrollsX($("#toolbar"));
    /* an open menu sized to the old viewport would hang off the new one */
    window.addEventListener("resize", () => { if (!$("#menu").hidden) showMenu(true); });

    /* editor */
    ed.addEventListener("input", () => {
      histQueue();
      const t = active();
      if (t) {
        t.content = ed.value;
        if (t.kind === "local") {
          const cur = state.docs.find(x => x.id === t.docId);
          if (cur) { cur.content = ed.value; cur.updated = Date.now(); }
          queueSave();
          libQueue(t.docId);
          clearTimeout(ed._dl);
          ed._dl = setTimeout(() => { renderDocs(); renderLibAssets(); }, 900);
          const ld = isDirty(t);
          if (ld !== t._dirty) { t._dirty = ld; renderTabs(); updateSaveUI(); }
        } else {
          const d = isDirty(t);
          if (d !== t._dirty) { t._dirty = d; renderTabs(); renderTree(); updateSaveUI(); }
        }
      }
      mirrorStale = true;
      queueRender();
      /* offsets shift as you type, so recompute the hits instead of showing stale ones */
      if (findHL) { clearTimeout(ed._fh); ed._fh = setTimeout(() => runFind(true), 120); }
    });
    ed.addEventListener("keydown", onEditorKey);
    /* a screenshot pasted straight in, the way Word takes one */
    ed.addEventListener("paste", e => {
      const files = clipImages(e.clipboardData);
      if (files.length) { e.preventDefault(); addImages(files); return; }
      /* a URL pasted over selected words makes them a link, as VS Code does */
      const text = (e.clipboardData && e.clipboardData.getData("text/plain") || "").trim();
      const sel = ed.value.slice(ed.selectionStart, ed.selectionEnd);
      if (sel && !/\n/.test(sel) && /^(https?:\/\/|mailto:)\S+$/i.test(text) && !/^(https?:\/\/|mailto:)/i.test(sel)) {
        e.preventDefault();
        insert("[" + sel + "](" + text + ")");
      }
    });
    ed.addEventListener("keyup", updateCursor);
    ed.addEventListener("click", updateCursor);
    ed.addEventListener("select", updateCursor);
    /* passive + at most one sync per frame, and only from the pane the user drives */
    /* the highlight layer must track every scroll frame, not the throttled sync */
    ed.addEventListener("scroll", () => { if (findHL) trackMirror(); }, { passive: true });
    ed.addEventListener("scroll", () => {
      if (!claimScroll("ed") || (queued & 1)) return;
      queued |= 1;
      requestAnimationFrame(() => { queued &= ~1; syncToPreview(); });
    }, { passive: true });
    previewPane.addEventListener("scroll", () => {
      if (!claimScroll("pv") || (queued & 2)) return;
      queued |= 2;
      requestAnimationFrame(() => { queued &= ~2; syncToEditor(); });
    }, { passive: true });

    /* selecting text in the editor reveals and highlights it in the preview */
    document.addEventListener("selectionchange", queueSelSync);
    ed.addEventListener("mouseup", queueSelSync);
    ed.addEventListener("keyup", e => { if (e.shiftKey || e.key === "Escape") queueSelSync(); });

    /* title (file tabs are named by the file on disk, so they are read-only) */
    $("#docTitle").addEventListener("input", () => {
      const t = active();
      if (!t || t.kind !== "local") return;
      const cur = state.docs.find(x => x.id === t.docId);
      if (!cur) return;
      cur.name = $("#docTitle").value || "Untitled";
      cur.updated = Date.now();
      t.name = cur.name;
      queueSave();
      libQueueRename(cur.id);
      renderTabs();
      clearTimeout($("#docTitle")._t);
      $("#docTitle")._t = setTimeout(renderDocs, 400);
    });
    $("#docTitle").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); ed.focus(); } });

    /* toolbar */
    $("#toolbar").addEventListener("click", e => {
      const b = e.target.closest("[data-tool]");
      if (!b) return;
      TOOLS[+b.dataset.tool].run();
    });

    /* top bar */
    document.querySelectorAll("[data-view]").forEach(b =>
      b.addEventListener("click", () => setView(b.dataset.view)));
    $("#btnTheme").addEventListener("click", toggleTheme);
    $("#btnPip").addEventListener("click", togglePip);
    $("#btnSide").addEventListener("click", () => setSidebar(!state.settings.sidebar));
    $("#btnSave").addEventListener("click", saveMarkdown);
    $("#btnFind").addEventListener("click", () => showFind($("#findbar").hidden));
    $("#btnNew").addEventListener("click", () => newDoc());
    $("#btnOpen").addEventListener("click", () => $("#filePick").click());
    $("#btnFolder").addEventListener("click", openFolder);

    /* editor tabs */
    $("#tabbar").addEventListener("click", e => {
      const x = e.target.closest("[data-close]");
      if (x) { e.stopPropagation(); closeTab(x.dataset.close); return; }
      const tb = e.target.closest("[data-tab]");
      if (tb && tb.dataset.tab !== activeTab) activateTab(tb.dataset.tab);
    });
    $("#btnCloseAll").addEventListener("click", closeAllTabs);
    $("#tabbar").addEventListener("auxclick", e => {
      if (e.button !== 1) return;
      const tb = e.target.closest("[data-tab]");
      if (tb) { e.preventDefault(); closeTab(tb.dataset.tab); }
    });

    /* file tree */
    $("#treeBody").addEventListener("click", async e => {
      const fs = e.target.closest("[data-fs]");
      if (fs) {
        const a = fs.dataset.fs;
        if (a === "open") openFolder();
        else if (a === "reopen" && reopen) {
          try { await useFolder(reopen.handle); idbSet("root", reopen.handle); }
          catch (err) { toast(tr("Could not reopen that folder")); }
        } else if (a === "new") newFileInFolder();
        else if (a === "refresh") { if (tree) { dropSearchCache(); await refreshTree(tree); renderTree(); toast(tr("Refreshed")); } }
        else if (a === "close") closeFolder();
        return;
      }
      const row = e.target.closest(".tree-row");
      if (!row) return;
      const n = nodeByPath.get(row.dataset.path);
      if (!n) return;
      selectRow(n.path);
      $("#treeBody").focus({ preventScroll: true });
      if (n.kind === "dir") {
        n.open = !n.open;
        if (n.open && n.kids === null) await loadDir(n);
        renderTree();
      } else if (n.kind === "img") showImage(treeImgKey(n), n.path);
      else { openFileNode(n); autoCloseSide(); }
    });
    $("#dirPick").addEventListener("change", e => { useFlatFolder(e.target.files); e.target.value = ""; });

    /* right-click menus, VS Code's: on the tree, on Docs, on editor tabs */
    $("#treeBody").addEventListener("contextmenu", e => {
      const row = e.target.closest(".tree-row");
      if (!row || !root) return;
      const n = nodeByPath.get(row.dataset.path);
      if (!n) return;
      e.preventDefault();
      selectRow(n.path);
      showCtx(e.clientX, e.clientY, treeItems(n));
    });
    $("#docList").addEventListener("contextmenu", e => {
      const row = e.target.closest(".doc");
      if (!row) return;
      const d = state.docs.find(x => x.id === row.dataset.id);
      if (!d) return;
      e.preventDefault();
      showCtx(e.clientX, e.clientY, docItems(d));
    });
    $("#tabbar").addEventListener("contextmenu", e => {
      e.preventDefault();
      const tb = e.target.closest("[data-tab]");
      const t = tb && tabs.find(x => x.id === tb.dataset.tab);
      /* on a tab, that tab's menu; on the empty bar beside them, Paste Tab */
      showCtx(e.clientX, e.clientY, t ? tabItems(t) : tabBarItems());
    });
    $("#tabbar").addEventListener("pointerdown", tabDragStart);
    window.addEventListener("pointermove", tabDragMove);
    window.addEventListener("pointerup", tabDragEnd);
    window.addEventListener("pointercancel", tabDragEnd);
    /* Esc while carrying a tab puts everything back where it was, as in Chrome */
    window.addEventListener("keydown", e => {
      if (e.key !== "Escape" || !tabDrag || !tabDrag.on) return;
      e.preventDefault(); e.stopPropagation();
      const d = tabDrag;
      tabs.sort((a, b) => d.order0.indexOf(a.id) - d.order0.indexOf(b.id));
      d.ghost = d.ghost || document.createElement("div");
      tabDragEnd({ type: "cancel", pointerId: d.pid });
    }, true);
    document.addEventListener("mousedown", e => { if (ctxEl && !ctxEl.contains(e.target)) hideCtx(); }, true);
    window.addEventListener("blur", hideCtx);
    window.addEventListener("resize", hideCtx);
    document.addEventListener("keydown", e => {
      if (!ctxEl) return;
      const items = [...ctxEl.querySelectorAll(".ctx-i:not(:disabled)")];
      const at = items.indexOf(document.activeElement);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const nx = items[(at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length];
        if (nx) nx.focus();
      }
    }, true);

    /* the tree answers keys of its own once a row is selected: F2, Delete, Enter, arrows */
    $("#treeBody").addEventListener("keydown", e => {
      if (!treeSel || e.target !== $("#treeBody")) return;
      const n = nodeOfPath(treeSel) || nodeByPath.get(treeSel);
      if (e.key === "F2" && n && n.kind !== "dir") { e.preventDefault(); e.stopPropagation(); startRename(treeSel); return; }
      if (e.key === "Delete" && n && n.kind !== "dir") { e.preventDefault(); deleteEntry(n); return; }
      if (e.key === "Enter" && n) { e.preventDefault(); treeRowEl(treeSel).click(); return; }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const rows = [...document.querySelectorAll("#treeBody .tree-row")];
        const i = rows.findIndex(r => r.dataset.path === treeSel);
        const nx = rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
        if (nx) { selectRow(nx.dataset.path); nx.scrollIntoView({ block: "nearest" }); }
      }
    });

    /* Quick Open / command palette */
    $("#palInput").addEventListener("input", paletteRender);
    $("#palInput").addEventListener("keydown", e => {
      if (e.key === "ArrowDown") { e.preventDefault(); paletteMove(1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); paletteMove(-1); }
      else if (e.key === "Enter") { e.preventDefault(); paletteRun(); }
      else if (e.key === "Escape") { e.preventDefault(); closePalette(); }
      else {
        /* Ctrl+P again, or Ctrl+Shift+P, switch what the box is listing */
        const c = comboOf(e);
        if (c === "Ctrl+P" || c === "Ctrl+E") { e.preventDefault(); $("#palInput").value = ""; paletteRender(); }
        else if (c === "Ctrl+Shift+P") { e.preventDefault(); $("#palInput").value = ">"; paletteRender(); }
      }
    });
    $("#palList").addEventListener("mousedown", e => {
      const it = e.target.closest(".pal-i");
      if (it) { e.preventDefault(); paletteRun(+it.dataset.i); }
    });
    $("#palette").addEventListener("mousedown", e => { if (e.target.id === "palette") closePalette(); });

    /* menu */
    $("#btnMenu").addEventListener("click", e => { e.stopPropagation(); showMenu($("#menu").hidden); });
    $("#menu").addEventListener("click", e => {
      const b = e.target.closest("[data-act]");
      if (b) menuAct(b.dataset.act);
    });
    document.addEventListener("click", e => {
      if (!$("#menu").hidden && !e.target.closest("#menu") && !e.target.closest("#btnMenu")) showMenu(false);
    });
    $("#settings").addEventListener("click", e => {
      if (e.target.id === "settings") { showSettings(false); return; }
      const b = e.target.closest("[data-set]");
      if (b) setAct(b.dataset.set);
    });
    $("#setClose").addEventListener("click", () => showSettings(false));
    $("#setLang").addEventListener("change", e => {
      state.settings.lang = e.target.value;
      applyLang();
      persist();
    });
    $("#setChange").addEventListener("click", libChooseFolder);
    $("#setOpen").addEventListener("click", libReveal);
    $("#helpClose").addEventListener("click", () => { $("#help").hidden = true; });
    $("#histClose").addEventListener("click", () => { $("#history").hidden = true; });
    $("#history").addEventListener("click", e => { if (e.target.id === "history") $("#history").hidden = true; });
    $("#histRestore").addEventListener("click", restoreHistory);
    $("#help").addEventListener("click", e => { if (e.target.id === "help") $("#help").hidden = true; });

    /* sidebar tabs */
    $("#tabFiles").addEventListener("click", () => showSideTab("files"));
    $("#tabDocs").addEventListener("click", () => showSideTab("docs"));
    $("#tabToc").addEventListener("click", () => showSideTab("toc"));
    $("#tabSearch").addEventListener("click", () => showSideTab("search"));

    /* search in folder */
    $("#fsInput").addEventListener("input", () => queueFolderSearch());
    $("#fsInput").addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); runFolderSearch(); }
    });
    $("#fsCase").addEventListener("change", () => runFolderSearch());
    $("#fsRe").addEventListener("change", () => runFolderSearch());
    $("#fsRefresh").addEventListener("click", () => { dropSearchCache(); runFolderSearch(); });
    $("#fsCollapse").addEventListener("click", () => {
      const rows = document.querySelectorAll("#fsResults .sr-file");
      const shut = Array.prototype.some.call(rows, r => !r.classList.contains("shut"));
      rows.forEach(r => {
        r.classList.toggle("shut", shut);
        if (shut) fsShut.add(r.dataset.srFile); else fsShut.delete(r.dataset.srFile);
      });
    });
    $("#fsResults").addEventListener("click", e => {
      if (e.target.closest("[data-fs-open]")) { openFolder(); return; }
      const hit = e.target.closest(".sr-hit");
      if (hit) { openSearchHit(hit); return; }
      const f = e.target.closest(".sr-file");
      if (f) {
        const p = f.dataset.srFile;
        if (f.classList.toggle("shut")) fsShut.add(p); else fsShut.delete(p);
      }
    });
    $("#docSearch").addEventListener("input", () => { renderDocs(); renderLibAssets(); });
    $("#docAssets").addEventListener("click", e => {
      if (e.target.closest("[data-as-toggle]")) {
        $("#docAssets").classList.toggle("shut");
        renderLibAssets();
        return;
      }
      const row = e.target.closest("[data-as]");
      if (row) showImage("lib:" + row.dataset.as);
    });
    $("#ivClose").addEventListener("click", hideImage);
    $("#imgView").addEventListener("click", e => { if (e.target.id === "imgView") hideImage(); });
    $("#ivCopy").addEventListener("click", () => copyText($("#ivPath").textContent, tr("Path copied")));
    $("#ivInsert").addEventListener("click", () => {
      const key = ivKey, base = imgBase(active());
      if (!key || !base) return;
      const path = key.slice(key.indexOf(":") + 1);
      hideImage();
      ed.focus();
      const name = path.replace(/^.*\//, ""), link = relFrom(base.doc, path).replace(/ /g, "%20");
      /* a picture is shown; any other file is linked - either on a line of its own,
         or a link put at the start of "# Heading" would stop it being a heading */
      insertImageText(IMG_EXT.test(path)
        ? "![" + name.replace(/\.[^.]+$/, "") + "](" + link + ")"
        : "[" + name + "](" + link + ")");
    });
    $("#docHome").addEventListener("click", e => {
      if (e.target.closest("#libWhere")) showSettings(true);
    });
    $("#docList").addEventListener("click", e => {
      const del = e.target.closest("[data-del]");
      if (del) { e.stopPropagation(); deleteDoc(del.dataset.del); return; }
      const row = e.target.closest(".doc");
      if (row) {
        /* state.active still names this doc while a FILE tab is on screen, so
           compare against the active tab or the click silently does nothing */
        const t = active();
        const showing = t && t.kind === "local" && t.docId === row.dataset.id;
        if (!showing) openDoc(row.dataset.id);
        autoCloseSide();
      }
    });
    $("#backdrop").addEventListener("click", () => setSidebar(false));
    $("#tocList").addEventListener("click", e => {
      const b = e.target.closest("[data-line]");
      if (!b) return;
      const el = preview.querySelector('[id="' + CSS.escape(b.dataset.id) + '"]');
      if (el) previewPane.scrollTop = el.offsetTop - 16;
      goToLine(+b.dataset.line);
      autoCloseSide();
      if (!isMobile()) ed.focus();
    });

    /* preview interactions */
    preview.addEventListener("click", e => {
      const cp = e.target.closest("[data-copy]");
      if (cp) {
        const code = cp.closest(".cb").querySelector("code");
        copyText(code.textContent, "Code copied");
        cp.textContent = "Copied";
        setTimeout(() => { cp.textContent = "Copy"; }, 1400);
        return;
      }
      const md = e.target.closest("[data-mmd]");
      if (md) { mmdAct(md); return; }
      const box = e.target.closest("[data-task-line]");
      if (box) {
        const line = +box.dataset.taskLine;
        const lines = ed.value.split("\n");
        if (lines[line] !== undefined) {
          lines[line] = box.checked
            ? lines[line].replace(/^(\s*(?:[-*+]|\d+[.)])\s+\[)\s(\])/, "$1x$2")
            : lines[line].replace(/^(\s*(?:[-*+]|\d+[.)])\s+\[)[xX](\])/, "$1 $2");
          const top = ed.scrollTop, pTop = previewPane.scrollTop;
          ed.setSelectionRange(0, ed.value.length);
          insert(lines.join("\n"));
          ed.scrollTop = top;
          renderNow();
          previewPane.scrollTop = pTop;
          /* insert() already fired the input handler, which writes the change to
             the ACTIVE tab. Writing to doc() here clobbered an unrelated stored
             document whenever the active tab was a file from an opened folder. */
        }
        return;
      }
      const a = e.target.closest("a");
      if (a) {
        const href = a.getAttribute("href") || "";
        if (!href || href === "#") { e.preventDefault(); return; }
        /* absolute links keep normal behaviour - they already open in a new tab */
        if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.indexOf("//") === 0) return;
        /* everything else is in-app: never let the browser leave the page */
        e.preventDefault();
        followLink(href);
      }
    });

    /* find bar */
    $("#findInput").addEventListener("input", () => runFind());
    $("#findCase").addEventListener("change", () => runFind());
    $("#findRe").addEventListener("change", () => runFind());
    $("#findNext").addEventListener("click", () => step(1));
    $("#findPrev").addEventListener("click", () => step(-1));
    $("#replOne").addEventListener("click", replaceOne);
    $("#replAll").addEventListener("click", replaceAll);
    $("#findClose").addEventListener("click", () => showFind(false));
    $("#findbar").addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); step(e.shiftKey ? -1 : 1); }
      if (e.key === "Escape") { e.preventDefault(); showFind(false); }
    });

    /* splitter */
    let dragging = false;
    $("#splitter").addEventListener("pointerdown", e => {
      dragging = true;
      $("#splitter").classList.add("drag");
      $("#splitter").setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    $("#splitter").addEventListener("pointermove", e => {
      if (!dragging) return;
      const r = panes.getBoundingClientRect();
      let p = ((e.clientX - r.left) / r.width) * 100;
      p = Math.max(15, Math.min(85, p));
      state.settings.split = Math.round(p * 10) / 10;
      panes.style.setProperty("--split", state.settings.split + "%");
      mirrorStale = true;
      scheduleFindRepaint(60);
    });
    $("#splitter").addEventListener("pointerup", e => {
      if (!dragging) return;
      dragging = false;
      $("#splitter").classList.remove("drag");
      try { $("#splitter").releasePointerCapture(e.pointerId); } catch (err) { }
      persist();
    });
    $("#splitter").addEventListener("dblclick", () => {
      state.settings.split = 50;
      applySettings();
      persist();
    });

    /* file pickers */
    $("#filePick").addEventListener("change", e => { readFiles(e.target.files); e.target.value = ""; });
    $("#jsonPick").addEventListener("change", e => {
      const f = e.target.files[0];
      e.target.value = "";
      if (!f) return;
      const fr = new FileReader();
      fr.onload = async () => {
        try {
          const data = JSON.parse(String(fr.result));
          if (!data || !Array.isArray(data.docs)) throw new Error("bad");
          const incoming = data.docs.filter(x => x && typeof x.content === "string");
          if (!incoming.length) throw new Error("empty");
          if (!(await askConfirm(tr("Import %n document(s) from this backup?")
            .replace("%n", incoming.length), { ok: tr("Import") }))) return;
          incoming.forEach(x => {
            const d = {
              id: uid(), name: String(x.name || "Imported"), content: String(x.content || ""),
              created: x.created || Date.now(), updated: Date.now()
            };
            state.docs.unshift(d);
            libFlush(d.id);          /* an imported document is a file like any other */
          });
          openDoc(state.docs[0].id);
          toast(tr("Imported ") + incoming.length + " document(s)");
        } catch (err) { toast(tr("That file is not a valid backup")); }
      };
      fr.readAsText(f);
    });

    /* drag and drop */
    let dragDepth = 0;
    window.addEventListener("dragenter", e => {
      if (!e.dataTransfer || !Array.prototype.includes.call(e.dataTransfer.types, "Files")) return;
      dragDepth++;
      $("#drop").hidden = false;
    });
    window.addEventListener("dragover", e => e.preventDefault());
    window.addEventListener("dragleave", () => { if (--dragDepth <= 0) { dragDepth = 0; $("#drop").hidden = true; } });
    window.addEventListener("drop", e => {
      e.preventDefault();
      dragDepth = 0;
      $("#drop").hidden = true;
      if (!e.dataTransfer || !e.dataTransfer.files.length) return;
      /* pictures go into the document at the caret; Markdown files open as before */
      const all = Array.prototype.slice.call(e.dataTransfer.files);
      const pics = all.filter(f => /^image\//.test(f.type) || IMG_EXT.test(f.name));
      const rest = all.filter(f => pics.indexOf(f) < 0);
      if (pics.length) addImages(pics);
      if (rest.length || !pics.length) readFiles(rest);
    });
    window.addEventListener("focus", () => { if (imgs.size) imgRecheck(); });

    /* misc */
    document.addEventListener("keydown", onGlobalKey);
    window.addEventListener("resize", () => { mirrorStale = true; mirrorStyleStale = true; scheduleFindRepaint(120); });

    /* the sidebar slides over 150ms, so repaint once it has settled */
    $("#sidebar").addEventListener("transitionend", e => {
      if (e.propertyName === "margin-left" || e.propertyName === "transform") scheduleFindRepaint(0);
    });
    window.addEventListener("beforeunload", e => {
      stashActive();
      const t = active();
      if (t && t.kind === "local") {
        const cur = state.docs.find(x => x.id === t.docId);
        if (cur) cur.content = t.content;
      }
      try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (err) { }
      libFlushNow();
      /* the floating window belongs to this one */
      if (pipLive && pipChan) { pipChan.postMessage({ type: "close" }); try { navigator.sendBeacon(floatUrl("close")); } catch (err) { } }
      /* files live on disk and are not autosaved, so warn before losing edits */
      if (tabs.some(isDirty)) { e.preventDefault(); e.returnValue = ""; return ""; }
    });
    ed.focus();
  }

  /* the same page serves the launcher's floating window, as ?pip=<channel> */
  const FLOAT_ID = (function () {
    try { return (new URLSearchParams(location.search).get("pip") || "").replace(/[^a-z0-9]/gi, ""); } catch (e) { return ""; }
  })();
  const start = FLOAT_ID ? () => initFloat(FLOAT_ID) : init;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
