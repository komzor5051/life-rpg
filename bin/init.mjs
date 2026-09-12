#!/usr/bin/env node
// Создаёт папку персонажа из шаблонов и пишет rpg.config.json.
// node bin/init.mjs --vault ~/Obsidian/Vault [--folder "Персонаж"] [--name Имя] [--class Класс] [--goal 300000]
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith("--") ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : "true"] : []).filter(Boolean));
const expand = p => p.replace(/^~(?=$|\/)/, process.env.HOME || "");
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = async (q, def) => { if (args.yes === "true") return def; const a = (await rl.question(`${q}${def ? ` [${def}]` : ""}: `)).trim(); return a || def; };

const vault = expand(args.vault || await ask("Путь к хранилищу Obsidian (или любая папка)", path.join(APP, "data")));
const folder = args.folder || await ask("Имя папки персонажа", "Персонаж");
const name = args.name || await ask("Имя персонажа", "Герой");
const cls = args.class || await ask("Класс", "Соло с AI-рычагом");
const goal = Number(args.goal || await ask("Цель дохода в месяц, число", "300000"));
rl.close();

const root = path.join(vault, folder);
if (fs.existsSync(root) && fs.readdirSync(root).length) { console.error(`Папка уже существует и не пуста: ${root}. Ничего не трогаю.`); process.exit(1); }
const today = new Date(), iso = d => d.toLocaleDateString("sv-SE");
const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
const q = Math.floor(today.getMonth() / 3); const quarterEnd = new Date(today.getFullYear(), q * 3 + 3, 0);
const vars = { NAME: name, CLASS: cls, MONTHLY_GOAL: String(goal), WEEKLY_GOAL: String(Math.round(goal / 4)), START: iso(today), MONTH_END: iso(monthEnd), QUARTER_END: iso(quarterEnd) };
const fill = s => s.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? "");
const copyDir = (src, dst) => { fs.mkdirSync(dst, { recursive: true }); for (const f of fs.readdirSync(src)) { const s = path.join(src, f), d = path.join(dst, f); if (fs.statSync(s).isDirectory()) copyDir(s, d); else fs.writeFileSync(d, fill(fs.readFileSync(s, "utf8"))); } };
copyDir(path.join(APP, "templates"), root);
fs.writeFileSync(path.join(APP, "rpg.config.json"), JSON.stringify({ vault, folder, port: 4877 }, null, 2) + "\n");
console.log(`Готово.\nПапка персонажа: ${root}\nКонфиг: ${path.join(APP, "rpg.config.json")}\n\nЗапуск: npm start, потом открой http://localhost:4877`);
