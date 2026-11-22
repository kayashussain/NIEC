// Try the whole system on your own computer with made-up students, before anything goes to the server.
//
//   node scripts/local-demo.js            starts it at http://localhost:8080 with a fresh demo folder (demo-data/)
//   node scripts/local-demo.js --keep     starts it again on the demo folder as you left it
//   PORT=9000 node scripts/local-demo.js  another port
//
// Nothing here is a real student (see scripts/demo-data.js) and nothing leaves your computer: the server sends no email (Follow-up
// keeps each email as a preview on the student's card until a mailbox is set up).
// The demo folder is never in git. To start from nothing again, press Ctrl+C and run the command without --keep.
//
// Log in at /login with one of these (demo passwords only, they are nothing to do with the real site):
//   owner   Admin (sees everything, the Incentive page asks for "Demo Incentive 1")
//   chief   Manager (the Dashboard and every student, view only)
//   asha    Application Team      bikram   Mock Team      sunita   Follow-up Team
//   chitwan Chitwan Branch        palpa    Palpa Branch
//   password for all of them: Demo-Password-2026

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { hashPassword } = require('../shared/accounts');
const { writeFileAtomic, localDate } = require('../shared/server-utils');
const { buildDemo } = require('./demo-data');

const root = path.join(__dirname, '..');
const dir = path.join(root, 'demo-data');
const studentsDir = path.join(dir, 'student-details');
const port = process.env.PORT || '8080';
const keep = process.argv.includes('--keep') && fs.existsSync(path.join(studentsDir, 'data.json'));

function write(name, data) { writeFileAtomic(path.join(studentsDir, name), JSON.stringify(data, null, 1)); }

if (!keep) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, 'counselor-incentive'), { recursive: true });
  fs.mkdirSync(studentsDir, { recursive: true });
  const demo = buildDemo({ today: localDate() });
  write('data.json', demo.workbook);
  write('cards.json', { cards: demo.cards });
  write('planning.json', demo.planning);
  write('b2b-partners.json', { universities: demo.b2b });
  write('agents.json', { universities: demo.agents });
  const hash = hashPassword('Demo-Password-2026');
  const person = (username, name, role, departments) => ({ id: require('crypto').randomBytes(8).toString('hex'), username, name, email: '', role, departments, passwordHash: hash, mustChangePassword: false, disabled: false, createdAt: new Date().toISOString() });
  const bikram = person('bikram', 'Bikram Demo', 'staff', ['mock']);
  write('users.json', { users: [
    person('owner', 'Owner Demo', 'admin', []), person('chief', 'Chief Demo', 'manager', []),
    person('asha', 'Asha Demo', 'staff', ['application']), bikram, person('sunita', 'Sunita Demo', 'staff', ['followup']), person('chitwan', 'Chitwan Branch Demo', 'staff', ['chitwan']), person('palpa', 'Palpa Branch Demo', 'staff', ['palpa']),
  ] });
  // The Mock Team's Bookings (made up): Bikram's link set up, slots Sunday to Friday, and a few mocks booked by made-up students at
  // Mock Stage (one already over and not answered, so the window after a mock shows).
  write('mock-bookings.json', demoBookings(demo.workbook, bikram.id));
  console.log('Made a fresh demo folder with', demo.workbook.sheets.reduce((n, s) => n + s.rows.length, 0), 'made-up students.');
}

function demoBookings(workbook, owner) {
  const { newestSheet } = require('../shared/teams');
  const sheet = newestSheet(workbook.sheets.filter((x) => !x.hidden));
  const rows = (sheet ? sheet.rows : []).filter((r) => r['APPLICATION STATUS'] === 'Mock Stage' && r.EMAIL).slice(0, 5);
  const slots = [['10:00', '10:30'], ['11:30', '12:30'], ['15:30', '16:00']];
  const weekly = { 0: slots, 1: slots, 2: slots, 3: slots, 4: slots, 5: [['10:00', '13:00']] };
  const addDays = (n) => { const t = new Date(localDate() + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
  const plan = [[-1, '11:30'], [1, '10:00'], [1, '15:30'], [2, '11:30'], [3, '10:00']];
  const bookings = rows.map((r, i) => {
    const next = [1, 2, 3, 4].find((n) => !r[`MOCK SCHEDULE ${n}`]) || 4;
    return { id: require('crypto').randomBytes(6).toString('hex'), token: require('crypto').randomBytes(18).toString('base64url'), owner, day: addDays(plan[i][0]), time: plan[i][1], minutes: 30,
      name: [r['FIRST NAME'], r['LAST NAME']].filter(Boolean).join(' '), email: String(r.EMAIL).toLowerCase(), phone: r['CONTACT NUMBER'] || '', rowId: r._id, mock: next,
      university: r['UNIVERSITY NAME'] || '', course: r['COURSE NAME'] || '', status: 'booked', at: new Date().toISOString(), siteUrl: '', answer: null, sent: { dayBefore: true, hourBefore: true } };
  });
  return { people: { [owner]: { slug: 'bikram', shown: 'Bikram, Mock Team', teams: 'https://teams.live.com/meet/9300000000000?p=DemoOnly', email: '', minutes: 30, weekly, dates: {}, ahead: 30, notice: 60 } }, bookings };
}

console.log(`\nStarting the system at http://localhost:${port}\nLog in as owner (Admin), chief (Manager), asha, bikram, sunita, chitwan or palpa. Password: Demo-Password-2026\nPress Ctrl+C to stop.\n`);
const env = { ...process.env, ISR_DEMO: '1', HOST: '127.0.0.1', PORT: port, STUDENT_DETAILS_DATA_DIR: studentsDir, COUNSELOR_DATA_DIR: path.join(dir, 'counselor-incentive'), INCENTIVE_PASSWORD: process.env.INCENTIVE_PASSWORD || 'Demo Incentive 1' };
const child = spawn(process.execPath, [path.join(root, 'student-details', 'server.js')], { env, stdio: 'inherit' });
child.on('exit', (code) => process.exit(code || 0));
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
