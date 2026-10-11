const PAGE = 48;
const LANG_COLORS = {
  TypeScript: '#3178c6', JavaScript: '#f1e05a', Python: '#3572A5', Rust: '#dea584', Go: '#00ADD8',
  Java: '#b07219', 'C++': '#f34b7d', C: '#555555', 'C#': '#178600', Swift: '#F05138', Kotlin: '#A97BFF',
  Ruby: '#701516', PHP: '#4F5D95', Shell: '#89e051', HTML: '#e34c26', CSS: '#663399', Vue: '#41b883',
  Svelte: '#ff3e00', Dart: '#00B4AB', Zig: '#ec915c', Lua: '#000080', 'Jupyter Notebook': '#DA5B0B',
  Elixir: '#6e4a7e', Haskell: '#5e5086', Scala: '#c22d40', Nix: '#7e7eff', MDX: '#fcb32c',
};

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = n => n >= 10000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
const daysSince = d => (Date.now() - new Date(d)) / 864e5;

const state = { q: '', sort: 'velocity', source: '', lang: '', shown: PAGE };
let all = [];

function readUrl() {
  const p = new URLSearchParams(location.search);
  state.q = p.get('q') || '';
  state.sort = ['velocity', 'stars', 'newest'].includes(p.get('sort')) ? p.get('sort') : 'velocity';
  state.source = p.get('source') || '';
  state.lang = p.get('lang') || '';
}
function writeUrl() {
  const p = new URLSearchParams();
  if (state.q) p.set('q', state.q);
  if (state.sort !== 'velocity') p.set('sort', state.sort);
  if (state.source) p.set('source', state.source);
  if (state.lang) p.set('lang', state.lang);
  history.replaceState(null, '', p.size ? `?${p}` : location.pathname);
}

function card(p) {
  const badges = [
    p.src.hn && `<a class="badge badge--hn" href="https://news.ycombinator.com/item?id=${esc(p.src.hn.id)}" target="_blank" rel="noopener" title="Show HN: ${esc(p.src.hn.title)}">HN ${p.src.hn.points}</a>`,
    p.src.ph && `<a class="badge badge--ph" href="${esc(p.src.ph.url)}" target="_blank" rel="noopener" title="${esc(p.src.ph.tagline)}">PH ${p.src.ph.votes}</a>`,
    p.src.submitted && `<a class="badge badge--submitted" href="https://github.com/nosselil/opengate/issues/${p.src.submitted.issue}" target="_blank" rel="noopener">Community</a>`,
  ].filter(Boolean).join('');
  const desc = p.desc || p.src.ph?.tagline || p.src.hn?.title || 'No description yet.';
  return `<li><article class="card">
    <div class="card__top">
      <img src="${esc(p.avatar)}&s=56" alt="" width="28" height="28" loading="lazy">
      <div class="card__name">
        <a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.name)}</a>
        <span class="card__owner">${esc(p.owner)}</span>
      </div>
    </div>
    <p class="card__desc">${esc(desc)}</p>
    <div class="card__stats">
      <span class="stat-stars" title="${p.stars.toLocaleString()} stars">★ ${fmt(p.stars)}</span>
      ${p.velocity >= 1 ? `<span class="stat-up" title="stars per day">+${fmt(Math.round(p.velocity))}/day</span>` : ''}
      ${p.lang ? `<span class="lang-dot" style="--dot:${LANG_COLORS[p.lang] || 'var(--color-muted)'}">${esc(p.lang)}</span>` : ''}
      ${badges ? `<span class="badges">${badges}</span>` : ''}
    </div>
  </article></li>`;
}

const RAILS = [
  { title: 'Rising fastest this week', note: 'Created in the last 7 days, ranked by stars per day.',
    pick: ps => ps.filter(p => daysSince(p.launched) <= 7).sort((a, b) => b.velocity - a.velocity),
    see: { sort: 'velocity' } },
  { title: 'Fresh from Show HN', note: 'Launched on Hacker News, ranked by points.',
    pick: ps => ps.filter(p => p.src.hn).sort((a, b) => b.src.hn.points - a.src.hn.points),
    see: { source: 'hn', sort: 'stars' } },
  { title: 'Launched on Product Hunt', note: 'Open source launches, ranked by upvotes.',
    pick: ps => ps.filter(p => p.src.ph).sort((a, b) => b.src.ph.votes - a.src.ph.votes),
    see: { source: 'ph', sort: 'stars' } },
  { title: 'From the community', note: 'Submitted by readers and approved by hand.',
    pick: ps => ps.filter(p => p.src.submitted).sort((a, b) => b.src.submitted.date.localeCompare(a.src.submitted.date)),
    see: { source: 'submitted', sort: 'newest' } },
];

function renderRails() {
  $('#rails').innerHTML = RAILS.map((r, i) => {
    const items = r.pick(all).slice(0, 16);
    if (!items.length) return '';
    return `<section class="rail" aria-labelledby="rail-${i}">
      <div class="rail__head">
        <div><h2 id="rail-${i}">${r.title}</h2><p>${r.note}</p></div>
        <button class="rail__more" data-rail="${i}">See all →</button>
      </div>
      <ol class="rail__track">${items.map(card).join('')}</ol>
    </section>`;
  }).join('');
}

function filtered() {
  const words = state.q.toLowerCase().split(/\s+/).filter(Boolean);
  let ps = all.filter(p =>
    (!state.source || p.src[state.source]) &&
    (!state.lang || p.lang === state.lang) &&
    (!words.length || words.every(w => p._hay.includes(w))));
  const by = {
    velocity: (a, b) => b.velocity - a.velocity,
    stars: (a, b) => b.stars - a.stars,
    newest: (a, b) => b.launched.localeCompare(a.launched) || b.stars - a.stars,
  }[state.sort];
  return ps.sort(by);
}

function renderGrid() {
  const ps = filtered();
  $('#grid').innerHTML = ps.slice(0, state.shown).map(card).join('');
  $('#count').textContent = `${ps.length.toLocaleString()} project${ps.length === 1 ? '' : 's'}`;
  $('#empty').hidden = ps.length > 0;
  $('#more').hidden = ps.length <= state.shown;
  $('#rails').hidden = !!state.q;
  document.querySelectorAll('.seg button').forEach(b => b.setAttribute('aria-checked', b.dataset.sort === state.sort));
  $('#source').value = state.source;
  $('#lang').value = state.lang;
  writeUrl();
}

function update(patch) {
  Object.assign(state, patch, { shown: PAGE });
  renderGrid();
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
  $('#grid').innerHTML = '<li class="skeleton"></li>'.repeat(8);

  let data;
  try {
    const res = await fetch('data/projects.json', { cache: 'no-cache' });
    data = await res.json();
  } catch {
    $('#meta').textContent = 'The index failed to load. Refresh to try again.';
    $('#grid').innerHTML = '';
    return;
  }
  all = data.projects.map(p => ({ ...p, _hay: `${p.name} ${p.owner} ${p.desc} ${p.topics.join(' ')} ${p.lang || ''} ${p.src.ph?.tagline || ''}`.toLowerCase() }));

  const s = data.meta.sources;
  $('#meta').innerHTML = `<strong>${data.meta.count.toLocaleString()}</strong> projects · refreshed ${ago(data.meta.updated)} · ${s.hn} from Show HN · ${s.ph} from Product Hunt${s.submitted ? ` · ${s.submitted} from the community` : ''}`;

  const langs = Object.entries(all.reduce((m, p) => (p.lang && (m[p.lang] = (m[p.lang] || 0) + 1), m), {}))
    .sort((a, b) => b[1] - a[1]);
  $('#lang').insertAdjacentHTML('beforeend', langs.map(([l, n]) => `<option value="${esc(l)}">${esc(l)} (${n})</option>`).join(''));

  renderRails();
  renderGrid();

  let t;
  $('#q').addEventListener('input', e => { clearTimeout(t); t = setTimeout(() => update({ q: e.target.value.trim() }), 120); });
  $('#source').addEventListener('change', e => update({ source: e.target.value }));
  $('#lang').addEventListener('change', e => update({ lang: e.target.value }));
  document.querySelector('.seg').addEventListener('click', e => { const b = e.target.closest('button'); if (b) update({ sort: b.dataset.sort }); });
  $('#more').addEventListener('click', () => { state.shown += PAGE; renderGrid(); });
  $('#rails').addEventListener('click', e => {
    const b = e.target.closest('.rail__more');
    if (!b) return;
    update({ source: '', lang: '', ...RAILS[b.dataset.rail].see });
    $('.catalogue').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  });
  document.addEventListener('keydown', e => {
    if (e.key === '/' && !/input|select|textarea/i.test(document.activeElement.tagName)) { e.preventDefault(); $('#q').focus(); }
  });
}

init();
