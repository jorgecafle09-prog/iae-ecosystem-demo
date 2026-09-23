'use strict';
// Self-contained checks for the API logic. Runs against a throwaway file store,
// or against Table Storage when STORAGE_CONNECTION_STRING is set (e.g. Azurite).
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeHandlers } = require('../src/lib/core');
const { FileStore, TableStore, seedLegacy } = require('../src/lib/stores');

(async () => {
  const conn = process.env.STORAGE_CONNECTION_STRING;
  let store;
  if (conn) store = new TableStore(conn);
  else { const f = path.join(os.tmpdir(), 'eiae-test-' + Date.now() + '.json'); store = new FileStore(f); }
  const legacy = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'seed', 'legacy-records.sample.json'), 'utf8'));
  const seeded = await seedLegacy(store, legacy);
  assert.strictEqual(seeded.seeded, 3, 'seeds 3 legacy people');
  assert.strictEqual((await seedLegacy(store, legacy)).skipped, true, 'second seed is a no-op');

  let clock = '2026-09-24T12:00:00.000Z';
  const pub = makeHandlers(async () => store, { now: () => clock, limiter: false });
  const team = makeHandlers(async () => store, { now: () => clock, devTeam: true, limiter: false });

  const people0 = (await team.teamPeople({})).jsonBody.people;
  assert.deepStrictEqual(people0.map(p => p.personId), ['EIAE-000001', 'EIAE-000002', 'EIAE-000003'], 'legacy IDs follow source row order');
  assert.strictEqual(people0[0].sensitive.dni, '90000000', 'DNI kept as sensitive data, not as ID');

  // New contact request from the founders website
  const r1 = await pub.register({ type: 'contact', program: 'WISE', name: 'Valentina R.', email: 'Valentina@RaizAgro.com', company: 'Raíz Agro', industry: 'Agtech & food tech', stage: 'Prototype / MVP', describe: 'Soil sensors', looking: 'A mentor' });
  assert.strictEqual(r1.status, 201);
  assert.strictEqual(r1.jsonBody.personId, 'EIAE-000004');
  assert.strictEqual(r1.jsonBody.submissionId, 'REQ-2026-00001');
  assert.strictEqual(r1.jsonBody.isNewPerson, true);

  // Same person applies to NAVES later → same person ID, new application ID
  const r2 = await pub.register({ type: 'naves_application', program: 'NAVES', email: 'valentina@raizagro.com', name: 'Valentina R.', venture: 'Raíz Agro', stage: 'Prototype / MVP', city: 'Córdoba', reviewConsent: true, team: [{ name: 'Martín G.', email: 'martin@raizagro.com' }], answers: { problem: 'Over-irrigation', goals: 'Pilot' } });
  assert.strictEqual(r2.status, 201);
  assert.strictEqual(r2.jsonBody.personId, 'EIAE-000004', 'same email → same person');
  assert.strictEqual(r2.jsonBody.submissionId, 'APP-2026-00001');
  assert.strictEqual(r2.jsonBody.isNewPerson, false);

  // A NAVES 2025 participant registering again is recognised by email
  const r3 = await pub.register({ type: 'contact', program: 'Open Innovation', name: 'Tomás Gómez', email: 'participante02@ejemplo.com', company: 'Raíz', industry: 'Knowledge economy', stage: 'Early revenue' });
  assert.strictEqual(r3.jsonBody.personId, 'EIAE-000002', 'legacy person recognised');
  assert.strictEqual(r3.jsonBody.submissionId, 'REQ-2026-00002');

  // Validation and spam
  const bad = await pub.register({ type: 'contact', program: 'WISE', email: 'nope' });
  assert.strictEqual(bad.status, 400);
  const spam = await pub.register({ type: 'contact', program: 'WISE', email: 'a@b.co', name: 'x', company: 'y', website2: 'http://spam' });
  assert.strictEqual(spam.status, 202);
  const noConsent = await pub.register({ type: 'naves_application', program: 'NAVES', email: 'z@z.co', venture: 'Z' });
  assert.strictEqual(noConsent.status, 400);

  // Year rollover restarts submission numbers, never person numbers
  clock = '2027-01-05T09:00:00.000Z';
  const r4 = await pub.register({ type: 'contact', program: 'Community', name: 'Ana L.', email: 'ana@molinetes.com', company: 'Molinetes SA' });
  assert.strictEqual(r4.jsonBody.submissionId, 'REQ-2027-00001');
  assert.strictEqual(r4.jsonBody.personId, 'EIAE-000005');

  // Cancel reasons
  const x1 = await pub.addExit({ program: 'WISE', reason: 'The form asks for too much', email: 'valentina@raizagro.com', filled: 3 });
  assert.strictEqual(x1.jsonBody.exitId, 'EXT-2027-00001');
  const exits = (await team.teamExits({})).jsonBody.exits;
  assert.strictEqual(exits[0].personId, 'EIAE-000004', 'exit linked to the person by email');

  // Team endpoints are closed to the public
  assert.strictEqual((await pub.teamPeople({})).status, 401);
  const fakeUser = { 'x-ms-client-principal': Buffer.from(JSON.stringify({ userRoles: ['anonymous', 'authenticated'] })).toString('base64') };
  assert.strictEqual((await pub.teamPeople(fakeUser)).status, 401, 'signed in but not on the team');
  const teamUser = { 'x-ms-client-principal': Buffer.from(JSON.stringify({ userRoles: ['authenticated', 'team'] })).toString('base64') };
  assert.strictEqual((await pub.teamPeople(teamUser)).status, 200, 'team role gets in');

  // Public directory: only published people, no sensitive fields
  let dir = (await pub.publicPeople()).jsonBody.people;
  assert.strictEqual(dir.length, 3, 'website registrants are private until the team publishes them');
  assert.ok(!('sensitive' in dir[0]) && !('raw' in dir[0]) && dir[0].email === null, 'no DNI, raw or email in public data');
  await team.teamSetDirectory({}, 'EIAE-000004', { visible: true });
  dir = (await pub.publicPeople()).jsonBody.people;
  assert.ok(dir.some(p => p.personId === 'EIAE-000004' && p.industry === 'Agronegocios' && p.stage === 'Prototipo'), 'published and mapped to Hub vocabulary');

  const subs = (await team.teamSubmissions({})).jsonBody.submissions;
  assert.strictEqual(subs.length, 4);

  // Concurrency: 25 parallel registrations get 25 distinct IDs
  const many = await Promise.all(Array.from({ length: 25 }, (_, i) => pub.register({ type: 'contact', program: 'Community', name: 'P' + i, email: 'p' + i + '@load.test', company: 'C' + i })));
  const ids = new Set(many.map(r => r.jsonBody.personId));
  const subIds = new Set(many.map(r => r.jsonBody.submissionId));
  assert.strictEqual(ids.size, 25, 'unique person IDs under load');
  assert.strictEqual(subIds.size, 25, 'unique submission IDs under load');

  // Consent: publishes automatically, email shared only when allowed
  const rc = await pub.register({ type: 'contact', program: 'WISE', name: 'Julieta F.', email: 'julieta@cianoplast.com', company: 'Cianoplast', industry: 'Advanced materials & chemistry', stage: 'Early revenue', directoryConsent: true, shareContact: true });
  dir = (await pub.publicPeople()).jsonBody.people;
  const jul = dir.find(p => p.personId === rc.jsonBody.personId);
  assert.ok(jul && jul.email === 'julieta@cianoplast.com', 'consent → in directory with email');

  // Status pipeline
  const st1 = await team.teamSetStatus({}, rc.jsonBody.submissionId, { program: 'WISE', status: 'Intro call booked' });
  assert.strictEqual(st1.status, 200);
  assert.strictEqual(st1.jsonBody.submission.statusHistory.length, 2, 'history kept');
  assert.strictEqual((await team.teamSetStatus({}, rc.jsonBody.submissionId, { program: 'WISE', status: 'Admitted' })).status, 400, 'NAVES status not valid for WISE');
  assert.strictEqual((await pub.teamSetStatus({}, rc.jsonBody.submissionId, { program: 'WISE', status: 'Fit review' })).status, 401, 'public cannot change status');
  const firstApp = (await team.teamSubmissions({})).jsonBody.submissions.find(x => x.submissionId === 'APP-2026-00001');
  assert.strictEqual(firstApp.status, 'Received', 'NAVES starts at Received');

  // Rate limit: 8 per 10 minutes per IP
  const { makeLimiter } = require('../src/lib/core');
  const limited = makeHandlers(async () => store, { now: () => clock, limiter: makeLimiter(8, 600000) });
  const ipH = { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' };
  const codes = [];
  for (let i = 0; i < 9; i++) codes.push((await limited.register({ type: 'contact', program: 'Community', name: 'R' + i, email: 'r' + i + '@rate.test', company: 'X' }, ipH)).status);
  assert.deepStrictEqual(codes.slice(-2), [201, 429], '9th form from the same IP is refused');
  assert.strictEqual((await limited.register({ type: 'contact', program: 'Community', name: 'Other', email: 'o@rate.test', company: 'X' }, { 'x-forwarded-for': '198.51.100.7' })).status, 201, 'other IPs unaffected');

  // Emails: built with the IDs, sent through the notifier, never block
  const { buildMessages, makeNotifier } = require('../src/lib/notify');
  assert.strictEqual(makeNotifier({}), null, 'emails off without settings');
  const sent = [];
  const mailing = makeHandlers(async () => store, { now: () => clock, limiter: false, notify: async (ev) => { sent.push(...buildMessages(ev, { OWNER_EMAILS: '{"WISE":"victoria@example.org"}' })); } });
  const rm = await mailing.register({ type: 'contact', program: 'WISE', name: 'Paula N.', email: 'paula@hidra.com.ar', company: 'Hidra' });
  assert.strictEqual(sent.length, 2, 'founder + owner');
  assert.ok(sent[0].text.includes(rm.jsonBody.personId) && sent[0].text.includes(rm.jsonBody.submissionId) && sent[0].text.includes('5 días hábiles'), 'confirmation carries both IDs');
  assert.strictEqual(sent[1].to, 'victoria@example.org');
  const broken = makeHandlers(async () => store, { now: () => clock, limiter: false, notify: async () => { throw new Error('smtp down'); } });
  assert.strictEqual((await broken.register({ type: 'contact', program: 'WISE', name: 'Z', email: 'z@z.test', company: 'Z' })).status, 201, 'email failure does not block');

  console.log('All API checks passed (' + (conn ? 'Table Storage' : 'file store') + ').');
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
