const mongoose = require('mongoose');

const CONTRACT_RANK = { draft: 1, sent: 2, signed: 3 };

function emptyLumquoteSummary() {
  return {
    contractStatus: 'none',
    invoiceCount: 0,
    totalInvoiced: 0,
    totalPaid: 0
  };
}

function toProjectObjectId(value) {
  const hex = String(value || '').trim();
  if (!/^[a-fA-F0-9]{24}$/.test(hex)) return null;
  if (!mongoose.Types.ObjectId.isValid(hex)) return null;
  return new mongoose.Types.ObjectId(hex);
}

function finiteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Read contract and invoice status for LumQuote projects.
 * Read-only against LumetryMedia. Does not write and does not copy documents.
 * @param {string[]} externalIds LumQuote project ids
 * @returns {Promise<Map<string, {contractStatus: string, invoiceCount: number, totalInvoiced: number, totalPaid: number}>>}
 */
async function fetchLumquoteBillingByProject(externalIds) {
  const objectIds = [];
  const seen = new Set();
  for (const id of externalIds || []) {
    const objectId = toProjectObjectId(id);
    if (!objectId) continue;
    const key = String(objectId);
    if (seen.has(key)) continue;
    seen.add(key);
    objectIds.push(objectId);
  }

  const byProject = new Map();
  for (const objectId of objectIds) {
    byProject.set(String(objectId), emptyLumquoteSummary());
  }
  if (!objectIds.length) return byProject;

  const client = mongoose.connection.getClient();
  const db = client.db('LumetryMedia');
  const filter = { project: { $in: objectIds } };
  const [contracts, invoices] = await Promise.all([
    db.collection('contracts').find(filter, { projection: { project: 1, status: 1 } }).toArray(),
    db.collection('invoices').find(filter, { projection: { project: 1, status: 1, total: 1, amountPaid: 1 } }).toArray()
  ]);

  for (const contract of contracts) {
    const row = byProject.get(String(contract.project));
    if (!row) continue;
    const status = String(contract.status || '').toLowerCase();
    const rank = CONTRACT_RANK[status] || 0;
    const current = CONTRACT_RANK[row.contractStatus] || 0;
    if (rank > current) row.contractStatus = status;
  }

  for (const invoice of invoices) {
    const row = byProject.get(String(invoice.project));
    if (!row) continue;
    row.invoiceCount += 1;
    if (String(invoice.status || '').toLowerCase() === 'void') continue;
    row.totalInvoiced += finiteNumber(invoice.total);
    row.totalPaid += finiteNumber(invoice.amountPaid);
  }

  return byProject;
}

module.exports = {
  fetchLumquoteBillingByProject,
  toProjectObjectId,
  emptyLumquoteSummary
};
