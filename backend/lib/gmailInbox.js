const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const GmailConnection = require('../models/GmailConnection');
const GmailMessage = require('../models/GmailMessage');
const Client = require('../models/Client');
const VideoProject = require('../models/VideoProject');
const PostProductionItem = require('../models/PostProductionItem');
const Table = require('../models/Table');

const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const SYNC_INTERVAL_MS = 2 * 60 * 1000;
const SYNC_VERSION = 5;
const PER_EVENT_MESSAGES = 8;
const pendingConnects = new Map();
const syncing = new Map();
let indexesReady = null;

async function listIndexes(model) {
  try {
    return await model.collection.indexes();
  } catch (err) {
    if (err.code === 26 || err.codeName === 'NamespaceNotFound') return [];
    throw err;
  }
}

function ensureGmailIndexes() {
  if (indexesReady) return indexesReady;
  indexesReady = (async () => {
    const connIndexes = await listIndexes(GmailConnection);
    const keyIdx = connIndexes.find(idx => idx.key && idx.key.key === 1);
    if (keyIdx) await GmailConnection.collection.dropIndex(keyIdx.name);
    const msgIndexes = await listIndexes(GmailMessage);
    const legacy = msgIndexes.find(idx => idx.unique && idx.key && idx.key.gmailId === 1 && !idx.key.userId);
    if (legacy) await GmailMessage.collection.dropIndex(legacy.name);
    if (connIndexes.length) await GmailConnection.deleteMany({ userId: { $exists: false } });
    if (msgIndexes.length) await GmailMessage.deleteMany({ userId: { $exists: false } });
    await GmailConnection.syncIndexes();
    await GmailMessage.syncIndexes();
  })().catch(err => {
    indexesReady = null;
    console.error('Gmail indexes:', err.message);
  });
  return indexesReady;
}

function gmailConfigured() {
  return !!(process.env.GOOGLE_GMAIL_CLIENT_ID && process.env.GOOGLE_GMAIL_CLIENT_SECRET);
}

function appBase(req) {
  const proto = String(req.get('x-forwarded-proto') || req.protocol || 'https').split(',')[0].trim();
  const host = String(req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim();
  return `${proto}://${host}`;
}

function redirectUri(req) {
  return `${appBase(req)}/api/gmail/callback`;
}

function redirectUris(req) {
  const uris = [];
  const add = (value) => {
    const uri = String(value || '').trim();
    if (uri && !uris.includes(uri)) uris.push(uri);
  };
  add(redirectUri(req));
  const appUrl = String(process.env.APP_URL || '').replace(/\/$/, '');
  if (/^https?:\/\//i.test(appUrl)) add(`${appUrl}/api/gmail/callback`);
  return uris;
}

function encKey() {
  return crypto.scryptSync(process.env.JWT_SECRET || 'lumdash', 'lumdash-gmail', 32);
}

function encrypt(plain) {
  if (!plain) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encKey(), iv);
  const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, data]).toString('base64');
}

function decrypt(enc) {
  if (!enc) return '';
  const buf = Buffer.from(enc, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', encKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

function safeReturn(value) {
  if (typeof value !== 'string') return '/dashboard.html#general';
  if (!value.startsWith('/dashboard.html')) return '/dashboard.html#general';
  if (value.includes('\\') || value.includes('//')) return '/dashboard.html#general';
  return value.slice(0, 500);
}

function withGmailFlag(returnTo, flag, reason) {
  const hashIndex = returnTo.indexOf('#');
  const path = hashIndex === -1 ? returnTo : returnTo.slice(0, hashIndex);
  const hash = hashIndex === -1 ? '' : returnTo.slice(hashIndex);
  const [base, query] = path.split('?');
  const params = new URLSearchParams(query || '');
  params.set('gmail', flag);
  if (reason) params.set('reason', String(reason).slice(0, 180));
  else params.delete('reason');
  return `${base}?${params.toString()}${hash}`;
}

function prunePending() {
  const now = Date.now();
  for (const [code, row] of pendingConnects) {
    if (row.exp < now) pendingConnects.delete(code);
  }
}

async function statusFor(user, req) {
  await ensureGmailIndexes();
  const conn = user?.id ? await GmailConnection.findOne({ userId: user.id }).lean() : null;
  const connected = !!(conn && conn.refreshTokenEnc);
  return {
    configured: gmailConfigured(),
    connected,
    email: connected ? (conn.email || '') : '',
    connectedAt: connected ? conn.connectedAt : null,
    lastSyncAt: conn?.lastSyncAt || null,
    lastError: conn?.lastError || '',
    redirectUri: redirectUri(req),
    redirectUris: redirectUris(req),
    canConnect: !!user?.id
  };
}

function beginConnect(user, returnTo) {
  if (!user?.id) {
    const err = new Error('Sign in to connect your Gmail');
    err.status = 401;
    throw err;
  }
  if (!gmailConfigured()) {
    const err = new Error('Google client id and secret are not on the server yet');
    err.status = 400;
    throw err;
  }
  prunePending();
  const code = crypto.randomBytes(24).toString('hex');
  pendingConnects.set(code, {
    uid: user.id,
    name: user.fullName || '',
    returnTo: safeReturn(returnTo),
    exp: Date.now() + 5 * 60 * 1000
  });
  return code;
}

function googleAuthUrl(req, code) {
  prunePending();
  const pending = pendingConnects.get(code);
  if (!pending) {
    const err = new Error('This connect link expired. Open the guide and try again.');
    err.status = 400;
    throw err;
  }
  pendingConnects.delete(code);
  if (!gmailConfigured()) {
    const err = new Error('Google client id and secret are not on the server yet');
    err.status = 400;
    throw err;
  }
  const state = jwt.sign({
    purpose: 'gmail-connect',
    uid: pending.uid,
    name: pending.name,
    returnTo: pending.returnTo
  }, process.env.JWT_SECRET, { expiresIn: '10m' });

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_GMAIL_CLIENT_ID,
    redirect_uri: redirectUri(req),
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'false',
    state
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

async function tokenRequest(body) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error_description || data.error || 'Google rejected the token request');
    err.status = 400;
    throw err;
  }
  return data;
}

async function accessTokenFor(conn) {
  const stillValid = conn.accessTokenExpiresAt && conn.accessTokenExpiresAt.getTime() > Date.now() + 60 * 1000;
  if (stillValid && conn.accessTokenEnc) return decrypt(conn.accessTokenEnc);
  const refresh = decrypt(conn.refreshTokenEnc);
  if (!refresh) throw new Error('The inbox needs to be connected again');
  const data = await tokenRequest({
    client_id: process.env.GOOGLE_GMAIL_CLIENT_ID,
    client_secret: process.env.GOOGLE_GMAIL_CLIENT_SECRET,
    refresh_token: refresh,
    grant_type: 'refresh_token'
  });
  conn.accessTokenEnc = encrypt(data.access_token);
  conn.accessTokenExpiresAt = new Date(Date.now() + (Number(data.expires_in) || 3600) * 1000);
  await conn.save();
  return data.access_token;
}

function parseEmails(header) {
  if (!header) return [];
  const found = String(header).match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
  return [...new Set(found.map(email => email.toLowerCase()))];
}

function parseFrom(header) {
  const emails = parseEmails(header);
  const name = String(header || '')
    .replace(/<[^>]*>/g, '')
    .replace(/"/g, '')
    .trim();
  return { email: emails[0] || '', name: name || emails[0] || 'Someone' };
}

function decodeHtml(value) {
  let text = String(value || '');
  for (let pass = 0; pass < 2; pass += 1) {
    const next = text
      .replace(/&#(\d+);/g, (match, n) => {
        const code = Number(n);
        if (!Number.isInteger(code) || code < 1 || code > 0x10FFFF) return match;
        return String.fromCodePoint(code);
      })
      .replace(/&#x([0-9a-f]+);/gi, (match, n) => {
        const code = parseInt(n, 16);
        if (!Number.isFinite(code) || code < 1 || code > 0x10FFFF) return match;
        return String.fromCodePoint(code);
      })
      .replace(/&quot;/gi, '"')
      .replace(/&apos;/gi, "'")
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&');
    if (next === text) break;
    text = next;
  }
  return text.replace(/\s+/g, ' ').trim();
}

function messageRfcId(header) {
  const raw = String(header || '').trim();
  if (!raw) return '';
  const wrapped = raw.match(/<([^<>\s]+)>/);
  const id = (wrapped ? wrapped[1] : raw).trim();
  if (!id || id.length > 998 || /\s/.test(id)) return '';
  return id;
}

function messageHref(row, mailbox) {
  const rfc = String(row.rfc822Id || '').trim();
  const gmailId = String(row.gmailId || '').trim();
  const auth = mailbox ? `?authuser=${mailbox}` : '';
  const base = `https://mail.google.com/mail/u/0/${auth}`;
  // Same shape as a Gmail message you already have open:
  // #search/rfc822msgid%3A<id>/<message id>
  // The id after the slash is what opens the message instead of leaving the results list.
  if (rfc) {
    const query = `rfc822msgid%3A${encodeURIComponent(rfc)}`;
    return gmailId ? `${base}#search/${query}/${gmailId}` : `${base}#search/${query}`;
  }
  if (gmailId) return `${base}#all/${gmailId}`;
  return '';
}

function headerMap(payload) {
  const map = {};
  for (const header of payload?.headers || []) {
    map[String(header.name || '').toLowerCase()] = header.value || '';
  }
  return map;
}

function dayOnly(value) {
  const match = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function addDays(date, days) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function gmailDay(date) {
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${date.getUTCFullYear()}/${month}/${day}`;
}

function windowFor(start, end) {
  const startDay = dayOnly(start);
  const endDay = dayOnly(end) || startDay;
  const now = new Date();
  if (!startDay) return { after: addDays(now, -90), before: addDays(now, 1) };
  const after = addDays(startDay, -120);
  let before = addDays(endDay, 46);
  const cap = addDays(now, 2);
  if (before > cap) before = cap;
  if (before <= after) before = addDays(after, 1);
  return { after, before };
}

function sentInWindow(sentAt, target) {
  const time = new Date(sentAt).getTime();
  return !Number.isNaN(time) && time >= target.after.getTime() && time < target.before.getTime();
}

function usableEmail(value, ignore) {
  const email = String(value || '').toLowerCase().trim();
  if (!email || !email.includes('@') || ignore.has(email)) return '';
  return email;
}

async function searchTargets(ignore) {
  const targets = new Map();
  const touch = (id, start, end) => {
    const key = String(id || '');
    if (!key) return null;
    if (!targets.has(key)) targets.set(key, { id: key, emails: new Set(), ...windowFor(start, end) });
    return targets.get(key);
  };

  const tables = await Table.find({ 'general.contacts.0': { $exists: true } })
    .select('_id general.contacts.email general.start general.end')
    .lean();
  for (const table of tables) {
    const target = touch(table._id, table.general?.start, table.general?.end);
    for (const contact of table.general?.contacts || []) {
      const email = usableEmail(contact.email, ignore);
      if (email) target.emails.add(email);
    }
  }

  const clients = await Client.find({ 'contacts.0': { $exists: true } })
    .select('_id contacts.email')
    .lean();
  if (clients.length) {
    const projects = await VideoProject.find({ clientId: { $in: clients.map(client => client._id) } })
      .select('clientId eventId postProductionItemId')
      .lean();
    const ppIds = projects.map(project => project.postProductionItemId).filter(Boolean);
    const ppItems = ppIds.length
      ? await PostProductionItem.find({ _id: { $in: ppIds } }).select('eventId').lean()
      : [];
    const ppEvent = new Map(ppItems.map(item => [String(item._id), item.eventId ? String(item.eventId) : '']));
    const eventsByClient = new Map();
    for (const project of projects) {
      const ids = eventsByClient.get(String(project.clientId)) || new Set();
      if (project.eventId) ids.add(String(project.eventId));
      const viaPp = project.postProductionItemId && ppEvent.get(String(project.postProductionItemId));
      if (viaPp) ids.add(viaPp);
      eventsByClient.set(String(project.clientId), ids);
    }
    const missing = [];
    for (const ids of eventsByClient.values()) {
      for (const id of ids) if (!targets.has(id)) missing.push(id);
    }
    if (missing.length) {
      const extra = await Table.find({ _id: { $in: missing } }).select('_id general.start general.end').lean();
      for (const table of extra) touch(table._id, table.general?.start, table.general?.end);
    }
    for (const client of clients) {
      const ids = eventsByClient.get(String(client._id));
      if (!ids) continue;
      for (const id of ids) {
        const target = targets.get(id);
        if (!target) continue;
        for (const contact of client.contacts || []) {
          const email = usableEmail(contact.email, ignore);
          if (email) target.emails.add(email);
        }
      }
    }
  }

  return [...targets.values()].filter(target => target.emails.size);
}

async function listMessageIds(token, query) {
  const listUrl = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
  listUrl.searchParams.set('maxResults', String(PER_EVENT_MESSAGES));
  listUrl.searchParams.set('q', query);
  const listRes = await fetch(listUrl, { headers: { Authorization: `Bearer ${token}` } });
  const list = await listRes.json().catch(() => ({}));
  if (!listRes.ok) {
    throw new Error(list.error?.message || 'Gmail could not list messages');
  }
  return (list.messages || []).map(row => row.id).filter(Boolean);
}

async function idsForTarget(token, target) {
  const ids = [];
  const seen = new Set();
  let batch = [];
  let length = 0;
  const run = async () => {
    if (!batch.length || ids.length >= PER_EVENT_MESSAGES) {
      batch = [];
      length = 0;
      return;
    }
    const terms = batch.map(email => {
      const safe = email.replace(/"/g, '');
      return `(from:"${safe}" OR to:"${safe}" OR cc:"${safe}")`;
    }).join(' OR ');
    const query = `after:${gmailDay(target.after)} before:${gmailDay(target.before)} (${terms})`;
    const found = await listMessageIds(token, query);
    for (const id of found) {
      if (seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
      if (ids.length >= PER_EVENT_MESSAGES) break;
    }
    batch = [];
    length = 0;
  };
  for (const email of target.emails) {
    const termLength = email.length * 3 + 24;
    if (batch.length && length + termLength > 1200) await run();
    if (ids.length >= PER_EVENT_MESSAGES) break;
    batch.push(email);
    length += termLength;
  }
  await run();
  return ids;
}

async function fetchMessages(token, targets) {
  const ids = [];
  const seen = new Set();
  for (let i = 0; i < targets.length; i += 4) {
    const chunk = targets.slice(i, i + 4);
    const foundGroups = await Promise.all(chunk.map(target => idsForTarget(token, target)));
    for (const found of foundGroups) {
      for (const id of found) {
        if (seen.has(id)) continue;
        seen.add(id);
        ids.push(id);
      }
    }
  }
  const messages = [];
  for (let i = 0; i < ids.length; i += 5) {
    const chunk = ids.slice(i, i + 5);
    const part = await Promise.all(chunk.map(async (id) => {
      const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}`);
      url.searchParams.set('format', 'metadata');
      ['From', 'To', 'Cc', 'Subject', 'Date', 'Message-ID'].forEach(name => url.searchParams.append('metadataHeaders', name));
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return null;
      return res.json();
    }));
    messages.push(...part.filter(Boolean));
  }
  return messages;
}

async function syncInbox(userId) {
  const key = String(userId || '');
  if (!key) return { synced: 0 };
  if (syncing.has(key)) return syncing.get(key);
  const job = runSync(key).finally(() => syncing.delete(key));
  syncing.set(key, job);
  return job;
}

async function runSync(userId) {
  await ensureGmailIndexes();
  const conn = await GmailConnection.findOne({ userId });
  if (!conn || !conn.refreshTokenEnc) return { synced: 0 };
  try {
    const token = await accessTokenFor(conn);
    const ignore = new Set([conn.email, String(process.env.SENDGRID_FROM_EMAIL || '').toLowerCase()].filter(Boolean));
    const targets = await searchTargets(ignore);
    const byEmail = new Map();
    for (const target of targets) {
      for (const email of target.emails) {
        if (!byEmail.has(email)) byEmail.set(email, []);
        byEmail.get(email).push(target);
      }
    }
    const raw = await fetchMessages(token, targets);
    const parsed = [];
    for (const message of raw) {
      const headers = headerMap(message.payload);
      const from = parseFrom(headers.from);
      const participants = [...new Set([
        ...parseEmails(headers.from),
        ...parseEmails(headers.to),
        ...parseEmails(headers.cc)
      ])].filter(email => !ignore.has(email));
      if (!participants.length) continue;
      parsed.push({
        gmailId: message.id,
        threadId: message.threadId || '',
        rfc822Id: messageRfcId(headers['message-id']),
        fromEmail: from.email,
        fromName: decodeHtml(from.name),
        subject: decodeHtml(headers.subject || ''),
        snippet: decodeHtml(message.snippet || ''),
        sentAt: message.internalDate ? new Date(Number(message.internalDate)) : new Date(headers.date || Date.now()),
        participants
      });
    }

    let synced = 0;
    const kept = [];
    for (const row of parsed) {
      const eventIds = new Set();
      for (const email of row.participants) {
        const matches = byEmail.get(email) || [];
        for (const target of matches) {
          if (sentInWindow(row.sentAt, target)) eventIds.add(target.id);
        }
      }
      if (!eventIds.size) continue;
      kept.push(row.gmailId);
      await GmailMessage.updateOne(
        { userId, gmailId: row.gmailId },
        {
          $set: {
            userId,
            threadId: row.threadId,
            rfc822Id: row.rfc822Id,
            fromEmail: row.fromEmail,
            fromName: row.fromName,
            subject: row.subject,
            snippet: row.snippet,
            sentAt: row.sentAt,
            eventIds: [...eventIds]
          }
        },
        { upsert: true }
      );
      synced += 1;
    }
    await GmailMessage.deleteMany({ userId, gmailId: { $nin: kept } });
    conn.lastSyncAt = new Date();
    conn.lastError = '';
    conn.syncVersion = SYNC_VERSION;
    await conn.save();
    return { synced };
  } catch (err) {
    conn.lastError = String(err.message || 'Sync failed').slice(0, 300);
    await conn.save();
    throw err;
  }
}

async function maybeSync(userId) {
  if (!userId) return false;
  const key = String(userId);
  try {
    if (syncing.has(key)) return true;
    const conn = await GmailConnection.findOne({ userId }).select('refreshTokenEnc lastSyncAt syncVersion').lean();
    if (!conn?.refreshTokenEnc) return false;
    const last = conn.lastSyncAt ? new Date(conn.lastSyncAt).getTime() : 0;
    const due = Date.now() - last >= SYNC_INTERVAL_MS;
    const outdated = (conn.syncVersion || 0) < SYNC_VERSION;
    if (!due && !outdated) return false;
    syncInbox(userId).catch(err => console.error('Gmail sync:', err.message));
    return true;
  } catch (err) {
    console.error('Gmail sync:', err.message);
    return false;
  }
}

async function emailsForEvent(eventId, userId) {
  if (!userId) return [];
  const conn = await GmailConnection.findOne({ userId }).select('email').lean();
  const mailbox = encodeURIComponent(conn?.email || '');
  const rows = await GmailMessage.find({ userId, eventIds: eventId }).sort({ sentAt: -1 }).limit(20).lean();
  return rows.map(row => ({
    id: row._id,
    type: 'email',
    actorName: decodeHtml(row.fromName) || row.fromEmail || 'Someone',
    message: decodeHtml(row.subject || ''),
    snippet: decodeHtml(row.snippet || ''),
    fromEmail: row.fromEmail || '',
    projectId: '',
    projectTitle: '',
    createdAt: row.sentAt || row.createdAt,
    href: messageHref(row, mailbox)
  }));
}

async function finishCallback(req) {
  const fallback = '/dashboard.html#general';
  if (req.query.error) {
    return withGmailFlag(fallback, 'error', req.query.error === 'access_denied'
      ? 'Google sign-in was cancelled'
      : req.query.error);
  }
  let payload;
  try {
    payload = jwt.verify(req.query.state, process.env.JWT_SECRET);
  } catch {
    return withGmailFlag(fallback, 'error', 'The connect link expired. Open the guide and try again.');
  }
  if (payload.purpose !== 'gmail-connect') {
    return withGmailFlag(fallback, 'error', 'This connect link is not valid.');
  }
  const returnTo = safeReturn(payload.returnTo);
  try {
    const data = await tokenRequest({
      code: req.query.code,
      client_id: process.env.GOOGLE_GMAIL_CLIENT_ID,
      client_secret: process.env.GOOGLE_GMAIL_CLIENT_SECRET,
      redirect_uri: redirectUri(req),
      grant_type: 'authorization_code'
    });
    if (!data.refresh_token) {
      return withGmailFlag(returnTo, 'error', 'Google did not grant offline access. Remove LumDash from the Google Account permissions and connect again.');
    }
    const profileRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
      headers: { Authorization: `Bearer ${data.access_token}` }
    });
    const profile = await profileRes.json().catch(() => ({}));
    if (!profileRes.ok) {
      return withGmailFlag(returnTo, 'error', profile.error?.message || 'Gmail did not share the mailbox address');
    }
    await ensureGmailIndexes();
    const email = String(profile.emailAddress || '').toLowerCase();
    const existing = await GmailConnection.findOne({ userId: payload.uid }).select('email').lean();
    if (existing && existing.email && existing.email !== email) {
      await GmailMessage.deleteMany({ userId: payload.uid });
    }
    await GmailConnection.findOneAndUpdate(
      { userId: payload.uid },
      {
        userId: payload.uid,
        email,
        refreshTokenEnc: encrypt(data.refresh_token),
        accessTokenEnc: encrypt(data.access_token),
        accessTokenExpiresAt: new Date(Date.now() + (Number(data.expires_in) || 3600) * 1000),
        connectedAt: new Date(),
        lastError: ''
      },
      { upsert: true, new: true }
    );
    try { await syncInbox(payload.uid); } catch (err) {
      console.error('Gmail sync after connect:', err.message);
    }
    return withGmailFlag(returnTo, 'connected');
  } catch (err) {
    return withGmailFlag(returnTo, 'error', err.message || 'Gmail could not be connected');
  }
}

async function disconnect(userId) {
  if (!userId) return;
  await GmailConnection.deleteMany({ userId });
  await GmailMessage.deleteMany({ userId });
}

module.exports = {
  statusFor,
  beginConnect,
  googleAuthUrl,
  finishCallback,
  disconnect,
  syncInbox,
  maybeSync,
  emailsForEvent,
  appBase
};
