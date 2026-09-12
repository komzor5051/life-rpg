// Кабинет персонажа. Читает и пишет markdown в Obsidian, без зависимостей.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";

const APP = path.dirname(new URL(import.meta.url).pathname);
const CFG_PATH = process.env.RPG_CONFIG || path.join(APP, "rpg.config.json");
const cfgFile = fs.existsSync(CFG_PATH) ? JSON.parse(fs.readFileSync(CFG_PATH, "utf8")) : {};
const expand = p => p ? p.replace(/^~(?=$|\/)/, process.env.HOME || "") : p;
// Приоритет: переменные окружения, потом rpg.config.json, потом папка data рядом с приложением.
const VAULT = expand(process.env.VAULT || cfgFile.vault) || path.join(APP, "data");
const ROOT = path.join(VAULT, process.env.RPG_FOLDER || cfgFile.folder || "Персонаж");
const PORT = Number(process.env.PORT || cfgFile.port || 4877);
const PUBLIC = path.join(APP, "public");
if (!fs.existsSync(ROOT)) { console.error(`Папка персонажа не найдена: ${ROOT}\nЗапусти: node bin/init.mjs --vault "${VAULT}"`); process.exit(1); }

const read = f => fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "";
const write = (f, s) => fs.writeFileSync(f, s, "utf8");
const today = () => new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD

// ---------- парсинг ----------
function resolveImg(val, key) {
  if (val) { const rel = String(val).replace(/^\[\[|\]\]$/g, "").split("|")[0]; for (const base of [VAULT, ROOT]) { const p = path.join(base, rel); if (fs.existsSync(p)) return p; } }
  const def = path.join(APP, "assets", key === "hero2" ? "hero-default-2.png" : key === "hero" ? "hero-default.png" : "avatar-default.png");
  return fs.existsSync(def) ? def : null;
}
function frontmatter(md) {
  const m = md.match(/^---\n([\s\S]*?)\n---/);
  const out = {};
  if (!m) return out;
  for (const line of m[1].split("\n")) {
    const k = line.match(/^([\w_]+):\s*(.*)$/);
    if (k) out[k[1]] = k[2].replace(/^["']|["']$/g, "").trim();
  }
  return out;
}
function fields(text) {
  const out = {};
  for (const m of text.matchAll(/\[([\w]+)::\s*([^\]]*)\]/g)) out[m[1]] = m[2].trim();
  return out;
}
function listItems(md) {
  const items = []; let section = "";
  md.split("\n").forEach((line, idx) => {
    const h = line.match(/^##\s+(.*)/); if (h) { section = h[1].trim(); return; }
    const li = line.match(/^- (\[([ xX])\] )?(.*)$/);
    if (!li) return;
    const f = fields(li[3]);
    items.push({ line: idx, raw: line, section, task: !!li[1], checked: li[2] ? li[2] !== " " : false,
      text: li[3].replace(/\[[\w]+::[^\]]*\]/g, "").trim(), ...f });
  });
  return items;
}

function state() {
  const cfgMd = read(path.join(ROOT, "00 Персонаж.md"));
  const cfg = frontmatter(cfgMd);
  const journal = listItems(read(path.join(ROOT, "Журнал.md"))).filter(i => i.type && i.d);
  const achievements = listItems(read(path.join(ROOT, "Достижения.md"))).filter(i => i.task);
  const bag = listItems(read(path.join(ROOT, "Багаж.md"))).filter(i => i.earned !== undefined);
  const skillsMd = read(path.join(ROOT, "Знания.md"));
  const skills = [];
  let cur = null;
  for (const line of skillsMd.split("\n")) {
    const h = line.match(/^##\s+(.*)/);
    if (h) { cur = { name: h[1].trim(), lvl: 0, criteria: [] }; skills.push(cur); continue; }
    if (!cur) continue;
    const l = line.match(/\[lvl::\s*(\d+)\]/); if (l) cur.lvl = Number(l[1]);
    const c = line.match(/Критерии:\s*(.*)/); if (c) cur.criteria = c[1].split(/;\s*/).map(s => s.replace(/^\d+\s*/, "").trim());
  }
  const qdir = path.join(ROOT, "Квесты");
  const quests = fs.existsSync(qdir) ? fs.readdirSync(qdir).filter(f => f.endsWith(".md")).map(f => {
    const md = read(path.join(qdir, f)); const fm = frontmatter(md);
    const steps = listItems(md).filter(i => i.task).map(i => ({ text: i.text, done: i.checked }));
    const title = (md.match(/^#\s+(.*)$/m) || [])[1] || f.replace(/\.md$/, "");
    return { file: f, name: f.replace(/\.md$/, ""), title, steps, ...fm };
  }) : [];
  const imgUrl = key => resolveImg(cfg[key], key) ? `/${key}?${Date.now()}` : null;
  const hero = imgUrl("hero") || "/hero?default", hero2 = imgUrl("hero2") || "/hero2?default";
  let avatar = null;
  if (cfg.avatar) {
    const p = cfg.avatar.replace(/^\[\[|\]\]$/g, "").split("|")[0];
    const abs = path.join(VAULT, p);
    if (fs.existsSync(abs)) avatar = "/avatar?" + Date.now();
  }
  const rules = read(path.join(ROOT, "Фундамент.md"));
  return { cfg, avatar, hero, hero2, journal, achievements, bag, skills, quests, today: today(), rules };
}

// ---------- сводка для виджета (повторяет compute() из index.html) ----------
const num = v => Number(String(v ?? "").replace(/\s/g, "")) || 0;
const D = s => { const [y, m, d] = String(s).slice(0, 10).split("-").map(Number); return new Date(y, m - 1, d); };
const iso = d => d.toLocaleDateString("sv-SE");
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const isoWeek = d => { const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const day = x.getUTCDay() || 7; x.setUTCDate(x.getUTCDate() + 4 - day); const y = new Date(Date.UTC(x.getUTCFullYear(), 0, 1)); return x.getUTCFullYear() + "-" + Math.ceil((((x - y) / 864e5) + 1) / 7); };
function summary() {
  const s = state(), cfg = s.cfg, td = D(s.today), start = D(cfg.start || s.today);
  const J = s.journal.map(i => ({ ...i, date: D(i.d) }));
  const by = t => J.filter(i => i.type === t);
  const sameMonth = i => i.date.getFullYear() === td.getFullYear() && i.date.getMonth() === td.getMonth();
  const sameWeek = i => isoWeek(i.date) === isoWeek(td);
  const isToday = i => iso(i.date) === s.today;
  const cnt = (a, f = "n") => a.reduce((x, i) => x + (i[f] === undefined ? (f === "n" ? 1 : 0) : num(i[f])), 0);
  const money = by("money"), sales = by("sale"), content = by("content"), practice = by("practice"), system = by("system"), days = by("day");
  const moneyAll = cnt(money, "sum"), moneyMonth = cnt(money.filter(sameMonth), "sum"), moneyWeek = cnt(money.filter(sameWeek), "sum");
  const perLevel = num(cfg.xp_per_level) || 250;
  const xpResult = Math.floor(moneyAll / 1000), level = Math.floor(xpResult / perLevel) + 1, xpIn = xpResult - (level - 1) * perLevel;
  const xpProcess = cnt(sales) + cnt(content) + cnt(practice, "hours");
  const monthlyGoal = num(cfg.monthly_goal) || 300000, weeklyGoal = num(cfg.weekly_goal) || 75000;
  // стрик: дни с записью sale, от сегодня или вчера назад до start; заморозки в календарный месяц, два пропуска подряд обнуляют
  const saleDays = new Set(sales.map(i => iso(i.date)));
  const freezes = num(cfg.freezes_per_month) || 2;
  let streak = 0, missed = 0, frozen = {}, cur = saleDays.has(s.today) ? td : addDays(td, -1);
  while (cur >= start) {
    const k = iso(cur);
    if (saleDays.has(k)) { streak++; missed = 0; }
    else { missed++; const mk = k.slice(0, 7); frozen[mk] = (frozen[mk] || 0) + 1; if (missed >= 2 || frozen[mk] > freezes) break; }
    cur = addDays(cur, -1);
  }
  const dayN = Math.max(0, Math.round((td - start) / 864e5) + 1);
  const mq = s.quests.find(q => q.kind === "main");
  const questProgress = q => { if (!q.match) return moneyMonth; const re = new RegExp(q.match, "i"); return cnt(money.filter(i => re.test(i.src || "")), "sum"); };
  return {
    name: cfg.name || "", class: cfg.class || "", level, xpIn, perLevel, xpResult, xpProcess,
    moneyAll, moneyMonth, moneyWeek, monthlyGoal, weeklyGoal,
    bossHp: Math.max(0, weeklyGoal - moneyWeek), bossDead: moneyWeek >= weeklyGoal,
    streak, freezesLeft: Math.max(0, freezes - (frozen[s.today.slice(0, 7)] || 0)), dayN,
    today: { sale: sales.some(isToday), content: content.some(isToday), day: days.some(isToday) },
    todayCounts: { sale: cnt(sales.filter(isToday)), content: cnt(content.filter(isToday)), system: cnt(system.filter(isToday)) },
    mainQuest: mq ? { title: mq.title, boss: mq.boss || "", progress: questProgress(mq), target: num(mq.target) } : null,
  };
}

// ---------- миниатюра героя без маджента-фона (python3 + Pillow, кэш в tmp) ----------
const KEYOUT_PY = `
import sys
from PIL import Image, ImageChops
im = Image.open(sys.argv[1]).convert("RGBA")
r, g, b, _ = im.split()
m = ImageChops.subtract(ImageChops.darker(r, b), g)  # min(r,b) - g, ниже нуля режется в 0
alpha = m.point(lambda v: 255 if v <= 60 else max(0, round(255 * (1 - (v - 60) / 60))))
edge = m.point(lambda v: 255 if v > 60 else 0)  # где давим розовый ореол: r,b не выше g+40
gp = g.point(lambda v: min(255, v + 40))
r = Image.composite(ImageChops.darker(r, gp), r, edge); b = Image.composite(ImageChops.darker(b, gp), b, edge)
out = Image.merge("RGBA", (r, g, b, alpha))
h = int(sys.argv[3]); out = out.resize((max(1, round(out.width * h / out.height)), h), Image.LANCZOS)
out.save(sys.argv[2], "PNG")
`;
function heroThumb(src, height = 320) {
  const cache = path.join(os.tmpdir(), `life-rpg-hero-${Math.floor(fs.statSync(src).mtimeMs)}-${height}.png`);
  if (fs.existsSync(cache)) return Promise.resolve(cache);
  return new Promise(r => execFile("python3", ["-c", KEYOUT_PY, src, cache, String(height)], { timeout: 15000 }, err => r(err ? null : cache)));
}

// ---------- записи ----------
function appendJournal(entry) {
  const f = path.join(ROOT, "Журнал.md");
  let md = read(f);
  const d = entry.d || today();
  const month = d.slice(0, 7);
  if (!md.includes(`## ${month}`)) md = md.trimEnd() + `\n\n## ${month}\n\n`;
  const parts = [`[type:: ${entry.type}]`, `[d:: ${d}]`];
  for (const k of ["sum", "n", "hours", "energy"]) if (entry[k] !== undefined && entry[k] !== "") parts.push(`[${k}:: ${entry[k]}]`);
  if (entry.src) parts.push(`[src:: ${String(entry.src).replace(/[\[\]]/g, "")}]`);
  md = md.trimEnd() + "\n- " + parts.join(" ") + "\n";
  write(f, md);
}
function deleteJournal(raw) {
  const f = path.join(ROOT, "Журнал.md");
  const lines = read(f).split("\n"); const i = lines.indexOf(raw);
  if (i >= 0) { lines.splice(i, 1); write(f, lines.join("\n")); return true; }
  return false;
}
function toggleAchievement(raw, on) {
  const f = path.join(ROOT, "Достижения.md");
  const lines = read(f).split("\n"); const i = lines.indexOf(raw);
  if (i < 0) return false;
  let l = lines[i];
  l = on ? l.replace(/^- \[ \]/, "- [x]").replace(/\[when::[^\]]*\]/, `[when:: ${today()}]`)
         : l.replace(/^- \[[xX]\]/, "- [ ]").replace(/\[when::[^\]]*\]/, "[when:: ]");
  lines[i] = l; write(f, lines.join("\n")); return true;
}
function setSkill(name, lvl) {
  const f = path.join(ROOT, "Знания.md");
  const lines = read(f).split("\n"); let inSec = false, done = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) inSec = lines[i].replace(/^##\s+/, "").trim() === name;
    if (inSec && /\[lvl::\s*\d+\]/.test(lines[i])) { lines[i] = lines[i].replace(/\[lvl::\s*\d+\]/, `[lvl:: ${lvl}]`); done = true; break; }
  }
  if (done) write(f, lines.join("\n")); return done;
}
function setQuest(file, patch) {
  const f = path.join(ROOT, "Квесты", file); if (!fs.existsSync(f)) return false;
  let md = read(f);
  for (const [k, v] of Object.entries(patch)) {
    if (new RegExp(`^${k}:.*$`, "m").test(md)) md = md.replace(new RegExp(`^${k}:.*$`, "m"), `${k}: ${v}`);
    else md = md.replace(/^---\n/, `---\n${k}: ${v}\n`);
  }
  write(f, md); return true;
}
function toggleQuestStep(file, text, done) {
  const f = path.join(ROOT, "Квесты", file); if (!fs.existsSync(f)) return false;
  const lines = read(f).split("\n");
  const i = lines.findIndex(l => /^- \[[ xX]\] /.test(l) && l.replace(/^- \[[ xX]\] /, "").trim() === text);
  if (i < 0) return false;
  lines[i] = lines[i].replace(/^- \[[ xX]\]/, done ? "- [x]" : "- [ ]"); write(f, lines.join("\n")); return true;
}

// ---------- http ----------
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
const json = (res, code, obj) => { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(obj)); };
const body = req => new Promise(r => { let s = ""; req.on("data", c => s += c); req.on("end", () => { try { r(JSON.parse(s || "{}")); } catch { r({}); } }); });

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  try {
    if (url.pathname === "/api/state") return json(res, 200, state());
    if (url.pathname === "/api/summary") return json(res, 200, summary());
    if (url.pathname === "/hero-thumb") {
      const cfg = frontmatter(read(path.join(ROOT, "00 Персонаж.md")));
      const p = resolveImg(cfg.hero, "hero");
      if (!p) { res.writeHead(404); return res.end("no image"); }
      const t = (await heroThumb(p)) || p; // без python/Pillow отдаём исходник как есть
      res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "no-store" });
      return fs.createReadStream(t).pipe(res);
    }
    if (["/avatar", "/hero", "/hero2"].includes(url.pathname)) {
      const cfg = frontmatter(read(path.join(ROOT, "00 Персонаж.md")));
      const key = url.pathname.slice(1);
      const p = resolveImg(cfg[key], key);
      if (!p) { res.writeHead(404); return res.end("no image"); }
      res.writeHead(200, { "Content-Type": MIME[path.extname(p)] || "application/octet-stream", "Cache-Control": "no-store" });
      return fs.createReadStream(p).pipe(res);
    }
    if (req.method === "POST") {
      const b = await body(req);
      if (url.pathname === "/api/log") { appendJournal(b); return json(res, 200, { ok: true }); }
      if (url.pathname === "/api/log/delete") return json(res, 200, { ok: deleteJournal(b.raw) });
      if (url.pathname === "/api/achievement") return json(res, 200, { ok: toggleAchievement(b.raw, !!b.on) });
      if (url.pathname === "/api/skill") return json(res, 200, { ok: setSkill(b.name, Math.max(0, Math.min(5, Number(b.lvl) || 0))) });
      if (url.pathname === "/api/quest") return json(res, 200, { ok: setQuest(b.file, b.patch || {}) });
      if (url.pathname === "/api/quest/step") return json(res, 200, { ok: toggleQuestStep(b.file, b.text, !!b.done) });
      return json(res, 404, { error: "unknown" });
    }
    let p = url.pathname === "/" ? "/index.html" : url.pathname;
    const file = path.join(PUBLIC, path.normalize(p));
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file)) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    fs.createReadStream(file).pipe(res);
  } catch (e) { json(res, 500, { error: String(e) }); }
}).listen(PORT, () => console.log(`Кабинет: http://localhost:${PORT}\nПапка персонажа: ${ROOT}`));
