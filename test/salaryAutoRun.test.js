const { test } = require('node:test');
const assert = require('node:assert/strict');
const Employee = require('../models/Employee');
const SalarySlip = require('../models/SalarySlip');
const AutoRun = require('../models/SalarySlipAutoRun');
const ensureMonthlySalarySlips = require('../utils/monthlySalarySlips');
const salaryController = require('../controllers/salaryController');
const autoRunController = require('../controllers/salaryAutoRunController');
const scheduler = require('../utils/monthlySalaryScheduler');
const { today } = require('../utils/istDate');

const HOUR = 60 * 60 * 1000;
// 05 Nov 2026 08:30 IST — deliberately not the 1st, so a server that slept through
// the 1st must still deliver Oct/2026 on its next wake-up.
const WAKE_UP = new Date('2026-11-05T03:00:00Z');
const TARGET_MONTH = 'Oct/2026';

const order = value => (typeof value === 'number' ? value : new Date(value).getTime());
const lt = (left, right) => left !== null && left !== undefined && order(left) < order(right);

const valueMatches = (value, condition) => {
  if (condition === null || typeof condition !== 'object' || condition instanceof Date) {
    if (value instanceof Date || condition instanceof Date) {
      return value !== null && value !== undefined && order(value) === order(condition);
    }
    return value === condition;
  }
  return Object.entries(condition).every(([operator, operand]) => {
    if (operator === '$lt') return lt(value, operand);
    throw new Error(`Unsupported query operator: ${operator}`);
  });
};

const docMatches = (doc, filter) => Object.entries(filter).every(([key, condition]) =>
  key === '$or' ? condition.some(part => docMatches(doc, part)) : valueMatches(doc[key], condition));

// Stands in for the unique monthYear index plus an atomic findOneAndUpdate, which is what
// makes the claim safe across the two backend copies running on the server.
const createLedger = () => {
  const docs = [];
  let nextId = 1;
  const apply = (doc, update) => {
    for (const [key, value] of Object.entries(update.$set || {})) doc[key] = value;
    for (const [key, value] of Object.entries(update.$inc || {})) doc[key] = (doc[key] || 0) + value;
  };
  const blank = monthYear => ({
    _id: `run${nextId++}`,
    monthYear,
    attempts: 0,
    sent: 0,
    failed: 0,
    alreadySent: 0,
    activeEmployees: 0,
    created: 0,
    claimedAt: null,
    finishedAt: null,
    lastError: null,
    runner: null,
  });
  return {
    docs,
    seed(doc = {}) { docs.push({ ...blank(doc.monthYear ?? TARGET_MONTH), ...doc }); return docs[docs.length - 1]; },
    async updateOne(filter, update, options = {}) {
      const doc = docs.find(entry => docMatches(entry, filter));
      if (doc) { apply(doc, update); return { matchedCount: 1 }; }
      if (options.upsert) {
        const created = blank(filter.monthYear);
        apply(created, { $set: update.$setOnInsert || {} });
        docs.push(created);
      }
      return { matchedCount: 0 };
    },
    async findOneAndUpdate(filter, update) {
      const doc = docs.find(entry => docMatches(entry, filter));
      if (!doc) return null;
      apply(doc, update);
      return doc;
    },
    // A Mongoose Query is both thenable and chainable, because skipReason reads .lean().
    findOne(filter) {
      const found = docs.find(entry => docMatches(entry, filter)) || null;
      const value = found ? { ...found } : null;
      return { lean: async () => value, then: (resolve, reject) => Promise.resolve(value).then(resolve, reject) };
    },
  };
};

const slip = (overrides = {}) => ({
  _id: 'slip1',
  employee: 'e1',
  employeeId: 'VAM-0001',
  employeeEmail: 'radha@viraladsmedia.com',
  emailStatus: 'Pending',
  updatedAt: WAKE_UP,
  save: async function save() { return this; },
  ...overrides,
});

const employee = { _id: 'e1', email: 'radha@viraladsmedia.com', empId: 'VAM-0001' };

const harness = async (t, { employees, slips, send, ledger = createLedger() } = {}) => {
  const sent = [];
  t.mock.method(ensureMonthlySalarySlips, 'ensurePreviousMonth', async () => ({ created: 0 }));
  t.mock.method(Employee, 'find', filter => {
    t.__employeeFilter = filter;
    return { select: () => ({ lean: async () => employees ?? [employee] }) };
  });
  t.mock.method(SalarySlip, 'find', filter => {
    t.__slipFilter = filter;
    return Promise.resolve(slips ?? [slip()]);
  });
  t.mock.method(salaryController, 'sendSalarySlipRecord', async record => {
    if (send) send(record);
    sent.push(record.employeeEmail);
    return record;
  });
  for (const method of ['updateOne', 'findOneAndUpdate', 'findOne']) {
    t.mock.method(AutoRun, method, (...args) => ledger[method](...args));
  }
  return { ledger, sent };
};

test('a payslip month is delivered on the first tick after the server wakes up', async t => {
  const { ledger, sent } = await harness(t);
  const result = await scheduler.runIfDue(WAKE_UP);
  assert.equal(result.monthYear, TARGET_MONTH);
  assert.equal(result.sent, 1);
  assert.deepEqual(sent, ['radha@viraladsmedia.com']);
  assert.equal(t.__slipFilter.monthYear, TARGET_MONTH);
  assert.equal(ledger.docs.length, 1);
  assert.equal(ledger.docs[0].finishedAt instanceof Date, true);
});

test('a completed month is never re-sent on a later tick', async t => {
  const { ledger, sent } = await harness(t);
  await scheduler.runIfDue(WAKE_UP);
  const second = await scheduler.runIfDue(new Date(WAKE_UP.getTime() + HOUR));
  assert.equal(second.skipped, 'delivered');
  assert.equal(sent.length, 1);
  assert.equal(ledger.docs[0].attempts, 1);
});

test('a pass already claimed by the other backend copy is left alone', async t => {
  const ledger = createLedger();
  ledger.seed({ claimedAt: new Date(WAKE_UP.getTime() - 60 * 1000), attempts: 1 });
  const { sent } = await harness(t, { ledger });
  const result = await scheduler.runIfDue(WAKE_UP);
  assert.equal(result.skipped, 'in-progress');
  assert.equal(sent.length, 0);
  assert.equal(ledger.docs[0].attempts, 1);
});

test('a claim abandoned by a process that died mid-send is taken over', async t => {
  const ledger = createLedger();
  ledger.seed({ claimedAt: new Date(WAKE_UP.getTime() - 3 * HOUR), attempts: 1 });
  const { sent } = await harness(t, { ledger });
  const result = await scheduler.runIfDue(WAKE_UP);
  assert.equal(result.sent, 1);
  assert.equal(sent.length, 1);
  assert.equal(ledger.docs[0].attempts, 2);
  assert.equal(ledger.docs[0].finishedAt instanceof Date, true);
});

test('a month with delivery failures stays open for the next tick, then stops retrying', async t => {
  const ledger = createLedger();
  const record = slip();
  let attemptsSeen = 0;
  const { sent } = await harness(t, {
    ledger,
    slips: [record],
    send: () => { throw new Error('SMTP handshake timed out'); },
  });

  for (let tick = 0; tick < scheduler.MAX_ATTEMPTS + 2; tick += 1) {
    attemptsSeen = ledger.docs[0]?.attempts ?? 0;
    await scheduler.runIfDue(new Date(WAKE_UP.getTime() + tick * HOUR));
  }

  assert.equal(sent.length, 0);
  assert.equal(record.emailStatus, 'Failed');
  assert.equal(ledger.docs[0].finishedAt, null);
  assert.equal(ledger.docs[0].claimedAt, null);
  assert.equal(ledger.docs[0].failed, 1);
  assert.match(ledger.docs[0].lastError, /SMTP handshake timed out/);
  assert.equal(attemptsSeen, scheduler.MAX_ATTEMPTS);
});

test('only Active employees are considered and an already-sent employee is skipped', async t => {
  const { ledger, sent } = await harness(t, { slips: [slip({ emailStatus: 'Sent' })] });
  const result = await scheduler.runIfDue(WAKE_UP);
  assert.deepEqual(t.__employeeFilter, { status: { $ne: 'Non Active' } });
  assert.equal(result.sent, 0);
  assert.equal(result.alreadySent, 1);
  assert.equal(sent.length, 0);
  assert.equal(ledger.docs[0].finishedAt instanceof Date, true);
});

test('a manual run reports the month outcome without touching the ledger', async t => {
  const ledger = createLedger();
  const { sent } = await harness(t, { ledger });
  const result = await scheduler.runNow(WAKE_UP);
  assert.equal(result.monthYear, TARGET_MONTH);
  assert.equal(result.sent, 1);
  assert.equal(sent.length, 1);
  assert.equal(ledger.docs.length, 0);
});

const response = () => ({
  code: 200,
  status(code) { this.code = code; return this; },
  json(body) { this.body = body; return this; },
});

const ledgerRow = (overrides = {}) => ({
  monthYear: TARGET_MONTH,
  attempts: 0,
  sent: 0,
  failed: 0,
  alreadySent: 0,
  activeEmployees: 0,
  created: 0,
  claimedAt: null,
  finishedAt: null,
  lastError: null,
  runner: null,
  ...overrides,
});

const mockLedger = (t, rows) => {
  t.mock.method(AutoRun, 'find', () => ({ sort: () => ({ limit: () => ({ lean: async () => rows }) }) }));
};

test('the status endpoint reports the month that is due, not just the newest row', async t => {
  const due = scheduler.previousMonthKey(today());
  mockLedger(t, [
    ledgerRow({ monthYear: 'Jun/2026' }),
    ledgerRow({ monthYear: due, finishedAt: new Date(), sent: 9 }),
  ]);
  const res = response();
  await autoRunController.getAutoRunStatus({}, res);
  assert.equal(res.code, 200);
  assert.equal(res.body.targetMonthYear, due);
  assert.equal(res.body.lastRun.state, 'Delivered');
  assert.equal(res.body.lastRun.sent, 9);
  assert.equal(res.body.history.length, 2);
});

test('ledger rows are labelled so HR can tell delivered from stuck', async t => {
  const rows = [
    ledgerRow({ finishedAt: new Date() }),
    ledgerRow({ attempts: scheduler.MAX_ATTEMPTS, lastError: 'SMTP down' }),
    ledgerRow({ attempts: 1, claimedAt: new Date() }),
    ledgerRow(),
  ];
  mockLedger(t, rows);
  const res = response();
  await autoRunController.getAutoRunStatus({}, res);
  assert.deepEqual(res.body.history.map(row => row.state),
    ['Delivered', 'Retries exhausted', 'In progress', 'Waiting']);
});

test('the manual run answers with one readable line', async t => {
  t.mock.method(scheduler, 'runNow', async () => ({
    monthYear: TARGET_MONTH, sent: 3, failed: 1, alreadySent: 2,
  }));
  const res = response();
  await autoRunController.triggerAutoRun({}, res);
  assert.equal(res.body.message, '3 sent, 1 failed, 2 already delivered');
});

test('the status endpoint answers 500 when the ledger cannot be read', async t => {
  t.mock.method(AutoRun, 'find', () => { throw new Error('collection unavailable'); });
  const res = response();
  await autoRunController.getAutoRunStatus({}, res);
  assert.equal(res.code, 500);
  assert.equal(res.body.success, false);
});
