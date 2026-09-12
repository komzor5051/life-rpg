#!/bin/bash
# life-rpg SwiftBar plugin: character widget in the macOS menu bar.
# Refresh every 30s (the ".30s." in the filename). Data source: local life-rpg server.
#
# <swiftbar.title>life-rpg</swiftbar.title>
# <swiftbar.hideAbout>true</swiftbar.hideAbout>
# <swiftbar.hideRunInTerminal>true</swiftbar.hideRunInTerminal>
# <swiftbar.hideLastUpdated>true</swiftbar.hideLastUpdated>
# <swiftbar.hideDisablePlugin>true</swiftbar.hideDisablePlugin>
# <swiftbar.hideSwiftBar>true</swiftbar.hideSwiftBar>

BASE="${LIFE_RPG_URL:-http://localhost:4877}"
SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
TODAY="$(date +%F)"

# --- action mode: life-rpg.30s.sh log sale|content ---------------------------
if [ "$1" = "log" ]; then
  TYPE="${2:-sale}"
  case "$TYPE" in sale|content|money|day) ;; *) echo "unknown type: $TYPE" >&2; exit 1 ;; esac
  curl -s -m 5 -X POST "$BASE/api/log" \
    -H 'Content-Type: application/json' \
    -d "{\"type\":\"$TYPE\",\"d\":\"$TODAY\",\"n\":1,\"src\":\"menubar\"}" >/dev/null
  exit 0
fi

# --- render mode --------------------------------------------------------------
JSON="$(curl -s -m 3 -f "$BASE/api/summary" 2>/dev/null)"

if [ -z "$JSON" ]; then
  echo "RPG офлайн | font=Menlo size=12"
  echo "---"
  echo "Сервер $BASE не отвечает | color=gray"
  echo "Открыть кабинет | href=$BASE"
  echo "Обновить | refresh=true"
  exit 0
fi

HERO="$(curl -s -m 3 -f "$BASE/hero-thumb" 2>/dev/null | base64 | tr -d '\n')"

JSON="$JSON" HERO="$HERO" SELF="$SELF" BASE="$BASE" /usr/bin/python3 - <<'PY'
import json, os, sys, datetime

try:
    d = json.loads(os.environ["JSON"])
except Exception:
    print("RPG офлайн | font=Menlo size=12")
    print("---")
    print("Ответ /api/summary не разобран | color=gray")
    print("Открыть кабинет | href=%s" % os.environ["BASE"])
    print("Обновить | refresh=true")
    sys.exit(0)

hero = os.environ.get("HERO", "")
self_path = os.environ["SELF"]
base = os.environ["BASE"]
MONO = "font=Menlo size=12"

def num(v):
    try:
        v = float(v)
    except (TypeError, ValueError):
        return "0"
    if v == int(v):
        return "{:,}".format(int(v)).replace(",", " ")
    return "{:,.1f}".format(v).replace(",", " ")

def bar(cur, total, width=20):
    try:
        cur = float(cur or 0); total = float(total or 0)
    except (TypeError, ValueError):
        cur, total = 0.0, 0.0
    if total <= 0:
        return "□" * width
    filled = int(round(min(max(cur / total, 0.0), 1.0) * width))
    return "■" * filled + "□" * (width - filled)

def esc(s):
    return str(s if s is not None else "").replace("|", "/")

level = d.get("level", 0)
boss_hp = d.get("bossHp", 0)
boss_dead = bool(d.get("bossDead"))
today = d.get("today") or {}
counts = d.get("todayCounts") or {}
now = datetime.datetime.now()

# --- menu bar title ---
if boss_dead:
    title = "LVL %s · босс повержен" % level
else:
    title = "LVL %s · %s HP" % (level, num(boss_hp))
if not today.get("sale") and now.hour >= 11:
    title += " · продажа?"
print("%s | %s" % (title, MONO))
print("---")

# --- hero image ---
if hero:
    print("| image=%s" % hero)

# --- character ---
print("%s · %s | %s" % (esc(d.get("name", "")), esc(d.get("class", "")), MONO))
xp_in = d.get("xpIn", 0); per = d.get("perLevel", 0)
print("Опыт %s / %s | %s" % (num(xp_in), num(per), MONO))
print("%s | %s" % (bar(xp_in, per), MONO))
print("Стрик продаж %s дн · заморозки %s | %s" % (d.get("streak", 0), d.get("freezesLeft", 0), MONO))

# --- boss of the week ---
weekly = d.get("weeklyGoal", 0)
if boss_dead:
    print("Босс недели повержен · %s из %s | %s" % (num(d.get("moneyWeek", 0)), num(weekly), MONO))
else:
    print("Босс недели: %s HP из %s | %s" % (num(boss_hp), num(weekly), MONO))
print("%s | %s" % (bar(d.get("moneyWeek", 0), weekly), MONO))

# --- main quest ---
mq = d.get("mainQuest")
if mq:
    mq_title = str(mq.get("title") or "").strip()
    if mq_title.lower().startswith("main quest:"):
        mq_title = mq_title[len("main quest:"):].strip()
    print("Main quest: %s | %s" % (esc(mq_title), MONO))
    if mq.get("target") is not None:
        print("%s / %s | %s" % (num(mq.get("progress", 0)), num(mq.get("target", 0)), MONO))
        print("%s | %s" % (bar(mq.get("progress", 0), mq.get("target", 0)), MONO))

# --- today ---
print("---")
print("Сегодня, день %s | %s" % (d.get("dayN", "?"), MONO))
def mark(flag): return "[x]" if flag else "[ ]"
print("%s продажа (%s) | %s" % (mark(today.get("sale")), counts.get("sale", 0), MONO))
print("%s публикация (%s) | %s" % (mark(today.get("content")), counts.get("content", 0), MONO))
print("%s день закрыт | %s" % (mark(today.get("day")), MONO))

# --- actions ---
print("---")
print("Записать продажу (+1) | bash=%s param1=log param2=sale terminal=false refresh=true" % self_path)
print("Записать публикацию (+1) | bash=%s param1=log param2=content terminal=false refresh=true" % self_path)
print("Открыть кабинет | href=%s" % base)
print("Обновить | refresh=true")
PY
