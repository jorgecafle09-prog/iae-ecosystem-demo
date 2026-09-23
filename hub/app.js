/* IAE Business School · Ecosystem Hub
   Data now comes from the API (/api/*) instead of being hard-coded here:
   - public directory:  GET /api/entrepreneurs        (no DNI, CUIT, phone or raw form data)
   - team (sign-in):    GET /api/team/people | submissions | exits
   Every person has a permanent ID (EIAE-000001). Each form sent from the founders website
   has its own ID (APP-2026-00001 for NAVES applications, REQ-2026-00001 for contact requests). */
'use strict';

const providers = [
  { name: 'Banco Macro', type: 'Investor / Corporate Partner', offers: ['Capital', 'Mentoring', 'Corporate connections'] },
  { name: 'IAE Mentor Network', type: 'Mentor Network', offers: ['Mentoring', 'Strategy', 'Introductions'] }
];
const events = [
  { name: 'IAE Founder Networking Breakfast', date: 'Oct 8, 2026', place: 'IAE Campus' },
  { name: 'Investor Office Hours', date: 'Oct 21, 2026', place: 'Online' }
];
const PROGRAM_FILTERS = ['All', 'NAVES', 'WISE', 'Open Innovation', 'IAE Hackathon', 'Community'];
const FAV_KEY = 'eiae-hub-favorites';

const readFavs = () => { try { return new Set(JSON.parse(localStorage.getItem(FAV_KEY) || '[]')); } catch (e) { return new Set(); } };
const saveFavs = () => { try { localStorage.setItem(FAV_KEY, JSON.stringify([...s.fav])); } catch (e) {} };

let s = {
  view: new URLSearchParams(location.search).get('view') === 'admin' ? 'admin' : 'entrepreneur',
  page: null, q: '', fav: readFavs(), selected: null, warehouse: null, imp: false,
  people: [], loading: true, error: null,
  team: { loaded: false, loading: false, authNeeded: false, error: null, people: [], submissions: [], exits: [], statuses: {} },
  progFilter: 'All', toast: ''
};
s.page = s.view === 'admin' ? 'Admin Dashboard' : 'Entrepreneurs';

const $ = x => document.querySelector(x);
const e = x => String(x ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));
const chip = (x, c = '') => `<span class="chip ${c}">${e(x)}</span>`;
const idChip = id => `<span class="idchip" title="Permanent ID">${e(id)}</span>`;
const fmtDate = iso => { if (!iso) return '—'; const d = new Date(iso); return isNaN(d) ? '—' : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); };

// ---------------------------------------------------------------- data
async function getJSON(url) {
  const r = await fetch(url, { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
  if (r.status === 401 || r.status === 403) { const err = new Error('auth'); err.auth = true; throw err; }
  if (!r.ok) throw new Error(url + ' → ' + r.status);
  return r.json();
}
async function loadPublic() {
  s.loading = true; s.error = null;
  try { const d = await getJSON('/api/entrepreneurs'); s.people = d.people || []; }
  catch (err) { s.error = 'We could not load the directory. Please try again in a minute.'; }
  s.loading = false; render();
}
async function loadTeam(force) {
  if (s.team.loading || (s.team.loaded && !force)) return;
  s.team.loading = true; s.team.error = null; render();
  try {
    const [p, sub, x, st] = await Promise.all([getJSON('/api/team/people'), getJSON('/api/team/submissions'), getJSON('/api/team/exits'), getJSON('/api/statuses')]);
    Object.assign(s.team, { people: p.people || [], submissions: sub.submissions || [], exits: x.exits || [], statuses: st.statuses || {}, loaded: true, authNeeded: false });
  } catch (err) {
    if (err.auth) s.team.authNeeded = true; else s.team.error = 'The team data could not be loaded.';
  }
  s.team.loading = false; render();
}
async function setStatus(submissionId, program, status) {
  const r = await fetch('/api/team/submissions/' + encodeURIComponent(submissionId) + '/status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ program, status }), credentials: 'same-origin' });
  if (r.ok) {
    const d = await r.json();
    const i = s.team.submissions.findIndex(x => x.submissionId === submissionId);
    if (i >= 0) s.team.submissions[i] = d.submission;
    s.toast = submissionId + ' → ' + status;
  } else s.toast = 'Could not update ' + submissionId + '.';
  render();
}
async function setDirectory(personId, visible) {
  const r = await fetch('/api/team/people/' + encodeURIComponent(personId) + '/directory', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ visible }), credentials: 'same-origin' });
  if (r.ok) {
    const p = s.team.people.find(x => x.personId === personId); if (p) p.directory = visible;
    s.toast = visible ? personId + ' is now visible in the entrepreneur directory.' : personId + ' was removed from the entrepreneur directory.';
    loadPublic();
  } else s.toast = 'Could not update ' + personId + '.';
  render();
}

// ---------------------------------------------------------------- helpers
const teamPeople = () => s.team.people;
const personById = id => teamPeople().find(p => p.personId === id) || s.people.find(p => p.personId === id);
const programsOf = p => (p.programs && p.programs.length ? p.programs : [p.program || 'NAVES']);
function countBy(list, k) { return list.reduce((a, p) => { const v = p[k] || 'Not specified'; a[v] = (a[v] || 0) + 1; return a; }, {}); }
function matchQuery(p, q, admin) {
  const hay = [p.personId, p.name, p.venture, p.industry, p.stage, p.province, p.location, programsOf(p).join(' ')];
  if (admin && p.sensitive) hay.push(p.sensitive.dni, p.sensitive.taxId, p.email);
  return hay.join(' ').toLowerCase().includes(q.toLowerCase());
}
function fresh(p) {
  if (!p.lastUpdated) return ['Missing date', 'red'];
  const cutoff = new Date(); cutoff.setFullYear(cutoff.getFullYear() - 1);
  if (p.lastUpdated < cutoff.toISOString().slice(0, 10)) return ['Update / remove', 'red'];
  return ['Current', 'green'];
}
function bars(obj, green = false) {
  const vals = Object.values(obj); if (!vals.length) return '<p class="muted">No data yet.</p>';
  const max = Math.max(...vals);
  return Object.entries(obj).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k, v]) => `<div class="barrow"><span>${e(k)}</span><div class="track" aria-hidden="true"><div class="fill ${green ? 'greenfill' : ''}" style="width:${v / max * 100}%"></div></div><b>${v}</b></div>`).join('');
}
const sourceChip = p => p.source === 'Website' ? chip('New · website', 'green') : chip(p.source || 'NAVES 2025 file', 'purple');

// ---------------------------------------------------------------- cards and lists
function person(p, admin = false) {
  const f = fresh(p);
  const top = admin ? chip(f[0], f[1]) : `<button class="bookmark ${s.fav.has(p.personId) ? 'saved' : ''}" data-fav="${e(p.personId)}" aria-label="${s.fav.has(p.personId) ? 'Remove from favorites' : 'Add to favorites'}: ${e(p.name)}" aria-pressed="${s.fav.has(p.personId)}">${s.fav.has(p.personId) ? '★' : '☆'}</button>`;
  return `<article class="card person" data-id="${e(p.personId)}" tabindex="0" role="button" aria-label="Open ${e(p.name)}, ${e(p.venture)}">${top}${programsOf(p).map(x => chip(x)).join('')}${admin ? sourceChip(p) : ''}<h3>${e(p.name)}</h3><div class="venture">${e(p.venture)}</div>${p.status ? chip(p.status) : ''}<p class="muted">${e(p.industry)} · ${e(p.stage)}<br>${e(p.location)}</p>${admin ? `<small>${idChip(p.personId)}${p.sensitive && p.sensitive.dni ? `<br>DNI: ${e(p.sensitive.dni)} · CUIT/CUIL: ${e(p.sensitive.taxId)}` : ''}${p.directory ? '' : '<br><span class="muted">Not in public directory</span>'}</small>` : ''}</article>`;
}
const search = (ph = 'Search name, project, industry or location') => `<label class="sr-only" for="search">${e(ph)}</label><input id="search" class="search" type="search" value="${e(s.q)}" placeholder="${e(ph)}" autocomplete="off">`;

// Only this part re-renders while typing, so the search box keeps focus.
function results() {
  const q = s.q.trim();
  if (s.view === 'entrepreneur') {
    if (s.page === 'Entrepreneurs') {
      const list = s.people.filter(p => matchQuery(p, q));
      return list.length ? `<div class="grid">${list.map(p => person(p)).join('')}</div>` : `<div class="card">No entrepreneurs match “${e(q)}”.</div>`;
    }
    if (s.page === 'Find Resources') {
      const list = providers.filter(p => (p.name + ' ' + p.type + ' ' + p.offers.join(' ')).toLowerCase().includes(q.toLowerCase()));
      return `<div class="grid">${list.map(p => `<div class="card">${chip(p.type, 'green')}<h3>${e(p.name)}</h3><p>${p.offers.map(e).join(' · ')}</p></div>`).join('') || '<div class="card">No resources match.</div>'}</div>`;
    }
  }
  if (s.page === 'People Database') {
    const list = teamPeople().filter(p => matchQuery(p, q, true));
    return `<div class="grid">${list.map(p => person(p, true)).join('') || '<div class="card">No people match.</div>'}</div>`;
  }
  if (s.page === 'Data Warehouse') {
    const list = teamPeople().filter(p => matchQuery(p, q, true));
    return `<div class="tablewrap"><table><thead><tr><th scope="col">ID</th><th scope="col">Record</th><th scope="col">DNI</th><th scope="col">CUIT/CUIL</th><th scope="col">Project</th><th scope="col">Source</th></tr></thead><tbody>${list.map(p => `<tr class="wr" data-id="${e(p.personId)}" tabindex="0"><td>${idChip(p.personId)}</td><td><b>${e(p.name)}</b></td><td>${e(p.sensitive && p.sensitive.dni || '—')}</td><td>${e(p.sensitive && p.sensitive.taxId || '—')}</td><td>${e(p.venture)}</td><td>${p.sourceRow ? 'NAVES 2025 · row ' + p.sourceRow : 'Website'}</td></tr>`).join('')}</tbody></table></div>`;
  }
  if (s.page === 'Registrations') {
    const list = s.team.submissions.filter(x => (s.progFilter === 'All' || x.program === s.progFilter) && matchQuery(Object.assign({ personId: x.personId + ' ' + x.submissionId }, x), q));
    if (!list.length) return '<div class="card">No registrations yet. They appear here as soon as someone sends a form on the founders website.</div>';
    return `<div class="tablewrap"><table><thead><tr><th scope="col">Submission</th><th scope="col">Person ID</th><th scope="col">Received</th><th scope="col">Program</th><th scope="col">Type</th><th scope="col">Name</th><th scope="col">Venture</th><th scope="col">Email</th><th scope="col">Status</th><th scope="col">Directory</th></tr></thead><tbody>${list.map(x => {
      const p = personById(x.personId) || {};
      return `<tr class="reg" data-id="${e(x.personId)}" tabindex="0"><td>${idChip(x.submissionId)}</td><td>${idChip(x.personId)}</td><td>${fmtDate(x.createdAt)}</td><td>${chip(x.program)}</td><td>${x.type === 'naves_application' ? 'NAVES application' : 'Contact request'}</td><td><b>${e(x.name)}</b></td><td>${e(x.venture)}</td><td>${e(x.email)}</td><td>${statusSelect(x)}</td><td>${p.directory ? chip('Published', 'green') : `<button class="mini" data-publish="${e(x.personId)}">Publish</button>`}</td></tr>`;
    }).join('')}</tbody></table></div>`;
  }
  if (s.page === 'Stopped & cancelled') {
    const list = s.team.exits.filter(x => (s.progFilter === 'All' || x.program === s.progFilter) && [x.name, x.email, x.company, x.reason, x.program, x.personId, x.exitId].join(' ').toLowerCase().includes(q.toLowerCase()));
    if (!list.length) return '<div class="card">Nobody has cancelled yet.</div>';
    return `<div class="tablewrap"><table><thead><tr><th scope="col">ID</th><th scope="col">Person</th><th scope="col">Program</th><th scope="col">Where</th><th scope="col">Reason</th><th scope="col">Date</th></tr></thead><tbody>${list.map(x => `<tr><td>${idChip(x.exitId)}</td><td><b>${e(x.name || 'Anonymous')}</b><br><span class="muted">${e([x.company, x.email].filter(Boolean).join(' · ') || 'No contact details')}</span>${x.personId ? '<br>' + idChip(x.personId) : ''}</td><td>${chip(x.program)}</td><td>${e(x.where)}${x.filled != null ? `<br><span class="muted">${x.filled} of 7 fields</span>` : ''}</td><td><b>${e(x.reason)}</b></td><td>${fmtDate(x.createdAt)}</td></tr>`).join('')}</tbody></table></div>`;
  }
  return '';
}
function statusSelect(x) {
  const opts = s.team.statuses[x.program] || [x.status];
  return `<label class="sr-only" for="st-${e(x.submissionId)}">Status of ${e(x.submissionId)}</label><select id="st-${e(x.submissionId)}" class="status" data-status="${e(x.submissionId)}" data-program="${e(x.program)}">${opts.map(o => `<option ${o === x.status ? 'selected' : ''}>${e(o)}</option>`).join('')}</select>`;
}
const filterChips = () => `<div class="filters" role="group" aria-label="Filter by program">${PROGRAM_FILTERS.map(p => `<button class="fchip ${s.progFilter === p ? 'on' : ''}" data-prog="${e(p)}" aria-pressed="${s.progFilter === p}">${e(p)}</button>`).join('')}</div>`;

// ---------------------------------------------------------------- pages
function ent() {
  if (s.loading) return '<h1>Entrepreneur Database</h1><div class="accent"></div><p class="muted">Loading…</p>';
  if (s.error) return `<h1>Entrepreneur Database</h1><div class="accent"></div><div class="card notice">${e(s.error)} <button class="mini" id="retry">Retry</button></div>`;
  if (s.page === 'Entrepreneurs') return `<h1>Entrepreneur Database</h1><div class="accent"></div><p class="muted">${s.people.length} entrepreneurs in the directory.</p>${search()}<div id="results">${results()}</div>`;
  if (s.page === 'My Favorites') { const list = s.people.filter(p => s.fav.has(p.personId)); return `<h1>My Favorites</h1><div class="accent"></div><div class="grid">${list.map(p => person(p)).join('') || '<div class="card">No favorites yet. Tap ☆ on a card to save it here.</div>'}</div>`; }
  if (s.page === 'Find Resources') return `<h1>Find Resources & Expertise</h1><div class="accent"></div>${search('Search resources or expertise')}<div id="results">${results()}</div>`;
  if (s.page === 'Capital & Support') return `<h1>Capital & Support Network</h1><div class="accent"></div>${providers.map(p => `<div class="card" style="margin-bottom:10px"><h3>${e(p.name)}</h3><p>${p.offers.map(e).join(' · ')}</p></div>`).join('')}`;
  return `<h1>Upcoming Network Events</h1><div class="accent"></div>${events.map(x => `<div class="card" style="margin-bottom:10px"><h3>${e(x.name)}</h3><p>${e(x.date)} · ${e(x.place)}</p></div>`).join('')}`;
}
function dashboard() {
  const P = teamPeople();
  const ind = countBy(P, 'industry'), phase = countBy(P, 'stage'), loc = countBy(P, 'province');
  const review = P.filter(p => fresh(p)[1] !== 'green').length;
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
  const newWeek = s.team.submissions.filter(x => x.createdAt >= weekAgo).length;
  const fromWeb = P.filter(p => p.source === 'Website').length;
  return `<h1>Admin Command Center</h1><div class="accent"></div>${chip('Team only', 'red')}<div class="kpis"><div class="card kpi"><b>${P.length}</b>People with an ID</div><div class="card kpi"><b>${fromWeb}</b>From the website</div><button class="card kpi linkcard" data-goto="Registrations"><b>${newWeek}</b>New forms · 7 days</button><button class="card kpi linkcard" data-goto="Stopped & cancelled"><b>${s.team.exits.length}</b>Stopped / cancelled</button><div class="card kpi"><b>${review}</b>Need review</div></div><div class="charts"><section class="panel"><h3>Entrepreneurs by Industry</h3><p class="muted">NAVES file and website registrations.</p>${bars(ind)}</section><section class="panel"><h3>Entrepreneurs by Phase</h3><p class="muted">Current venture maturity.</p>${bars(phase, true)}</section><section class="panel chart-wide"><h3>Entrepreneurs by Location</h3><p class="muted">Province / region coverage.</p><div class="locgrid">${Object.entries(loc).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k, v]) => `<div class="loc"><span>${e(k)}</span><b>${v}</b></div>`).join('')}</div></section></div>`;
}
function admin() {
  if (s.team.authNeeded) return `<h1>Team sign-in</h1><div class="accent"></div><div class="card notice"><p>The admin area shows personal data (DNI, CUIT/CUIL, phone). Sign in with your IAE Microsoft account to continue.</p><a class="btn" href="/.auth/login/aad?post_login_redirect_uri=${encodeURIComponent('/?view=admin')}">Sign in</a></div>`;
  if (!s.team.loaded) return s.team.error ? `<div class="card notice">${e(s.team.error)} <button class="mini" id="retryTeam">Retry</button></div>` : '<p class="muted">Loading team data…</p>';
  if (s.page === 'Admin Dashboard') return dashboard();
  if (s.page === 'Registrations') return `<h1>Registrations</h1><div class="accent"></div><p class="muted">Every form sent from the founders website, newest first. Each person keeps one ID across programs; each form gets its own.</p>${filterChips()}${search('Search by ID, name, venture or email')}<div id="results">${results()}</div>`;
  if (s.page === 'Stopped & cancelled') return `<h1>Stopped & cancelled</h1><div class="accent"></div><p class="muted">People who pressed Cancel on a form, with the reason they gave.</p>${filterChips()}${search('Search by name, email, reason or ID')}<div id="results">${results()}</div>`;
  if (s.page === 'People Database') return `<h1>Internal People Database</h1><div class="accent"></div>${search('Search ID, name, DNI, CUIT/CUIL, email or project')}<div id="results">${results()}</div>`;
  if (s.page === 'Data Warehouse') return `<h1>Data Warehouse</h1><div class="accent"></div><p class="muted">Raw source records: NAVES 2025 file (42 fields) and website forms.</p>${search('Search warehouse by ID, person, DNI, CUIT/CUIL or venture')}<div id="results">${results()}</div>`;
  if (s.page === 'Data Freshness') return `<h1>Data Freshness</h1><div class="accent"></div>${teamPeople().filter(p => fresh(p)[1] !== 'green').map(p => `<div class="card" style="margin-bottom:8px">${idChip(p.personId)} <b>${e(p.name)}</b> ${chip(fresh(p)[0], fresh(p)[1])}</div>`).join('') || '<div class="card">Everything is current.</div>'}`;
  const byProg = {}; teamPeople().forEach(p => programsOf(p).forEach(x => { byProg[x] = (byProg[x] || 0) + 1; }));
  return `<h1>Programs</h1><div class="accent"></div><div class="grid">${Object.entries(byProg).map(([k, v]) => `<div class="card"><b>${e(k)}</b> · ${v} people</div>`).join('')}</div>`;
}
function matches(p) {
  return s.people.filter(x => x.personId !== p.personId).map(x => ({ x, score: (x.industry === p.industry ? 5 : 0) + (x.stage === p.stage ? 3 : 0) + ((x.needs || []).some(n => (p.skills || []).includes(n)) ? 2 : 0) })).filter(m => m.score > 0).sort((a, b) => b.score - a.score).slice(0, 4);
}
function drawers() {
  let z = '';
  if (s.selected) {
    const p = s.selected;
    const subs = s.team.submissions.filter(x => x.personId === p.personId);
    const adminBody = `${chip('TEAM ONLY', 'red')}<h3>Sensitive Information</h3><div class="card">${p.sensitive && p.sensitive.dni ? `DNI: ${e(p.sensitive.dni)}<br>CUIT/CUIL: ${e(p.sensitive.taxId)}<br>Age: ${e(p.sensitive.age)}<br>Phone: ${e(p.sensitive.phone)}<br>` : ''}Email: ${e(p.email || '—')}</div><h3>Forms from the website</h3>${subs.length ? subs.map(x => `<div class="card" style="margin-top:8px">${idChip(x.submissionId)} ${chip(x.program)} ${chip(x.status || 'New', 'green')} <span class="muted">${fmtDate(x.createdAt)}</span><p>${e((x.payload && (x.payload.describe || x.payload.answers && x.payload.answers.problem)) || '')}</p>${x.payload && x.payload.looking ? `<p class="muted">Looking for: ${e(x.payload.looking)}</p>` : ''}</div>`).join('') : '<p class="muted">None. This person comes from the NAVES 2025 file.</p>'}<h3>Public directory</h3><p>${p.directory ? 'Visible to entrepreneurs.' : 'Hidden. Only the team can see this person.'}</p><button class="mini" data-publish="${e(p.personId)}" data-visible="${p.directory ? 'false' : 'true'}">${p.directory ? 'Hide from directory' : 'Publish in directory'}</button>`;
    const publicBody = `<h3>Skills</h3>${(p.skills || []).map(x => chip(x, 'green')).join('') || '<p class="muted">—</p>'}<h3>Looking For</h3>${(p.needs || []).map(x => chip(x)).join('') || '<p class="muted">—</p>'}<h3>Contact</h3><div class="card">${p.email ? e(p.email) : 'Ask the EmprendeIAE team for an introduction.'}</div><div class="matches"><h3>Recommended Best Matches</h3>${matches(p).map((m, i) => `<div class="card" style="margin-top:8px"><b>${e(m.x.name)}</b> · ${e(m.x.venture)} ${chip(i === 0 ? 'Best match' : `${m.score} pts`)}</div>`).join('') || '<p class="muted">No close matches yet.</p>'}</div>`;
    z += `<div class="drawer-bg" data-close="selected"><div class="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title"><button id="close" class="close" aria-label="Close">×</button>${programsOf(p).map(x => chip(x)).join('')}<h2 id="drawer-title">${e(p.name)}</h2>${s.view === 'admin' ? idChip(p.personId) : ''}<div class="venture">${e(p.venture)}</div><p>${e(p.industry)} · ${e(p.stage)} · ${e(p.location)}</p>${s.view === 'admin' ? adminBody : publicBody}</div></div>`;
  }
  if (s.warehouse) {
    const p = s.warehouse;
    const rows = p.raw && Object.keys(p.raw).length ? Object.entries(p.raw) : Object.entries(Object.assign({ 'Person ID': p.personId, Email: p.email, Venture: p.venture, Industry: p.industryOriginal || p.industry, Stage: p.stageOriginal || p.stage, City: p.location, Programs: programsOf(p).join(', '), Created: p.createdAt }));
    z += `<div class="drawer-bg" data-close="warehouse"><div class="drawer" role="dialog" aria-modal="true" aria-labelledby="wh-title"><button id="closeW" class="close" aria-label="Close">×</button>${chip('RAW TEAM RECORD', 'red')} ${idChip(p.personId)}<h2 id="wh-title">${e(p.name)}</h2><div class="fieldgrid">${rows.map(([k, v]) => `<div><b>${e(k)}</b></div><div>${e(v == null || v === '' ? '—' : v)}</div>`).join('')}</div></div></div>`;
  }
  if (s.imp) z += `<div class="drawer-bg" data-close="imp" style="justify-content:center;align-items:center"><div class="drawer" role="dialog" aria-modal="true" aria-labelledby="imp-title" style="height:auto;max-width:520px;border-radius:14px"><button id="closeI" class="close" aria-label="Close">×</button><h2 id="imp-title">Import Data</h2><p class="muted">New people arrive automatically from the founders website. To load a past program file, convert it with <code>scripts/extract-legacy-records.mjs</code> and run <code>npm run seed</code> in the api folder. Every row gets a permanent ID.</p></div></div>`;
  return z;
}

// ---------------------------------------------------------------- render + events
function render() {
  const nav = s.view === 'admin'
    ? ['Admin Dashboard', 'Registrations', 'Stopped & cancelled', 'People Database', 'Data Warehouse', 'Import Data', 'Data Freshness', 'Programs']
    : ['Entrepreneurs', 'My Favorites', 'Find Resources', 'Capital & Support', 'Events'];
  const badge = n => (n ? ` <span class="navcount">${n}</span>` : '');
  const newCount = s.team.submissions.filter(x => x.createdAt >= new Date(Date.now() - 7 * 864e5).toISOString()).length;
  $('#app').innerHTML = `<header class="top"><div class="brand"><div class="mark" aria-hidden="true">IAE</div><div><b>IAE Business School</b><small>Universidad Austral · Ecosystem Hub</small></div></div><div class="topright"><a class="toplink" href="/apply/">Founders website ↗</a><div class="switch" role="group" aria-label="View"><button id="ent" class="${s.view === 'entrepreneur' ? 'on' : 'off'}" aria-pressed="${s.view === 'entrepreneur'}">Entrepreneur View</button><button id="adm" class="${s.view === 'admin' ? 'on' : 'off'}" aria-pressed="${s.view === 'admin'}">Admin Team</button></div></div></header><div class="layout"><aside class="${s.view === 'admin' ? 'admin' : ''}"><nav aria-label="Sections">${nav.map(n => `<button data-page="${e(n)}" class="nav ${s.page === n ? 'sel' : ''}" ${s.page === n ? 'aria-current="page"' : ''}>${e(n)}${n === 'Registrations' ? badge(newCount) : ''}</button>`).join('')}</nav></aside><main id="main">${s.toast ? `<div class="toast" role="status">${e(s.toast)}</div>` : ''}${s.view === 'admin' ? admin() : ent()}</main></div>${drawers()}`;
  bind();
  const d = document.querySelector('.drawer .close'); if (d) d.focus();
}
function bindResults() {
  document.querySelectorAll('[data-fav]').forEach(b => b.onclick = x => { x.stopPropagation(); const id = b.dataset.fav; s.fav.has(id) ? s.fav.delete(id) : s.fav.add(id); saveFavs(); render(); });
  const open = (el, fn) => { el.onclick = fn; el.onkeydown = ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); fn(); } }; };
  document.querySelectorAll('.person').forEach(x => open(x, () => { s.selected = personById(x.dataset.id); render(); }));
  document.querySelectorAll('.wr').forEach(x => open(x, () => { s.warehouse = personById(x.dataset.id); render(); }));
  document.querySelectorAll('.reg').forEach(x => open(x, () => { s.selected = personById(x.dataset.id); render(); }));
  document.querySelectorAll('select[data-status]').forEach(sel => { sel.onclick = ev => ev.stopPropagation(); sel.onkeydown = ev => ev.stopPropagation(); sel.onchange = () => setStatus(sel.dataset.status, sel.dataset.program, sel.value); });
  document.querySelectorAll('[data-publish]').forEach(b => b.onclick = ev => { ev.stopPropagation(); setDirectory(b.dataset.publish, b.dataset.visible !== 'false'); });
}
function bind() {
  $('#ent').onclick = () => { s.view = 'entrepreneur'; s.page = 'Entrepreneurs'; s.q = ''; s.toast = ''; history.replaceState(null, '', '/'); render(); };
  $('#adm').onclick = () => { s.view = 'admin'; s.page = 'Admin Dashboard'; s.q = ''; s.toast = ''; history.replaceState(null, '', '/?view=admin'); render(); loadTeam(); };
  document.querySelectorAll('[data-page]').forEach(b => b.onclick = () => { if (b.dataset.page === 'Import Data') s.imp = true; else { s.page = b.dataset.page; s.q = ''; s.progFilter = 'All'; } s.toast = ''; render(); });
  document.querySelectorAll('[data-goto]').forEach(b => b.onclick = () => { s.page = b.dataset.goto; s.q = ''; s.progFilter = 'All'; render(); });
  document.querySelectorAll('[data-prog]').forEach(b => b.onclick = () => { s.progFilter = b.dataset.prog; render(); });
  const q = $('#search');
  if (q) q.oninput = x => { s.q = x.target.value; $('#results').innerHTML = results(); bindResults(); };
  bindResults();
  if ($('#retry')) $('#retry').onclick = loadPublic;
  if ($('#retryTeam')) $('#retryTeam').onclick = () => loadTeam(true);
  const closeAll = () => { s.selected = null; s.warehouse = null; s.imp = false; render(); };
  ['#close', '#closeW', '#closeI'].forEach(id => { if ($(id)) $(id).onclick = closeAll; });
  document.querySelectorAll('.drawer-bg').forEach(bg => bg.onclick = ev => { if (ev.target === bg) closeAll(); });
}
document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && (s.selected || s.warehouse || s.imp)) { s.selected = null; s.warehouse = null; s.imp = false; render(); } });
// Refresh team data when the tab comes back into view, so new registrations show up.
document.addEventListener('visibilitychange', () => { if (!document.hidden && s.view === 'admin' && s.team.loaded) loadTeam(true); });

render();
loadPublic();
if (s.view === 'admin') loadTeam();
