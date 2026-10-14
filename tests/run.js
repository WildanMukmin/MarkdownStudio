// node tests/run.js  - the Markdown parser, the sanitiser, the diagram engine and the
// highlighter, which are the parts that handle other people's text.
const { MD, MMD, HL } = require("./load.js");
let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); pass++; }
  catch (e) { fail++; console.log("FAIL  " + name + "\n      " + e.message); }
};
const eq = (a, b, m) => { if (a !== b) throw new Error((m || "") + " expected " + JSON.stringify(b) + " got " + JSON.stringify(a)); };
const has = (s, sub) => { if (!s.includes(sub)) throw new Error("missing " + JSON.stringify(sub) + " in " + s); };
const lacks = (s, sub) => { if (s.includes(sub)) throw new Error("should not contain " + JSON.stringify(sub) + " in " + s); };
const md = s => MD.render(s).html;

/* what a script could ever run through: an element that is live, or an event attribute
   or script URL on one. Escaped text (&lt;script&gt;) is inert and is fine. */
function assertInert(html, allowSvg) {
  /* escaped text and the insides of quoted attribute values cannot start anything */
  const live = html.replace(/&lt;[^]*?&gt;/g, "").replace(/=\s*"[^"]*"/g, '=""').replace(/=\s*'[^']*'/g, "=''");
  const bad = allowSvg ? "script|iframe|object|embed|style|link|meta|base|form|math|foreignObject|animate|set"
                       : "script|iframe|object|embed|style|link|meta|base|form|svg|math";
  if (new RegExp("<\\s*(" + bad + ")\\b", "i").test(live)) throw new Error("live dangerous element: " + html);
  if (/<[^>]+\son[a-z]+\s*=/i.test(live)) throw new Error("live event handler: " + html);
  if (/(href|src|action|formaction|xlink:href)\s*=\s*["']?\s*(javascript|vbscript|data:text\/html)/i.test(html.replace(/&lt;[^]*?&gt;/g, ""))) throw new Error("script url: " + html);
}

/* ---- basics ---- */
t("heading and inline", () => {
  const h = md("# Hi\n\ntext **b** *i* `c`");
  has(h, "<h1"); has(h, "<strong>b</strong>"); has(h, "<em>i</em>"); has(h, "<code>c</code>");
});
t("table", () => has(md("| a | b |\n|---|---|\n| 1 | 2 |"), "<th>a</th>"));
t("task list", () => { const h = md("- [x] a\n- [ ] b"); has(h, "checked"); has(h, "tasklist"); });
t("nested list", () => has(md("1. a\n2. b\n   - c"), "<ul>"));
t("footnote", () => { const h = md("a[^1]\n\n[^1]: note"); has(h, "fnref-1"); has(h, "fn-1"); });
t("reference link", () => has(md("[ref]\n\n[ref]: http://x.com 'T'"), 'href="http://x.com"'));
t("empty input", () => eq(md(""), ""));
t("crlf input", () => has(md("# A\r\n\r\ntext"), "<h1"));
t("code block keeps markup as text", () => {
  const h = md("```js\nlet a = '<b>';\n```");
  has(h, "&lt;b&gt;"); lacks(h, "<b>");
});
t("headings report themselves", () => eq(MD.render("# One\n## Two").headings.length, 2));

/* ---- sanitiser: every one of these has to come out inert ---- */
const attacks = [
  "<script>alert(1)</script>",
  "<img src=x onerror=alert(1)>",
  '<a href="javascript:alert(1)" onclick="x()">a</a>',
  "<svg onload=alert(1)>",
  "<iframe src=//evil></iframe>",
  "<style>body{display:none}</style>",
  '<div style="background:url(javascript:1)" onmouseover="x()">x</div>',
  "[x](javascript:alert(1))",
  "![x](javascript:alert(1))",
  "[x](  JaVaScRiPt:alert(1))",
  "[x](java\tscript:alert(1))",
  "[x](&#106;avascript:alert(1))",
  "[x](&#x6A;avascript:alert(1))",
  "[x](jav&#x09;ascript:alert(1))",
  "[x](vbscript:msgbox(1))",
  "[x](data:text/html,<script>alert(1)</script>)",
  "![x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)",
  '[x](http://a.com "t\\" onmouseover=\\"alert(1)")',
  '[x](<http://a.com" onmouseover="alert(1)>)',
  '![a" onerror="alert(1)](http://a.com/x.png)',
  '[a"><script>alert(1)</script>](http://a.com)',
  "<http://a.com\"onmouseover=\"alert(1)>",
  "<a href=\"&#106;avascript:alert(1)\">x</a>",
  "<a href=\" javascript:alert(1)\">x</a>",
  "<a href='java\nscript:alert(1)'>x</a>",
  "<img src=\"x\" srcset=\"javascript:alert(1)\">",
  "<form action=javascript:alert(1)><button>x</button></form>",
  "<math><mtext></form><form><mglyph><style></math><img src onerror=alert(1)>",
  "<details open ontoggle=alert(1)>x</details>",
  "<input autofocus onfocus=alert(1)>",
  "<body onload=alert(1)>",
  "<meta http-equiv=refresh content='0;url=javascript:alert(1)'>",
  "<base href=javascript:alert(1)//>",
  "# <img src=x onerror=alert(1)>",
  "| <img src=x onerror=alert(1)> |\n|---|\n| x |",
  "- <img src=x onerror=alert(1)>",
  "> <img src=x onerror=alert(1)>",
  "[^1]: <img src=x onerror=alert(1)>\n\na[^1]",
  "*<img src=x onerror=alert(1)>*",
  "`</code><img src=x onerror=alert(1)>`",
  "```<img src=x onerror=alert(1)>\ncode\n```",
  "```js\n</code></pre><img src=x onerror=alert(1)>\n```",
  "[a]: javascript:alert(1)\n\n[a]",
  "<<script>script>alert(1)<</script>/script>"
];
attacks.forEach((a, i) => t("inert #" + i + " " + a.replace(/\s+/g, " ").slice(0, 50), () => assertInert(md(a))));

/* ---- diagram: labels are text, never markup ---- */
t("diagram draws a flowchart", () => has(MMD.render("graph TD\nA-->B").svg, "<svg"));
t("diagram reports non-flowcharts", () => has(MMD.render("not a diagram").error, "flowchart"));
t("diagram label cannot inject", () => {
  const r = MMD.render('graph TD\nA["<img src=x onerror=alert(1)>"] --> B["</text><script>alert(1)</script>"]');
  assertInert(r.svg || "", true);
});
t("diagram link label cannot inject", () => {
  const r = MMD.render("graph LR\nA -->|<script>alert(1)</script>| B");
  assertInert(r.svg || "", true);
});
t("diagram style cannot inject", () => {
  const r = MMD.render('graph TD\nA-->B\nstyle A fill:red" onload="alert(1)');
  assertInert(r.svg || "", true);
});
t("diagram survives a cycle", () => has(MMD.render("graph TD\nA-->B\nB-->C\nC-->A").svg, "<svg"));
t("diagram survives a self loop", () => has(MMD.render("graph TD\nA-->A").svg, "<svg"));
t("diagram survives garbage", () => { MMD.render("graph TD\n-->-->\n[[[\n(((\n"); });

/* ---- highlighter ---- */
t("highlighter escapes", () => {
  const h = HL.highlight("<b>&\"x\"</b>", "js");
  lacks(h, "<b>"); has(h, "&amp;");
});
t("highlighter unknown language is plain escaped text", () => lacks(HL.highlight("<i>", "nonsense"), "<i>"));

/* ---- robustness: nothing may hang or throw on hostile shapes ---- */
t("deep nesting terminates", () => { md("> ".repeat(500) + "x"); md("- ".repeat(300) + "x"); });
t("unclosed constructs terminate", () => { md("**".repeat(2000)); md("[".repeat(2000)); md("`".repeat(2001)); md("<".repeat(2000)); });
t("long line terminates", () => {
  const s = Date.now(); md("a ".repeat(50000) + "*b"); md("[a](".repeat(3000));
  if (Date.now() - s > 4000) throw new Error("took " + (Date.now() - s) + "ms");
});

console.log((fail ? "FAILED " : "ok ") + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
