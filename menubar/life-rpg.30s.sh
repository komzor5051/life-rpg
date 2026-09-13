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
REAL="$(/usr/bin/python3 -c 'import os,sys;print(os.path.realpath(sys.argv[1]))' "$SELF")"   # follow the symlink to find render_card.py
RENDER="$(dirname "$REAL")/render_card.py"
TODAY="$(date +%F)"

# --- action mode: life-rpg.30s.sh sale  (asks sum and source via dialog) -----
if [ "$1" = "sale" ]; then
  SUM="$(osascript -e 'text returned of (display dialog "Сумма продажи, ₽" default answer "" with title "Продал" buttons {"Отмена","Записать"} default button "Записать")' 2>/dev/null | tr -d ' ')"
  [ -z "$SUM" ] && exit 0
  case "$SUM" in ''|*[!0-9]*) osascript -e 'display notification "Нужно число" with title "Продажа не записана"'; exit 0 ;; esac
  SRC="$(osascript -e 'text returned of (display dialog "Что и кому: консультация, Иван" default answer "" with title "Продал" buttons {"Записать"} default button "Записать")' 2>/dev/null | sed 's/["\\]//g')"
  curl -s -m 5 -X POST "$BASE/api/log" \
    -H 'Content-Type: application/json' \
    -d "{\"type\":\"money\",\"d\":\"$TODAY\",\"sum\":$SUM,\"src\":\"$SRC\"}" >/dev/null \
    && osascript -e "display notification \"$SUM ₽ · $SRC\" with title \"Продажа записана\""
  exit 0
fi

# --- action mode: life-rpg.30s.sh day  (evening: energy + what was dropped) ---
if [ "$1" = "day" ]; then
  EN="$(osascript -e 'text returned of (display dialog "Энергия сегодня, 1-10" default answer "7" with title "Закрыть день" buttons {"Отмена","Дальше"} default button "Дальше")' 2>/dev/null | tr -d ' ')"
  [ -z "$EN" ] && exit 0
  case "$EN" in ''|*[!0-9]*) exit 0 ;; esac
  SRC="$(osascript -e 'text returned of (display dialog "Что бросил сегодня и почему" default answer "" with title "Закрыть день" buttons {"Записать"} default button "Записать")' 2>/dev/null | sed 's/["\\]//g')"
  curl -s -m 5 -X POST "$BASE/api/log" -H 'Content-Type: application/json' \
    -d "{\"type\":\"day\",\"d\":\"$TODAY\",\"energy\":$EN,\"src\":\"$SRC\"}" >/dev/null \
    && osascript -e 'display notification "Энергия записана" with title "День закрыт"'
  exit 0
fi

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

TMP="${TMPDIR:-/tmp}/life-rpg-menubar"; mkdir -p "$TMP"
printf '%s' "$JSON" > "$TMP/summary.json"
curl -s -m 3 -f "$BASE/hero-thumb" -o "$TMP/hero.png" 2>/dev/null
CARD=""
if [ -f "$RENDER" ] && /usr/bin/python3 "$RENDER" "$TMP/summary.json" "$TMP/hero.png" "$TMP/card.png" 2>"$TMP/render.err"; then
  CARD="$(base64 < "$TMP/card.png" | tr -d '\n')"
fi
HERO=""
[ -z "$CARD" ] && HERO="$(base64 < "$TMP/hero.png" 2>/dev/null | tr -d '\n')"

JSON="$JSON" HERO="$HERO" CARD="$CARD" SELF="$SELF" BASE="$BASE" /usr/bin/python3 - <<'PY'
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
card = os.environ.get("CARD", "")
self_path = os.environ["SELF"]
base = os.environ["BASE"]
MONO = "size=13"

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
    title += " · касание?"
print("%s | font=.AppleSystemUIFont size=12" % title)
print("---")

# --- card (rendered PNG) or text fallback ---
if card:
    print("| image=%s" % card)
else:
    if hero:
        print("| image=%s" % hero)
    print("%s · %s | %s" % (esc(d.get("name", "")), esc(d.get("class", "")), MONO))
    xp_in = d.get("xpIn", 0); per = d.get("perLevel", 0)
    print("Опыт %s / %s | %s" % (num(xp_in), num(per), MONO))
    print("Стрик касаний %s дн · заморозки %s | %s" % (d.get("streak", 0), d.get("freezesLeft", 0), MONO))
    weekly = d.get("weeklyGoal", 0)
    if boss_dead:
        print("Босс недели повержен · %s из %s | %s" % (num(d.get("moneyWeek", 0)), num(weekly), MONO))
    else:
        print("Босс недели: %s HP из %s | %s" % (num(boss_hp), num(weekly), MONO))
    print("---")
    print("Сегодня, день %s | %s" % (d.get("dayN", "?"), MONO))
    def mark(flag): return "[x]" if flag else "[ ]"
    print("%s касание (%s) | %s" % (mark(today.get("sale")), counts.get("sale", 0), MONO))
    print("%s публикация (%s) | %s" % (mark(today.get("content")), counts.get("content", 0), MONO))
    print("%s день закрыт | %s" % (mark(today.get("day")), MONO))

# --- actions ---
print("---")
print("Продал: сумма… | bash=%s param1=sale terminal=false refresh=true sfimage=plus.circle.fill" % self_path)
print("Касание +1 | bash=%s param1=log param2=sale terminal=false refresh=true sfimage=hand.tap" % self_path)
print("Публикация +1 | bash=%s param1=log param2=content terminal=false refresh=true sfimage=text.bubble" % self_path)
print("Закрыть день | bash=%s param1=day terminal=false refresh=true sfimage=moon" % self_path)
print("---")
print("Открыть кабинет | href=%s sfimage=arrow.up.right.square" % base)
print("Обновить | refresh=true sfimage=arrow.clockwise")
PY
