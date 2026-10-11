# OpenGate

A public index of open source projects released in the last 30 days, refreshed every morning.

**Live:** https://nosselil.github.io/opengate/

## Where projects come from

| Source | What qualifies |
| --- | --- |
| GitHub | Repos created in the last 30 days with 100+ stars (forks excluded) |
| Show HN | Show HN posts linking a GitHub repo, 20+ points |
| Product Hunt | Launches in the Open Source topic with a GitHub link, 50+ votes |
| Community | [Submit a project](https://github.com/nosselil/opengate/issues/new?template=submit.yml); it goes live once a maintainer adds the `approved` label |

Projects stay listed for 45 days. "Rising" ranks by stars per day, measured from daily snapshots once a week of history exists.

## How it works

- `scripts/fetch.mjs` pulls every source, merges by repo and writes `data/projects.json` (Node 20+, no dependencies).
- `.github/workflows/refresh.yml` runs it daily at 10:00 UTC, commits the data and deploys the static site to GitHub Pages.
- The site is plain HTML/CSS/JS: `index.html`, `styles.css`, `tokens.css`, `app.js`.

Run locally:

```sh
GITHUB_TOKEN=$(gh auth token) PRODUCTHUNT_TOKEN=... node scripts/fetch.mjs
python3 -m http.server 8742
```

MIT licensed.
