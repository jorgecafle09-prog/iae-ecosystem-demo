'use strict';
// Framework-free request handlers. Azure Functions (src/functions/*.js) and the
// local dev server (dev-server.js) both call these, so both behave the same.

const PROGRAMS = ['NAVES', 'WISE', 'Open Innovation', 'IAE Hackathon', 'Community'];
const TYPES = ['naves_application', 'contact'];

// Stages each submission moves through, per program. The first one is where every new form starts.
const STATUSES = {
  'NAVES': ['Received', 'Filter I', 'Filter II', 'Admitted', 'Not this cycle'],
  'WISE': ['New', 'Intro call booked', 'Fit review', 'Invited to cohort', 'Not a fit'],
  'Open Innovation': ['New', 'Intro call booked', 'Matched to a challenge', 'Pilot proposal sent', 'Not a fit'],
  'IAE Hackathon': ['New', 'Contacted', 'On the list'],
  'Community': ['New', 'Contacted', 'On the list']
};

// Founders website (English) → Hub / NAVES file vocabulary (Spanish)
const STAGE_MAP = {
  'Just an idea': 'Planificación',
  'Prototype / MVP': 'Prototipo',
  'Early revenue': 'Mercado',
  'Scaling': 'Mercado'
};
const INDUSTRY_MAP = {
  'Agribusiness': 'Agronegocios',
  'Knowledge economy': 'Economía del conocimiento',
  'Renewable energy': 'Energías renovables',
  'Wine industry': 'Industria vitivinícola',
  'Mining': 'Minería',
  'Oil & Gas': 'Oil & Gas',
  'Health': 'Salud',
  'Tourism': 'Turismo',
  // WISE technology areas
  'Agtech & food tech': 'Agronegocios',
  'Biotech & life sciences': 'Salud',
  'Health tech & medical devices': 'Salud',
  'Cleantech & energy': 'Energías renovables',
  'Software, data & AI': 'Economía del conocimiento',
  'Hardware, robotics & IoT': 'Economía del conocimiento',
  'Advanced materials & chemistry': 'Economía del conocimiento',
  'Fintech': 'Economía del conocimiento',
  'Edtech': 'Economía del conocimiento'
};
const NEED_TO_STATUS = {
  'A mentor': 'Looking for help',
  'Funding': 'Looking for help',
  'A co-founder': 'Looking for a partner',
  'Customers': 'Looking to connect'
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const clean = (v, max = 2000) => (v == null ? '' : String(v)).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);

function validateRegistration(body) {
  const errors = [];
  if (!body || typeof body !== 'object') return { ok: false, errors: ['Body must be JSON.'] };
  if (clean(body.website2)) return { ok: false, spam: true, errors: ['Rejected.'] }; // honeypot
  const type = clean(body.type, 40);
  const program = clean(body.program, 40);
  if (!TYPES.includes(type)) errors.push('type must be one of ' + TYPES.join(', '));
  if (!PROGRAMS.includes(program)) errors.push('program must be one of ' + PROGRAMS.join(', '));
  if (type === 'naves_application' && program !== 'NAVES') errors.push('naves_application must use program NAVES');
  const email = clean(body.email, 200).toLowerCase();
  if (!EMAIL_RE.test(email)) errors.push('a valid email is required');
  const d = {
    type, program, email,
    name: clean(body.name, 120),
    venture: clean(body.venture || body.company, 160),
    industry: clean(body.industry, 80),
    stage: clean(body.stage, 60),
    city: clean(body.city, 120),
    province: clean(body.province, 120),
    website: clean(body.website, 300),
    oneLine: clean(body.oneLine, 400),
    describe: clean(body.describe),
    looking: clean(body.looking),
    need: clean(body.need, 80),
    founderType: clean(body.founderType, 80),
    category: clean(body.category, 120),
    answers: {
      problem: clean(body.answers && body.answers.problem),
      goals: clean(body.answers && body.answers.goals),
      hours: clean(body.answers && body.answers.hours, 40)
    },
    team: Array.isArray(body.team) ? body.team.slice(0, 5).map(m => ({ name: clean(m && m.name, 120), email: clean(m && m.email, 200).toLowerCase() })).filter(m => m.name || m.email) : [],
    eligibility: body.eligibility && typeof body.eligibility === 'object' ? {
      invoices: body.eligibility.invoices === true, employees: body.eligibility.employees === true,
      investment: body.eligibility.investment === true, corporate: body.eligibility.corporate === true
    } : null,
    reviewConsent: body.reviewConsent === true,
    directoryConsent: body.directoryConsent === true,
    shareContact: body.shareContact === true,
    source: clean(body.source, 60) || 'Founders website'
  };
  if (type === 'contact') {
    if (!d.name) errors.push('name is required');
    if (!d.venture) errors.push('company is required');
  }
  if (type === 'naves_application') {
    if (!d.venture) errors.push('venture is required');
    if (!d.reviewConsent) errors.push('reviewConsent must be true');
  }
  return { ok: errors.length === 0, errors, data: d };
}

function validateExit(body) {
  if (!body || typeof body !== 'object') return { ok: false, errors: ['Body must be JSON.'] };
  const program = clean(body.program, 40);
  const reason = clean(body.reason, 160);
  const errors = [];
  if (!PROGRAMS.includes(program)) errors.push('program must be one of ' + PROGRAMS.join(', '));
  if (!reason) errors.push('reason is required');
  const email = clean(body.email, 200).toLowerCase();
  const filled = Number.isFinite(+body.filled) ? Math.max(0, Math.min(7, Math.round(+body.filled))) : null;
  return { ok: errors.length === 0, errors, data: { program, reason, email: EMAIL_RE.test(email) ? email : '', name: clean(body.name, 120), company: clean(body.company, 160), where: clean(body.where, 60) || 'Contact form', filled } };
}

// Merge new website data into a person without blanking fields we already have.
function mergePerson(p, d, now) {
  const keep = (a, b) => (b ? b : a);
  const programs = new Set(p.programs || []); programs.add(d.program);
  return Object.assign({}, p, {
    name: keep(p.name, d.name),
    email: p.email || d.email,
    venture: keep(p.venture, d.venture),
    industry: keep(p.industry, INDUSTRY_MAP[d.industry] || d.industry),
    industryOriginal: keep(p.industryOriginal, d.industry),
    stage: keep(p.stage, STAGE_MAP[d.stage] || d.stage),
    stageOriginal: keep(p.stageOriginal, d.stage),
    location: keep(p.location, d.city),
    province: keep(p.province, d.province),
    website: keep(p.website, d.website),
    status: keep(p.status, NEED_TO_STATUS[d.need] || (d.looking ? 'Looking for help' : '')),
    skills: p.skills && p.skills.length ? p.skills : [INDUSTRY_MAP[d.industry] || d.industry].filter(Boolean),
    needs: d.need ? Array.from(new Set([...(p.needs || []), d.need])) : (p.needs || []),
    programs: Array.from(programs),
    directory: !!(p.directory || d.directoryConsent),
    shareContact: !!(p.shareContact || d.shareContact),
    consentAt: (d.directoryConsent || d.shareContact) ? now : (p.consentAt || null),
    lastUpdated: now.slice(0, 10),
    updatedAt: now
  });
}

// Fields anyone may see in the public directory.
function publicView(p) {
  return {
    personId: p.personId, name: p.name, venture: p.venture, industry: p.industry, stage: p.stage,
    location: p.location, programs: p.programs, program: (p.programs || [])[0] || 'NAVES', status: p.status,
    skills: p.skills || [], needs: p.needs || [], source: p.source,
    email: p.shareContact ? p.email : null
  };
}

function isTeam(principal) {
  return !!(principal && Array.isArray(principal.userRoles) && (principal.userRoles.includes('team') || principal.userRoles.includes('admin')));
}

function readPrincipal(headers, devTeam) {
  if (devTeam) return { userDetails: 'dev', userRoles: ['anonymous', 'authenticated', 'team'] };
  const h = headers && (headers['x-ms-client-principal'] || (headers.get && headers.get('x-ms-client-principal')));
  if (!h) return null;
  try { return JSON.parse(Buffer.from(h, 'base64').toString('utf8')); } catch (e) { return null; }
}

const json = (status, body) => ({ status, jsonBody: body });

// Simple per-IP limit: at most `max` forms per `windowMs` from one address (per server instance).
function makeLimiter(max = 8, windowMs = 10 * 60 * 1000) {
  const hits = new Map();
  return {
    allow(ip, t = Date.now()) {
      if (!ip) return true;
      const list = (hits.get(ip) || []).filter(x => t - x < windowMs);
      if (list.length >= max) { hits.set(ip, list); return false; }
      list.push(t); hits.set(ip, list);
      if (hits.size > 5000) hits.clear();
      return true;
    }
  };
}
const clientIp = (headers) => {
  const h = headers || {};
  const raw = h['x-forwarded-for'] || h['x-client-ip'] || h['x-azure-clientip'] || '';
  return String(raw).split(',')[0].trim().replace(/:\d+$/, '');
};

function makeHandlers(getStore, opts = {}) {
  const now = opts.now || (() => new Date().toISOString());
  const guard = (headers) => isTeam(readPrincipal(headers, opts.devTeam));
  const limiter = opts.limiter === false ? null : (opts.limiter || makeLimiter());
  const notify = opts.notify || null;

  return {
    async register(body, headers) {
      if (limiter && !limiter.allow(clientIp(headers))) return json(429, { ok: false, errors: ['Too many forms from this connection. Please try again in a few minutes.'] });
      const v = validateRegistration(body);
      if (v.spam) return json(202, { ok: true });
      if (!v.ok) return json(400, { ok: false, errors: v.errors });
      const store = await getStore();
      const d = v.data; const ts = now(); const year = ts.slice(0, 4);
      let person = await store.findPersonByEmail(d.email);
      let isNewPerson = false;
      if (!person) {
        const personId = await store.nextId('person');
        const claimed = await store.claimEmail(d.email, personId);
        if (claimed !== personId) person = await store.getPerson(claimed); // lost a race: reuse
        else {
          isNewPerson = true;
          person = { personId, createdAt: ts, source: 'Website', directory: false, shareContact: false, programs: [], sensitive: {} };
        }
      }
      person = mergePerson(person, d, ts);
      const kind = d.type === 'naves_application' ? 'application' : 'request';
      const submissionId = await store.nextId(kind, year);
      const submission = { submissionId, personId: person.personId, type: d.type, program: d.program, status: STATUSES[d.program][0], statusHistory: [{ status: STATUSES[d.program][0], at: ts, by: 'website' }], createdAt: ts, name: d.name || person.name, venture: d.venture || person.venture, email: d.email, payload: d };
      await store.savePerson(person);
      await store.addSubmission(submission);
      if (notify) { try { await notify({ person, submission, isNewPerson }); } catch (e) { /* email problems never block a registration */ } }
      return json(201, { ok: true, personId: person.personId, submissionId, isNewPerson });
    },

    async addExit(body, headers) {
      if (limiter && !limiter.allow(clientIp(headers))) return json(429, { ok: false, errors: ['Too many requests.'] });
      const v = validateExit(body);
      if (!v.ok) return json(400, { ok: false, errors: v.errors });
      const store = await getStore();
      const ts = now();
      const exitId = await store.nextId('exit', ts.slice(0, 4));
      const person = v.data.email ? await store.findPersonByEmail(v.data.email) : null;
      await store.addExit(Object.assign({ exitId, createdAt: ts, personId: person ? person.personId : null }, v.data));
      return json(201, { ok: true, exitId });
    },

    async publicPeople() {
      const store = await getStore();
      const people = (await store.listPeople()).filter(p => p.directory);
      return json(200, { count: people.length, people: people.map(publicView) });
    },

    async teamPeople(headers) {
      if (!guard(headers)) return json(401, { ok: false, error: 'Team sign-in required' });
      const store = await getStore();
      return json(200, { people: await store.listPeople() });
    },
    async teamSubmissions(headers) {
      if (!guard(headers)) return json(401, { ok: false, error: 'Team sign-in required' });
      const store = await getStore();
      return json(200, { submissions: await store.listSubmissions() });
    },
    async teamExits(headers) {
      if (!guard(headers)) return json(401, { ok: false, error: 'Team sign-in required' });
      const store = await getStore();
      return json(200, { exits: await store.listExits() });
    },
    async teamSetStatus(headers, submissionId, body) {
      if (!guard(headers)) return json(401, { ok: false, error: 'Team sign-in required' });
      const program = clean(body && body.program, 40); const status = clean(body && body.status, 60);
      if (!STATUSES[program]) return json(400, { ok: false, error: 'Unknown program' });
      if (!STATUSES[program].includes(status)) return json(400, { ok: false, error: 'Status must be one of: ' + STATUSES[program].join(', ') });
      const store = await getStore();
      const principal = readPrincipal(headers, opts.devTeam);
      const updated = await store.updateSubmission(program, submissionId, (s) => Object.assign({}, s, {
        status, statusUpdatedAt: now(),
        statusHistory: (s.statusHistory || []).concat([{ status, at: now(), by: (principal && principal.userDetails) || 'team' }])
      }));
      if (!updated) return json(404, { ok: false, error: 'Unknown submission ' + submissionId });
      return json(200, { ok: true, submission: updated });
    },
    async statuses() { return json(200, { statuses: STATUSES }); },
    async teamSetDirectory(headers, personId, body) {
      if (!guard(headers)) return json(401, { ok: false, error: 'Team sign-in required' });
      const store = await getStore();
      const p = await store.getPerson(personId);
      if (!p) return json(404, { ok: false, error: 'Unknown person ' + personId });
      const next = Object.assign({}, p, { directory: !!(body && body.visible), updatedAt: now() });
      await store.savePerson(next);
      return json(200, { ok: true, personId, directory: next.directory });
    }
  };
}

module.exports = { makeHandlers, makeLimiter, STATUSES, validateRegistration, validateExit, mergePerson, publicView, STAGE_MAP, INDUSTRY_MAP, PROGRAMS };
