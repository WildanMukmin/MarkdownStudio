"use strict";
/* =========================================================
   1. Syntax highlighter
   ========================================================= */
const HL = (function () {
  const E = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  const esc = s => String(s).replace(/[&<>"']/g, c => E[c]);
  const re = (src, flags) => new RegExp(src, "y" + (flags || ""));

  function generic(o) {
    const r = [["plain", /[ \t\n]+/y]];
    if (o.triple) r.push(["str", /"""[\s\S]*?"""|'''[\s\S]*?'''/y]);
    if (o.line) r.push(["com", re(o.line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[^\\n]*")]);
    if (o.block !== false) r.push(["com", /\/\*[\s\S]*?\*\//y]);
    r.push(["str", /"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`/y]);
    r.push(["num", /\b(?:0[xXbBoO][0-9a-fA-F_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?)[a-zA-Z_]*\b/y]);
    if (o.kw) r.push(["kw", re("\\b(?:" + o.kw.join("|") + ")\\b", o.ci ? "i" : "")]);
    if (o.type) r.push(["var", re("\\b(?:" + o.type.join("|") + ")\\b")]);
    if (o.sigil) r.push(["var", re(o.sigil)]);
    r.push(["fn", /[A-Za-z_$][\w$]*(?=\s*\()/y]);
    r.push(["var", /\b[A-Z][A-Za-z0-9_]*\b/y]);
    r.push(["op", /[+\-*/%=<>!&|^~?:@]+/y]);
    r.push(["punct", /[{}()\[\];,.]/y]);
    r.push(["plain", /[A-Za-z_$][\w$]*/y]);
    return r;
  }

  const JS_KW = "const let var function return if else for while do switch case default break continue new class extends super this typeof instanceof in of null undefined true false async await try catch finally throw yield import export from delete void static get set interface type enum implements public private protected readonly as namespace declare abstract require module".split(" ");
  const PY_KW = "def class return if elif else for while break continue pass import from as try except finally raise with lambda yield global nonlocal assert del in is not and or None True False async await match case self".split(" ");
  const C_KW = "auto break case char const continue default do double else enum extern float for goto if inline int long register return short signed sizeof static struct switch typedef union unsigned void volatile while bool true false nullptr namespace using class public private protected virtual template typename new delete this try catch throw operator friend explicit constexpr static_cast dynamic_cast const_cast reinterpret_cast include define ifndef endif pragma".split(" ");
  const JAVA_KW = "abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while var record sealed true false null".split(" ");
  const CS_KW = "abstract as base bool break byte case catch char checked class const continue decimal default delegate do double else enum event explicit extern false finally fixed float for foreach goto if implicit in int interface internal is lock long namespace new null object operator out override params private protected public readonly ref return sbyte sealed short sizeof stackalloc static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using var virtual void volatile while async await record nameof".split(" ");
  const GO_KW = "break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var nil true false make new len cap append copy delete panic recover string int int64 float64 bool byte rune error".split(" ");
  const RS_KW = "as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while box macro_rules println vec Some None Ok Err String Vec Option Result".split(" ");
  const PHP_KW = "abstract and array as break callable case catch class clone const continue declare default do echo else elseif empty enddeclare endfor endforeach endif endswitch endwhile enum extends final finally fn for foreach function global goto if implements include include_once instanceof insteadof interface isset list match namespace new or print private protected public readonly require require_once return static switch throw trait try unset use var while xor yield true false null".split(" ");
  const RB_KW = "alias and begin break case class def defined do else elsif end ensure false for if in module next nil not or redo rescue retry return self super then true undef unless until when while yield attr_accessor attr_reader require puts lambda proc".split(" ");
  const SQL_KW = "select from where insert into values update set delete create table alter drop index view join inner left right full outer on group by order having limit offset union all distinct as and or not null is in between like exists case when then else end asc desc count sum avg min max primary key foreign references default constraint unique check cascade begin commit rollback transaction with returning interval now current_timestamp coalesce cast".split(" ");
  const SH_KW = "if then else elif fi for while until do done case esac function return break continue in select time local export readonly declare unset shift source echo printf cd ls rm mkdir cp mv cat grep sed awk find sudo chmod chown curl wget git npm node python pip docker exit set trap".split(" ");
  const SWIFT_KW = "associatedtype class deinit enum extension fileprivate func import init inout internal let open operator private protocol public rethrows static struct subscript typealias var break case continue default defer do else fallthrough for guard if in repeat return switch where while as catch is nil super self throw throws try true false async await some any".split(" ");

  const LANGS = {
    javascript: generic({ line: "//", kw: JS_KW }),
    python: generic({ line: "#", block: false, triple: true, kw: PY_KW, sigil: "@[A-Za-z_][\\w.]*" }),
    c: generic({ line: "//", kw: C_KW, sigil: "#[a-z]+" }),
    java: generic({ line: "//", kw: JAVA_KW, sigil: "@[A-Za-z_]\\w*" }),
    csharp: generic({ line: "//", kw: CS_KW }),
    go: generic({ line: "//", kw: GO_KW }),
    rust: generic({ line: "//", kw: RS_KW, sigil: "#!?\\[[^\\]]*\\]|'[a-z_]+\\b" }),
    php: generic({ line: "//", kw: PHP_KW, sigil: "\\$[A-Za-z_]\\w*" }),
    ruby: generic({ line: "#", block: false, kw: RB_KW, sigil: "[@$:][A-Za-z_]\\w*" }),
    swift: generic({ line: "//", kw: SWIFT_KW }),
    sql: generic({ line: "--", kw: SQL_KW, ci: true }),
    shell: generic({ line: "#", block: false, kw: SH_KW, sigil: "\\$\\{?[A-Za-z_][\\w]*\\}?|\\$[@*#?$!0-9-]|--?[A-Za-z][\\w-]*" }),
    json: [
      ["plain", /[ \t\n]+/y],
      ["attr", /"(?:\\[\s\S]|[^"\\])*"(?=\s*:)/y],
      ["str", /"(?:\\[\s\S]|[^"\\])*"/y],
      ["num", /-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/y],
      ["kw", /\b(?:true|false|null)\b/y],
      ["punct", /[{}\[\],:]/y]
    ],
    yaml: [
      ["plain", /[ \t\n]+/y],
      ["com", /#[^\n]*/y],
      ["attr", /^[ \t]*-?[ \t]*[A-Za-z_][\w.\- ]*(?=\s*:)/my],
      ["str", /"(?:\\[\s\S]|[^"\\])*"|'(?:[^']|'')*'/y],
      ["num", /\b-?\d+(?:\.\d+)?\b/y],
      ["kw", /\b(?:true|false|null|yes|no|on|off)\b/y],
      ["op", /[-:>|&*]/y]
    ],
    html: [
      ["plain", /[ \t\n]+/y],
      ["com", /<!--[\s\S]*?-->|<!DOCTYPE[^>]*>/iy],
      ["str", /"(?:[^"]*)"|'(?:[^']*)'/y],
      ["tag", /<\/?[A-Za-z][\w:-]*|\/?>/y],
      ["attr", /\b[A-Za-z_:@#-][\w:.-]*(?==)/y],
      ["op", /=/y]
    ],
    css: [
      ["plain", /[ \t\n]+/y],
      ["com", /\/\*[\s\S]*?\*\//y],
      ["str", /"(?:[^"]*)"|'(?:[^']*)'/y],
      ["kw", /@[a-zA-Z-]+|![a-z]+/y],
      ["attr", /--[\w-]+|(?:[a-zA-Z-]+)(?=\s*:)/y],
      ["num", /#[0-9a-fA-F]{3,8}\b|\b-?\d*\.?\d+(?:px|em|rem|%|vh|vw|s|ms|deg|fr|ch|pt|vmin|vmax)?\b/y],
      ["fn", /[a-zA-Z-]+(?=\()/y],
      ["tag", /\.[-\w]+|#[-\w]+|::?[-\w]+/y],
      ["punct", /[{}();,:]/y]
    ],
    diff: [
      ["ins", /^\+[^\n]*/my],
      ["del", /^-[^\n]*/my],
      ["com", /^@@[^\n]*|^diff [^\n]*|^index [^\n]*/my],
      ["plain", /[^\n]*\n?/y]
    ],
    markdown: [
      ["kw", /^#{1,6} [^\n]*/my],
      ["com", /^>[^\n]*/my],
      ["str", /`[^`\n]*`|```[\s\S]*?```/y],
      ["fn", /\*\*[^*\n]+\*\*|__[^_\n]+__/y],
      ["var", /\[[^\]\n]*\]\([^)\n]*\)/y],
      ["num", /^[ \t]*(?:[-*+]|\d+\.) /my],
      ["plain", /[\s\S]/y]
    ],
    ini: [
      ["plain", /[ \t\n]+/y],
      ["com", /[#;][^\n]*/y],
      ["tag", /^\[[^\]\n]*\]/my],
      ["attr", /^[ \t]*[\w.-]+(?=\s*=)/my],
      ["str", /"(?:[^"]*)"|'(?:[^']*)'/y],
      ["num", /\b-?\d+(?:\.\d+)?\b/y],
      ["op", /=/y]
    ]
  };

  const ALIAS = {
    js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript", node: "javascript",
    ts: "javascript", tsx: "javascript", typescript: "javascript",
    py: "python", python3: "python",
    "c++": "c", cpp: "c", cc: "c", h: "c", hpp: "c", objc: "c", arduino: "c",
    cs: "csharp", "c#": "csharp", dotnet: "csharp",
    golang: "go", rs: "rust", rb: "ruby", kt: "java", kotlin: "java", scala: "java", groovy: "java", dart: "java",
    postgres: "sql", postgresql: "sql", mysql: "sql", sqlite: "sql", plsql: "sql",
    sh: "shell", bash: "shell", zsh: "shell", console: "shell", terminal: "shell",
    shellsession: "shell", ps: "shell", powershell: "shell", bat: "shell", cmd: "shell", fish: "shell",
    xml: "html", svg: "html", vue: "html", htm: "html", jsp: "html", erb: "html", handlebars: "html", twig: "html", blade: "html",
    scss: "css", sass: "css", less: "css", stylus: "css",
    yml: "yaml", toml: "ini", conf: "ini", cfg: "ini", properties: "ini", editorconfig: "ini",
    patch: "diff", md: "markdown", mdown: "markdown"
  };

  function resolve(lang) {
    if (!lang) return null;
    const k = String(lang).toLowerCase().trim();
    return LANGS[k] || LANGS[ALIAS[k]] || null;
  }

  function highlight(code, lang) {
    const rules = resolve(lang);
    if (!rules) return esc(code);
    let out = "", p = 0;
    const n = code.length;
    while (p < n) {
      let matched = false;
      for (let i = 0; i < rules.length; i++) {
        const rx = rules[i][1];
        rx.lastIndex = p;
        const m = rx.exec(code);
        if (m && m.index === p && m[0].length) {
          const t = rules[i][0];
          out += t === "plain" ? esc(m[0]) : '<span class="t-' + t + '">' + esc(m[0]) + "</span>";
          p += m[0].length;
          matched = true;
          break;
        }
      }
      if (!matched) { out += esc(code[p]); p++; }
    }
    return out;
  }

  return { highlight: highlight, known: l => !!resolve(l) };
})();

