/* =========================================================
   3. Mermaid flowcharts
   ========================================================= */
/* Enough of Mermaid to draw the diagrams people actually put in a README:
   flowchart / graph in all four directions, the usual node shapes, the usual link
   styles, edge labels, subgraphs and styling. Hand-written for the same reason the
   Markdown parser below it is - Mermaid itself is some three megabytes once d3,
   dagre and cytoscape come with it, an order of magnitude more than this whole app,
   and it would have to be carried inside it to keep working with no connection.

   Layout is the textbook layered one: rank the nodes, give long edges invisible
   stops to travel through, order each rank to untangle the crossings, then place
   them. Everything is computed in "along the ranks" and "across a rank", and only
   the last step knows whether that means down, up, right or left.

   Whatever it cannot read is reported by line, and the block falls back to showing
   its source instead of a broken picture. */
const MMD = (function () {
  const E = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  const esc = s => String(s).replace(/[&<>"']/g, c => E[c]);

  const FONT = '13px ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif';
  const LFONT = '11.5px ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif';
  const PAD_X = 15, PAD_Y = 9, MIN_W = 48, MIN_H = 36, LH = 17;
  const GAP_ACROSS = 28, GAP_ALONG = 48, PAD = 10;
  const MAX_NODES = 400;

  /* Text is measured rather than guessed at, or every box would be the wrong size
     for its label. A canvas is the cheapest ruler the browser has. */
  let ctx;
  function measure(text, font) {
    if (ctx === undefined) {
      try { ctx = document.createElement("canvas").getContext("2d"); }
      catch (e) { ctx = null; }
    }
    if (!ctx) return String(text).length * 7.1;
    ctx.font = font || FONT;
    return ctx.measureText(String(text)).width;
  }

  /* ---------------------------------------------------------------- parsing */

  /* Longest opener first: "[[" must be tried before "[", or every subroutine reads
     as a rectangle whose label starts with a bracket. */
  const SHAPES = [
    ["(((", ")))", "circle"],
    ["([", "])", "stadium"],
    ["[[", "]]", "subroutine"],
    ["[(", ")]", "cylinder"],
    ["((", "))", "circle"],
    ["{{", "}}", "hexagon"],
    ["[/", "/]", "leanr"],
    ["[/", "\\]", "trapa"],
    ["[\\", "\\]", "leanl"],
    ["[\\", "/]", "trapb"],
    ["[", "]", "rect"],
    ["(", ")", "round"],
    ["{", "}", "rhombus"],
    [">", "]", "odd"]
  ];
  /* No "-" in an id: "A-->B" would otherwise read as a node called "A-". */
  const ID_RE = /^[A-Za-z0-9_À-￿]+/;
  const HEADS = ">xo";

  function unquote(s) {
    s = String(s).trim();
    const a = s.charAt(0), b = s.charAt(s.length - 1);
    if (s.length > 1 && ((a === '"' && b === '"') || (a === "'" && b === "'"))) s = s.slice(1, -1);
    return s;
  }
  /* "<br/>" is how Mermaid breaks a label; a literal \n is how people try to. */
  function textLines(s) {
    const parts = unquote(s).replace(/<br\s*\/?>/gi, "\n").replace(/\\n/g, "\n")
      .split("\n").map(x => x.trim());
    while (parts.length > 1 && parts[0] === "") parts.shift();
    while (parts.length > 1 && parts[parts.length - 1] === "") parts.pop();
    return parts;
  }

  function readNode(s, p) {
    const m = ID_RE.exec(s.slice(p));
    if (!m) return null;
    const id = m[0];
    const q = p + id.length;
    for (let i = 0; i < SHAPES.length; i++) {
      const open = SHAPES[i][0], close = SHAPES[i][1];
      if (s.substr(q, open.length) !== open) continue;
      const at = s.indexOf(close, q + open.length);
      if (at < 0) continue;
      return { id: id, text: s.slice(q + open.length, at), shape: SHAPES[i][2],
               end: at + close.length };
    }
    return { id: id, text: null, shape: null, end: q };
  }

  /* One link, in any of the spellings: --> --- -.-> ==> --x --o <--> and the two
     ways of labelling one, "-- yes -->" and "-->|yes|". */
  function readLink(s, p) {
    let q = p, back = false;
    if (s.charAt(q) === "<" && "-=.".indexOf(s.charAt(q + 1)) >= 0) { back = true; q++; }
    const a = q;
    while (q < s.length && "-=.".indexOf(s.charAt(q)) >= 0) q++;
    const lead = s.slice(a, q);
    if (lead.length < 2) return null;

    let label = "", tail = "";
    if (q < s.length && HEADS.indexOf(s.charAt(q)) < 0 && /^(--|==|-\.)$/.test(lead)) {
      const m = /^\s*(\S[^\n]*?)\s*([-=.]{2,})/.exec(s.slice(q));
      if (!m) return null;                 /* "A -- B" is a dangling link, not one */
      label = m[1]; tail = m[2]; q += m[0].length;
    }
    let head = "";
    if (q < s.length && HEADS.indexOf(s.charAt(q)) >= 0) { head = s.charAt(q); q++; }
    if (!label && s.charAt(q) === "|") {
      const at = s.indexOf("|", q + 1);
      if (at > 0) { label = s.slice(q + 1, at); q = at + 1; }
    }
    const all = lead + tail;
    return {
      end: q, back: back, head: head,
      label: unquote(label),
      style: all.indexOf(".") >= 0 ? "dotted" : all.indexOf("=") >= 0 ? "thick" : "solid"
    };
  }

  /* Semicolons separate statements, but only outside a label - "A[a;b]" is one node. */
  function statements(line) {
    const out = [];
    let depth = 0, quote = "", start = 0;
    for (let i = 0; i < line.length; i++) {
      const c = line.charAt(i);
      if (quote) { if (c === quote) quote = ""; continue; }
      if (c === '"' || c === "'") { quote = c; continue; }
      if (c === "[" || c === "(" || c === "{") depth++;
      else if (c === "]" || c === ")" || c === "}") depth--;
      else if (c === ";" && depth <= 0) { out.push(line.slice(start, i)); start = i + 1; }
    }
    out.push(line.slice(start));
    return out.map(x => x.trim()).filter(Boolean);
  }

  function props(s) {
    const o = {};
    String(s).split(",").forEach(kv => {
      const i = kv.indexOf(":");
      if (i > 0) o[kv.slice(0, i).trim().toLowerCase()] = kv.slice(i + 1).trim();
    });
    return o;
  }

  function node(g, id) {
    let n = g.nodes.get(id);
    if (!n) {
      n = { id: id, lines: [id], shape: "rect", group: null, cls: [], style: null };
      g.nodes.set(id, n);
      g.order.push(id);
    }
    return n;
  }

  function parse(src) {
    const g = {
      dir: "TB", nodes: new Map(), order: [], edges: [],
      groups: [], classes: new Map()
    };
    const raw = String(src).replace(/\r\n?/g, "\n").split("\n");
    const open = [];
    let started = false;

    for (let i = 0; i < raw.length; i++) {
      let line = raw[i];
      const c = line.indexOf("%%");
      if (c >= 0) line = line.slice(0, c);
      line = line.trim();
      if (!line) continue;

      if (!started) {
        const m = /^(?:flowchart|graph)[ \t]*(TB|TD|BT|LR|RL)?\b/i.exec(line);
        if (!m) {
          return { error: tr('the first line should be "flowchart TD" (or graph LR, ' +
                             'and TB, BT, RL work too) - only flowcharts are drawn here') };
        }
        g.dir = (m[1] || "TB").toUpperCase();
        if (g.dir === "TD") g.dir = "TB";
        started = true;
        line = line.slice(m[0].length).trim();
        if (!line) continue;
      }

      const sts = statements(line);
      for (let k = 0; k < sts.length; k++) {
        const err = statement(sts[k], g, open, i + 1);
        if (err) return { error: err };
        if (g.nodes.size > MAX_NODES) {
          return { error: tr("this diagram has more than ") + MAX_NODES + tr(" nodes") };
        }
      }
    }
    if (!started) return { error: tr("there is nothing here to draw") };
    if (!g.nodes.size) return { error: tr("no nodes were defined") };
    return { graph: g };
  }

  function statement(st, g, open, ln) {
    const where = " (" + tr("line") + " " + ln + ")";

    let m = /^subgraph\b\s*(.*)$/i.exec(st);
    if (m) {
      const rest = m[1].trim();
      let id = "sg" + g.groups.length, title = rest;
      const n = readNode(rest, 0);
      if (n && n.text !== null && n.end === rest.length) { id = n.id; title = n.text; }
      else if (rest) title = unquote(rest);
      const grp = { id: id, title: textLines(title || " ").join(" "), members: [] };
      g.groups.push(grp);
      open.push(grp);
      return null;
    }
    if (/^end$/i.test(st)) { open.pop(); return null; }
    /* recognised, and deliberately not acted on */
    if (/^(direction|click|linkStyle|call)\b/i.test(st)) return null;

    if ((m = /^classDef\s+(\S+)\s+(.*)$/i.exec(st))) {
      m[1].split(",").forEach(name => g.classes.set(name.trim(), props(m[2])));
      return null;
    }
    if ((m = /^class\s+([^\s]+)\s+(\S+)\s*$/i.exec(st))) {
      m[1].split(",").forEach(id => node(g, id.trim()).cls.push(m[2].trim()));
      return null;
    }
    if ((m = /^style\s+(\S+)\s+(.*)$/i.exec(st))) {
      node(g, m[1]).style = props(m[2]);
      return null;
    }
    return chain(st, g, open.length ? open[open.length - 1] : null, where);
  }

  /* "A[Start] --> B{Ok?} -- yes --> C([Done])", and node lists joined with & */
  function chain(s, g, group, where) {
    let p = 0, prev = null, link = null;
    const skip = () => { while (p < s.length && /\s/.test(s.charAt(p))) p++; };

    while (p < s.length) {
      skip();
      if (p >= s.length) break;

      const ids = [];
      for (;;) {
        const n = readNode(s, p);
        if (!n) return tr("could not read ") + '"' + s.slice(p, p + 26) + '"' + where;
        p = n.end;
        const nd = node(g, n.id);
        if (n.text !== null) { nd.lines = textLines(n.text); nd.shape = n.shape; }
        /* "A:::warning" is the inline way of putting a node in a class */
        const cm = /^:::([A-Za-z0-9_-]+)/.exec(s.slice(p));
        if (cm) { nd.cls.push(cm[1]); p += cm[0].length; }
        if (group && group.members.indexOf(n.id) < 0) {
          group.members.push(n.id);
          if (nd.group === null) nd.group = group.id;
        }
        ids.push(n.id);
        skip();
        if (s.charAt(p) === "&") { p++; skip(); continue; }
        break;
      }

      if (prev && link) {
        for (let a = 0; a < prev.length; a++) {
          for (let b = 0; b < ids.length; b++) {
            g.edges.push({
              from: prev[a], to: ids[b], label: link.label,
              style: link.style, head: link.head, both: link.back
            });
          }
        }
      }
      prev = ids;

      skip();
      if (p >= s.length) break;
      link = readLink(s, p);
      if (!link) return tr("could not read ") + '"' + s.slice(p, p + 26) + '"' + where;
      p = link.end;
    }
    return null;
  }

  /* ---------------------------------------------------------------- sizing */

  function sizeOf(n) {
    let w = 0;
    for (let i = 0; i < n.lines.length; i++) w = Math.max(w, measure(n.lines[i]));
    let bw = Math.max(MIN_W, Math.ceil(w) + PAD_X * 2);
    let bh = Math.max(MIN_H, n.lines.length * LH + PAD_Y * 2);
    switch (n.shape) {
      case "rhombus": bw = Math.ceil(bw * 1.3) + 14; bh = Math.ceil(bh * 1.45); break;
      case "circle": { const d = Math.ceil(Math.max(bw, bh) * 1.06) + 6; bw = d; bh = d; break; }
      case "hexagon": bw += 26; break;
      case "leanr": case "leanl": case "trapa": case "trapb": bw += 30; break;
      case "cylinder": bh += 14; break;
      case "stadium": bw += 12; break;
      case "subroutine": bw += 16; break;
      case "odd": bw += 14; break;
    }
    n.w = bw; n.h = bh;
  }

  /* ---------------------------------------------------------------- layout */

  /* A cycle has no layering, so the edges that close one are found and left out of
     the ranking. They are still drawn - they just do not get a say in what comes
     before what, which is the usual way of laying out a graph that loops back. */
  function backEdges(g) {
    const adj = new Map();
    g.nodes.forEach((n, id) => adj.set(id, []));
    g.edges.forEach((e, i) => { if (adj.has(e.from) && adj.has(e.to)) adj.get(e.from).push(i); });

    const state = new Map(), back = new Set();
    g.order.forEach(id => {
      if (state.get(id)) return;
      /* an explicit stack: a deep chain would overflow a recursive walk */
      const stack = [{ id: id, k: 0 }];
      state.set(id, 1);
      while (stack.length) {
        const top = stack[stack.length - 1];
        const list = adj.get(top.id);
        if (top.k >= list.length) { state.set(top.id, 2); stack.pop(); continue; }
        const ei = list[top.k++];
        const to = g.edges[ei].to;
        const st = state.get(to) || 0;
        if (st === 1) back.add(ei);
        else if (st === 0) { state.set(to, 1); stack.push({ id: to, k: 0 }); }
      }
    });
    return back;
  }

  function rankNodes(g, back) {
    const indeg = new Map(), outs = new Map();
    g.nodes.forEach((n, id) => { indeg.set(id, 0); outs.set(id, []); });
    g.edges.forEach((e, i) => {
      if (back.has(i) || !outs.has(e.from) || !indeg.has(e.to) || e.from === e.to) return;
      outs.get(e.from).push(e.to);
      indeg.set(e.to, indeg.get(e.to) + 1);
    });
    const rank = new Map();
    const queue = [];
    g.order.forEach(id => { rank.set(id, 0); if (!indeg.get(id)) queue.push(id); });
    let head = 0;
    while (head < queue.length) {
      const id = queue[head++];
      outs.get(id).forEach(to => {
        rank.set(to, Math.max(rank.get(to), rank.get(id) + 1));
        indeg.set(to, indeg.get(to) - 1);
        if (!indeg.get(to)) queue.push(to);
      });
    }
    return rank;
  }

  /* Virtual stops so an edge that skips a rank travels between the boxes on the way
     rather than straight across them. */
  function build(g, rank, back) {
    const cells = [];
    const all = [];
    g.order.forEach(id => {
      const n = g.nodes.get(id);
      sizeOf(n);
      n.rank = rank.get(id);
      n.virtual = false;
      all.push(n);
    });

    const routes = [];
    g.edges.forEach((e, i) => {
      const a = g.nodes.get(e.from), b = g.nodes.get(e.to);
      if (!a || !b) return;
      const flip = back.has(i) || a.rank > b.rank;
      const lo = flip ? b : a, hi = flip ? a : b;
      const chainIds = [];
      if (hi.rank - lo.rank > 1) {
        for (let r = lo.rank + 1; r < hi.rank; r++) {
          const v = { id: "\u0000v" + routes.length + "_" + r, lines: [], shape: "rect",
                      w: 1, h: 1, rank: r, virtual: true, cls: [], style: null, group: null };
          all.push(v);
          chainIds.push(v);
        }
      }
      routes.push({ edge: e, a: a, b: b, flip: flip, via: chainIds, index: i });
    });

    all.forEach(n => {
      (cells[n.rank] || (cells[n.rank] = [])).push(n);
    });
    for (let r = 0; r < cells.length; r++) if (!cells[r]) cells[r] = [];
    return { cells: cells, routes: routes, all: all };
  }

  /* Neighbours as the ordering pass sees them: the real edge if it is short, else
     the virtual stop that stands in for it on the next rank along. */
  function neighbours(lay) {
    const up = new Map(), down = new Map();
    lay.all.forEach(n => { up.set(n, []); down.set(n, []); });

    lay.routes.forEach(r => {
      if (r.a === r.b) return;                    /* a self-loop ranks nothing */
      const path = [r.flip ? r.b : r.a].concat(r.via, [r.flip ? r.a : r.b]);
      for (let i = 0; i + 1 < path.length; i++) {
        down.get(path[i]).push(path[i + 1]);
        up.get(path[i + 1]).push(path[i]);
      }
    });
    return { up: up, down: down };
  }

  function order(lay, nb) {
    const pos = new Map();
    const reindex = () => lay.cells.forEach(c => c.forEach((n, i) => pos.set(n, i)));
    reindex();

    const bary = (n, side) => {
      const list = side.get(n);
      if (!list.length) return null;
      let s = 0;
      for (let i = 0; i < list.length; i++) s += pos.get(list[i]);
      return s / list.length;
    };

    for (let pass = 0; pass < 6; pass++) {
      const down = pass % 2 === 0;
      const from = down ? 1 : lay.cells.length - 2;
      const step = down ? 1 : -1;
      for (let r = from; down ? r < lay.cells.length : r >= 0; r += step) {
        const side = down ? nb.up : nb.down;
        const cell = lay.cells[r];
        const keyed = cell.map((n, i) => {
          const b = bary(n, side);
          return { n: n, i: i, b: b === null ? i : b };
        });
        keyed.sort((p, q) => {
          /* subgraph members stay side by side, or their box would swallow the rest */
          const gp = p.n.group || "", gq = q.n.group || "";
          if (gp !== gq) {
            const d = (gp === "" ? 1 : 0) - (gq === "" ? 1 : 0);
            if (d) return d;
            return gp < gq ? -1 : 1;
          }
          return p.b - q.b || p.i - q.i;
        });
        lay.cells[r] = keyed.map(k => k.n);
        reindex();
      }
    }
  }

  /* Across-rank placement: lay each rank out end to end, then a few passes pulling
     every node towards the middle of what it is joined to, never closer to its
     neighbour than the gap allows. */
  function place(lay, nb, dir) {
    /* "Across" is sideways in a top-down chart and up-down in a left-right one, so
       which of a box's two sizes matters depends on the direction. */
    const horiz = dir === "LR" || dir === "RL";
    const aSize = n => (n.virtual ? 1 : horiz ? n.h : n.w);
    const lSize = n => (n.virtual ? 0 : horiz ? n.w : n.h);
    const gapOf = n => (n.virtual ? 12 : GAP_ACROSS);
    lay.aSize = aSize;

    lay.cells.forEach(cell => {
      let x = 0;
      cell.forEach(n => { n.a = x + aSize(n) / 2; x += aSize(n) + gapOf(n); });
    });

    const mid = (n, side) => {
      const list = side.get(n);
      if (!list.length) return null;
      let s = 0;
      for (let i = 0; i < list.length; i++) s += list[i].a;
      return s / list.length;
    };

    for (let pass = 0; pass < 8; pass++) {
      const down = pass % 2 === 0;
      const from = down ? 1 : lay.cells.length - 2;
      const step = down ? 1 : -1;
      for (let r = from; down ? r < lay.cells.length : r >= 0; r += step) {
        const side = down ? nb.up : nb.down;
        const cell = lay.cells[r];
        if (!cell.length) continue;
        const want = cell.map(n => { const m = mid(n, side); return m === null ? n.a : m; });

        /* in order, never closer than the gap allows */
        for (let i = 0; i < cell.length; i++) {
          const n = cell[i];
          const lo = i
            ? cell[i - 1].a + aSize(cell[i - 1]) / 2 +
              Math.max(gapOf(n), gapOf(cell[i - 1])) + aSize(n) / 2
            : -1e9;
          n.a = Math.max(lo, want[i]);
        }
        /* that pass can only ever push right, so take the drift back out in one
           piece - moving the whole rank keeps every gap it just established */
        let drift = 0;
        for (let i = 0; i < cell.length; i++) drift += want[i] - cell[i].a;
        drift /= cell.length;
        for (let i = 0; i < cell.length; i++) cell[i].a += drift;
      }
    }

    /* ranks stack along the other axis, each as deep as its deepest box */
    let along = 0;
    lay.cells.forEach(cell => {
      let size = 0;
      cell.forEach(n => { size = Math.max(size, lSize(n)); });
      cell.forEach(n => { n.l = along + size / 2; });
      along += size + GAP_ALONG;
    });
    lay.along = Math.max(0, along - GAP_ALONG);

    let min = 1e9, max = -1e9;
    lay.all.forEach(n => {
      min = Math.min(min, n.a - aSize(n) / 2);
      max = Math.max(max, n.a + aSize(n) / 2);
    });
    lay.all.forEach(n => { n.a -= min; });
    lay.across = max - min;
  }

  /* Only here does the layout learn which way is down. */
  function toXY(lay, dir) {
    const A = lay.across, L = lay.along;
    lay.all.forEach(n => {
      const across = n.a, along = n.l;
      let cx, cy;
      if (dir === "TB") { cx = across; cy = along; }
      else if (dir === "BT") { cx = across; cy = L - along; }
      else if (dir === "LR") { cx = along; cy = across; }
      else { cx = L - along; cy = across; }           /* RL */
      n.cx = cx + PAD; n.cy = cy + PAD;
      n.x = n.cx - n.w / 2; n.y = n.cy - n.h / 2;
    });
    const horiz = dir === "LR" || dir === "RL";
    lay.width = (horiz ? L : A) + PAD * 2;
    lay.height = (horiz ? A : L) + PAD * 2;
  }

  /* ---------------------------------------------------------------- drawing */

  function shapePath(n) {
    const x = n.x, y = n.y, w = n.w, h = n.h, r = 6;
    const P = (pts) => '<polygon points="' + pts + '"/>';
    switch (n.shape) {
      case "round":
        return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="12"/>';
      case "stadium":
        return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="' + (h / 2) + '"/>';
      case "circle":
        return '<ellipse cx="' + n.cx + '" cy="' + n.cy + '" rx="' + (w / 2) + '" ry="' + (h / 2) + '"/>';
      case "rhombus":
        return P([n.cx + "," + y, (x + w) + "," + n.cy, n.cx + "," + (y + h), x + "," + n.cy].join(" "));
      case "hexagon":
        return P([(x + 14) + "," + y, (x + w - 14) + "," + y, (x + w) + "," + n.cy,
                  (x + w - 14) + "," + (y + h), (x + 14) + "," + (y + h), x + "," + n.cy].join(" "));
      case "leanr":
        return P([(x + 16) + "," + y, (x + w) + "," + y, (x + w - 16) + "," + (y + h), x + "," + (y + h)].join(" "));
      case "leanl":
        return P([x + "," + y, (x + w - 16) + "," + y, (x + w) + "," + (y + h), (x + 16) + "," + (y + h)].join(" "));
      case "trapa":
        return P([(x + 16) + "," + y, (x + w - 16) + "," + y, (x + w) + "," + (y + h), x + "," + (y + h)].join(" "));
      case "trapb":
        return P([x + "," + y, (x + w) + "," + y, (x + w - 16) + "," + (y + h), (x + 16) + "," + (y + h)].join(" "));
      case "odd":
        return P([x + "," + y, (x + w - 12) + "," + y, (x + w) + "," + n.cy,
                  (x + w - 12) + "," + (y + h), x + "," + (y + h)].join(" "));
      case "cylinder": {
        const ry = 8;
        return '<path d="M' + x + ' ' + (y + ry) + 'a' + (w / 2) + ' ' + ry + ' 0 0 1 ' + w + ' 0' +
               'v' + (h - ry * 2) + 'a' + (w / 2) + ' ' + ry + ' 0 0 1 ' + (-w) + ' 0Z"/>' +
               '<path class="mmd-line-only" d="M' + x + ' ' + (y + ry) +
               'a' + (w / 2) + ' ' + ry + ' 0 0 0 ' + w + ' 0"/>';
      }
      case "subroutine":
        return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="' + r + '"/>' +
               '<path class="mmd-line-only" d="M' + (x + 8) + ' ' + y + 'v' + h +
               'M' + (x + w - 8) + ' ' + y + 'v' + h + '"/>';
      default:
        return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="' + r + '"/>';
    }
  }

  function styleOf(g, n) {
    let s = {};
    for (let i = 0; i < n.cls.length; i++) {
      const c = g.classes.get(n.cls[i]);
      if (c) s = Object.assign(s, c);
    }
    if (n.style) s = Object.assign(s, n.style);
    let out = "";
    if (s.fill) out += "fill:" + s.fill + ";";
    if (s.stroke) out += "stroke:" + s.stroke + ";";
    if (s["stroke-width"]) out += "stroke-width:" + s["stroke-width"] + ";";
    if (s["stroke-dasharray"]) out += "stroke-dasharray:" + s["stroke-dasharray"] + ";";
    return { box: out, text: s.color ? "fill:" + s.color + ";" : "" };
  }

  /* Where an edge leaves or meets a box: the side that faces the next rank, so the
     arrows all run with the flow instead of at the nearest corner. */
  function port(n, dir, out) {
    const h = dir === "LR" || dir === "RL";
    const fwd = dir === "TB" || dir === "LR";
    const s = out === fwd ? 1 : -1;
    return h ? { x: n.cx + s * n.w / 2, y: n.cy } : { x: n.cx, y: n.cy + s * n.h / 2 };
  }

  /* `fan` bows the curve sideways. Two links between the same pair of boxes would
     otherwise be drawn one exactly on top of the other, which reads as one link and
     loses a label - the "yes" and "no" going back to the same box, typically. */
  function edgePath(pts, dir, fan) {
    const h = dir === "LR" || dir === "RL";
    const ox = h ? 0 : (fan || 0), oy = h ? (fan || 0) : 0;
    if (pts.length === 2) {
      const a = pts[0], b = pts[1];
      const d = h ? (b.x - a.x) * 0.5 : (b.y - a.y) * 0.5;
      const c1 = h ? { x: a.x + d, y: a.y + oy } : { x: a.x + ox, y: a.y + d };
      const c2 = h ? { x: b.x - d, y: b.y + oy } : { x: b.x + ox, y: b.y - d };
      return "M" + a.x + " " + a.y + "C" + c1.x + " " + c1.y + " " + c2.x + " " + c2.y +
             " " + b.x + " " + b.y;
    }
    /* a smooth run through the stops the edge was given */
    const at = i => (i === 0 || i === pts.length - 1)
      ? pts[i] : { x: pts[i].x + ox, y: pts[i].y + oy };
    let d = "M" + pts[0].x + " " + pts[0].y;
    for (let i = 1; i < pts.length - 1; i++) {
      const p = at(i), q = at(i + 1);
      d += "Q" + p.x + " " + p.y + " " + ((p.x + q.x) / 2) + " " + ((p.y + q.y) / 2);
    }
    const last = pts[pts.length - 1];
    d += "T" + last.x + " " + last.y;
    return d;
  }

  let uid = 0;

  function draw(g, lay) {
    const dir = g.dir;
    const id = "m" + (++uid);
    let out = "";

    /* A subgraph box reaches past the boxes it holds, and a self-loop past the one
       it belongs to, so the picture can end up bigger than the layout was. Both
       report what they cover and the frame is stretched to fit at the end. */
    let bx0 = 0, by0 = 0, bx1 = lay.width, by1 = lay.height;
    const cover = (x0, y0, x1, y1) => {
      bx0 = Math.min(bx0, x0); by0 = Math.min(by0, y0);
      bx1 = Math.max(bx1, x1); by1 = Math.max(by1, y1);
    };

    /* subgraph boxes go down first, so everything else sits on top of them */
    g.groups.forEach(grp => {
      const mem = grp.members.map(i => g.nodes.get(i)).filter(n => n && !n.virtual);
      if (!mem.length) return;
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      mem.forEach(n => {
        x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y);
        x1 = Math.max(x1, n.x + n.w); y1 = Math.max(y1, n.y + n.h);
      });
      x0 -= 14; y0 -= 28; x1 += 14; y1 += 14;
      x1 = Math.max(x1, x0 + 24 + Math.ceil(measure(grp.title, LFONT)));
      cover(x0, y0, x1, y1);
      out += '<g class="mmd-sg"><rect x="' + x0 + '" y="' + y0 + '" width="' + (x1 - x0) +
             '" height="' + (y1 - y0) + '" rx="8"/>' +
             '<text x="' + (x0 + 12) + '" y="' + (y0 + 18) + '">' + esc(grp.title) + "</text></g>";
    });

    /* links sharing a pair of boxes are spread out around where one would run */
    const pairs = new Map();
    lay.routes.forEach(r => {
      if (r.a === r.b) return;
      const k = r.a.id < r.b.id ? r.a.id + "\u0000" + r.b.id : r.b.id + "\u0000" + r.a.id;
      if (!pairs.has(k)) pairs.set(k, []);
      pairs.get(k).push(r);
    });
    pairs.forEach(list => list.forEach((r, i) => {
      r.fan = list.length > 1 ? (i - (list.length - 1) / 2) * 22 : 0;
    }));

    lay.routes.forEach(r => {
      const e = r.edge;
      const a = g.nodes.get(e.from), b = g.nodes.get(e.to);
      const cls = "mmd-edge mmd-" + e.style;
      const marker = e.head === "x" ? "x" : e.head === "o" ? "o" : e.head ? "a" : "";
      const arrow = (marker ? ' marker-end="url(#' + id + marker + ')"' : "") +
                    (e.both ? ' marker-start="url(#' + id + 'b)"' : "");
      let pts;

      if (a === b) {
        /* a node pointing at itself: a small loop off its top right corner */
        const x0 = a.x + a.w, y0 = a.cy - 8, x1 = a.cx + 10, y1 = a.y;
        out += '<path class="' + cls + '" d="M' + x0 + " " + y0 +
               "C" + (x0 + 40) + " " + y0 + " " + (x1 + 34) + " " + (y1 - 34) + " " +
               x1 + " " + y1 + '"' + arrow + "/>";
        cover(x1, y1 - 30, x0 + 36, y0);
        pts = [{ x: a.x + a.w + 24, y: a.y - 12 }];
      } else {
        pts = [port(a, dir, !r.flip)];
        const via = r.flip ? r.via.slice().reverse() : r.via;
        via.forEach(v => pts.push({ x: v.cx, y: v.cy }));
        pts.push(port(b, dir, r.flip));
        out += '<path class="' + cls + '" d="' + edgePath(pts, dir, r.fan) + '"' + arrow + "/>";
        if (r.fan) {
          const f = Math.abs(r.fan);
          pts.forEach(q => cover(q.x - f, q.y - f, q.x + f, q.y + f));
        }
      }

      if (e.label) {
        const h = dir === "LR" || dir === "RL";
        /* three quarters of the bow, which is about where the curve actually is */
        const off = (r.fan || 0) * 0.75;
        const mp = pts.length === 1 ? pts[0] : pts.length === 2
          ? { x: (pts[0].x + pts[1].x) / 2 + (h ? 0 : off),
              y: (pts[0].y + pts[1].y) / 2 + (h ? off : 0) }
          : { x: pts[Math.floor(pts.length / 2)].x + (h ? 0 : off),
              y: pts[Math.floor(pts.length / 2)].y + (h ? off : 0) };
        const w = Math.ceil(measure(e.label, LFONT)) + 10;
        cover(mp.x - w / 2, mp.y - 9, mp.x + w / 2, mp.y + 9);
        out += '<g class="mmd-elabel"><rect x="' + (mp.x - w / 2) + '" y="' + (mp.y - 9) +
               '" width="' + w + '" height="18" rx="4"/>' +
               '<text x="' + mp.x + '" y="' + (mp.y + 4) + '">' + esc(e.label) + "</text></g>";
      }
    });

    g.order.forEach(nid => {
      const n = g.nodes.get(nid);
      const s = styleOf(g, n);
      out += '<g class="mmd-node"' + (s.box ? ' style="' + esc(s.box) + '"' : "") + ">" +
             shapePath(n);
      const top = n.cy - ((n.lines.length - 1) * LH) / 2 + 4.5;
      n.lines.forEach((t, i) => {
        out += '<text x="' + n.cx + '" y="' + (top + i * LH) + '"' +
               (s.text ? ' style="' + esc(s.text) + '"' : "") + ">" + esc(t) + "</text>";
      });
      out += "</g>";
    });

    const head = (mid, body) =>
      '<marker id="' + id + mid + '" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" ' +
      'markerHeight="7" orient="auto-start-reverse">' + body + "</marker>";
    /* the heads are styled by class, so they follow the theme like the lines do */
    const defs = "<defs>" +
      head("a", '<path class="mmd-mk" d="M0 0 L10 5 L0 10 z"/>') +
      head("b", '<path class="mmd-mk" d="M0 0 L10 5 L0 10 z"/>') +
      head("x", '<path class="mmd-mk-o" d="M1 1 L9 9 M9 1 L1 9"/>') +
      head("o", '<circle class="mmd-mk-o" cx="5" cy="5" r="4"/>') +
      "</defs>";

    const dx = Math.max(0, -bx0), dy = Math.max(0, -by0);
    const w = Math.ceil(bx1 + dx), h = Math.ceil(by1 + dy);
    const body = dx || dy
      ? '<g transform="translate(' + dx + " " + dy + ')">' + out + "</g>" : out;
    return '<svg class="mmd-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' +
      w + " " + h + '" width="' + w + '" height="' + h + '" role="img">' +
      defs + body + "</svg>";
  }

  /* ---------------------------------------------------------------- entry */

  /* The preview is rebuilt on every keystroke, and a diagram costs far more than a
     paragraph, so the last few are kept as they were drawn. */
  const cache = new Map();
  const CACHE_MAX = 40;

  function render(src) {
    const key = String(src);
    if (cache.has(key)) return cache.get(key);
    let res;
    try { res = build_(key); }
    catch (e) { res = { error: tr("this diagram could not be drawn") + " (" + (e.message || e) + ")" }; }
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(key, res);
    return res;
  }

  function build_(src) {
    const p = parse(src);
    if (p.error) return { error: p.error };
    const g = p.graph;
    const back = backEdges(g);
    const rank = rankNodes(g, back);
    const lay = build(g, rank, back);
    const nb = neighbours(lay);
    order(lay, nb);
    place(lay, nb, g.dir);
    toXY(lay, g.dir);
    return { svg: draw(g, lay) };
  }

  return { render: render, handles: l => /^(mermaid|mmd)$/i.test(String(l || "")) };
})();

