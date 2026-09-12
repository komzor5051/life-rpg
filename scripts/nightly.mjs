#!/usr/bin/env node
// Ночной автосбор: пишет в Журнал.md строки type system (сессии Claude Code, коммиты git) за вчера и сегодня.
// Авто-строки помечены [src:: авто...] и перезаписываются, ручные записи за тот же день не трогаются.
// node scripts/nightly.mjs [YYYY-MM-DD] [--repos ~/proj1,~/proj2]
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const cfg = JSON.parse(fs.readFileSync(path.join(APP, "rpg.config.json"), "utf8"));
const expand = p => p.replace(/^~(?=$|\/)/, process.env.HOME || "");
const ROOT = path.join(expand(cfg.vault), cfg.folder);
const JOURNAL = path.join(ROOT, "Журнал.md");
const args = process.argv.slice(2);
const day = args.find(a => /^\d{4}-\d{2}-\d{2}$/.test(a)) || new Date().toLocaleDateString("sv-SE");
const ri = args.indexOf("--repos");
const repos = String(ri >= 0 ? args[ri + 1] || "" : cfg.repos || "").split(",").filter(Boolean).map(expand);
const prev = d => { const x = new Date(d); x.setDate(x.getDate() - 1); return x.toLocaleDateString("sv-SE"); };

function claudeSessions(d) {
  const root = path.join(process.env.HOME, ".claude", "projects"); if (!fs.existsSync(root)) return 0; let n = 0;
  for (const p of fs.readdirSync(root)) { const dir = path.join(root, p); if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir)) if (f.endsWith(".jsonl") && fs.statSync(path.join(dir, f)).mtime.toLocaleDateString("sv-SE") === d) n++; }
  return n;
}
function commits(d) { let n = 0; for (const r of repos) { try { n += execFileSync("git", ["-C", r, "log", "--since", `${d} 00:00`, "--until", `${d} 23:59:59`, "--format=%h"], { encoding: "utf8" }).trim().split("\n").filter(Boolean).length; } catch {} } return n; }
function upsert(md, type, d, fields, src) {
  const lines = md.split("\n");
  const isAuto = l => l.startsWith("- ") && l.includes(`[type:: ${type}]`) && l.includes(`[d:: ${d}]`) && l.includes("[src:: авто");
  if (lines.some(l => l.startsWith("- ") && l.includes(`[type:: ${type}]`) && l.includes(`[d:: ${d}]`) && !isAuto(l))) return md;
  let out = lines.filter(l => !isAuto(l)).join("\n"); const month = d.slice(0, 7);
  if (!out.includes(`## ${month}`)) out = out.trimEnd() + `\n\n## ${month}\n`;
  return out.trimEnd() + `\n- [type:: ${type}] [d:: ${d}] ${fields} [src:: авто: ${src}]\n`;
}
let md = fs.readFileSync(JOURNAL, "utf8");
for (const d of [prev(day), day]) {
  const s = claudeSessions(d), c = commits(d);
  const parts = []; if (s) parts.push(`${s} сессий Claude Code`); if (c) parts.push(`${c} коммитов`);
  if (s + c > 0) { md = upsert(md, "system", d, `[n:: ${s + c}]`, parts.join(", ")); console.log(`${d}: система ${s + c} (${parts.join(", ")})`); }
}
fs.writeFileSync(JOURNAL, md);
