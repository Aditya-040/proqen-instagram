// Publishes the next unposted item from queue/manifest.json to Instagram.
// Runs in GitHub Actions. Needs secrets IG_USER_ID and IG_ACCESS_TOKEN.
// Optional secret GH_PAT (fine-grained token with "Secrets: read & write" on this repo)
// lets it save a refreshed Instagram token automatically.
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const API = "https://graph.instagram.com/v23.0";
const clean = (v) => (v || "").trim().replace(/^["']|["']$/g, "").trim();
const USER = clean(process.env.IG_USER_ID);
let TOKEN = clean(process.env.IG_ACCESS_TOKEN);
const REPO = process.env.GITHUB_REPOSITORY; // owner/name
const BRANCH = process.env.GITHUB_REF_NAME || "main";
const FORCE = process.env.FORCE === "true";
const DRY = process.env.DRY_RUN === "true";

if (!USER || !TOKEN) fail("Missing IG_USER_ID or IG_ACCESS_TOKEN secret.");
console.log(`::add-mask::${TOKEN}`);
console.log(`Token looks like: starts with "${TOKEN.slice(0, 4)}…", ${TOKEN.length} characters. User ID has ${USER.length} digits.`);
if (TOKEN.startsWith("EAA")) fail("IG_ACCESS_TOKEN is a Facebook token (starts with EAA). Generate the token under Instagram API > 'API setup with Instagram login' > 'Generate access tokens' instead; that one starts with IG.");

const manifest = JSON.parse(readFileSync("queue/manifest.json", "utf8"));
const state = JSON.parse(readFileSync("state/posted.json", "utf8"));
const todayIST = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);

function fail(msg) { msg = String(msg); if (TOKEN) msg = msg.replaceAll(TOKEN, "***"); console.log("::error title=Instagram post failed::" + msg.replace(/\n/g, " ")); process.exit(1); }
function warn(msg) { console.log("::warning::" + msg); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const imgUrl = (p) => `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${p}`;

async function ig(method, path, params = {}) {
  const url = new URL(API + path);
  const body = new URLSearchParams({ ...params, access_token: TOKEN });
  const res = method === "GET"
    ? await fetch(url + "?" + body)
    : await fetch(url, { method, body });
  const json = await res.json();
  if (!res.ok || json.error) throw new Error(`${path}: ${JSON.stringify(json.error || json)}`);
  return json;
}

async function waitReady(id) {
  for (let i = 0; i < 40; i++) {
    const { status_code } = await ig("GET", `/${id}`, { fields: "status_code" });
    if (status_code === "FINISHED") return;
    if (status_code === "ERROR" || status_code === "EXPIRED") throw new Error(`container ${id} ${status_code}`);
    await sleep(3000);
  }
  throw new Error(`container ${id} not ready after 2 minutes`);
}

async function refreshToken() {
  // Long-lived Instagram tokens last 60 days; refresh once a week to keep them alive.
  const res = await fetch(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${TOKEN}`);
  const j = await res.json();
  if (!j.access_token) { warn("Token refresh failed: " + JSON.stringify(j.error || j)); return; }
  console.log(`🔑 Token refreshed, valid ~${Math.round(j.expires_in / 86400)} more days.`);
  if (j.access_token !== TOKEN) {
    console.log(`::add-mask::${j.access_token}`);
    TOKEN = j.access_token;
    if (process.env.GH_PAT) {
      try {
        // token goes in via stdin, never on the command line (command lines can end up in logs)
        execFileSync("gh", ["secret", "set", "IG_ACCESS_TOKEN", "--repo", REPO], {
          input: TOKEN, env: { ...process.env, GH_TOKEN: process.env.GH_PAT }, stdio: ["pipe", "ignore", "pipe"] });
        console.log("🔑 Saved new token to repo secret.");
      } catch (err) {
        const why = String(err.stderr || "").replaceAll(TOKEN, "***").split("\n")[0];
        warn("Couldn't save the refreshed token (GH_PAT needs 'Secrets: Read and write' on this repo): " + why);
      }
    } else {
      warn("Instagram issued a new token string but GH_PAT isn't set, so it can't be saved. Update IG_ACCESS_TOKEN manually within 60 days.");
    }
  }
  state.lastRefresh = todayIST;
}

async function main() {
  const daysSinceRefresh = state.lastRefresh ? (Date.parse(todayIST) - Date.parse(state.lastRefresh)) / 864e5 : 99;
  if (!DRY && daysSinceRefresh >= 7) await refreshToken();

  if (state.lastDate === todayIST && !FORCE) {
    console.log(`Already posted today (${todayIST}). Nothing to do.`);
    return save();
  }
  const done = new Set(state.posted.map((p) => p.id));
  const post = manifest.find((p) => !done.has(p.id));
  if (!post) fail("Queue is empty: no unposted items left. Add more posts to content/posts.json.");
  const left = manifest.filter((p) => !done.has(p.id)).length - 1;
  console.log(`Posting ${post.id} (${post.type}, ${post.images.length} image(s)). ${left} left in queue after this.`);
  if (DRY) { post.images.forEach((p) => console.log("  ", imgUrl(p))); return; }

  let creationId;
  if (post.type === "image") {
    const c = await ig("POST", `/${USER}/media`, { image_url: imgUrl(post.images[0]), caption: post.caption });
    await waitReady(c.id); creationId = c.id;
  } else {
    const children = [];
    for (const p of post.images.slice(0, 10)) {
      const c = await ig("POST", `/${USER}/media`, { image_url: imgUrl(p), is_carousel_item: "true" });
      children.push(c.id);
    }
    for (const id of children) await waitReady(id);
    const parent = await ig("POST", `/${USER}/media`, { media_type: "CAROUSEL", children: children.join(","), caption: post.caption });
    await waitReady(parent.id); creationId = parent.id;
  }
  const pub = await ig("POST", `/${USER}/media_publish`, { creation_id: creationId });
  console.log(`✅ Published ${post.id} → media id ${pub.id}`);
  state.posted.push({ id: post.id, media_id: pub.id, date: todayIST });
  state.lastDate = todayIST;
  save();
  if (left < 3) warn(`Only ${left} post(s) left in the queue.`);
}

function save() { writeFileSync("state/posted.json", JSON.stringify(state, null, 2) + "\n"); }

main().catch((e) => { save(); fail(e.message); });
