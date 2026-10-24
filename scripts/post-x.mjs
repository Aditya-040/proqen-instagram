// Mirrors the latest Instagram post to X (Twitter), using the same images.
// Runs in GitHub Actions right after scripts/post.mjs. Needs four repo secrets (OAuth 1.0a, Read and write):
//   X_API_KEY, X_API_SECRET (the app's "Consumer Keys")
//   X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET (your account's "Access Token and Secret")
// If they're missing, it skips with a warning so Instagram posting is never affected.
//
// Which post: the item Instagram posted most recently (state/posted.json). Old posts are never backfilled.
// Text: a post's optional "x_text" in content/posts.json, otherwise a short version of the Instagram caption.
// Images: X allows 4 per post, so a carousel with more slides continues as a reply thread (4 images per reply).
// Cost note (X pay-per-use): a post containing a link costs much more than one without, so by default the text
// has no URL (the slides already show proqen.com). Set repo variable X_INCLUDE_LINK=true to add proqen.com.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHmac, randomBytes } from "node:crypto";

const clean = (v) => (v || "").trim().replace(/^["']|["']$/g, "").trim();
const KEY = clean(process.env.X_API_KEY);
const KEY_SECRET = clean(process.env.X_API_SECRET);
const TOKEN = clean(process.env.X_ACCESS_TOKEN);
const TOKEN_SECRET = clean(process.env.X_ACCESS_TOKEN_SECRET);
const DRY = process.env.DRY_RUN === "true";
const INCLUDE_LINK = process.env.X_INCLUDE_LINK === "true";
const SECRETS = [KEY, KEY_SECRET, TOKEN, TOKEN_SECRET].filter(Boolean);
for (const s of SECRETS) console.log(`::add-mask::${s}`);

const STATE_FILE = "state/x-posted.json";
const igState = JSON.parse(readFileSync("state/posted.json", "utf8"));
const manifest = JSON.parse(readFileSync("queue/manifest.json", "utf8"));
const content = JSON.parse(readFileSync("content/posts.json", "utf8"));
const state = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf8")) : { posted: [] };
const save = () => writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + "\n");

const redact = (m) => SECRETS.reduce((s, x) => s.replaceAll(x, "***"), String(m));
function fail(msg) { console.log("::error title=X post failed::" + redact(msg).replace(/\n/g, " ")); process.exit(1); }
const warn = (msg) => console.log("::warning::" + redact(msg));

// ---------- OAuth 1.0a ----------
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
function authHeader(method, url) {
  // JSON and multipart bodies are not part of the signature; only the oauth_* params are.
  const p = {
    oauth_consumer_key: KEY, oauth_nonce: randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1", oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: TOKEN, oauth_version: "1.0",
  };
  const params = Object.keys(p).sort().map((k) => `${enc(k)}=${enc(p[k])}`).join("&");
  const base = [method, enc(url), enc(params)].join("&");
  p.oauth_signature = createHmac("sha1", `${enc(KEY_SECRET)}&${enc(TOKEN_SECRET)}`).update(base).digest("base64");
  return "OAuth " + Object.keys(p).sort().map((k) => `${enc(k)}="${enc(p[k])}"`).join(", ");
}

async function x(url, body, isForm) {
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: authHeader("POST", url), ...(isForm ? {} : { "Content-Type": "application/json" }) },
    body: isForm ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok || !json.data) {
    let hint = "";
    if (res.status === 401) hint = " (check the 4 X secrets; regenerate the Access Token after setting app permissions to Read and write)";
    if (res.status === 403) hint = " (app needs 'Read and write' permission, and the account needs API credits)";
    if (res.status === 402) hint = " (no API credits left: top up in the X Developer Console)";
    throw new Error(`${url} → HTTP ${res.status}${hint}: ${JSON.stringify(json.errors || json.detail || json)}`);
  }
  return json.data;
}

async function uploadImage(path) {
  const form = new FormData();
  form.append("media", new Blob([readFileSync(path)], { type: "image/jpeg" }), path.split("/").pop());
  form.append("media_category", "tweet_image");
  const d = await x("https://api.x.com/2/media/upload", form, true);
  return d.id;
}

// ---------- Text ----------
// Approximation of X's weighted length: Latin & common punctuation count 1, everything else (emoji, CJK…) counts 2,
// URLs count 23. Overcounting is safe; it just trims a little earlier.
function xLength(s) {
  let n = 0;
  const urls = s.match(/\b(?:https?:\/\/)?[a-z0-9-]+\.(?:com|in|io|dev|net|org)(?:\/\S*)?/gi) || [];
  for (const u of urls) { s = s.replace(u, ""); n += 23; }
  for (const ch of s) {
    const c = ch.codePointAt(0);
    n += (c <= 4351 || (c >= 8192 && c <= 8205) || (c >= 8208 && c <= 8223) || (c >= 8242 && c <= 8247)) ? 1 : 2;
  }
  return n;
}

function buildText(post) {
  const custom = content.find((p) => p.id === post.id)?.x_text;
  if (custom) return custom.trim();

  const paras = post.caption.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  // Hashtags come from the caption's hashtag block only (so "the #1 fear" isn't picked up).
  const tags = paras.filter((p) => p.startsWith("#")).join(" ").match(/#[a-z]\w*/gi) || [];
  const pick = [...tags.filter((t) => t !== "#proqen").slice(0, 2), "#proqen"].join(" ");
  // Body paragraphs only: drop Instagram-only lines (comment keyword, save/share, link line, hashtag block).
  const body = paras.filter((p) =>
    !p.startsWith("#") && !/comment\s+["“]/i.test(p) && !/^(save|share|follow)\b/i.test(p) && !/proqen\.com/i.test(p));
  const footer = ["💬 WhatsApp +91 94531 26836", INCLUDE_LINK ? "🌐 proqen.com" : null].filter(Boolean).join("\n");

  const compose = (parts) => [parts.join("\n\n"), footer, pick].filter(Boolean).join("\n\n");
  let parts = [];
  for (const p of body) { if (xLength(compose([...parts, p])) <= 280) parts.push(p); else break; }
  // Don't end on a lead-in line ("Here's how we work:") whose list didn't fit.
  while (parts.length > 1 && /:$/.test(parts.at(-1))) parts.pop();
  if (!parts.length) {
    // Even the hook is too long: cut it at a word boundary.
    let hook = body[0] || "";
    while (hook && xLength(compose([hook + "…"])) > 280) hook = hook.replace(/\s*\S+$/, "");
    parts = [hook + "…"];
  }
  return compose(parts);
}

// ---------- Main ----------
async function main() {
  const latest = igState.posted.at(-1);
  if (!latest) return console.log("Nothing has been posted to Instagram yet. Nothing to mirror.");
  const post = manifest.find((p) => p.id === latest.id);
  if (!post) fail(`Instagram post ${latest.id} isn't in queue/manifest.json.`);

  let entry = state.posted.find((p) => p.id === post.id);
  if (entry?.done) return console.log(`${post.id} is already on X. Nothing to do.`);

  const text = buildText(post);
  const groups = [];
  for (let i = 0; i < post.images.length; i += 4) groups.push(post.images.slice(i, i + 4));
  console.log(`Mirroring ${post.id} to X: ${post.images.length} image(s) in ${groups.length} post(s). Text (${xLength(text)}/280):\n${text}`);
  if (DRY) return;
  if (SECRETS.length < 4) return warn("X secrets not set (X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET). Skipping X.");
  if (xLength(text) > 280) fail(`Text for ${post.id} is over 280 characters. Shorten its x_text.`);

  // Resume a half-finished thread instead of starting over (so retries never duplicate posts).
  if (!entry) { entry = { id: post.id, date: latest.date, tweet_ids: [] }; state.posted.push(entry); }
  for (let i = entry.tweet_ids.length; i < groups.length; i++) {
    const media_ids = [];
    for (const img of groups[i]) media_ids.push(await uploadImage(img));
    const body = { media: { media_ids } };
    if (i === 0) body.text = text;
    else body.reply = { in_reply_to_tweet_id: entry.tweet_ids[i - 1] };
    const d = await x("https://api.x.com/2/tweets", body);
    entry.tweet_ids.push(d.id);
    save();
    console.log(`  posted ${i + 1}/${groups.length} → https://x.com/i/status/${d.id}`);
  }
  entry.done = true;
  save();
  console.log(`✅ ${post.id} is live on X.`);
}

main().catch((e) => { save(); fail(e.message); });
