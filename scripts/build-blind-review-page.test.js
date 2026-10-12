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

test("parses the current format with vibe energy and risk, and still the legacy one", async () => {
  const { parseReview, renderPage } = await load();
  const current = [
    "## F3-1",
    "- A: summary: You both seem keen. | energy: Warm and easy | risk: Don't rush it | reply: Ha, noted",
    "- B: summary: They like you. | energy: Light | risk: Low | reply: Sure | really",
  ].join("\n");
  const [pair] = parseReview(current);
  assert.equal(pair.A.energy, "Warm and easy");
  assert.equal(pair.A.risk, "Don't rush it");
  assert.equal(pair.B.reply, "Sure | really");
  assert.equal(parseReview("## F1-1\n- A: summary: S | reply: R\n- B: summary: S2 | reply: R2")[0].A.energy, undefined);
  const html = renderPage([pair], {}, "page-1");
  assert.match(html, /Taler direkte til mig/);
  assert.match(html, /Bruger ME\/THEM eller lyder som en rapport/);
  assert.match(html, /wingr-blind-review-" \+ "page-1"/);
  assert.equal(html.toLowerCase().includes("medium"), false);
});

test("the review page labels vibe fields like the app (English), not in Danish", async () => {
  const { renderPage } = await load();
  const html = renderPage([{ A: { reply: "r", summary: "s", energy: "e", risk: "k" }, B: { reply: "r", summary: "s" }, fixture: 1, id: "F1-1" }], {}, "p");
  assert.match(html, /Conversation energy/);
  assert.match(html, /"Risk"/);
  assert.doesNotMatch(html, /"Energi"|"Risiko"/);
});
