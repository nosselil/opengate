const PAGE = 50;
const SUBMIT = 'https://github.com/nosselil/opengate/issues/new?template=submit.yml';
const LANG_COLORS = {
  TypeScript: '#3178c6', JavaScript: '#e8d44d', Python: '#3572A5', Rust: '#dea584', Go: '#00ADD8',
  Java: '#b07219', 'C++': '#f34b7d', C: '#555555', 'C#': '#178600', Swift: '#F05138', Kotlin: '#A97BFF',
  Ruby: '#701516', PHP: '#4F5D95', Shell: '#89e051', HTML: '#e34c26', CSS: '#663399', Vue: '#41b883',
  Svelte: '#ff3e00', Dart: '#00B4AB', Zig: '#ec915c', Lua: '#000080', 'Jupyter Notebook': '#DA5B0B',
  Elixir: '#6e4a7e', Haskell: '#5e5086', Scala: '#c22d40', Nix: '#7e7eff', MDX: '#fcb32c', Lean: '#7a7a7a',
};

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = n => n >= 10000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
const daysAgo = d => Math.max(0, Math.floor((Date.now() - new Date(d)) / 864e5));
const rel = d => { const n = daysAgo(d); return n === 0 ? 'today' : n === 1 ? '1 day ago' : `${n} days ago`; };
// Units show on phones only, where the column header is hidden.
const unit = u => `<span class="unit">${u}</span>`;
const perDay = p => p.velocity >= 1
  ? `<span class="row__metric">+${fmt(Math.round(p.velocity))}${unit('/day')}</span>`
  : `<span class="row__metric row__metric--flat">&lt;1${unit('/day')}</span>`;

// Each tab is a cut of the same list: a filter, an order and the right-hand metric.
const VIEWS = {
  rising:    { label: 'Per day',  filter: () => true, sort: (a, b) => b.velocity - a.velocity, metric: perDay },
  stars:     { label: 'Per day',  filter: () => true, sort: (a, b) => b.stars - a.stars, metric: perDay },
  newest:    { label: 'Released', filter: () => true, sort: (a, b) => b.launched.localeCompare(a.launched) || b.stars - a.stars,
               metric: p => `<span class="row__metric row__metric--flat">${rel(p.launched)}</span>` },
  hn:        { label: 'HN points', filter: p => p.src.hn, sort: (a, b) => b.src.hn.points - a.src.hn.points,
               metric: p => `<span class="row__metric">${p.src.hn.points}${unit(' pts')}</span>` },
  ph:        { label: 'PH votes', filter: p => p.src.ph, sort: (a, b) => b.src.ph.votes - a.src.ph.votes,
               metric: p => `<span class="row__metric">${p.src.ph.votes}${unit(' votes')}</span>` },
  community: { label: 'Added', filter: p => p.src.submitted, sort: (a, b) => b.src.submitted.date.localeCompare(a.src.submitted.date),
               metric: p => `<span class="row__metric row__metric--flat">${rel(p.src.submitted.date)}</span>` },
};

const state = { q: '', view: 'rising', lang: '', shown: PAGE };
let all = [];

function readUrl() {
  const p = new URLSearchParams(location.search);
  state.q = p.get('q') || '';
  state.view = VIEWS[p.get('view')] ? p.get('view') : 'rising';
  state.lang = p.get('lang') || '';
}
function writeUrl() {
  const p = new URLSearchParams();
  if (state.q) p.set('q', state.q);
  if (state.view !== 'rising') p.set('view', state.view);
  if (state.lang) p.set('lang', state.lang);
  history.replaceState(null, '', p.size ? `?${p}` : location.pathname);
}

function row(p, i, view) {
  const chips = [
    p.src.hn && `<a class="chip chip--hn" href="https://news.ycombinator.com/item?id=${esc(p.src.hn.id)}" target="_blank" rel="noopener" title="Show HN: ${esc(p.src.hn.title)}">HN</a>`,
    p.src.ph && `<a class="chip chip--ph" href="${esc(p.src.ph.url)}" target="_blank" rel="noopener" title="${esc(p.src.ph.tagline)}">PH</a>`,
    p.src.submitted && `<a class="chip chip--community" href="https://github.com/nosselil/opengate/issues/${p.src.submitted.issue}" target="_blank" rel="noopener" title="Submitted by the community">Pick</a>`,
  ].filter(Boolean).join('');
  const desc = p.desc || p.src.ph?.tagline || p.src.hn?.title;
  return `<li class="row">
    <span class="row__rank">${i + 1}</span>
    <div class="row__main">
      <img src="${esc(p.avatar)}&s=72" alt="" width="36" height="36" loading="lazy">
      <div class="row__title">
        <a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.name)}</a>
        <span class="row__owner">${esc(p.owner)}</span>
        ${chips}
      </div>
      <p class="row__desc${desc ? '' : ' row__desc--none'}">${esc(desc || 'No description')}</p>
    </div>
    <span class="row__lang" style="--dot:${LANG_COLORS[p.lang] || 'var(--color-rule-2)'}">${esc(p.lang || '—')}</span>
    <span class="row__stats">
      <span class="row__stars" title="${p.stars.toLocaleString()} stars">★ ${fmt(p.stars)}</span>
      ${view.metric(p)}
    </span>
  </li>`;
}

function filtered() {
  const view = VIEWS[state.view];
  const words = state.q.toLowerCase().split(/\s+/).filter(Boolean);
  return all
    .filter(p => view.filter(p) && (!state.lang || p.lang === state.lang) && words.every(w => p._hay.includes(w)))
    .sort(view.sort);
}

function render() {
  const view = VIEWS[state.view];
  const ps = filtered();
  $('#list').innerHTML = ps.slice(0, state.shown).map((p, i) => row(p, i, view)).join('');
  $('#col-metric').textContent = view.label;
  $('#count').textContent = ps.length ? `Showing ${Math.min(state.shown, ps.length).toLocaleString()} of ${ps.length.toLocaleString()}` : '';
  $('#more').hidden = ps.length <= state.shown;

  const empty = $('#empty');
  empty.hidden = ps.length > 0;
  if (!ps.length) {
    empty.innerHTML = state.view === 'community' && !state.q && !state.lang
      ? `No community picks yet. <a href="${SUBMIT}" target="_blank" rel="noopener">Submit the first one</a>.`
      : `Nothing matches that. Try a broader word, or <a href="${SUBMIT}" target="_blank" rel="noopener">submit the project</a>.`;
  }

  document.querySelectorAll('.tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.view === state.view));
  $('#lang').value = state.lang;
  writeUrl();
}

function update(patch) {
  Object.assign(state, patch, { shown: PAGE });
  render();
}

function ago(iso) {
  const h = (Date.now() - new Date(iso)) / 36e5;
  if (h < 1) return 'less than an hour ago';
  if (h < 24) return `${Math.round(h)} hour${Math.round(h) === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

async function init() {
  readUrl();
  $('#q').value = state.q;
  $('#list').innerHTML = '<li class="skeleton"></li>'.repeat(10);

  let data;
  try {
    data = await (await fetch('data/projects.json', { cache: 'no-cache' })).json();
  } catch {
    $('#meta').textContent = 'The index failed to load. Refresh to try again.';
    $('#list').innerHTML = '';
    return;
  }
  all = data.projects.map(p => ({ ...p, _hay: `${p.name} ${p.owner} ${p.desc} ${p.topics.join(' ')} ${p.lang || ''} ${p.src.ph?.tagline || ''}`.toLowerCase() }));

  const s = data.meta.sources;
  $('#meta').innerHTML = `<strong>${data.meta.count.toLocaleString()}</strong> projects · updated ${ago(data.meta.updated)}`;
  const counts = { hn: s.hn, ph: s.ph, community: s.submitted };
  document.querySelectorAll('.tabs button').forEach(b => {
    if (b.dataset.view in counts) b.insertAdjacentHTML('beforeend', `<span class="tab-n">${counts[b.dataset.view]}</span>`);
  });

  const langs = Object.entries(all.reduce((m, p) => (p.lang && (m[p.lang] = (m[p.lang] || 0) + 1), m), {})).sort((a, b) => b[1] - a[1]);
  $('#lang').insertAdjacentHTML('beforeend', langs.map(([l, n]) => `<option value="${esc(l)}">${esc(l)} · ${n}</option>`).join(''));

  render();

  let t;
  $('#q').addEventListener('input', e => { clearTimeout(t); t = setTimeout(() => update({ q: e.target.value.trim() }), 120); });
  $('#lang').addEventListener('change', e => update({ lang: e.target.value }));
  $('.tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) update({ view: b.dataset.view }); });
  $('.tabs').addEventListener('keydown', e => {
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    const tabs = [...document.querySelectorAll('.tabs button')];
    const i = tabs.findIndex(b => b.dataset.view === state.view);
    const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
    next.focus();
    update({ view: next.dataset.view });
  });
  $('#more').addEventListener('click', () => { state.shown += PAGE; render(); });
  document.addEventListener('keydown', e => {
    if (e.key === '/' && !/input|select|textarea/i.test(document.activeElement.tagName)) { e.preventDefault(); $('#q').focus(); }
  });
}

init();
