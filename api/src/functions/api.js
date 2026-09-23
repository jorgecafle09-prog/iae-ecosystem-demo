'use strict';
// Azure Functions (Node.js v4 programming model). Static Web Apps serves these under /api/*.
const { app } = require('@azure/functions');
const { makeHandlers } = require('../lib/core');
const { getStore } = require('../lib/stores');
const { makeNotifier } = require('../lib/notify');

const h = makeHandlers(getStore, { notify: makeNotifier() });
const headersOf = (req) => Object.fromEntries(req.headers.entries());
const bodyOf = async (req) => { try { return await req.json(); } catch (e) { return null; } };
const wrap = (fn) => async (req, ctx) => {
  try { return await fn(req, ctx); }
  catch (err) { ctx.error(err); return { status: 500, jsonBody: { ok: false, error: 'Server error' } }; }
};

app.http('registrations', { methods: ['POST'], authLevel: 'anonymous', route: 'registrations', handler: wrap(async (req) => h.register(await bodyOf(req), headersOf(req))) });
app.http('exits', { methods: ['POST'], authLevel: 'anonymous', route: 'exits', handler: wrap(async (req) => h.addExit(await bodyOf(req), headersOf(req))) });
app.http('entrepreneurs', { methods: ['GET'], authLevel: 'anonymous', route: 'entrepreneurs', handler: wrap(async () => h.publicPeople()) });
app.http('statuses', { methods: ['GET'], authLevel: 'anonymous', route: 'statuses', handler: wrap(async () => h.statuses()) });
// "admin" is a reserved route prefix in Azure Functions, so team endpoints live under /api/team/*.
app.http('teamPeople', { methods: ['GET'], authLevel: 'anonymous', route: 'team/people', handler: wrap(async (req) => h.teamPeople(headersOf(req))) });
app.http('teamSubmissions', { methods: ['GET'], authLevel: 'anonymous', route: 'team/submissions', handler: wrap(async (req) => h.teamSubmissions(headersOf(req))) });
app.http('teamExits', { methods: ['GET'], authLevel: 'anonymous', route: 'team/exits', handler: wrap(async (req) => h.teamExits(headersOf(req))) });
app.http('teamDirectory', { methods: ['POST'], authLevel: 'anonymous', route: 'team/people/{personId}/directory', handler: wrap(async (req) => h.teamSetDirectory(headersOf(req), req.params.personId, await bodyOf(req))) });
app.http('teamStatus', { methods: ['POST'], authLevel: 'anonymous', route: 'team/submissions/{submissionId}/status', handler: wrap(async (req) => h.teamSetStatus(headersOf(req), req.params.submissionId, await bodyOf(req))) });
