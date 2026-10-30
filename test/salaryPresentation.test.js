const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { formatINR, getNetPayWords } = require('../utils/salarySlipFormatting');

const sampleSalary = {
  employeeName: 'Test Employee',
  employeeId: 'TEST-001',
  monthYear: 'Oct/2026',
  basicSalary: 80000,
  allowance: 0,
  bonus: 0,
  workingDays: 30,
  lopDays: 2,
  lopAmount: 5333.33,
  pfDeduction: 0,
  otherDeduction: 0,
  grossEarnings: 80000,
  totalDeductions: 5333.33,
  netPayable: 74666.67,
};

test('salary amounts round to whole rupees with Indian digit grouping', () => {
  for (const [value, expected] of [
    [74666.67, '74,667'],
    [5333.33, '5,333'],
    [0, '0'],
    [undefined, '0'],
    [999.49, '999'],
    [999.5, '1,000'],
    [99999.5, '1,00,000'],
    ['1234567.50', '12,34,568'],
  ]) {
    assert.equal(formatINR(value), expected, String(value));
  }
  assert.equal(getNetPayWords(74666.67), 'seventy-four thousand, six hundred sixty-seven');
  assert.equal(getNetPayWords(999.49), 'nine hundred ninety-nine');
  assert.equal(getNetPayWords(999.5), 'one thousand');
  assert.equal(getNetPayWords(0), 'zero');
});

test('salary PDF renders rounded table amounts and matching net pay words', async t => {
  const engine = require('../utils/pdfEngine');
  let renderedHtml;
  const pdfBuffer = Buffer.from('%PDF-test-salary');
  t.mock.method(engine, 'create', html => {
    renderedHtml = html;
    return { toBuffer(callback) { callback(null, pdfBuffer); } };
  });

  const generate = require('../utils/salarySlipPdfGenerator');
  assert.equal(await generate(sampleSalary), pdfBuffer);
  const amounts = [...renderedHtml.matchAll(/<td class="amount">([^<]*)<\/td>/g)]
    .map(match => match[1].trim());
  assert.deepEqual(amounts, [
    '80,000', '5,333', '0', '0', '0', '0', '0', '0', '₹ 80,000', '₹ 5,333',
  ]);
  assert.match(renderedHtml, /class="net-pay-value">₹ 74,667<\/div>/);
  assert.match(renderedHtml, /\(Rupees seventy-four thousand, six hundred sixty-seven Only\)/);
  assert.equal(sampleSalary.netPayable, 74666.67);
  assert.equal(sampleSalary.lopAmount, 5333.33);
});

test('salary email shows rounded pay and preserves the archived PDF attachment', async t => {
  const deliveryPath = require.resolve('../utils/deliverDocument');
  const senderPath = require.resolve('../utils/sendSalarySlip');
  require(deliveryPath);
  const previousSender = require.cache[senderPath];
  let captured;
  t.mock.method(require.cache[deliveryPath], 'exports', async (...args) => {
    captured = args;
    return { accepted: ['test@example.invalid'] };
  });
  t.mock.method(require('../utils/pdfEngine'), 'create', () => {
    assert.fail('An archived PDF must not be rendered again by the email sender');
  });
  delete require.cache[senderPath];
  t.after(() => {
    if (previousSender) require.cache[senderPath] = previousSender;
    else delete require.cache[senderPath];
  });

  const send = require(senderPath);
  const pdfBuffer = Buffer.from('%PDF-archived-salary');
  await send('test@example.invalid', {
    ...sampleSalary,
    _pdfBuffer: pdfBuffer,
    _snapshotId: 'salary-snapshot',
  });

  const [options, type, employeeName, snapshotId] = captured;
  assert.equal(options.to, 'test@example.invalid');
  assert.match(options.html, /Net Pay Credited:<\/strong> ₹ 74,667<br>/);
  assert.doesNotMatch(options.html, /74,666\.67/);
  assert.equal(options.attachments[0].content, pdfBuffer);
  assert.equal(type, 'Salary Slip');
  assert.equal(employeeName, sampleSalary.employeeName);
  assert.equal(snapshotId, 'salary-snapshot');
});

test('template revision tags invalidate only the documents whose layout changed', () => {
  const { fingerprint } = require('../utils/documentArchive');
  const data = { employeeName: 'Test Employee', netPayable: 74666.67 };
  const serialized = JSON.stringify(data);
  const legacyHash = type => createHash('sha256').update(type + serialized).digest('hex');

  for (const [type, version] of Object.entries({
    'Salary Slip': 'v5',
    'Appointment Letter': 'v6',
    'Increment Letter': 'v3',
    'Termination Letter': 'v4',
    'FNF Settlement': 'v3',
  })) {
    assert.notEqual(fingerprint(type, data), legacyHash(type), type);
    assert.equal(
      fingerprint(type, data),
      createHash('sha256').update(`${type}:template-${version}:` + serialized).digest('hex'),
      type,
    );
  }
  for (const type of ['Offer Letter', 'Onboarding Report']) {
    assert.equal(fingerprint(type, data), legacyHash(type), type);
  }
  assert.equal(fingerprint('Salary Slip', {
    ...data,
    updatedAt: '2026-10-27T08:00:00.000Z',
    __v: 2,
    emailStatus: 'Sent',
    netPayWords: 'seventy-four thousand, six hundred sixty-seven',
  }), fingerprint('Salary Slip', data));
  assert.notEqual(
    fingerprint('Salary Slip', { ...data, netPayable: 74667.67 }),
    fingerprint('Salary Slip', data),
  );
});
