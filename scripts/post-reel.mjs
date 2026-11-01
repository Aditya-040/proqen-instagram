// Publishes a scheduled "special" (a Reel) from specials/specials.json to Instagram, then mirrors it to X as a video.
// Started by .github/workflows/post-special.yml when trigger-special/request.txt is pushed. The id to post is the
// last word in that file (or the REEL_ID input of a manual run). This is separate from the daily image poster:
// it never reads or writes state/posted.json, so the 7:15 PM daily post still goes out as usual.
// State: state/specials-posted.json. Secrets: IG_USER_ID, IG_ACCESS_TOKEN (+ the four X_* secrets for X).
import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { createHmac, randomBytes } from "node:crypto";

const clean = (v) => (v || "").trim().replace(/^["']|["']$/g, "").trim();
const API = "https://graph.instagram.com/v23.0";
const USER = clean(process.env.IG_USER_ID);
const TOKEN = clean(process.env.IG_ACCESS_TOKEN);
const REPO = process.env.GITHUB_REPOSITORY;
const BRANCH = process.env.GITHUB_REF_NAME || "main";
const DRY = process.env.DRY_RUN === "true";
const XK = [process.env.X_API_KEY, process.env.X_API_SECRET, process.env.X_ACCESS_TOKEN, process.env.X_ACCESS_TOKEN_SECRET].map(clean);
const SECRETS = [TOKEN, ...XK].filter(Boolean);
for (const s of SECRETS) console.log(`::add-mask::${s}`);

const STATE_FILE = "state/specials-posted.json";
const state = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf8")) : { posted: [] };
const save = () => writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + "\n");
const redact = (m) => SECRETS.reduce((s, x) => s.replaceAll(x, "***"), String(m));
function fail(msg) { save(); console.log("::error title=Reel post failed::" + redact(msg).replace(/\n/g, " ")); process.exit(1); }
const warn = (m) => console.log("::warning::" + redact(m));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rawUrl = (p) => `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${p}`;

const specials = JSON.parse(readFileSync("specials/specials.json", "utf8"));
const reqId = clean(process.env.REEL_ID) || (existsSync("trigger-special/request.txt")
  ? readFileSync("trigger-special/request.txt", "utf8").trim().split(/\s+/).pop() : "");
const post = specials.find((p) => p.id === reqId);
if (!post) fail(`No special with id "${reqId}" in specials/specials.json.`);

// ---------- Instagram ----------
async function ig(method, path, params = {}) {
  const body = new URLSearchParams({ ...params, access_token: TOKEN });
  const res = method === "GET" ? await fetch(API + path + "?" + body) : await fetch(API + path, { method, body });
  const json = await res.json();
  if (!res.ok || json.error) throw new Error(`${path}: ${JSON.stringify(json.error || json)}`);
  return json;
}
async function waitReady(id, minutes = 8) {
  for (let i = 0; i < minutes * 12; i++) {
    const { status_code, status } = await ig("GET", `/${id}`, { fields: "status_code,status" });
    if (status_code === "FINISHED") return true;
    if (status_code === "ERROR" || status_code === "EXPIRED") { warn(`container ${id} ${status_code}: ${status || ""}`); return false; }
    await sleep(5000);
  }
  throw new Error(`video container ${id} not ready after ${minutes} minutes`);
}
async function createReel() {
  const base = { media_type: "REELS", caption: post.caption, share_to_feed: "true", thumb_offset: String(post.thumb_offset_ms || 0) };
  // 1) Let Instagram fetch the video from the public repo URL.
  const c = await ig("POST", `/${USER}/media`, { ...base, video_url: rawUrl(post.video) });
  if (await waitReady(c.id)) return c.id;
  // 2) Fallback: upload the file bytes directly (resumable upload).
  console.log("URL fetch failed, uploading the video file directly…");
  const r = await ig("POST", `/${USER}/media`, { ...base, upload_type: "resumable" });
  const bytes = readFileSync(post.video);
  const up = await fetch(r.uri || `https://rupload.facebook.com/ig-api-upload/v23.0/${r.id}`, {
    method: "POST", headers: { Authorization: `OAuth ${TOKEN}`, offset: "0", file_size: String(bytes.length) }, body: bytes });
  if (!up.ok) throw new Error(`direct upload failed: HTTP ${up.status} ${redact(await up.text())}`);
  if (await waitReady(r.id)) return r.id;
  throw new Error("Instagram could not process the video (both URL and direct upload failed).");
}

// ---------- X (video, chunked upload) ----------
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
function xAuth(method, url, query = {}) {
  const [KEY, KEY_SECRET, XTOKEN, XTOKEN_SECRET] = XK;
  const p = { oauth_consumer_key: KEY, oauth_nonce: randomBytes(16).toString("hex"), oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)), oauth_token: XTOKEN, oauth_version: "1.0" };
  const all = { ...p, ...query };
  const params = Object.keys(all).sort().map((k) => `${enc(k)}=${enc(all[k])}`).join("&");
  p.oauth_signature = createHmac("sha1", `${enc(KEY_SECRET)}&${enc(XTOKEN_SECRET)}`).update([method, enc(url), enc(params)].join("&")).digest("base64");
  return "OAuth " + Object.keys(p).sort().map((k) => `${enc(k)}="${enc(p[k])}"`).join(", ");
}
async function x(method, url, { json, form, query } = {}) {
  const qs = query ? "?" + new URLSearchParams(query) : "";
  const res = await fetch(url + qs, { method, headers: { Authorization: xAuth(method, url, query || {}), ...(json ? { "Content-Type": "application/json" } : {}) },
    body: json ? JSON.stringify(json) : form });
  const text = await res.text(); let j; try { j = JSON.parse(text); } catch { j = { raw: text }; }
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}: ${JSON.stringify(j.errors || j.detail || j)}`);
  return j.data || j;
}
async function mirrorToX(entry) {
  if (XK.some((k) => !k)) return warn("X secrets not set. Skipping X.");
  if (entry.x_done) return console.log("Already on X.");
  const bytes = readFileSync(post.video);
  const init = await x("POST", "https://api.x.com/2/media/upload/initialize", { json: { media_type: "video/mp4", total_bytes: bytes.length, media_category: "tweet_video" } });
  const id = init.id;
  const CH = 4 * 1024 * 1024;
  for (let i = 0, seg = 0; i < bytes.length; i += CH, seg++) {
    const form = new FormData();
    form.append("media", new Blob([bytes.subarray(i, i + CH)], { type: "video/mp4" }), "reel.mp4");
    form.append("segment_index", String(seg));
    await x("POST", `https://api.x.com/2/media/upload/${id}/append`, { form });
  }
  let fin = await x("POST", `https://api.x.com/2/media/upload/${id}/finalize`, {});
  for (let i = 0; i < 60 && fin.processing_info && !["succeeded", "failed"].includes(fin.processing_info.state); i++) {
    await sleep((fin.processing_info.check_after_secs || 3) * 1000);
    fin = await x("GET", "https://api.x.com/2/media/upload", { query: { command: "STATUS", media_id: id } });
  }
  if (fin.processing_info?.state === "failed") throw new Error("X failed to process the video: " + JSON.stringify(fin.processing_info));
  const tw = await x("POST", "https://api.x.com/2/tweets", { json: { text: post.x_text || post.caption.slice(0, 250), media: { media_ids: [id] } } });
  entry.x_done = true; entry.tweet_id = tw.id; save();
  console.log(`✅ ${post.id} is live on X → https://x.com/i/status/${tw.id}`);
}

// ---------- Main ----------
async function main() {
  let entry = state.posted.find((p) => p.id === post.id);
  console.log(`Special ${post.id}: ${post.video} (${(statSync(post.video).size / 1e6).toFixed(1)} MB)\nCaption:\n${post.caption}`);
  if (DRY) return console.log("Dry run: video URL " + rawUrl(post.video));
  if (!USER || !TOKEN) fail("Missing IG_USER_ID or IG_ACCESS_TOKEN secret.");
  if (!entry?.media_id) {
    const creation = await createReel();
    const pub = await ig("POST", `/${USER}/media_publish`, { creation_id: creation });
    entry = { id: post.id, media_id: pub.id, date: new Date().toISOString() };
    state.posted.push(entry); save();
    console.log(`✅ Published reel ${post.id} to Instagram → media id ${pub.id}`);
  } else console.log(`${post.id} is already on Instagram (media ${entry.media_id}).`);
  try { await mirrorToX(entry); } catch (e) { warn("X mirror failed (Instagram is fine): " + e.message); }
  save();
}
main().catch((e) => fail(e.message));
