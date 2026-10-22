const mongoose = require('mongoose');

const CONTRACT_RANK = { draft: 1, sent: 2, signed: 3 };

function emptyLumquoteSummary() {
  return {
    contractStatus: 'none',
    invoiceCount: 0,
    totalInvoiced: 0,
    totalPaid: 0,
    quotes: []
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
    db.collection('invoices').find(filter, { projection: { project: 1, status: 1, total: 1, amountPaid: 1 } }).toArray(),
    attachGroupedQuotes(db, byProject, objectIds)
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

/** Quotes on this project, plus quotes on projects that point back at it. */
async function attachGroupedQuotes(db, byProject, objectIds) {
  const idStrings = objectIds.map(id => String(id));
  const siblings = await db.collection('crmProjects').find(
    {
      archived: { $ne: true },
      $or: [
        { lumdashProject: { $in: objectIds } },
        { lumdashProject: { $in: idStrings } }
      ]
    },
    { projection: { lumdashProject: 1 } }
  ).toArray();

  const projectToAnchor = new Map(idStrings.map(id => [id, id]));
  const siblingIds = [];
  for (const sibling of siblings) {
    const anchor = String(sibling.lumdashProject || '');
    const siblingId = String(sibling._id);
    if (!byProject.has(anchor) || projectToAnchor.has(siblingId)) continue;
    projectToAnchor.set(siblingId, anchor);
    siblingIds.push(sibling._id);
  }

  const quotes = await db.collection('savedQuotes').find(
    { project: { $in: [...objectIds, ...siblingIds] }, archived: { $ne: true } },
    { projection: { project: 1, name: 1, booked: 1, 'quoteData.quoteTitle': 1, 'quoteData.total': 1 } }
  ).toArray();

  const contractProjects = [...objectIds, ...siblingIds];
  const [contracts, groupedInvoices] = await Promise.all([
    db.collection('contracts').find(
      { project: { $in: contractProjects } },
      { projection: { project: 1, status: 1 } }
    ).toArray(),
    db.collection('invoices').find(
      { project: { $in: contractProjects } },
      { projection: { project: 1, status: 1, total: 1, amountPaid: 1 } }
    ).toArray()
  ]);
  const statusByProject = new Map();
  for (const contract of contracts) {
    const key = String(contract.project);
    const status = String(contract.status || '').toLowerCase();
    const rank = CONTRACT_RANK[status] || 0;
    const current = CONTRACT_RANK[statusByProject.get(key)] || 0;
    if (rank > current) statusByProject.set(key, status);
  }
  const invoiceByProject = new Map();
  for (const invoice of groupedInvoices) {
    const key = String(invoice.project);
    if (!invoiceByProject.has(key)) {
      invoiceByProject.set(key, { invoiceCount: 0, totalInvoiced: 0, totalPaid: 0 });
    }
    const bucket = invoiceByProject.get(key);
    bucket.invoiceCount += 1;
    if (String(invoice.status || '').toLowerCase() === 'void') continue;
    bucket.totalInvoiced += finiteNumber(invoice.total);
    bucket.totalPaid += finiteNumber(invoice.amountPaid);
  }

  for (const quote of quotes) {
    const projectId = String(quote.project);
    const row = byProject.get(projectToAnchor.get(projectId));
    if (!row) continue;
    const name = String(quote.name || quote.quoteData?.quoteTitle || '').trim() || 'Quote';
    const invoices = invoiceByProject.get(projectId) || { invoiceCount: 0, totalInvoiced: 0, totalPaid: 0 };
    row.quotes.push({
      name,
      total: finiteNumber(quote.quoteData?.total),
      booked: quote.booked === true,
      projectId,
      contractStatus: statusByProject.get(projectId) || 'none',
      invoiceCount: invoices.invoiceCount,
      totalInvoiced: invoices.totalInvoiced,
      totalPaid: invoices.totalPaid
    });
  }

  for (const row of byProject.values()) {
    row.quotes.sort((a, b) => a.name.localeCompare(b.name));
  }
}

const LUMQUOTE_ORIGIN = String(process.env.LUMQUOTE_BASE_URL || 'https://lumquote.com').replace(/\/$/, '');

function documentTime(doc) {
  const time = new Date(doc?.updatedAt || doc?.createdAt || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

function lumquoteDocumentUrl(kind, publicToken) {
  const token = String(publicToken || '').trim();
  if (!/^[a-f0-9]{16,}$/i.test(token)) return '';
  const path = kind === 'contract' ? 'sign' : 'invoice';
  return `${LUMQUOTE_ORIGIN}/${path}/${token}`;
}

function pickContractLink(contracts) {
  let best = null;
  let bestRank = 0;
  for (const contract of contracts) {
    if (!contract.publicToken) continue;
    const rank = CONTRACT_RANK[String(contract.status || '').toLowerCase()] || 0;
    if (!best || rank > bestRank || (rank === bestRank && documentTime(contract) > documentTime(best))) {
      best = contract;
      bestRank = rank;
    }
  }
  return best ? lumquoteDocumentUrl('contract', best.publicToken) : '';
}

function pickInvoiceLink(invoices) {
  let best = null;
  for (const invoice of invoices) {
    if (String(invoice.status || '').toLowerCase() === 'void') continue;
    if (!invoice.publicToken) continue;
    if (!best || documentTime(invoice) > documentTime(best)) best = invoice;
  }
  return best ? lumquoteDocumentUrl('invoice', best.publicToken) : '';
}

async function fetchLumquoteLinks(externalId) {
  const empty = { contractUrl: '', invoiceUrl: '' };
  const objectId = toProjectObjectId(externalId);
  if (!objectId) return empty;

  const db = mongoose.connection.getClient().db('LumetryMedia');
  const filter = { project: objectId };
  const [contracts, invoices] = await Promise.all([
    db.collection('contracts').find(filter, { projection: { status: 1, publicToken: 1, updatedAt: 1, createdAt: 1 } }).toArray(),
    db.collection('invoices').find(filter, { projection: { status: 1, publicToken: 1, updatedAt: 1, createdAt: 1 } }).toArray()
  ]);
  return {
    contractUrl: pickContractLink(contracts),
    invoiceUrl: pickInvoiceLink(invoices)
  };
}

module.exports = {
  fetchLumquoteBillingByProject,
  fetchLumquoteLinks,
  toProjectObjectId,
  emptyLumquoteSummary
};
