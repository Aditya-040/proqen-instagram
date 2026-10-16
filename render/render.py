#!/usr/bin/env python3
"""Render ProQen Instagram posts from content/posts.json into queue/<id>/<n>.jpg.

Usage:  python3 render/render.py            # render posts that have no images yet
        python3 render/render.py --all      # re-render everything
        python3 render/render.py --only p001 p002
Writes queue/manifest.json (the posting script reads it).
"""
import base64, html, json, pathlib, sys
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
FD = ROOT / "render" / "fonts"
def F(n): return "data:font/otf;base64," + base64.b64encode((FD / n).read_bytes()).decode()
W, H = 1080, 1350
e = html.escape


def rich(s):
    """Escape text, then allow *highlight* and line breaks."""
    s = e(s)
    parts = s.split("*")
    out = "".join(f"<mark>{p}</mark>" if i % 2 else p for i, p in enumerate(parts))
    return out.replace("\n", "<br>")


CSS = f"""
@font-face{{font-family:I;src:url({F("Inter-Regular.otf")});font-weight:400}}
@font-face{{font-family:I;src:url({F("Inter-Medium.otf")});font-weight:500}}
@font-face{{font-family:I;src:url({F("Inter-SemiBold.otf")});font-weight:600}}
@font-face{{font-family:D;src:url({F("InterDisplay-Bold.otf")});font-weight:700}}
@font-face{{font-family:D;src:url({F("InterDisplay-ExtraBold.otf")});font-weight:800}}
:root{{--ink:#0D1020;--ink2:#171B33;--paper:#F5F3EE;--card:#FFFFFF;--line:#E4E1D8;
--acc:#4F46E5;--acc-l:#8E8BFF;--hi:#FFD84D;--ok:#16A34A;--bad:#E5484D;--mut:#6B6F80}}
*{{box-sizing:border-box;margin:0;padding:0}}
html,body{{width:{W}px;height:{H}px}}
body{{font-family:I;-webkit-font-smoothing:antialiased;overflow:hidden}}
.f{{position:relative;width:{W}px;height:{H}px;padding:84px 88px;display:flex;flex-direction:column}}
.dark{{background:radial-gradient(1200px 700px at 85% -10%,#2A2E7A 0%,rgba(42,46,122,0) 60%),var(--ink);color:#fff}}
.light{{background:var(--paper);color:var(--ink)}}
.top{{display:flex;justify-content:space-between;align-items:center;font:600 28px I;letter-spacing:.02em}}
.logo{{display:flex;align-items:center;gap:14px;font:800 34px D;letter-spacing:-.01em}}
.logo i{{width:40px;height:40px;border-radius:11px;background:var(--acc);display:grid;place-items:center;
 font:800 24px D;color:#fff;font-style:normal}}
.cnt{{opacity:.55;font-variant-numeric:tabular-nums}}
.bot{{margin-top:auto;display:flex;justify-content:space-between;align-items:center;font:500 27px I;opacity:.7}}
.kick{{display:inline-block;font:600 26px I;letter-spacing:.14em;text-transform:uppercase;color:var(--acc-l);margin-bottom:34px}}
.light .kick{{color:var(--acc)}}
h1{{font:800 104px/1.0 D;letter-spacing:-.035em}}
h2{{font:800 78px/1.04 D;letter-spacing:-.03em}}
mark{{background:linear-gradient(transparent 58%,var(--hi) 58%,var(--hi) 92%,transparent 92%);color:inherit;padding:0 .06em}}
.dark mark{{background:none;color:var(--hi)}}
.sub{{font:400 38px/1.42 I;opacity:.78;margin-top:40px;max-width:860px}}
.swipe{{display:flex;align-items:center;gap:16px;font:600 30px I}}
.swipe b{{width:64px;height:64px;border-radius:50%;background:var(--acc);display:grid;place-items:center;color:#fff;font:700 32px I}}
.num{{font:800 220px/0.8 D;letter-spacing:-.05em;color:var(--acc);opacity:.95}}
.body{{font:400 40px/1.45 I;color:#333849;margin-top:36px;max-width:880px}}
.tip{{margin-top:44px;background:var(--card);border:2px solid var(--line);border-radius:28px;padding:30px 36px;
 font:500 33px/1.4 I;color:var(--ink);display:flex;gap:20px}}
.tip span{{font:700 33px I;color:var(--acc);white-space:nowrap}}
.grow{{flex:1;display:flex;flex-direction:column;justify-content:center}}
.pill{{display:inline-flex;align-items:center;gap:12px;background:rgba(255,255,255,.1);border:1.5px solid rgba(255,255,255,.2);
 border-radius:99px;padding:16px 28px;font:600 30px I}}
.light .pill{{background:#fff;border-color:var(--line)}}
.row{{display:flex;gap:18px;flex-wrap:wrap;margin-top:44px}}
/* mockups */
.mock{{background:var(--card);border-radius:32px;box-shadow:0 30px 80px rgba(13,16,32,.18);color:var(--ink)}}
.xl{{font:500 26px I;border-collapse:collapse;width:100%}}
.xl td{{border:1.5px solid #D6D3CA;padding:14px 16px;color:#444}}
.xl tr:first-child td{{background:#EDEBE4;font-weight:600;color:#222}}
.sticky{{position:absolute;background:#FFE680;padding:22px 26px;font:600 27px/1.3 I;color:#4A3B00;border-radius:6px;
 box-shadow:0 10px 30px rgba(0,0,0,.15)}}
.kpi{{background:#fff;border-radius:22px;padding:24px 26px;border:1.5px solid var(--line)}}
.kpi small{{display:block;font:500 22px I;color:var(--mut)}}
.kpi b{{display:block;font:800 44px D;letter-spacing:-.02em;margin-top:6px}}
.kpi em{{font:600 21px I;font-style:normal;color:var(--ok)}}
.rcpt{{font:500 30px I}}
.rcpt .l{{display:flex;justify-content:space-between;padding:14px 0;border-bottom:1.5px dashed #D9D6CC}}
.chat{{background:#E9E3D8;border-radius:32px;padding:28px;display:flex;flex-direction:column;gap:16px}}
.msg{{max-width:78%;padding:22px 26px;border-radius:24px;font:500 30px/1.4 I;color:#111}}
.me{{align-self:flex-end;background:#D7F8C6;border-bottom-right-radius:6px}}
.them{{align-self:flex-start;background:#fff;border-bottom-left-radius:6px}}
.btns{{display:flex;gap:14px;margin-top:6px}}
.btns span{{background:#fff;border-radius:16px;padding:14px 22px;font:600 26px I;color:#0B7A5A}}
.steps{{display:flex;flex-direction:column;gap:22px;margin-top:50px}}
.step{{display:flex;align-items:center;gap:28px;background:#fff;border:2px solid var(--line);border-radius:26px;padding:26px 30px}}
.step i{{font:800 40px D;color:var(--acc);font-style:normal;width:64px}}
.step b{{font:700 38px D;flex:1}}
.step small{{font:500 26px I;color:var(--mut)}}
"""


def frame(theme, idx, total, inner, foot=None):
    cnt = f'<span class="cnt">{idx:02d} / {total:02d}</span>' if total > 1 else ""
    foot = foot or '<span>proqen.com</span><span>Custom software · India</span>'
    return f"""<!doctype html><html><head><meta charset="utf-8"><style>{CSS}</style></head>
<body><div class="f {theme}"><div class="top"><div class="logo"><i>P</i>ProQen</div>{cnt}</div>
{inner}<div class="bot">{foot}</div></div></body></html>"""


# ---------- layouts ----------
def L_cover(s, i, n):
    swipe = '<div class="swipe" style="margin-top:56px"><b>→</b>Swipe</div>' if n > 1 else ""
    inner = f"""<div class="grow"><div><span class="kick">{e(s.get('kicker',''))}</span></div>
<h1>{rich(s['title'])}</h1><p class="sub">{rich(s.get('sub',''))}</p>{swipe}</div>"""
    return frame(s.get("theme", "dark"), i, n, inner)


def L_point(s, i, n):
    tip = f'<div class="tip"><span>{e(s.get("tip_label","Fix →"))}</span><div>{rich(s["tip"])}</div></div>' if s.get("tip") else ""
    inner = f"""<div class="grow"><div class="num">{e(s.get('num',''))}</div>
<h2 style="margin-top:44px">{rich(s['title'])}</h2><p class="body">{rich(s['body'])}</p>{tip}</div>"""
    return frame(s.get("theme", "light"), i, n, inner)


def L_steps(s, i, n):
    items = "".join(f'<div class="step"><i>{k+1:02d}</i><b>{e(t)}</b><small>{e(d)}</small></div>'
                    for k, (t, d) in enumerate(s["items"]))
    inner = f"""<div class="grow"><span class="kick">{e(s.get('kicker',''))}</span>
<h2>{rich(s['title'])}</h2><div class="steps">{items}</div></div>"""
    return frame(s.get("theme", "light"), i, n, inner)


def L_cta(s, i, n):
    inner = f"""<div class="grow"><span class="kick">{e(s.get('kicker','Your turn'))}</span>
<h1 style="font-size:96px">{rich(s['title'])}</h1><p class="sub">{rich(s.get('sub',''))}</p>
<div class="row"><span class="pill">💬 WhatsApp +91 94531 26836</span><span class="pill">🌐 proqen.com</span></div>
<div class="swipe" style="margin-top:48px"><b>✦</b>Save this post · Share with a business owner</div></div>"""
    return frame("dark", i, n, inner)


def L_sheet_vs(s, i, n):
    inner = f"""<div style="margin-top:56px"><span class="kick">{e(s.get('kicker',''))}</span>
<h2 style="font-size:84px">{rich(s['title'])}</h2></div>
<div style="position:relative;margin-top:52px;display:grid;grid-template-columns:1fr 1fr;gap:28px">
 <div class="mock" style="padding:26px;transform:rotate(-2deg)">
  <div style="font:600 22px I;color:#1D6F42;margin-bottom:14px">▦ orders_FINAL_v3 (2).xlsx</div>
  <table class="xl"><tr><td>Party</td><td>Amt</td><td>Paid?</td></tr><tr><td>Sharma</td><td>18400</td><td>??</td></tr>
  <tr><td>Gupta</td><td>9,250</td><td>no</td></tr><tr><td>Mehta</td><td>#REF!</td><td></td></tr><tr><td>Rao</td><td>4400</td><td>yes?</td></tr></table>
  <div class="sticky" style="left:-14px;bottom:-60px;transform:rotate(-5deg)">Stock count doesn't<br>match AGAIN</div>
 </div>
 <div class="mock" style="padding:26px;background:#F0EFFF">
  <div style="font:700 22px I;color:var(--acc);margin-bottom:14px">● ProQen dashboard</div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
   <div class="kpi"><small>Today's sales</small><b>₹48,250</b><em>+12%</em></div>
   <div class="kpi"><small>Pending dues</small><b>₹18,400</b><em>reminder sent</em></div>
   <div class="kpi"><small>Orders</small><b>126</b><em>+8</em></div>
   <div class="kpi"><small>Low stock</small><b>3 items</b><em>auto PO ready</em></div>
  </div></div>
</div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:28px;margin-top:84px;font:700 30px I">
 <div style="color:var(--bad)">✕ Before</div><div style="color:var(--acc)">✓ With ProQen</div></div>"""
    return frame("light", i, n, inner)


def L_pos(s, i, n):
    lines = "".join(f'<div class="l"><span>{e(a)}</span><span>{e(b)}</span></div>' for a, b in s["lines"])
    inner = f"""<div style="display:grid;grid-template-columns:1.05fr .95fr;gap:52px;align-items:center;flex:1">
<div><span class="kick">{e(s.get('kicker',''))}</span><h2>{rich(s['title'])}</h2><p class="sub" style="font-size:34px">{rich(s.get('sub',''))}</p>
<div class="row" style="margin-top:36px">{''.join(f'<span class="pill" style="font-size:25px;padding:12px 22px">{e(t)}</span>' for t in s.get('tags',[]))}</div></div>
<div class="mock rcpt" style="padding:40px 38px;transform:rotate(2deg)">
 <div style="font:800 34px D;text-align:center">TABLE 7</div><div style="text-align:center;font:500 22px I;color:var(--mut);margin:6px 0 18px">KOT #0482 · 8:42 PM</div>
 {lines}<div class="l" style="border:none;font:800 40px D;padding-top:22px"><span>TOTAL</span><span>{e(s['total'])}</span></div>
 <div style="margin-top:18px;background:var(--ok);color:#fff;text-align:center;border-radius:16px;padding:16px;font:700 28px I">Paid via UPI ✓</div>
</div></div>"""
    return frame("dark", i, n, inner)


def L_chat(s, i, n):
    msgs = ""
    for who, text in s["chat"]:
        if who == "buttons":
            msgs += '<div class="btns">' + "".join(f"<span>{e(b)}</span>" for b in text) + "</div>"
        else:
            msgs += f'<div class="msg {"me" if who=="me" else "them"}">{e(text)}</div>'
    inner = f"""<div style="margin-top:36px"><span class="kick">{e(s.get('kicker',''))}</span><h2 style="font-size:70px">{rich(s['title'])}</h2></div>
<div class="chat" style="margin-top:40px">{msgs}</div>
<p class="sub" style="font-size:30px;margin-top:28px">{rich(s.get('sub',''))}</p>"""
    return frame("light", i, n, inner)


LAYOUTS = {k[2:]: v for k, v in globals().items() if k.startswith("L_")}


def main():
    args = sys.argv[1:]
    posts = json.loads((ROOT / "content" / "posts.json").read_text())
    only = set(args[args.index("--only") + 1:]) if "--only" in args else None
    manifest = []
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
        for post in posts:
            pid, slides = post["id"], post["slides"]
            d = ROOT / "queue" / pid
            files = [f"queue/{pid}/{k+1}.jpg" for k in range(len(slides))]
            need = "--all" in args or (only and pid in only) or (not only and not all((ROOT / f).exists() for f in files))
            if need:
                d.mkdir(parents=True, exist_ok=True)
                for old in d.glob("*.jpg"):
                    old.unlink()
                for k, s in enumerate(slides):
                    pg.set_content(LAYOUTS[s["layout"]](s, k + 1, len(slides)), wait_until="load")
                    pg.evaluate("document.fonts.ready")
                    pg.screenshot(path=str(ROOT / files[k]), type="jpeg", quality=92)
                print("rendered", pid, len(slides), "slide(s)")
            manifest.append({"id": pid, "type": "carousel" if len(slides) > 1 else "image",
                             "images": files, "caption": post["caption"]})
        b.close()
    (ROOT / "queue" / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False))
    print("manifest:", len(manifest), "posts")


if __name__ == "__main__":
    main()
