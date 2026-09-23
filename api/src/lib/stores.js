'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const pad = (n, w) => String(n).padStart(w, '0');
const PREFIX = { application: 'APP', request: 'REQ', exit: 'EXT' };
// Person IDs are permanent and never reused: EIAE-000001.
// Submission IDs restart every year: APP-2026-00001 (NAVES application), REQ-2026-00001 (contact request), EXT-2026-00001 (cancel / drop-out).
function formatId(kind, n, year) {
  if (kind === 'person') return 'EIAE-' + pad(n, 6);
  return PREFIX[kind] + '-' + year + '-' + pad(n, 5);
}
const counterKey = (kind, year) => (kind === 'person' ? 'person' : kind + '-' + year);
const emailKey = (email) => crypto.createHash('sha256').update(String(email).trim().toLowerCase()).digest('hex');

// ---------------------------------------------------------------- File store
// Local development and tests. One JSON file, writes serialized.
class FileStore {
  constructor(file) {
    this.file = file;
    this.chain = Promise.resolve();
    this.db = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { counters: {}, emails: {}, people: {}, submissions: [], exits: [] };
  }
  _save() { const tmp = this.file + '.tmp'; fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(tmp, JSON.stringify(this.db, null, 2)); fs.renameSync(tmp, this.file); }
  _q(fn) { const r = this.chain.then(fn); this.chain = r.catch(() => {}); return r; }
  nextId(kind, year) { return this._q(() => { const k = counterKey(kind, year); const n = (this.db.counters[k] || 0) + 1; this.db.counters[k] = n; this._save(); return formatId(kind, n, year); }); }
  claimEmail(email, personId) { return this._q(() => { const k = emailKey(email); if (!this.db.emails[k]) { this.db.emails[k] = personId; this._save(); } return this.db.emails[k]; }); }
  async findPersonByEmail(email) { const id = this.db.emails[emailKey(email)]; return id ? this.db.people[id] || null : null; }
  async getPerson(id) { return this.db.people[id] || null; }
  savePerson(p) { return this._q(() => { this.db.people[p.personId] = p; this._save(); }); }
  addSubmission(s) { return this._q(() => { this.db.submissions.push(s); this._save(); }); }
  addExit(x) { return this._q(() => { this.db.exits.push(x); this._save(); }); }
  updateSubmission(program, id, fn) { return this._q(() => { const i = this.db.submissions.findIndex(s => s.submissionId === id && s.program === program); if (i < 0) return null; this.db.submissions[i] = fn(this.db.submissions[i]); this._save(); return this.db.submissions[i]; }); }
  async listPeople() { return Object.values(this.db.people).sort((a, b) => a.personId.localeCompare(b.personId)); }
  async listSubmissions() { return this.db.submissions.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  async listExits() { return this.db.exits.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  async countPeople() { return Object.keys(this.db.people).length; }
}

// ---------------------------------------------------------------- Azure Table Storage
// Production. Tables are created on first use. Each row keeps the full object as JSON in `data`
// plus a few plain columns so the tables are readable in Azure Storage Explorer.
class TableStore {
  constructor(connectionString) {
    const { TableClient } = require('@azure/data-tables');
    const allow = /UseDevelopmentStorage|127\.0\.0\.1|localhost/i.test(connectionString) ? { allowInsecureConnection: true } : {};
    const mk = (name) => TableClient.fromConnectionString(connectionString, name, allow);
    this.t = { counters: mk('Counters'), emails: mk('EmailIndex'), people: mk('People'), submissions: mk('Submissions'), exits: mk('Exits') };
    this.ready = null;
  }
  init() {
    if (!this.ready) this.ready = Promise.all(Object.values(this.t).map(c => c.createTable().catch(e => { if (e.statusCode !== 409) throw e; })));
    return this.ready;
  }
  async nextId(kind, year) {
    await this.init();
    const rk = counterKey(kind, year);
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        const e = await this.t.counters.getEntity('counter', rk);
        const n = Number(e.value) + 1;
        await this.t.counters.updateEntity({ partitionKey: 'counter', rowKey: rk, value: n }, 'Replace', { etag: e.etag });
        return formatId(kind, n, year);
      } catch (err) {
        if (err.statusCode === 404) {
          try { await this.t.counters.createEntity({ partitionKey: 'counter', rowKey: rk, value: 1 }); return formatId(kind, 1, year); }
          catch (e2) { if (e2.statusCode !== 409) throw e2; }
        } else if (err.statusCode !== 412) throw err; // 412 = someone else took this number, retry
        await new Promise(r => setTimeout(r, 20 + Math.random() * 80));
      }
    }
    throw new Error('Could not allocate an ID after 20 attempts');
  }
  async claimEmail(email, personId) {
    await this.init();
    const rk = emailKey(email);
    try { await this.t.emails.createEntity({ partitionKey: 'email', rowKey: rk, personId }); return personId; }
    catch (e) { if (e.statusCode !== 409) throw e; const x = await this.t.emails.getEntity('email', rk); return x.personId; }
  }
  async findPersonByEmail(email) {
    await this.init();
    try { const x = await this.t.emails.getEntity('email', emailKey(email)); return this.getPerson(x.personId); }
    catch (e) { if (e.statusCode === 404) return null; throw e; }
  }
  async getPerson(id) {
    await this.init();
    try { const e = await this.t.people.getEntity('person', id); return JSON.parse(e.data); }
    catch (e) { if (e.statusCode === 404) return null; throw e; }
  }
  async savePerson(p) {
    await this.init();
    await this.t.people.upsertEntity({ partitionKey: 'person', rowKey: p.personId, name: p.name || '', venture: p.venture || '', source: p.source || '', directory: !!p.directory, data: JSON.stringify(p) }, 'Replace');
  }
  async addSubmission(s) {
    await this.init();
    await this.t.submissions.createEntity({ partitionKey: s.program, rowKey: s.submissionId, personId: s.personId, type: s.type, createdAt: s.createdAt, data: JSON.stringify(s) });
  }
  async updateSubmission(program, id, fn) {
    await this.init();
    for (let attempt = 0; attempt < 10; attempt++) {
      let e;
      try { e = await this.t.submissions.getEntity(program, id); } catch (err) { if (err.statusCode === 404) return null; throw err; }
      const next = fn(JSON.parse(e.data));
      try {
        await this.t.submissions.updateEntity({ partitionKey: program, rowKey: id, personId: next.personId, type: next.type, createdAt: next.createdAt, status: next.status, data: JSON.stringify(next) }, 'Replace', { etag: e.etag });
        return next;
      } catch (err) { if (err.statusCode !== 412) throw err; }
    }
    throw new Error('Could not update ' + id);
  }
  async addExit(x) {
    await this.init();
    await this.t.exits.createEntity({ partitionKey: x.program, rowKey: x.exitId, reason: x.reason, createdAt: x.createdAt, data: JSON.stringify(x) });
  }
  async _all(client) { await this.init(); const out = []; for await (const e of client.listEntities()) out.push(JSON.parse(e.data)); return out; }
  async listPeople() { return (await this._all(this.t.people)).sort((a, b) => a.personId.localeCompare(b.personId)); }
  async listSubmissions() { return (await this._all(this.t.submissions)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  async listExits() { return (await this._all(this.t.exits)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  async countPeople() { await this.init(); for await (const _ of this.t.people.listEntities({ queryOptions: { select: ['rowKey'] } })) return 1; return 0; }
}

// ---------------------------------------------------------------- Seeding the NAVES file
// Turns the 24 records hard-coded in the old app.js into people with permanent IDs.
// The DNI stops being the ID; it moves to `sensitive` (team only).
function legacyToPerson(r, personId) {
  const ts = r.raw && r.raw['Marca temporal'] ? new Date(r.raw['Marca temporal'].replace(' ', 'T') + 'Z').toISOString() : null;
  return {
    personId, legacyKey: 'NAVES-2025-row-' + r.sourceRow, source: 'NAVES 2025 file',
    name: r.name, email: (r.email || '').toLowerCase(), venture: r.venture, industry: r.industry, stage: r.stage,
    province: r.province, location: r.location, programs: [r.program || 'NAVES'], status: r.status,
    skills: r.skills || [], needs: r.needs || [], lastUpdated: r.lastUpdated || null,
    directory: true, shareContact: false, createdAt: ts, updatedAt: ts,
    sensitive: { dni: r.id, taxId: r.taxId, age: r.age, phone: r.phone },
    sourceRow: r.sourceRow, raw: r.raw || {}
  };
}
async function seedLegacy(store, records) {
  if (await store.countPeople() > 0) return { seeded: 0, skipped: true };
  const sorted = records.slice().sort((a, b) => (a.sourceRow || 0) - (b.sourceRow || 0));
  for (const r of sorted) {
    const id = await store.nextId('person');
    const p = legacyToPerson(r, id);
    if (p.email) await store.claimEmail(p.email, id);
    await store.savePerson(p);
  }
  return { seeded: sorted.length, skipped: false };
}

let shared = null;
async function getStore() {
  if (shared) return shared;
  const conn = process.env.STORAGE_CONNECTION_STRING;
  shared = conn ? new TableStore(conn) : new FileStore(process.env.DATA_FILE || path.join(__dirname, '..', '..', '.data', 'db.json'));
  const seedFile = path.join(__dirname, '..', '..', 'seed', 'legacy-records.json');
  // Local only: in Azure, seed once with `npm run seed` (two cold starts could otherwise seed twice).
  if (!conn && process.env.AUTO_SEED !== 'false' && fs.existsSync(seedFile)) await seedLegacy(shared, JSON.parse(fs.readFileSync(seedFile, 'utf8')));
  return shared;
}

module.exports = { FileStore, TableStore, getStore, seedLegacy, legacyToPerson, formatId, emailKey };
