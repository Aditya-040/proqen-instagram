# ProQen Instagram auto-poster

Posts one item a day to ProQen's Instagram (7:30 PM IST) via GitHub Actions.

- `content/posts.json`: post content (source of truth). Each post: `id` (p001, p002, …), `slides`, `caption`.
- `render/render.py`: renders slides to `queue/<id>/<n>.jpg` (1080×1350 JPEG) and writes `queue/manifest.json`.
  Run: `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers python3 render/render.py` (only renders posts without images).
- `scripts/post.mjs` + `.github/workflows/post.yml`: posts the next item not yet in `state/posted.json`.
- Never edit `state/posted.json` by hand, and never change or re-render posts that are already posted.

## Weekly refill (what the scheduled task does)

1. Count unposted items (manifest ids not in state/posted.json). If 7 or more remain, stop.
2. Add new posts at the end of `content/posts.json` until 7 are unposted. New id = highest existing number + 1 (ids are not in
   array order; posting order = array order). Alternate carousel / single image.
3. Read the existing posts first and do not repeat a topic or angle used in the last 21 posts.
4. Rendering: run render.py, then build a contact sheet and LOOK at it. Fix any text overflow (text hitting the footer, slides that are too crowded) by shortening copy, then re-render that post with `--only <id>`.
5. Commit and push to `main`.

## Content rules

- Audience: owners of restaurants, cafés, shops/kirana, hotels/homestays, clinics, schools and small businesses in India.
- ProQen services: websites & web apps, mobile apps, ERP/CRM & dashboards, e-commerce, POS & billing (offline, GST, KOT),
  hotel & hospitality (booking engine, room QR codes, front-desk apps), AI & WhatsApp automation, UI/UX design.
- Facts you may use: Noida, India; WhatsApp +91 94531 26836; support@proqen.com; proqen.com; fixed quote before starting;
  client owns source code; process Discover (2–3 days) → Design (1–2 wks) → Build (weekly demos) → Test → Launch & support;
  website 2–4 weeks, apps 6–12 weeks, ERP in phases.
- Never invent client names, testimonials, results, stats, prices or awards. Concept examples must read as examples.
- Mix: educational carousels (tips, signs, mistakes, checklists), product spotlights, relatable "before vs after" posts,
  festival/seasonal hooks when relevant (check the date). Each caption: hook line, short value, CTA (comment keyword or
  WhatsApp), proqen.com, 8–12 hashtags ending with #proqen.

## Brand voice & focus (set by the owner)

- Posts must clearly say who ProQen is and what it builds. At least 4 of every 7 posts are brand/service posts
  (a service spotlight, "why ProQen", industries we serve, a process or comparison that leads to a ProQen service);
  the rest can be tips/educational, always ending with how ProQen helps.
- Service priority: 1) websites & mobile/web apps, 2) POS & billing, 3) custom software (ERP/CRM/dashboards/internal tools),
  4) AI & WhatsApp automation. Hotel software, e-commerce and UI/UX appear less often.
- Language: English + Hinglish. Hinglish hook in titles/first caption line ("Google pe search kiya… aapka business dikha?",
  "Internet gaya? Billing chalu."), clear English for details. Indian context: GST, UPI, KOT, udhaar, kirana, WhatsApp, ₹.

## Layouts (see render.py)

- `cover` {kicker, title, sub, theme?} · `point` {num, title, body, tip?, tip_label?} · `steps` {kicker, title, items:[[t,d]]}
- `cta` {title, sub, kicker?} (use as last carousel slide) · `sheet_vs` {kicker, title}
- `pos` {kicker, title, sub, tags, lines:[[item,amt]], total} · `chat` {kicker, title, chat:[[me|them,text] | ["buttons",[..]]], sub}
- `grid` {kicker, title, items:[[emoji,title,desc]] (4–8), sub?, theme?} · `flow` {kicker, title, flow:[[emoji,title,desc]] (≤5), sub}
- `site` {kicker, title, domain, site_kicker, site_title, site_items:[3], tags} (website mockup)
- `app` {kicker, title, sub, tags, app_hello, app_title, app_card_label, app_card_value, app_rows:[[a,b]] (4)} (phone mockup)
- `point.num` may be an emoji instead of a number.
- `*word*` in titles = yellow highlight. Carousels: cover + 4–5 points + cta (max 10 slides).
- Keep titles ≤ ~45 characters for point slides and body ≤ ~140 characters.
