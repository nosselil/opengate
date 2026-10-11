// OpenGate data refresh. Pulls new open source projects from GitHub, Show HN,
// Product Hunt and approved community submissions, merges them by repo, and
// writes data/projects.json. Node 20+, no dependencies.
//
// Env: GITHUB_TOKEN (required), PRODUCTHUNT_TOKEN (optional),
//      GITHUB_REPOSITORY (owner/repo hosting submission issues; optional locally)

import { readFile, writeFile } from 'node:fs/promises';

const WINDOW_DAYS = 30;     // how far back "lately" goes
const MIN_STARS = 100;      // traction bar for GitHub discovery
const HN_MIN_POINTS = 20;
const PH_MIN_VOTES = 50;
const KEEP_DAYS = 45;       // drop entries older than this
const OUT = new URL('../data/projects.json', import.meta.url);

const GH = process.env.GITHUB_TOKEN;
const PH = process.env.PRODUCTHUNT_TOKEN;
const SUBMIT_REPO = process.env.GITHUB_REPOSITORY || 'nosselil/opengate';
if (!GH) throw new Error('GITHUB_TOKEN is required');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const day = d => d.toISOString().slice(0, 10);
const now = new Date();
const today = day(now);
const daysAgo = n => new Date(now.getTime() - n * 864e5);

async function gh(path, { retries = 3 } = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: { Authorization: `Bearer ${GH}`, Accept: 'application/vnd.github+json', 'User-Agent': 'opengate' },
  });
  if ((res.status === 403 || res.status === 429) && retries > 0) {
    const reset = Number(res.headers.get('x-ratelimit-reset')) * 1000;
    const wait = Math.min(Math.max(reset - Date.now(), 5000), 65000);
    console.warn(`rate limited on ${path}, waiting ${Math.round(wait / 1000)}s`);
    await sleep(wait);
    return gh(path, { retries: retries - 1 });
  }
  if (res.status === 404 || res.status === 451) return null;
  if (!res.ok) throw new Error(`GitHub ${res.status} on ${path}`);
  return res.json();
}

// Extract owner/repo from any text containing a github.com link.
const SKIP_OWNERS = new Set(['features', 'sponsors', 'orgs', 'topics', 'marketplace', 'apps', 'settings', 'login', 'about']);
function repoFrom(text) {
  if (!text) return null;
  const m = String(text).match(/github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)/);
  if (!m || SKIP_OWNERS.has(m[1].toLowerCase())) return null;
  return `${m[1]}/${m[2].replace(/\.git$/, '').replace(/[.]+$/, '')}`;
}

function slim(r) {
  return {
    id: r.full_name.toLowerCase(),
    name: r.name,
    owner: r.owner.login,
    avatar: r.owner.avatar_url,
    url: r.html_url,
    desc: (r.description || '').slice(0, 280),
    lang: r.language || null,
    topics: (r.topics || []).slice(0, 8),
    stars: r.stargazers_count,
    forks: r.forks_count,
    license: r.license?.spdx_id && r.license.spdx_id !== 'NOASSERTION' ? r.license.spdx_id : null,
    homepage: r.homepage || null,
    created: r.created_at.slice(0, 10),
    pushed: r.pushed_at?.slice(0, 10) || null,
    archived: !!r.archived,
  };
}

// ── Sources ──────────────────────────────────────────────────────────────

async function fromGitHub() {
  const out = [];
  for (let i = 0; i <= WINDOW_DAYS; i++) {
    const d = day(daysAgo(i));
    for (let page = 1; page <= 3; page++) {
      const q = encodeURIComponent(`created:${d} stars:>=${MIN_STARS} fork:false`);
      const res = await gh(`/search/repositories?q=${q}&sort=stars&order=desc&per_page=100&page=${page}`);
      await sleep(2200); // search API allows 30 req/min
      const items = res?.items || [];
      out.push(...items.map(slim));
      if (items.length < 100) break;
    }
  }
  console.log(`github: ${out.length} repos`);
  return out;
}

async function fromHN() {
  const since = Math.floor(daysAgo(WINDOW_DAYS).getTime() / 1000);
  const params = new URLSearchParams({
    tags: 'show_hn',
    numericFilters: `created_at_i>${since},points>=${HN_MIN_POINTS}`,
    hitsPerPage: '1000',
  });
  const res = await fetch(`https://hn.algolia.com/api/v1/search_by_date?${params}`);
  if (!res.ok) { console.warn(`hn: ${res.status}`); return []; }
  const { hits } = await res.json();
  const out = [];
  for (const h of hits) {
    const repo = repoFrom(h.url) || repoFrom(h.story_text);
    if (repo) out.push({ repo, hn: { id: h.objectID, points: h.points, comments: h.num_comments || 0, date: h.created_at.slice(0, 10), title: h.title.replace(/^Show HN:\s*/i, '') } });
  }
  console.log(`hn: ${out.length} repo launches`);
  return out;
}

const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';
let redirectFailures = 0;
async function resolveRedirect(url) {
  try {
    const res = await fetch(url, { redirect: 'manual', headers: { 'User-Agent': BROWSER_UA } });
    const loc = res.headers.get('location');
    if (!loc && redirectFailures++ === 0) console.warn(`ph: redirect not resolved (HTTP ${res.status})`);
    return loc;
  } catch (e) {
    if (redirectFailures++ === 0) console.warn(`ph: redirect failed (${e.message})`);
    return null;
  }
}

// PH hides GitHub links behind redirects that can be blocked from CI, so
// remember every resolved post -> repo pair.
const PH_CACHE = new URL('../data/ph-links.json', import.meta.url);

async function fromProductHunt() {
  if (!PH) { console.log('ph: no token, skipped'); return []; }
  const query = `query($after: String, $since: DateTime) {
    posts(topic: "open-source", order: VOTES, postedAfter: $since, first: 20, after: $after) {
      pageInfo { hasNextPage endCursor }
      edges { node { name tagline votesCount createdAt url productLinks { type url } } }
    } }`;
  const cache = JSON.parse(await readFile(PH_CACHE, 'utf8').catch(() => '{}'));
  const out = [];
  let after = null;
  for (let page = 0; page < 6; page++) {
    const res = await fetch('https://api.producthunt.com/v2/api/graphql', {
      method: 'POST',
      headers: { Authorization: `Bearer ${PH}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables: { after, since: daysAgo(WINDOW_DAYS).toISOString() } }),
    });
    if (!res.ok) { console.warn(`ph: ${res.status}`); break; }
    const { data, errors } = await res.json();
    if (errors) { console.warn('ph:', errors[0]?.message); break; }
    const posts = data.posts.edges.map(e => e.node);
    let belowBar = false;
    for (const p of posts) {
      if (p.votesCount < PH_MIN_VOTES) { belowBar = true; continue; }
      const link = p.productLinks?.find(l => /github/i.test(l.type));
      if (!link) continue;
      const postUrl = p.url.split('?')[0];
      const repo = cache[postUrl] || repoFrom(await resolveRedirect(link.url));
      if (!repo) continue;
      cache[postUrl] = repo;
      out.push({ repo, ph: { name: p.name, tagline: p.tagline, votes: p.votesCount, date: p.createdAt.slice(0, 10), url: postUrl } });
    }
    if (belowBar || !data.posts.pageInfo.hasNextPage) break;
    after = data.posts.pageInfo.endCursor;
  }
  await writeFile(PH_CACHE, JSON.stringify(cache, null, 1));
  console.log(`ph: ${out.length} repo launches`);
  return out;
}

async function fromSubmissions() {
  const issues = await gh(`/repos/${SUBMIT_REPO}/issues?labels=approved&state=all&per_page=100`);
  if (!issues) return [];
  const out = issues
    .filter(i => !i.pull_request)
    .map(i => ({ repo: repoFrom(i.body) || repoFrom(i.title), submitted: { issue: i.number, date: i.created_at.slice(0, 10) } }))
    .filter(s => s.repo);
  console.log(`submissions: ${out.length} approved`);
  return out;
}

// ── Merge ────────────────────────────────────────────────────────────────

async function main() {
  let prev = {};
  try {
    const old = JSON.parse(await readFile(OUT, 'utf8'));
    for (const p of old.projects) prev[p.id] = p;
  } catch { /* first run */ }

  const [ghRepos, hn, ph, subs] = [await fromGitHub(), await fromHN(), await fromProductHunt(), await fromSubmissions()];

  const byId = new Map(ghRepos.map(r => [r.id, { ...r, src: { github: true } }]));

  // Launch sources may point at older repos or repos under the star bar,
  // so look each one up individually.
  for (const launch of [...hn, ...ph, ...subs]) {
    const id = launch.repo.toLowerCase();
    let entry = byId.get(id);
    if (!entry) {
      const r = await gh(`/repos/${launch.repo}`);
      if (!r || r.fork || r.private) continue;
      entry = { ...slim(r), src: {} };
      byId.set(entry.id, entry);
    }
    const key = launch.hn ? 'hn' : launch.ph ? 'ph' : 'submitted';
    const val = launch[key];
    // keep the strongest signal when a repo is launched twice on one source
    if (!entry.src[key] || (val.points ?? val.votes ?? 0) > (entry.src[key].points ?? entry.src[key].votes ?? 0)) entry.src[key] = val;
  }

  // Carry over entries that fell out of today's search but are still recent.
  const cutoff = day(daysAgo(KEEP_DAYS));
  for (const [id, old] of Object.entries(prev)) {
    if (!byId.has(id) && launchDate(old) >= cutoff) byId.set(id, old);
  }

  const projects = [];
  for (const p of byId.values()) {
    const old = prev[p.id];
    p.firstSeen = old?.firstSeen || today;
    const hist = (old?.hist || []).filter(([d]) => d >= cutoff && d !== today);
    hist.push([today, p.stars]);
    p.hist = hist.slice(-KEEP_DAYS);
    p.launched = launchDate(p);
    p.velocity = velocity(p);
    if (p.launched >= cutoff && !p.archived) projects.push(p);
  }
  projects.sort((a, b) => b.velocity - a.velocity);

  const meta = {
    updated: now.toISOString(),
    count: projects.length,
    sources: {
      github: projects.filter(p => p.src.github).length,
      hn: projects.filter(p => p.src.hn).length,
      ph: projects.filter(p => p.src.ph).length,
      submitted: projects.filter(p => p.src.submitted).length,
    },
    rules: { windowDays: WINDOW_DAYS, minStars: MIN_STARS, hnMinPoints: HN_MIN_POINTS, phMinVotes: PH_MIN_VOTES },
  };
  await writeFile(OUT, JSON.stringify({ meta, projects }));
  console.log(`wrote ${projects.length} projects`, meta.sources);
}

// The date a project "came out": the earliest of repo creation and any launch.
function launchDate(p) {
  const dates = [p.created, p.src?.hn?.date, p.src?.ph?.date, p.src?.submitted?.date].filter(Boolean);
  // A repo created long ago but launched recently counts from its launch.
  const launches = dates.slice(1);
  return launches.length && p.created < day(daysAgo(WINDOW_DAYS)) ? launches.sort()[0] : p.created;
}

// Stars per day: measured from snapshots once a week of history exists,
// otherwise averaged since the repo was created.
function velocity(p) {
  const h = p.hist;
  if (h.length >= 7) {
    const [d0, s0] = h[h.length - 7];
    const [d1, s1] = h[h.length - 1];
    const span = (new Date(d1) - new Date(d0)) / 864e5 || 1;
    return Math.round(((s1 - s0) / span) * 10) / 10;
  }
  const age = Math.max(1, (now - new Date(p.created)) / 864e5);
  return Math.round((p.stars / age) * 10) / 10;
}

main().catch(e => { console.error(e); process.exit(1); });
