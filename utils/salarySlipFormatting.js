const { toWords } = require('number-to-words');

const roundRupees = value => Math.round(Number(value) || 0);

const formatINR = value => roundRupees(value).toLocaleString('en-IN', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const getNetPayWords = value => toWords(roundRupees(value));

module.exports = { formatINR, getNetPayWords };
