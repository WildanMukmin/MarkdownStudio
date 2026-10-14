// Loads the pure modules from src/js into one scope, the way the page does, so they
// can be tested without a browser. Order matters: i18n defines tr, which markdown uses.
const fs = require("fs"), path = require("path");
const dir = path.join(__dirname, "..", "src", "js");
const code = ["highlight.js", "i18n.js", "diagram.js", "markdown.js"]
  .map(f => fs.readFileSync(path.join(dir, f), "utf8")).join("\n");
module.exports = new Function(code + "\n;return { HL, I18N, MMD, MD };")();
