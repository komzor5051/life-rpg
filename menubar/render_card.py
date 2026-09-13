#!/usr/bin/env python3
"""Render the life-rpg menu card as a PNG (retina, 144 dpi) for SwiftBar.
Usage: render_card.py summary.json hero.png out.png
Fonts: Inter Tight if installed, else Helvetica."""
import json, sys, os, glob
from PIL import Image, ImageDraw, ImageFont

BG, LINE, INK, MUTE, ACC, TRACK = "#17181B", "#272A2F", "#E6E6E1", "#8F9298", "#C8F04C", "#23262B"
S = 2                       # retina scale
W = 336 * S                 # card width in px (336 pt)
PAD = 18 * S

def font(size, weight=400):
    cands = glob.glob(os.path.expanduser("~/Library/Fonts/InterTight[wght].ttf")) + \
            glob.glob("/Library/Fonts/InterTight[wght].ttf") + ["/System/Library/Fonts/Helvetica.ttc"]
    for p in cands:
        if os.path.exists(p):
            f = ImageFont.truetype(p, size * S)
            try: f.set_variation_by_axes([weight])
            except Exception: pass
            return f
    return ImageFont.load_default()

def num(v):
    try: v = float(v)
    except (TypeError, ValueError): return "0"
    return "{:,}".format(int(round(v))).replace(",", " ")

def main(summary_path, hero_path, out_path):
    d = json.load(open(summary_path, encoding="utf-8"))
    img = Image.new("RGBA", (W, 2000), (0, 0, 0, 0))
    dr = ImageDraw.Draw(img)
    y = PAD
    F = {"h": font(17, 600), "b": font(13, 500), "s": font(12, 400), "n": font(13, 600), "lvl": font(11, 700)}

    def text(x, yy, t, f, fill=INK, anchor="la"):
        dr.text((x, yy), t, font=f, fill=fill, anchor=anchor)
    def bar(yy, ratio, h=6):
        r = max(0.0, min(1.0, ratio))
        dr.rounded_rectangle((PAD, yy, W - PAD, yy + h * S), radius=h * S // 2, fill=TRACK)
        if r > 0:
            dr.rounded_rectangle((PAD, yy, PAD + max(h * S, int((W - 2 * PAD) * r)), yy + h * S), radius=h * S // 2, fill=ACC)
        return yy + h * S
    def row(label, value, yy):
        text(PAD, yy, label, F["b"], MUTE); text(W - PAD, yy, value, F["n"], INK, "ra"); return yy + 20 * S
    def hr(yy):
        dr.line((PAD, yy, W - PAD, yy), fill=LINE, width=S); return yy + 14 * S

    # header: hero + name
    size = 56 * S
    try:
        hero = Image.open(hero_path).convert("RGBA")
        hero.thumbnail((size, size))
        frame = Image.new("RGBA", (size, size), TRACK)
        mask = Image.new("L", (size, size), 0); ImageDraw.Draw(mask).rounded_rectangle((0, 0, size, size), radius=14 * S, fill=255)
        frame.paste(hero, ((size - hero.width) // 2, size - hero.height), hero)
        img.paste(frame, (PAD, y), mask)
    except Exception:
        dr.rounded_rectangle((PAD, y, PAD + size, y + size), radius=14 * S, fill=TRACK)
    tx = PAD + size + 14 * S
    text(tx, y + 4 * S, d.get("name") or "Персонаж", F["h"])
    text(tx, y + 27 * S, d.get("class") or "", F["s"], MUTE)
    lvl = "LVL %s" % d.get("level", 1)
    bw = dr.textlength(lvl, font=F["lvl"]) + 16 * S
    dr.rounded_rectangle((W - PAD - bw, y + 4 * S, W - PAD, y + 24 * S), radius=10 * S, fill=ACC)
    text(W - PAD - bw / 2, y + 14 * S, lvl, F["lvl"], "#0F1011", "mm")
    y += size + 18 * S

    # xp
    y = row("Опыт до уровня", "%s / %s" % (num(d.get("xpIn")), num(d.get("perLevel"))), y)
    y = bar(y, (d.get("xpIn") or 0) / max(1, d.get("perLevel") or 1)) + 10 * S
    y = row("Стрик касаний", "%s дн · заморозки %s" % (d.get("streak", 0), d.get("freezesLeft", 0)), y) + 4 * S
    y = hr(y)

    # boss of the week
    weekly = d.get("weeklyGoal") or 0; week = d.get("moneyWeek") or 0
    if d.get("bossDead"):
        y = row("Босс недели", "повержен · %s р." % num(week), y)
    else:
        y = row("Босс недели", "%s HP из %s" % (num(d.get("bossHp")), num(weekly)), y)
    y = bar(y, week / max(1, weekly)) + 12 * S

    mq = d.get("mainQuest")
    if mq:
        t = str(mq.get("title") or "").strip()
        if t.lower().startswith("main quest:"): t = t[len("main quest:"):].strip()
        text(PAD, y, "Main quest", F["b"], MUTE); y += 18 * S
        text(PAD, y, t[:44] + ("…" if len(t) > 44 else ""), F["n"]); y += 20 * S
        if mq.get("target"):
            text(W - PAD, y - 20 * S, "", F["s"])
            y = row("", "%s / %s р." % (num(mq.get("progress")), num(mq.get("target"))), y - 2 * S)
            y = bar(y, (mq.get("progress") or 0) / max(1, mq.get("target") or 1)) + 4 * S
    y = hr(y + 6 * S)

    # today
    text(PAD, y, "Сегодня · день %s" % d.get("dayN", "?"), F["b"], MUTE); y += 22 * S
    today = d.get("today") or {}; c = d.get("todayCounts") or {}
    for key, label, cnt in (("sale", "Касание", c.get("sale", 0)), ("content", "Публикация", c.get("content", 0)), ("day", "День закрыт", None)):
        on = bool(today.get(key)); cx, cy, r = PAD + 8 * S, y + 8 * S, 7 * S
        if on:
            dr.ellipse((cx - r, cy - r, cx + r, cy + r), fill=ACC)
            dr.line((cx - 3 * S, cy, cx - S, cy + 2.5 * S, cx + 3.5 * S, cy - 2.5 * S), fill="#0F1011", width=2 * S, joint="curve")
        else:
            dr.ellipse((cx - r, cy - r, cx + r, cy + r), outline=MUTE, width=S)
        text(PAD + 24 * S, y, label, F["b"], INK if on else MUTE)
        if cnt: text(W - PAD, y, str(cnt), F["n"], MUTE, "ra")
        y += 22 * S
    y += PAD - 6 * S

    card = Image.new("RGBA", (W, y), (0, 0, 0, 0))
    ImageDraw.Draw(card).rounded_rectangle((0, 0, W - 1, y - 1), radius=16 * S, fill=BG)
    card.alpha_composite(img.crop((0, 0, W, y)))
    card.save(out_path, dpi=(72 * S, 72 * S))

if __name__ == "__main__":
    main(*sys.argv[1:4])
