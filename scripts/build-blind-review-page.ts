#!/usr/bin/env node

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Builds ONE self-contained, local-only HTML page from a blinded review file
// (reasoning-effort-review-*.local.md) so a person can compare A/B replies next
// to the original screenshot and score them. The page contains no variant key.
// It makes no network request, and the output stays in the ignored results
// directory: it embeds consented screenshots and model output. Never share it.

const ROOT = resolve(process.cwd());
const RESULTS = join(ROOT, "benchmarks/results");
const SCREENSHOTS = join(ROOT, "benchmarks/screenshots");

export type ReviewOutput = {
  energy?: string;
  reply: string;
  risk?: string;
  summary: string;
};
export type ReviewPair = {
  A: ReviewOutput;
  B: ReviewOutput;
  fixture: number;
  id: string;
};

/** Parses the blinded review markdown written by benchmark-reasoning-effort. */
export function parseReview(markdown: string): ReviewPair[] {
  const pairs: ReviewPair[] = [];
  let current: Partial<ReviewPair> | null = null;
  for (const line of markdown.split(/\r?\n/)) {
    const heading = /^## (F(\d+)-\d+)$/.exec(line);
    if (heading) {
      current = { fixture: Number(heading[2]), id: heading[1] };
      continue;
    }
    // Current format: summary | energy | risk | reply. Older reviews: summary | reply.
    const full = /^- ([AB]): summary: (.*?) \| energy: (.*?) \| risk: (.*?) \| reply: (.*)$/.exec(line);
    const legacy = /^- ([AB]): summary: (.*?) \| reply: (.*)$/.exec(line);
    const output = full ?? legacy;
    if (output && current) {
      (current as Record<string, unknown>)[output[1]] = full
        ? { energy: full[3], reply: full[5], risk: full[4], summary: full[2] }
        : { reply: legacy![3], summary: legacy![2] };
      if (current.A && current.B) {
        pairs.push(current as ReviewPair);
        current = null;
      }
    }
  }
  return pairs;
}

/** JSON that is safe to embed inside a <script> element. */
export function scriptSafeJson(value: unknown) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(new RegExp("\\u2028", "g"), "\\u2028")
    .replace(new RegExp("\\u2029", "g"), "\\u2029");
}

export function renderPage(pairs: ReviewPair[], images: Record<number, string>, pageId = "default") {
  return `<!doctype html>
<html lang="da">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>WiNGR blindet review</title>
<style>
:root{--bg:#f6f6f8;--card:#fff;--text:#16161a;--muted:#6b6b76;--line:#dcdce3;--accent:#6a2a5f;--ok:#1a7f4b}
@media (prefers-color-scheme:dark){:root{--bg:#121216;--card:#1c1c22;--text:#ececf1;--muted:#9a9aa6;--line:#2e2e38;--accent:#c58ab9;--ok:#4cc38a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 -apple-system,system-ui,sans-serif}
main{max-width:1000px;margin:0 auto;padding:16px}
h1{font-size:1.4rem;margin:8px 0}.muted{color:var(--muted)}
.bar{position:sticky;top:0;background:var(--bg);padding:8px 0;border-bottom:1px solid var(--line);display:flex;gap:12px;align-items:center;justify-content:space-between;z-index:2}
button{font:inherit;border:1px solid var(--line);background:var(--card);color:var(--text);border-radius:8px;padding:6px 12px;cursor:pointer}
button.primary{background:var(--accent);color:#fff;border-color:var(--accent)}
.pair{background:var(--card);border:1px solid var(--line);border-radius:14px;margin:16px 0;padding:16px}
.grid{display:grid;grid-template-columns:200px 1fr 1fr;gap:16px}
@media (max-width:760px){.grid{grid-template-columns:1fr}}
.shot img{width:100%;border-radius:10px;border:1px solid var(--line);cursor:zoom-in}
.out{border:1px solid var(--line);border-radius:12px;padding:12px}
.out h3{margin:0 0 6px;font-size:1rem}.reply{font-size:1.05rem;margin:6px 0 10px}
.row{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:4px 0}.row label{min-width:92px;color:var(--muted);font-size:.9rem}
.stars button{padding:2px 9px}.stars button.on{background:var(--accent);color:#fff;border-color:var(--accent)}
.flags label{min-width:0;color:var(--text)}details{margin-top:6px;color:var(--muted);font-size:.9rem}
.vibe{margin-top:10px;padding-top:8px;border-top:1px dashed var(--line)}.vline{margin:4px 0;font-size:.95rem}
.pick{margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center}.pick button.on{background:var(--ok);color:#fff;border-color:var(--ok)}
dialog{border:0;padding:0;background:transparent;max-width:95vw}dialog img{max-height:92vh;max-width:95vw;border-radius:8px}
</style>
</head>
<body>
<main>
<h1>Blindet sammenligning</h1>
<p class="muted">Du ved ikke, hvilken model der skrev A eller B. Kig på skærmbilledet, og vælg, hvilket svar du ville sende. Vurder både svaret og vibe checket (er det personligt, og taler det direkte til dig?). Dine valg gemmes i browseren, og du eksporterer dem øverst.</p>
<div class="bar"><span id="progress" class="muted"></span><button class="primary" id="export">Eksportér scores (JSON)</button></div>
<div id="pairs"></div>
<dialog id="zoom"><img id="zoomImg" alt=""></dialog>
</main>
<script>
const PAIRS = ${scriptSafeJson(pairs)};
const IMAGES = ${scriptSafeJson(images)};
const KEY = "wingr-blind-review-" + ${scriptSafeJson(pageId)};
let state = {};
try { state = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (e) { state = {}; }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} progress(); };
const get = (id, label) => ((state[id] = state[id] || {})[label] = state[id][label] || {});
function stars(id, label, name, text){
  const row = document.createElement("div"); row.className = "row stars";
  const l = document.createElement("label"); l.textContent = text; row.append(l);
  for (let n = 1; n <= 5; n++) {
    const b = document.createElement("button"); b.textContent = n; b.type = "button";
    const sync = () => b.classList.toggle("on", get(id, label)[name] === n);
    b.onclick = () => { get(id, label)[name] = n; save(); row.querySelectorAll("button").forEach(x => x.dispatchEvent(new Event("sync"))); };
    b.addEventListener("sync", sync); sync(); row.append(b);
  }
  return row;
}
function flag(id, label, name, text){
  const wrap = document.createElement("label"); const c = document.createElement("input"); c.type = "checkbox";
  c.checked = !!get(id, label)[name]; c.onchange = () => { get(id, label)[name] = c.checked; save(); };
  wrap.append(c, " " + text); return wrap;
}
function output(pair, label){
  const box = document.createElement("div"); box.className = "out";
  const h = document.createElement("h3"); h.textContent = "Svar " + label;
  const r = document.createElement("div"); r.className = "reply"; r.textContent = pair[label].reply;
  box.append(h, r);
  box.append(stars(pair.id, label, "natural", "Naturlighed"), stars(pair.id, label, "flirt", "Flirt"), stars(pair.id, label, "hook", "Kontekst"));
  const flags = document.createElement("div"); flags.className = "row flags";
  flags.append(flag(pair.id, label, "meThemError", "Fejl i ME/THEM"), flag(pair.id, label, "invents", "Opfinder oplysninger"));
  box.append(flags);
  const vibe = document.createElement("div"); vibe.className = "vibe";
  const vt = document.createElement("strong"); vt.textContent = "Vibe check"; vibe.append(vt);
  [["summary", pair[label].summary], ["Conversation energy", pair[label].energy], ["Risk", pair[label].risk]].forEach(([name, value]) => {
    if (!value) return; const line = document.createElement("div"); line.className = "vline";
    line.textContent = (name === "summary" ? "" : name + ": ") + value; vibe.append(line);
  });
  vibe.append(stars(pair.id, label, "vibe", "Vibe check"));
  const vflags = document.createElement("div"); vflags.className = "row flags";
  vflags.append(flag(pair.id, label, "vibeDirect", "Taler direkte til mig"), flag(pair.id, label, "vibeReportTone", "Bruger ME/THEM eller lyder som en rapport"));
  vibe.append(vflags); box.append(vibe);
  return box;
}
function render(){
  const root = document.getElementById("pairs");
  PAIRS.forEach(pair => {
    const sec = document.createElement("section"); sec.className = "pair";
    const t = document.createElement("div"); t.className = "muted"; t.textContent = "Eksempel " + pair.id;
    const grid = document.createElement("div"); grid.className = "grid";
    const shot = document.createElement("div"); shot.className = "shot";
    const img = document.createElement("img"); img.alt = "Screenshot"; img.src = IMAGES[pair.fixture] || "";
    img.onclick = () => { document.getElementById("zoomImg").src = img.src; document.getElementById("zoom").showModal(); };
    shot.append(img);
    grid.append(shot, output(pair, "A"), output(pair, "B"));
    const pick = document.createElement("div"); pick.className = "pick";
    const q = document.createElement("strong"); q.textContent = "Det ville jeg sende:"; pick.append(q);
    [["A","A"],["B","B"],["tie","Lige gode"],["none","Ingen af dem"]].forEach(([v, text]) => {
      const b = document.createElement("button"); b.type = "button"; b.textContent = text;
      const sync = () => b.classList.toggle("on", (state[pair.id] || {}).preferred === v);
      b.onclick = () => { (state[pair.id] = state[pair.id] || {}).preferred = v; save(); pick.querySelectorAll("button").forEach(x => x.dispatchEvent(new Event("sync"))); };
      b.addEventListener("sync", sync); sync(); pick.append(b);
    });
    sec.append(t, grid, pick); root.append(sec);
  });
}
function progress(){
  const done = PAIRS.filter(p => (state[p.id] || {}).preferred).length;
  document.getElementById("progress").textContent = done + " af " + PAIRS.length + " eksempler har et valg";
}
document.getElementById("zoom").onclick = e => e.currentTarget.close();
document.getElementById("export").onclick = () => {
  const out = {};
  PAIRS.forEach(p => {
    const s = state[p.id] || {};
    const one = l => { const v = s[l] || {}; return { ownership: !v.meThemError, noInventedFacts: !v.invents, language: true, hook: v.hook ?? null, natural: v.natural ?? null, flirt: v.flirt ?? null, vibe: v.vibe ?? null, vibeDirect: !!v.vibeDirect, vibeReportTone: !!v.vibeReportTone }; };
    out[p.id] = { A: one("A"), B: one("B"), preferred: s.preferred === "none" ? null : (s.preferred ?? null) };
  });
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "wingr-blind-scores.local.json"; a.click();
};
render(); progress();
</script>
</body>
</html>
`;
}

function latestReview() {
  const files = readdirSync(RESULTS)
    .filter((name) => /^reasoning-effort-review-.*\.local\.md$/.test(name))
    .sort();
  if (!files.length) throw new Error("No blinded review file found in benchmarks/results.");
  return join(RESULTS, files[files.length - 1]);
}

function main() {
  const args = process.argv.slice(2);
  const source = args[0] ? resolve(args[0]) : latestReview();
  if (!existsSync(source)) throw new Error("Review file not found.");
  const pairs = parseReview(readFileSync(source, "utf8"));
  if (!pairs.length) throw new Error("No review pairs found.");
  const images: Record<number, string> = {};
  const files = readdirSync(SCREENSHOTS);
  for (const fixture of new Set(pairs.map((pair) => pair.fixture))) {
    const name = files.find((file) =>
      new RegExp(`^fixture-${String(fixture).padStart(2, "0")}\\.png$`, "i").test(file),
    );
    if (name)
      images[fixture] = `data:image/png;base64,${readFileSync(join(SCREENSHOTS, name)).toString("base64")}`;
  }
  mkdirSync(RESULTS, { recursive: true });
  const pageId = new Date().toISOString().replace(/[:.]/g, "-");
  const output = join(RESULTS, `blind-review-${pageId}.local.html`);
  writeFileSync(output, renderPage(pairs, images, pageId), { mode: 0o600 });
  console.log(`Built ${pairs.length} blinded pairs. Open locally (not shared): ${output}`);
}

const isDirectExecution =
  Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectExecution) {
  try {
    main();
  } catch (error) {
    console.error(`Review page stopped: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exitCode = 1;
  }
}
