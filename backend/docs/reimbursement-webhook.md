# Reimbursement submitted webhook

External reimbursement apps write reimbursement documents directly to MongoDB (`reimbursementrequests`). LumDash does **not** learn about new submissions unless:

1. **This webhook is called** (recommended, durable), or
2. MongoDB change streams are enabled (replica set), or
3. A one-time / debounced reconcile runs (startup or when an admin opens Reimbursements in LumDash).

Integrators should implement **(1)** on every successful submit.

---

## LumDash operator setup

1. Generate a long random shared secret.
2. Set on the LumDash backend (production and staging):

   ```env
   REIMBURSEMENT_HOOK_SECRET=your-long-random-secret-here
   ```

   If unset, the hook accepts unauthenticated requests (local development only).

3. Ensure email delivery env vars are set:

   ```env
   SENDGRID_API_KEY=...
   SENDGRID_FROM_EMAIL=...
   APP_URL=https://beta.lumdash.app
   ```

4. Deploy the backend.

5. Smoke-test with an existing submitted request ID:

   ```bash
   curl -X POST "https://YOUR_API_HOST/api/reimbursements/submitted-hook" \
     -H "Content-Type: application/json" \
     -H "x-reimbursement-hook-secret: YOUR_SECRET" \
     -d '{"requestId":"MONGODB_REQUEST_ID"}'
   ```

---

## When to call (external app)

Call **once**, immediately after the reimbursement document is **saved to MongoDB** with:

| Field | Requirement |
|-------|-------------|
| `status` | Exactly `"submitted"` (not `"pending"` or other values) |
| `dateSubmitted` | Set (recommended) |
| Collection | `reimbursementrequests` (same database LumDash uses) |

Do **not** call for:

- Draft saves
- Edits while still `draft`
- Approve / reject flows (LumDash handles approved email separately)

---

## Endpoint

```
POST {LUMDASH_API_BASE_URL}/api/reimbursements/submitted-hook
```

Example base URLs (replace with your deployment):

- Production: `https://api.lumdash.app`
- Staging: your staging API host

Full URL example:

```
POST https://api.lumdash.app/api/reimbursements/submitted-hook
```

---

## Authentication

Provide the shared secret in **either** place:

- **Header (preferred):** `x-reimbursement-hook-secret: <SECRET>`
- **JSON body:** `"secret": "<SECRET>"`

LumDash provides `<SECRET>` out of band. Do not commit it to source control.

If `REIMBURSEMENT_HOOK_SECRET` is configured on LumDash and the secret is wrong or missing, the API returns `401 Unauthorized`.

---

## Request

**Headers**

```
Content-Type: application/json
x-reimbursement-hook-secret: <SECRET>
```

**Body (JSON)**

```json
{
  "requestId": "674a1b2c3d4e5f6789012345"
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `requestId` | Yes | MongoDB `_id` of the reimbursement document (24-char hex string) |
| `_id` | No | Alias for `requestId` |
| `secret` | No | Alternative to header auth |

---

## Responses

### 200 OK

```json
{
  "message": "Notifications sent (duplicates skipped if already sent)",
  "requestId": "674a1b2c3d4e5f6789012345"
}
```

Duplicate calls for the same `requestId` are safe; LumDash uses an atomic claim on the reimbursement document (`submissionNotifiedAt`) so reviewers are not notified twice, even if the webhook and MongoDB change stream fire in parallel.

**Important:** Call the hook **once** per submission. Do not retry on `200`. Only retry on `500` or network timeout (see Retry policy).

### 400 Bad Request

- Missing `requestId`
- Request exists but `status` is not `submitted`

```json
{ "error": "requestId is required" }
```

```json
{ "error": "Request is not submitted" }
```

### 401 Unauthorized

Wrong or missing secret when `REIMBURSEMENT_HOOK_SECRET` is set on LumDash.

```json
{ "error": "Unauthorized" }
```

### 404 Not Found

No reimbursement document with that ID.

```json
{ "error": "Request not found" }
```

### 500 Server Error

LumDash internal error — retry with backoff.

```json
{ "error": "Server error" }
```

---

## Retry policy

| Status | Action |
|--------|--------|
| `500`, network timeout | Retry 2–3 times with exponential backoff (e.g. 1s, 5s, 15s) |
| `400`, `404` | Do not retry; fix data (`status` must be `submitted`, ID must exist) |
| `401` | Do not retry; fix secret configuration |
| `200` | Success; no retry needed |

---

## Data requirements (for correct alerts)

LumDash notifies **system admins** and **owners of the matched event**.

| Field | Purpose |
|-------|---------|
| `eventName` or `eventId` | Match a LumDash event (`Table.title` or `_id`) so event owners receive alerts |
| `userId` | Resolve submitter name/email from LumDash `User` collection |
| `userName`, `userEmail` | Shown in notification text and emails (backfilled from `userId` if missing) |
| `totalAmount`, `description`, `items` | Included in email content |

Example event name that must match LumDash: `Conference Direct - APM 2026`.

---

## What LumDash does after a successful hook

1. Loads the reimbursement by `requestId`
2. Skips if `submissionNotifiedAt` is already set (unless admin force-resend)
3. Creates in-app notifications for admins + event owners
4. Pushes real-time toasts via Socket.IO if reviewers are online
5. Sends email via SendGrid (if configured and user has email enabled in Settings → Reimbursement submitted)

**Note:** The submitter does **not** receive a “submitted” notification. They are notified when the request is **approved** (`reimbursement_approved`).

---

## Example: Node.js

```javascript
async function notifyLumDashReimbursementSubmitted(requestId) {
  const baseUrl = process.env.LUMDASH_API_URL; // e.g. https://api.lumdash.app
  const secret = process.env.LUMDASH_REIMBURSEMENT_HOOK_SECRET;

  const res = await fetch(`${baseUrl}/api/reimbursements/submitted-hook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-reimbursement-hook-secret': secret
    },
    body: JSON.stringify({ requestId: String(requestId) })
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`LumDash hook failed ${res.status}: ${err.error || res.statusText}`);
  }

  return res.json();
}

// After MongoDB insert/update succeeds:
// const doc = await saveReimbursement({ status: 'submitted', dateSubmitted: new Date(), ... });
// await notifyLumDashReimbursementSubmitted(doc._id);
```

---

## Example: cURL

```bash
curl -X POST "https://YOUR_API_HOST/api/reimbursements/submitted-hook" \
  -H "Content-Type: application/json" \
  -H "x-reimbursement-hook-secret: YOUR_SECRET" \
  -d '{"requestId":"674a1b2c3d4e5f6789012345"}'
```

---

## Integration checklist (external app)

- [ ] Call hook **after** MongoDB write succeeds
- [ ] Document `status` is `"submitted"` before calling
- [ ] Pass MongoDB `_id` as `requestId`
- [ ] Store `LUMDASH_API_URL` and `LUMDASH_REIMBURSEMENT_HOOK_SECRET` in env (not in git)
- [ ] Retry on `500` / network errors only
- [ ] Set `eventName` or `eventId` so event owners are notified
- [ ] Log hook failures for support (submission still saved in MongoDB)

---

## Related LumDash APIs

| Endpoint | Purpose |
|----------|---------|
| `POST /api/reimbursements/submitted-hook` | Trigger reviewer notifications (this doc) |
| `POST /api/reimbursements/:id/resend-notifications` | Admin-only; force resend (JWT required) |
| `GET /api/reimbursements` | List requests for reviewers (JWT required) |

Implementation: `backend/server.js` — `notifyReimbursementSubmitted`, `setupReimbursementChangeStream`, `reconcileUnnotifiedReimbursementSubmissions`.

Model: `backend/models/ReimbursementRequest.js` — collection `reimbursementrequests`, status enum: `draft`, `submitted`, `approved`, `rejected`.
