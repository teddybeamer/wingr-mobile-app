const assert = require("node:assert/strict");
const test = require("node:test");

async function load() {
  const module = await import("./build-blind-review-page.ts");
  return module.default ?? module;
}

const markdown = [
  "# LOCAL ONLY",
  "",
  "## F1-1",
  "- A: summary: Sum A | reply: Reply A",
  "- B: summary: Sum B | reply: Reply B <script>alert(1)</script>",
  "",
  "## F2-1",
  "- A: summary: S | reply: R | with pipe",
  "- B: summary: S2 | reply: R2",
].join("\n");

test("parses blinded pairs without a variant key", async () => {
  const { parseReview } = await load();
  const pairs = parseReview(markdown);
  assert.equal(pairs.length, 2);
  assert.equal(pairs[0].fixture, 1);
  assert.equal(pairs[1].fixture, 2);
  assert.equal(pairs[1].A.reply, "R | with pipe");
  assert.equal(JSON.stringify(pairs).toLowerCase().includes("medium"), false);
});

test("embedded data cannot break out of the script element", async () => {
  const { parseReview, renderPage, scriptSafeJson } = await load();
  assert.equal(scriptSafeJson({ a: "</script><b>&" }).includes("</script>"), false);
  const html = renderPage(parseReview(markdown), { 1: "data:image/png;base64,AAAA" });
  assert.equal((html.match(/<script>/g) ?? []).length, 1);
  assert.equal(html.includes("alert(1)</script>"), false);
  assert.match(html, /Det ville jeg sende/);
});
