/* =========================================================
   4. Markdown parser
   ========================================================= */
const MD = (function () {
  const E = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  const esc = s => String(s).replace(/[&<>"']/g, c => E[c]);

  const TAGS = new Set(["a","b","i","u","s","em","strong","del","ins","mark","small","sub","sup","kbd","code","abbr","span","br","hr","img","p","div","details","summary","center","dl","dt","dd","figure","figcaption","picture","source","table","thead","tbody","tfoot","tr","td","th","caption","ul","ol","li","blockquote","q","cite","time","var","samp","wbr"]);
  const ATTRS = new Set(["href","src","alt","title","align","width","height","class","id","open","colspan","rowspan","start","type","datetime","cite","reversed","srcset","loading","dir","lang"]);
  const VOID = new Set(["br", "hr", "img", "wbr", "source", "input"]);
  /* Every id the document's own content produces carries this, as GitHub's
     "user-content-" does. Without it a heading called "Settings" became
     id="settings" - the app's own Settings window - and since the preview comes
     first in the page, the Settings button opened the heading instead. Headings
     named Help, Menu, Status or Editor did the same to those parts of the app, and
     picked up their styling too. Links keep the plain name: #settings still finds
     the heading. */
  const ID_PREFIX = "md-";
  const TAG_RE = /^<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[a-zA-Z_:@#-][\w:.-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>`]+))?)*)\s*(\/?)>/;

  let refs = {}, fnDefs = {}, fnList = [], headings = [], slugs = {};

  /* A relative image path means nothing to the page itself - it is served from
     127.0.0.1, not from the folder the document sits in - so the app gets to say
     where "assets/shot.png" really is. It answers null to leave the URL alone, or
     { src, key }: the address to show now (null while it is still being read) and
     a key the app uses to fill it in once it has the picture. */
  let imgHook = null;
  function imgSrc(url) {
    const r = imgHook ? imgHook(url) : null;
    if (!r) return ' src="' + safeUrl(url) + '"';
    return (r.src ? ' src="' + safeUrl(r.src) + '"' : "") + ' data-img="' + esc(r.key) + '"';
  }

  /* A ```mermaid block is drawn rather than printed, with its source one click
     away. If it cannot be drawn you get the source and the reason, never a broken
     picture and never a lost block. */
  function diagram(code, A) {
    const r = MMD.render(code);
    const src = '<pre class="mmd-src"><code>' + esc(code) + "</code></pre>";
    if (r.error) {
      return '<figure class="mmd is-bad"' + A + '><div class="mmd-msg">' +
        esc(r.error) + "</div>" + src + "</figure>";
    }
    return '<figure class="mmd"' + A + '><div class="mmd-view">' + r.svg + "</div>" +
      '<pre class="mmd-src" hidden><code>' + esc(code) + "</code></pre>" +
      '<div class="mmd-bar">' +
      '<button type="button" data-mmd="code" title="' + esc(tr("Show the Mermaid source")) +
      '">' + esc(tr("Code")) + "</button>" +
      '<button type="button" data-mmd="copy" title="' + esc(tr("Copy the Mermaid source")) +
      '">' + esc(tr("Copy")) + "</button>" +
      '<span class="grow"></span>' +
      '<button type="button" data-mmd="png" title="' + esc(tr("Save the diagram as a picture")) + '">PNG</button>' +
      '<button type="button" data-mmd="svg" title="' + esc(tr("Save the diagram as SVG")) + '">SVG</button>' +
      "</div></figure>";
  }

  function safeUrl(u) {
    u = String(u || "").trim().replace(/[\u0000-\u001f]/g, "");
    const bare = u.replace(/\s+/g, "").toLowerCase();
    if (/^javascript:|^vbscript:|^file:/.test(bare)) return "#";
    if (/^data:/.test(bare) && !/^data:image\/(png|jpe?g|gif|webp|svg\+xml|avif|bmp|x-icon);/.test(bare)) return "#";
    return esc(u).replace(/ /g, "%20");
  }

  function sanTag(raw, close, name, attrs, selfClose) {
    if (close) return "</" + name + ">";
    let out = "<" + name;
    const rx = /([a-zA-Z_:@#-][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>`]+)))?/g;
    let m;
    while ((m = rx.exec(attrs || ""))) {
      const a = m[1].toLowerCase();
      if (!ATTRS.has(a)) continue;
      let v = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : "";
      if (a === "src" && name === "img") { out += imgSrc(v); continue; }
      v = (a === "href" || a === "src") ? safeUrl(v) : a === "id" ? ID_PREFIX + esc(v) : esc(v);
      out += " " + a + '="' + v + '"';
    }
    if (name === "a" && !/\shref=/.test(out)) out += ' href="#"';
    if (name === "a") out += ' target="_blank" rel="noopener noreferrer"';
    return out + (selfClose ? " />" : ">");
  }

  function slug(text) {
    let s = String(text).toLowerCase().trim()
      .replace(/[^\w\u00c0-\uffff\s-]/g, "")
      .replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
    if (!s) s = "section";
    if (slugs[s] === undefined) { slugs[s] = 0; return s; }
    slugs[s]++;
    return s + "-" + slugs[s];
  }
  const strip = h => h.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

  /* ---------------- inline ---------------- */
  const EMPH = [
    ["***", "<strong><em>", "</em></strong>"], ["___", "<strong><em>", "</em></strong>"],
    ["**", "<strong>", "</strong>"], ["__", "<strong>", "</strong>"],
    ["~~", "<del>", "</del>"], ["==", "<mark>", "</mark>"],
    ["*", "<em>", "</em>"], ["_", "<em>", "</em>"],
    ["~", "<sub>", "</sub>"], ["^", "<sup>", "</sup>"]
  ];

  function skipCode(t, j) {
    let n = 0;
    while (t[j + n] === "`") n++;
    const f = "`".repeat(n);
    const e = t.indexOf(f, j + n);
    return e === -1 ? -1 : e + n;
  }

  function findClose(t, from, mark) {
    let j = from;
    while (j < t.length) {
      const c = t[j];
      if (c === "\\") { j += 2; continue; }
      if (c === "`") { const s = skipCode(t, j); if (s !== -1) { j = s; continue; } }
      if (t.startsWith(mark, j)) {
        const prev = t[j - 1];
        if (prev !== undefined && !/\s/.test(prev)) {
          if (mark === "_" || mark === "__" || mark === "___") {
            const after = t[j + mark.length];
            if (after !== undefined && /[\w]/.test(after)) { j++; continue; }
          }
          return j;
        }
      }
      j++;
    }
    return -1;
  }

  function linkAt(t, start, isImg) {
    let depth = 0, i = start, labelEnd = -1;
    for (; i < t.length; i++) {
      const c = t[i];
      if (c === "\\") { i++; continue; }
      if (c === "`") { const s = skipCode(t, i); if (s !== -1) { i = s - 1; continue; } }
      if (c === "[") depth++;
      else if (c === "]") { depth--; if (depth === 0) { labelEnd = i; break; } }
    }
    if (labelEnd === -1) return null;
    const label = t.slice(start + 1, labelEnd);
    let j = labelEnd + 1;

    if (t[j] === "(") {
      let d = 0, k = j;
      for (; k < t.length; k++) {
        const c = t[k];
        if (c === "\\") { k++; continue; }
        if (c === "(") d++;
        else if (c === ")") { d--; if (d === 0) break; }
      }
      if (k >= t.length) return null;
      const inner = t.slice(j + 1, k).trim();
      const m = /^(<[^>]*>|\S*?)(?:\s+(?:"([^"]*)"|'([^']*)'|\(([^)]*)\)))?$/.exec(inner);
      let url = m ? m[1] : inner;
      const title = m ? (m[2] || m[3] || m[4] || "") : "";
      if (url.startsWith("<") && url.endsWith(">")) url = url.slice(1, -1);
      return { html: build(label, url, title, isImg), end: k + 1 };
    }

    let key = null, end = labelEnd + 1;
    if (t[j] === "[") {
      const close = t.indexOf("]", j + 1);
      if (close !== -1) { key = t.slice(j + 1, close).trim() || label.trim(); end = close + 1; }
    } else key = label.trim();
    if (key) {
      const d = refs[key.toLowerCase()];
      if (d) return { html: build(label, d.url, d.title, isImg), end: end };
    }
    return null;
  }

  function build(label, url, title, isImg) {
    const ti = title ? ' title="' + esc(title) + '"' : "";
    /* alt is what a screen reader says, so the label's text, not its Markdown */
    if (isImg) return "<img" + imgSrc(url) + ' alt="' + esc(strip(inline(label))) + '"' + ti + ' loading="lazy">';
    const ext = /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(url) ? ' target="_blank" rel="noopener noreferrer"' : "";
    return '<a href="' + safeUrl(url) + '"' + ti + ext + ">" + inline(label) + "</a>";
  }

  function inline(text) {
    let out = "", i = 0;
    const n = text.length;
    while (i < n) {
      const c = text[i];

      if (c === "\\" && i + 1 < n && /[\\`*_{}\[\]()#+\-.!>~|^=<>"']/.test(text[i + 1])) {
        out += esc(text[i + 1]); i += 2; continue;
      }
      if (c === "`") {
        let k = 0;
        while (text[i + k] === "`") k++;
        const f = "`".repeat(k), e = text.indexOf(f, i + k);
        if (e !== -1) {
          let code = text.slice(i + k, e);
          if (code.length > 1 && code[0] === " " && code[code.length - 1] === " ") code = code.slice(1, -1);
          out += "<code>" + esc(code) + "</code>";
          i = e + k; continue;
        }
      }
      if (c === "<") {
        const rest = text.slice(i);
        let m = /^<((?:https?|ftp|mailto|tel):[^\s<>]+)>/.exec(rest);
        if (m) {
          const u = m[1], show = u.replace(/^mailto:/, "");
          out += '<a href="' + safeUrl(u) + '" target="_blank" rel="noopener noreferrer">' + esc(show) + "</a>";
          i += m[0].length; continue;
        }
        m = /^<([\w.!#$%&'*+/=?^`{|}~-]+@[\w-]+(?:\.[\w-]+)+)>/.exec(rest);
        if (m) { out += '<a href="mailto:' + esc(m[1]) + '">' + esc(m[1]) + "</a>"; i += m[0].length; continue; }
        m = /^<!--[\s\S]*?-->/.exec(rest);
        if (m) { i += m[0].length; continue; }
        m = TAG_RE.exec(rest);
        if (m && TAGS.has(m[2].toLowerCase())) {
          out += sanTag(m[0], m[1], m[2].toLowerCase(), m[3], m[4]);
          i += m[0].length; continue;
        }
      }
      if (c === "!" && text[i + 1] === "[") {
        const r = linkAt(text, i + 1, true);
        if (r) { out += r.html; i = r.end; continue; }
      }
      if (c === "[" && text[i + 1] === "^") {
        const m = /^\[\^([^\]\s]+)\]/.exec(text.slice(i));
        if (m && fnDefs[m[1]]) {
          let idx = fnList.indexOf(m[1]);
          if (idx === -1) { fnList.push(m[1]); idx = fnList.length - 1; }
          const id = esc(m[1]);
          out += '<sup class="fnref" id="fnref-' + id + '"><a href="#fn-' + id + '">' + (idx + 1) + "</a></sup>";
          i += m[0].length; continue;
        }
      }
      if (c === "[") {
        const r = linkAt(text, i, false);
        if (r) { out += r.html; i = r.end; continue; }
      }
      if (c === "h" && /^https?:\/\/[^\s<>\[\]()"']+/.test(text.slice(i))) {
        const m = /^https?:\/\/[^\s<>\[\]()"']+/.exec(text.slice(i));
        let u = m[0].replace(/[.,;:!?]+$/, "");
        out += '<a href="' + safeUrl(u) + '" target="_blank" rel="noopener noreferrer">' + esc(u) + "</a>";
        i += u.length; continue;
      }

      let done = false;
      for (let e = 0; e < EMPH.length; e++) {
        const mk = EMPH[e][0];
        if (!text.startsWith(mk, i)) continue;
        const nx = text[i + mk.length];
        if (nx === undefined || /\s/.test(nx)) continue;
        if ((mk === "_" || mk === "__" || mk === "___") && i > 0 && /[\w]/.test(text[i - 1])) continue;
        if (mk === "^" && /\s/.test(nx)) continue;
        const close = findClose(text, i + mk.length, mk);
        if (close === -1) continue;
        const body = text.slice(i + mk.length, close);
        if (!body.trim()) continue;
        out += EMPH[e][1] + inline(body) + EMPH[e][2];
        i = close + mk.length;
        done = true;
        break;
      }
      if (done) continue;

      /* a backslash at the end of a line is a hard break: consume both, or the
         backslash itself ends up on screen. "\\" was already taken by the escape
         rule above, so reaching here means a single one. */
      if (c === "\\" && text[i + 1] === "\n") { out += "<br>"; i += 2; continue; }

      if (c === "\n") {
        if (/ {2,}$/.test(out)) out = out.replace(/ +$/, "") + "<br>";
        else out += "\n";
        i++; continue;
      }
      out += esc(c);
      i++;
    }
    return out;
  }

  /* ---------------- blocks ---------------- */
  const RE_FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*(.*)$/;
  const RE_HEAD = /^ {0,3}(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/;
  const RE_HR = /^ {0,3}([-*_])[ \t]*(?:\1[ \t]*){2,}$/;
  const RE_ITEM = /^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+)(.*)$/;
  const RE_DELIM = /^[ \t]*\|?[ \t]*:?-{1,}:?[ \t]*(?:\|[ \t]*:?-{1,}:?[ \t]*)*\|?[ \t]*$/;
  const RE_SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;

  function interrupts(l) {
    return !l.trim() || RE_HEAD.test(l) || RE_FENCE.test(l) || RE_HR.test(l) ||
      /^ {0,3}>/.test(l) || /^ {0,3}(?:[-*+]|\d{1,9}[.)])[ \t]+\S/.test(l) ||
      /^ {0,3}<\/?[a-zA-Z][\w-]*[\s/>]/.test(l);
  }

  function splitRow(row) {
    let s = row.trim();
    if (s.startsWith("|")) s = s.slice(1);
    if (/[^\\]\|$/.test(s) || s === "|") s = s.replace(/\|$/, "");
    const cells = [];
    let cur = "";
    for (let i = 0; i < s.length; i++) {
      if (s[i] === "\\" && s[i + 1] === "|") { cur += "|"; i++; continue; }
      if (s[i] === "`") { const e = skipCode(s, i); if (e !== -1) { cur += s.slice(i, e); i = e - 1; continue; } }
      if (s[i] === "|") { cells.push(cur); cur = ""; continue; }
      cur += s[i];
    }
    cells.push(cur);
    return cells.map(x => x.trim());
  }

  const ICONS = {
    note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/></svg>',
    tip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6M10 22h4M12 2a6 6 0 00-4 10.5c.7.8 1 1.5 1 2.5h6c0-1 .3-1.7 1-2.5A6 6 0 0012 2z"/></svg>',
    important: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/><path d="M12 7v4M12 14h.01"/></svg>',
    warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>',
    caution: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6M9 9l6 6"/></svg>'
  };

  function blocks(lines, base, top) {
    let out = "", i = 0;
    const L = lines.length;

    while (i < L) {
      const line = lines[i];
      if (!line.trim()) { i++; continue; }
      const A = top ? ' data-src-line="' + (base + i) + '"' : "";
      let m;

      /* fenced code */
      if ((m = RE_FENCE.exec(line))) {
        const ch = m[1][0], len = m[1].length;
        const info = (m[2] || "").trim();
        const closeRe = new RegExp("^ {0,3}[" + ch + "]{" + len + ",}[ \\t]*$");
        let j = i + 1;
        const buf = [];
        while (j < L && !closeRe.test(lines[j])) { buf.push(lines[j]); j++; }
        const lang = (info.split(/[\s,{]/)[0] || "").toLowerCase().replace(/^\./, "");
        const code = buf.join("\n");
        if (MMD.handles(lang)) { out += diagram(code, A); i = j + 1; continue; }
        out += '<div class="cb"' + A + '><div class="cb-h"><span class="cb-l">' +
          esc(lang || "text") + '</span><button class="cb-c" type="button" data-copy>Copy</button></div>' +
          '<pre><code class="language-' + esc(lang || "text") + '">' + HL.highlight(code, lang) + "</code></pre></div>";
        i = j + 1; continue;
      }

      /* ATX heading */
      if ((m = RE_HEAD.exec(line))) {
        const lv = m[1].length;
        const inner = inline(m[2]);
        const txt = strip(inner);
        const id = slug(txt);
        if (top) headings.push({ level: lv, text: txt, id: ID_PREFIX + id, line: base + i });
        out += "<h" + lv + ' id="' + ID_PREFIX + id + '"' + A + ">" + inner +
          '<a class="anchor" href="#' + id + '" aria-hidden="true">#</a></h' + lv + ">";
        i++; continue;
      }

      /* thematic break */
      if (RE_HR.test(line)) { out += "<hr" + A + ">"; i++; continue; }

      /* blockquote / callout */
      if (/^ {0,3}>/.test(line)) {
        const buf = [];
        let j = i;
        while (j < L) {
          const t = lines[j];
          if (/^ {0,3}>/.test(t)) { buf.push(t.replace(/^ {0,3}> ?/, "")); j++; continue; }
          if (t.trim() && !interrupts(t)) { buf.push(t); j++; continue; }
          break;
        }
        const cm = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(.*)$/i.exec(buf[0] || "");
        if (cm) {
          const kind = cm[1].toLowerCase();
          buf[0] = cm[2] || "";
          const label = kind.charAt(0).toUpperCase() + kind.slice(1);
          out += '<div class="callout c-' + kind + '"' + A + '><div class="callout-t">' +
            ICONS[kind] + label + "</div>" + blocks(buf, base + i, false) + "</div>";
        } else {
          out += "<blockquote" + A + ">" + blocks(buf, base + i, false) + "</blockquote>";
        }
        i = j; continue;
      }

      /* table */
      if (line.indexOf("|") !== -1 && i + 1 < L && RE_DELIM.test(lines[i + 1]) && lines[i + 1].indexOf("-") !== -1) {
        const head = splitRow(line);
        const delim = splitRow(lines[i + 1]);
        if (delim.length === head.length) {
          const align = delim.map(d => {
            const l = d.startsWith(":"), r = d.endsWith(":");
            return l && r ? "center" : r ? "right" : l ? "left" : "";
          });
          let j = i + 2;
          const rows = [];
          while (j < L && lines[j].trim() && lines[j].indexOf("|") !== -1 && !RE_FENCE.test(lines[j])) {
            rows.push(splitRow(lines[j])); j++;
          }
          const st = k => align[k] ? ' style="text-align:' + align[k] + '"' : "";
          let t = '<div class="tw"' + A + "><table><thead><tr>";
          head.forEach((h, k) => { t += "<th" + st(k) + ">" + inline(h) + "</th>"; });
          t += "</tr></thead><tbody>";
          rows.forEach(r => {
            t += "<tr>";
            for (let k = 0; k < head.length; k++) t += "<td" + st(k) + ">" + inline(r[k] || "") + "</td>";
            t += "</tr>";
          });
          out += t + "</tbody></table></div>";
          i = j; continue;
        }
      }

      /* list */
      if (RE_ITEM.test(line) && /^[ \t]{0,3}(?:[-*+]|\d{1,9}[.)])[ \t]+\S/.test(line)) {
        const r = list(lines, i, base, top);
        out += r.html; i = r.next; continue;
      }

      /* indented code */
      if (/^(?: {4}|\t)/.test(line) && (i === 0 || !lines[i - 1].trim())) {
        const buf = [];
        let j = i;
        while (j < L && (/^(?: {4}|\t)/.test(lines[j]) || !lines[j].trim())) {
          buf.push(lines[j].replace(/^(?: {4}|\t)/, "")); j++;
        }
        while (buf.length && !buf[buf.length - 1].trim()) buf.pop();
        out += '<pre class="plain"' + A + "><code>" + esc(buf.join("\n")) + "</code></pre>";
        i = j; continue;
      }

      /* raw html block */
      if (/^ {0,3}<\/?[a-zA-Z][\w-]*[\s/>]/.test(line)) {
        const tm = TAG_RE.exec(line.trim());
        if (tm && TAGS.has(tm[2].toLowerCase())) {
          const buf = [];
          let j = i;
          while (j < L && lines[j].trim()) { buf.push(lines[j]); j++; }
          const raw = inline(buf.join("\n"));
          /* A block that opens an element and leaves it open - <details> with
             Markdown between it and </details> - must not be wrapped: the wrapper's
             own </div> would close it on the spot and leave everything meant to be
             inside it outside. So only a balanced block gets the wrapper; an open or
             closing one goes out as it is, its source line on its first tag. */
          let depth = 0, tg;
          const tagRx = /<(\/?)([a-zA-Z][\w-]*)[^>]*?(\/?)>/g;
          while ((tg = tagRx.exec(raw))) {
            if (tg[3] || VOID.has(tg[2].toLowerCase())) continue;
            depth += tg[1] ? -1 : 1;
          }
          out += depth === 0 ? "<div" + A + ">" + raw + "</div>"
            : raw.replace(/^(\s*<[a-zA-Z][\w-]*)/, "$1" + A);
          i = j; continue;
        }
      }

      /* paragraph + setext */
      const buf = [];
      let j = i;
      while (j < L) {
        const t = lines[j];
        if (buf.length && RE_SETEXT.test(t)) {
          const lv = t.trim()[0] === "=" ? 1 : 2;
          const inner = inline(buf.join("\n"));
          const txt = strip(inner);
          const id = slug(txt);
          if (top) headings.push({ level: lv, text: txt, id: ID_PREFIX + id, line: base + i });
          out += "<h" + lv + ' id="' + ID_PREFIX + id + '"' + A + ">" + inner +
            '<a class="anchor" href="#' + id + '" aria-hidden="true">#</a></h' + lv + ">";
          i = j + 1;
          buf.length = 0;
          break;
        }
        if (buf.length && interrupts(t)) break;
        if (!t.trim()) break;
        buf.push(t); j++;
      }
      if (!buf.length) { if (i === j) i = j + 1; continue; }
      out += "<p" + A + ">" + inline(buf.join("\n")) + "</p>";
      i = j;
    }
    return out;
  }

  function list(lines, start, base, top) {
    const L = lines.length;
    const first = RE_ITEM.exec(lines[start]);
    const baseInd = first[1].replace(/\t/g, "    ").length;
    const ordered = /\d/.test(first[2]);
    const startNo = ordered ? parseInt(first[2], 10) : 1;
    const items = [];
    let cur = null, contInd = 0, loose = false, pendingBlank = 0;
    let i = start;

    while (i < L) {
      const raw = lines[i];
      const ln = raw.replace(/\t/g, "    ");
      const m = RE_ITEM.exec(ln);
      const ind = (ln.match(/^ */) || [""])[0].length;

      if (m && ind <= baseInd + 1 && /\d/.test(m[2]) === ordered) {
        if (cur && pendingBlank) loose = true;
        contInd = m[1].length + m[2].length + m[3].length;
        cur = { lines: [m[4]], line: base + i };
        items.push(cur);
        pendingBlank = 0; i++; continue;
      }
      if (!ln.trim()) {
        let k = i;
        while (k < L && !lines[k].trim()) k++;
        if (k >= L) break;
        const nx = lines[k].replace(/\t/g, "    ");
        const nm = RE_ITEM.exec(nx);
        const nind = (nx.match(/^ */) || [""])[0].length;
        if ((nm && nind <= baseInd + 1 && /\d/.test(nm[2]) === ordered) || nind >= contInd) {
          pendingBlank++;
          if (cur) cur.lines.push("");
          i++; continue;
        }
        break;
      }
      if (ind >= contInd) {
        if (cur) cur.lines.push(ln.slice(contInd));
        i++; continue;
      }
      if (m && ind > baseInd + 1) { if (cur) cur.lines.push(ln.slice(Math.min(ind, contInd))); i++; continue; }
      if (cur && !m && !pendingBlank) { cur.lines.push(ln.trim()); i++; continue; }
      break;
    }

    let html = "";
    let anyTask = false;
    items.forEach(it => {
      let task = null;
      const tm = /^\[([ xX])\][ \t]+([\s\S]*)$/.exec(it.lines[0] || "");
      if (tm) { task = tm[1].toLowerCase() === "x"; it.lines[0] = tm[2]; anyTask = true; }
      let body = blocks(it.lines, it.line, false);
      if (!loose) body = body.replace(/^<p(?: [^>]*)?>([\s\S]*?)<\/p>/, "$1");
      const cls = task === null ? "" : ' class="task' + (task ? " done" : "") + '"';
      const box = task === null ? "" :
        '<input type="checkbox" data-task-line="' + it.line + '"' + (task ? " checked" : "") + ">";
      html += "<li" + cls + ' data-src-line="' + it.line + '">' + box + body + "</li>";
    });

    const A = top ? ' data-src-line="' + (base + start) + '"' : "";
    const tag = ordered ? "ol" : "ul";
    const st = ordered && startNo !== 1 ? ' start="' + startNo + '"' : "";
    const lc = anyTask ? ' class="tasklist"' : "";
    return { html: "<" + tag + st + lc + A + ">" + html + "</" + tag + ">", next: i };
  }

  function collectDefs(lines) {
    let fence = null;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const f = RE_FENCE.exec(l);
      if (f) { if (fence && new RegExp("^ {0,3}[" + fence[0] + "]{" + fence.length + ",}[ \\t]*$").test(l)) fence = null; else if (!fence) fence = f[1]; continue; }
      if (fence) continue;

      let m = /^ {0,3}\[\^([^\]\s]+)\]:[ \t]*(.*)$/.exec(l);
      if (m) {
        const body = [m[2]];
        lines[i] = "";
        let j = i + 1;
        while (j < lines.length && (/^(?: {2,}|\t)\S/.test(lines[j]) || (!lines[j].trim() && /^(?: {2,}|\t)\S/.test(lines[j + 1] || "")))) {
          body.push(lines[j].replace(/^(?: {4}|\t| {2})/, "")); lines[j] = ""; j++;
        }
        fnDefs[m[1]] = body.join("\n").trim();
        i = j - 1; continue;
      }
      m = /^ {0,3}\[([^\]^][^\]]*)\]:[ \t]*(\S+)(?:[ \t]+(?:"([^"]*)"|'([^']*)'|\(([^)]*)\)))?[ \t]*$/.exec(l);
      if (m) {
        refs[m[1].trim().toLowerCase()] = { url: m[2], title: m[3] || m[4] || m[5] || "" };
        lines[i] = "";
      }
    }
  }

  function renderFootnotes() {
    if (!fnList.length) return "";
    let h = '<section class="footnotes"><ol>';
    fnList.forEach(k => {
      const id = esc(k);
      const body = blocks(String(fnDefs[k] || "").split("\n"), 0, false)
        .replace(/^<p(?: [^>]*)?>([\s\S]*)<\/p>$/, "$1");
      h += '<li id="fn-' + id + '">' + body +
        '<a class="fnback" href="#fnref-' + id + '" aria-label="Back to content">&#8617;</a></li>';
    });
    return h + "</ol></section>";
  }

  function render(src) {
    refs = {}; fnDefs = {}; fnList = []; headings = []; slugs = {};
    const text = String(src == null ? "" : src).replace(/\r\n?/g, "\n").replace(/\u00a0/g, " ");
    const lines = text.split("\n");
    collectDefs(lines);
    let html = blocks(lines, 0, true);
    html += renderFootnotes();
    return { html: html, headings: headings };
  }

  return { render: render, escape: esc, setImageHook: fn => { imgHook = fn; }, ID_PREFIX: ID_PREFIX };
})();

