'use strict';
// One-time: load the NAVES 2025 records into storage with permanent IDs (EIAE-000001 …).
// Usage (production):  STORAGE_CONNECTION_STRING="..." npm run seed
// Safe to re-run: it does nothing if People already has rows.
const fs = require('fs');
const path = require('path');
const { getStore, seedLegacy } = require('../src/lib/stores');
(async () => {
  const file = path.join(__dirname, '..', 'seed', 'legacy-records.json');
  if (!fs.existsSync(file)) { console.error('Missing seed/legacy-records.json. Run: node ../scripts/extract-legacy-records.mjs <hub url>'); process.exit(1); }
  process.env.AUTO_SEED = 'false';
  const store = await getStore();
  const r = await seedLegacy(store, JSON.parse(fs.readFileSync(file, 'utf8')));
  console.log(r.skipped ? 'People already has data. Nothing to do.' : 'Seeded ' + r.seeded + ' people.');
})().catch(e => { console.error(e); process.exit(1); });
