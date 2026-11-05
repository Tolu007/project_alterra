// Exercises the API end to end: two players sign up, join, act, see each other; a visit is tracked; an admin
// reads the stats. Usage: node scripts/api-smoke.mjs http://localhost:5199 [admin email]
const base = (process.argv[2] ?? 'http://localhost:5174').replace(/\/$/, '');
const adminEmail = process.argv[3] ?? 'boss@example.com';
const run = Date.now().toString(36);

function client() {
  let cookie = '';
  return async (path, body) => {
    const res = await fetch(base + '/api' + path, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    return { status: res.status, json: JSON.parse(text), bytes: text.length };
  };
}
const ok = (cond, msg) => {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exitCode = 1;
  } else console.log('ok:', msg);
};

const looks = { skin: 2, hair: 1, outfit: 3, accent: 2, glasses: false };
const a = client();
const b = client();
const admin = client();

let r = await a('/auth/signup', { name: 'Ada Eze', email: `ada-${run}@example.com`, password: 'jollof123' });
ok(r.status === 200 && r.json.account.name === 'Ada Eze', 'Ada signs up');
r = await a('/auth/signup', { name: 'Ada Again', email: `ada-${run}@example.com`, password: 'jollof123' });
ok(r.status === 409, 'the same email cannot sign up twice');
r = await b('/auth/signup', { name: 'Tunde Bello', email: `tunde-${run}@example.com`, password: 'short' });
ok(r.status === 400, 'a short password is refused');
r = await b('/auth/signup', { name: 'Tunde Bello', email: `tunde-${run}@example.com`, password: 'suya-night' });
ok(r.status === 200, 'Tunde signs up');

r = await a('/world/join', { gender: 'f', looks, home: 'IKJ', start: { kind: 'business', type: 'stall' } });
ok(r.status === 200 && r.json.game?.player.home === 'IKJ', `Ada joins the world (${Math.round(r.bytes / 1024)} KB view)`);
const adaId = r.json.game.me;
r = await b('/world/join', { gender: 'm', looks, home: 'IKJ', start: { kind: 'job', trade: 'factory' } });
ok(r.status === 200, 'Tunde joins the world');
const tundeId = r.json.game.me;
ok(r.json.game.others.some((o) => o.id === adaId), 'Tunde can see Ada in town');
ok(!JSON.stringify(r.json.game.seats).includes('Ada'), "Tunde is not sent Ada's private life");
r = await a('/world/join', { gender: 'f', looks, home: 'IKJ', start: { kind: 'business', type: 'stall' } });
ok(r.status === 409, 'you cannot make a second character while the first is alive');

r = await a('/world/act', { intent: { kind: 'act', id: 'cook', place: 'home', lot: null } });
ok(r.json.result?.ok === true, `Ada cooks: "${r.json.result?.text}"`);
r = await a('/world/act', { intent: { kind: 'act', id: 'family', place: 'home', lot: null } });
ok(r.json.result?.ok === true, 'and spends time with family straight after, no waiting');
r = await a('/world/act', { intent: { kind: 'act', id: 'family', place: 'home', lot: null } });
ok(r.json.result?.ok === false && /Done for today/.test(r.json.result.text), 'but only once a day');
r = await a('/world/act', { intent: { kind: 'act', id: 'cook', place: 'palace', lot: null } });
ok(r.json.result?.ok === false, 'you cannot act at a place that is not in your LGA');

// Getting around: a danfo from the bus stop along the real roads, and no new trip while still on the road.
r = await b('/world/act', { intent: { kind: 'act', id: 'travel:OSH', place: 'busstop', lot: null } });
if (r.json.result?.ok) ok(r.json.game.player.at === 'OSH' && r.json.game.place === 'busstop', `Tunde takes a danfo to Oshodi: "${r.json.result.text}"`);
else ok(/Closed|before/.test(r.json.result?.text ?? ''), `no danfo right now: "${r.json.result?.text}"`);
r = await b('/world/act', { intent: { kind: 'act', id: 'travel:ETI:taxi', place: r.json.game.place, lot: null } });
ok(r.json.result?.ok === true || /money/.test(r.json.result?.text ?? ''), `and books a car on to Lekki straight away: "${r.json.result?.text}"`);

const v = r.json.version;
r = await b(`/world?v=${v}`);
ok(r.json.same === true || r.json.version >= v, 'polling with the current version is cheap');
ok(r.json.online >= 2, `online now: ${r.json.online}`);

r = await fetch(base + '/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ visitor: `v-${run}`, path: '/', referrer: '' }) });
ok(r.status === 200, 'a visit is tracked');

r = await a('/stats');
ok(r.status === 403, 'stats are for admins only');
r = await admin('/auth/login', { email: adminEmail, password: 'admin-pass-1' });
if (r.status !== 200) r = await admin('/auth/signup', { name: 'Site Admin', email: adminEmail, password: 'admin-pass-1' });
r = await admin('/stats');
ok(r.status === 200 && r.json.onlineNow >= 2 && r.json.visitsToday >= 1, `admin stats: ${r.json.onlineNow} online, ${r.json.players} players, ${r.json.visitsToday} visits today`);

r = await a('/auth/logout', {});
r = await a('/world');
ok(r.status === 401, 'after logging out the world is closed to you');
r = await a('/auth/login', { email: `ada-${run}@example.com`, password: 'wrong-one' });
ok(r.status === 401, 'a wrong password is refused');
r = await a('/auth/login', { email: `ada-${run}@example.com`, password: 'jollof123' });
r = await a('/world');
ok(r.json.game?.me === adaId, 'logging back in returns you to your character');
void tundeId;
