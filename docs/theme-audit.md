# LumDash Theming Audit & Migration Plan

Goal: a single global light/dark theme that applies to **all pages, modals, and dialogs**, driven by `html[data-theme]` and semantic CSS variables.

Status of Phase 1 (done): token files exist (`css/theme-tokens.css`, `css/theme-light.css`), dark tokens scoped to `:root,[data-theme="dark"]`, `js/theme.js` API, Settings → Appearance toggle. The toggle flips the attribute and tokens, but most paint is hardcoded so the visible change is minimal. This document is the plan to fix that.

---

## 1. Root cause

Color is applied three ways that **do not respond to a token swap**:

1. **Hardcoded hex/rgba** in component CSS (`background: #1a1a1a`) instead of `var(--…)`.
2. **`.dark-theme`-scoped color rules** — color authority lives on a markup class, not on `data-theme`. Every page wrapper is `class="dark-theme <page>"`.
3. **`!important` on color rules** — prevents the global light overrides from winning.

A correct foundation requires: component CSS reads tokens only; `.dark-theme` is layout/structure only; color `!important` removed.

---

## 2. Scope (quantified)

### Hardcoded color counts per CSS file
(`#hex` declarations; rgba additional)

| File | hex | `!important` | Priority |
|---|---:|---:|---|
| `css/theme-dark.css` | 263 | 100 | P0 (global shell) |
| `css/gear.css` | 246 | 28 | P2 (also has full light baseline) |
| `css/schedule.css` | 118 | 104 | P1 |
| `css/timesheet.css` | 122 | 53 | P2 |
| `css/styles.css` | 86 | 56 | P0 (global Material base) |
| `css/general.css` | 85 | 75 | P1 |
| `css/crew-planner.css` | 75 | 16 | P2 |
| `css/post-production.css` | 69 | 100 | P2 |
| `css/events.css` | 68 | 100 | P1 |
| `css/call-times.css` | 63 | 5 | P3 |
| `css/notes.css` | 50 | 2 | P3 |
| `css/flights.css` | 47 | 29 | P2 |
| `css/travel-accommodation.css` | 35 | 90 | P2 |
| `css/card-log.css` | 32 | 70 | P2 |
| `css/crew-calendar.css` | 29 | 17 | P3 |
| `css/users.css` | 20 | 5 | P3 |
| `css/settings.css` | 20 | 2 | done-ish (token-based) |
| others (reimbursements, expenses, shotlist, executive-summary, chat, auth/login/register) | <15 each | low | P3 |

### Inline `<style>` blocks in page partials (hardcoded color lines)

| Page | count |
|---|---:|
| `pages/gear.html` | 75 |
| `pages/inventory-management.html` | 20 |
| `pages/event-calendar.html` | 16 |
| `pages/tasks.html` | 13 |
| `pages/crew-planner.html` | 10 |
| `pages/repair-gear.html` | 6 |
| ~12 other pages | 1–2 each |
| backups (`*-standalone-backup*.html`) | high, but unused — verify before touching |

> Note: `.dark-theme` is referenced ~100× in `theme-dark.css` alone and on every page wrapper.

---

## 3. Color → token map

### Backgrounds (theme-dependent → must tokenize)

| Hardcoded (dark) | Hardcoded (light, e.g. gear) | Token |
|---|---|---|
| `#080808` `#0a0a0a` `#121216` | `#f5f7fa` `#f3f4f6` | `--bg-primary` |
| `#18181c` | `#ffffff` | `--bg-secondary` |
| `#1a1a20` `#1e1e24` `#1a1a1a` | `#fafbfc` `#f9fafb` | `--bg-tertiary` / `--surface-card` |
| `#252530` | `#ffffff` | `--bg-elevated` |
| `#2a2a36` | `#eef0f3` | `--bg-hover` |
| `#1e1e26` | `#ffffff` | `--surface-modal` |
| `#14141a` | `#ffffff` | `--surface-input` |

### Text (theme-dependent)

| Dark | Light | Token |
|---|---|---|
| `#ffffff` `#fff` | `#222` `#333` | `--text-primary` |
| `#e0e0e0` `rgba(255,255,255,.75)` | `#444` | `--text-secondary` |
| `rgba(255,255,255,.5)` | `#666` | `--text-tertiary` |
| `rgba(255,255,255,.3)` | `#888` `#999` | `--text-muted` |

### Borders (theme-dependent)

| Dark | Light | Token |
|---|---|---|
| `#333` `rgba(255,255,255,.10)` | `#e0e0e0` `#eee` `#ccc` | `--border-default` |
| `rgba(255,255,255,.06)` | `#f0f0f0` | `--border-subtle` |
| `rgba(255,255,255,.16)` | `#ccc` | `--border-strong` |

### Brand / status (theme-AGNOSTIC → keep as tokens, no light variant needed)

| Hardcoded | Token |
|---|---|
| `#cc0007` | `--brand-red` |
| `#e6000a` | `--brand-red-hover` |
| `#a30006` `#b00006` | `--brand-red-active` |
| `#ef4444` | `--accent-red` |
| `#3b82f6` `#60a5fa` | `--accent-blue` |
| `#22c55e` `#28a745` | `--accent-green` / `--status-live` |
| `#f97316` `#ffc107` `#e0a800` | `--accent-orange` / warning |
| `#dc3545` `#c82333` | danger (add `--danger`, `--danger-hover`) |
| success/error chips `#d4edda/#155724`, `#f8d7da/#721c24` | add `--success-bg/-text`, `--error-bg/-text` |

### Tokens to ADD (not yet defined)

- `--danger`, `--danger-hover` (currently `#dc3545`/`#c82333`)
- `--success-bg`, `--success-text`, `--error-bg`, `--error-text`, `--warning-bg`, `--warning-text` (for alert/chip components in gear.css, flights.css, etc.)
- `--input-placeholder` (maps to `--text-muted`)

---

## 4. Structural fixes (in addition to color swaps)

1. **`.dark-theme` becomes layout-only.** Keep the class for structure, but move all `background/color/border` color rules so they come from tokens (which respond to `data-theme`). Do not delete the class (markup uses it everywhere); just stop using it as a color switch.
2. **Remove color `!important`.** Audit each `!important` on a color property; most exist to beat other dark rules and can be dropped once tokens are consistent. Keep `!important` only where it guards against third-party CSS (e.g. Quill, FullCalendar).
3. **Inline `<style>` in page partials** must be migrated too (esp. `pages/gear.html`), or they will keep overriding tokens.
4. **`gear.css` special case:** it has a complete hardcoded LIGHT baseline + `.gear-page.dark-theme` dark overrides. This is the inverse of every other page. Plan to collapse both into token usage rather than two parallel color sets.
5. **Third-party CSS** (Quill `quill.snow.css`, any calendar libs) is light-only; needs explicit dark overrides via tokens (already partially present).

---

## Critical cascade rule (learned the hard way)

Every page partial links `css/theme-dark.css` at its top. The SPA injects partials into `#page-container`, so `theme-dark.css` is **re-loaded after** `theme-light.css` on every navigation. With equal specificity, the later dark `:root` block wins and light tokens never apply.

**Rule:** light theme selectors MUST out-specify `:root`. Use `html[data-theme="light"]` (specificity 0,1,1), never bare `[data-theme="light"]` (0,1,0). All token defs and global overrides in `theme-light.css` follow this. Any future light overrides must too.

## Progress log

- **Cascade fix:** `theme-light.css` selectors changed `[data-theme="light"]` → `html[data-theme="light"]` so they beat the re-injected dark `:root`. This was why light mode showed no visual change.
- **P0 (global shell) — in progress.**
  - Added tokens: `--danger/-hover`, `--success`, `--warning`, `--info`, `--accent-blue-soft`, and feedback chip surfaces (`--success-bg/-text`, `--error-bg/-text`, `--warning-bg/-text`, `--info-bg/-text`) in dark + light.
  - `theme-dark.css`: converted all **light-mode-breaking neutrals** — gray text (`#888/#999/#9ca3af/#6b7280/#e0e0e0`), dark borders (`#333/#444`), and white-on-themed-surface text (calendar title, `.dark-modal` inputs/textarea, share-dropdown search, autofill) → tokens. Danger buttons → `--danger/-hover`. Todos Material override → theme tokens.
  - Remaining `#fff/#ffffff` are intentional (white text on brand-red/danger buttons) or page-specific modals (todos/editTask/card-log → P2).
  - `styles.css` left as-is: it's a separate light-oriented Material (`--md-sys-color-*`) system with no light-mode-breaking values; handle in a dedicated Material pass.
  - Lint: clean.
  - **Cache bust:** theme CSS/JS use `?v=2.0.0` (see P4). Bump `ASSET_VERSION` in `js/theme.js` when theme files change.
- **P1 (events/general/schedule) — complete via P0.** Key realization: the active styling layer for all three modern pages is `theme-dark.css` (the partials only link `theme-dark.css` and use `.events-page` / `.general-page` / `.schedule-page` selectors there, already tokenized by P0). The standalone `events.css` / `general.css` / `schedule.css` are **legacy light-oriented baselines** — tokenizing them would make them theme-reactive and double up with `theme-dark.css`, risking dark-mode breakage. Left as-is. Verified `theme-dark.css` `.general-page` rules use `var(--bg-primary)`/`var(--surface-card)`/`var(--text-primary)` and explicitly override the legacy `#333` values.
- **P2 — gear page done.** `pages/gear.html` inline `<style>` (~100 hardcoded) converted to tokens: dark surfaces `#080808→--bg-primary`, `#0f0f0f→--bg-tertiary`, `#1a1a1a→--surface-card`, `#2a2a2a→--surface-hover`; borders `#333→--border-default`, `#444→--border-strong`; text `#fff→--text-primary` (except white-on-brand buttons), `#aaa/#ddd→--text-secondary`, `#888→--text-tertiary`, `#666→--text-muted`; progress track `#333→--bg-active`; modal overlay `rgba(0,0,0,.7)→--surface-overlay`; brand `#cc0007→--brand-red`, `#a30006→--brand-red-active`. Status colors (green/red/amber) left as theme-agnostic. The `#...Modal` blocks were already token-based. Lint clean.
  - Remaining dark-inline-style partials to convert (counts of dark hexes): `event-calendar.html` (~12), `crew-planner.html` (~8), `inventory-management.html` (~6), `tasks.html` (~2). Standalone backups excluded.
- **Flight badge fix (dashboard).** `.event-badges .flight-badge` used `background: var(--primary-color); color: white;` but `--primary-color`/`--primary-color-hover` were **never defined anywhere** → invalid declarations, badge rendered transparent + white text (vanished in light mode). Repointed all stray `--primary-color(-hover)` refs (3 in `theme-dark.css`, 4 in `flights.css`) to `--brand-red(-hover)`. Then per user request set the flight badge to match the other badges: `background: transparent; color: var(--text-secondary)`, hover `color: var(--text-primary)`.
- **P2 inline-style partials done.**
  - `event-calendar.html`: converted both the `<style>` block and the JS `style.cssText`/`.style.background` strings — `#080808→--bg-primary`, `#0a0a0a→--bg-secondary`, `#1a1a1a→--surface-card`, `#151515→--bg-tertiary`, `#252525→--surface-hover`, `#333→--border-default` (borders + grid-gap lines), `#fff/#ffffff→--text-primary`, `#888→--text-tertiary`, day-number `#555/#999→--text-muted/--text-secondary`, overlay `rgba(0,0,0,.5)→--surface-overlay`. (Setting `el.style.background='var(--token)'` resolves fine inside the themed container.)
  - `crew-planner.html`: `#4a4a4a` separators→`--border-strong`; dropdown `#1a1a1a→--surface-card`, `#2a2a2a→--surface-hover`. Rest already tokenized.
  - `inventory-management.html`: disabled btn `#374151/#6b7280→--bg-active/--text-disabled`; modal overlays `rgba(0,0,0,.7)→--surface-overlay`. Status colors + white-on-colored buttons left as-is.
  - `tasks.html`: **skipped** — standalone legacy light page (own `<html>/<body>`, links only `/css/main.css`, no theme tokens loaded). Its `#888/#666/#bbb` are dark-on-white (intended); converting to tokens would break it since vars don't resolve there.
  - Lint clean across all edited files.
- **P2 (remaining heavy SPA pages) — done.**
  - **Post-production:** `post-production.css` already token-based; fixed status `<option>` bg (`#1e1e1e` → `--surface-modal`), link chips (`--info-text` / `--accent-blue-soft`), avatar ring fallback (`--bg-primary` only).
  - **Card log + Travel:** Active layer is `theme-dark.css` (already tokens). Fixed all `margin-left: 260px` → `var(--sidebar-width)` across `theme-dark.css` (7 pages including card-log, travel, general, gear, etc.). Legacy `card-log.css` / `travel-accommodation.css` left as light baselines (overridden by theme-dark).
  - **Event timesheet:** `timesheet.css` converted neutrals/surfaces/borders → tokens; added `theme-dark.css` link + `dark-theme` wrapper on `timesheet.html`; wired `loadPageCSS('timesheet')` in `app.js`. Status/button gradients left theme-agnostic.
  - **theme-light.css:** Added shell rules for `.post-production-page`, `.travel-page`, `.card-log-page`, `.timesheet-page`.
- **P3 (long tail) — done.**
  - **SPA pages** (call-times, users, reimbursements, expenses, shotlist, executive-summary, admin-notes, todos, crew, my-tasks): active styling already in `theme-dark.css` + dedicated CSS (`expenses.css`, `executive-summary.css`, `reimbursements.css`) using tokens. Added `html[data-theme="light"]` shell rules for all P3 page classes in `theme-light.css`.
  - **Reimbursements:** modal/sidebar overlays → `--surface-overlay`; status badge text → `--info-text` / `--success-text` / `--error-text`; light-mode select chevron override.
  - **Call times:** date-picker `invert(1)` scoped to `html[data-theme="dark"]` only.
  - **Auth** (`index.html`, `register.html`): early theme init, `theme-tokens.css` + `auth.css` + `theme-light.css` (light vars must load after auth.css `:root`), `theme.js`. Light auth tokens + gradient + logo swap in `theme-light.css`.
  - **Chat widget:** light `--chat-*` variables in `theme-light.css` token block (chat.css reads these vars).
  - **Legacy `pages/notes.html` + `notes.css`:** skipped — superseded by SPA `admin-notes.html` (theme-dark). Old standalone notes page remains light-only.
- **P4 (polish) — done.**
  - **`js/theme-early.js`:** sync `data-theme`, `color-scheme`, and `meta theme-color` before CSS paint on all full HTML entry points. Replaces duplicated inline scripts.
  - **`js/theme.js`:** `ASSET_VERSION` (`2.0.0`), `cssHref()` helper, sync init on load; `meta theme-color` updates on toggle (`#f3f4f6` light / `#121216` dark). Default remains **dark** when `lumdash-theme` unset — no `prefers-color-scheme`.
  - **Cache bust:** `?v=2.0.0` on theme CSS/JS in `dashboard.html`, auth pages, and standalone admin pages. `loadPageCSS()` uses `LumDashTheme.cssHref()`.
  - **Material tokens:** `--md-sys-color-*` remapped in `theme-dark.css` `:root` and `theme-light.css` so `styles.css` / shotlist flip globally (not only todos page).
  - **Chat polish:** `--chat-on-brand` for red surfaces; light scrollbar thumb override.
  - **`manifest.json`:** `background_color` / `theme_color` → `#121216` (install splash; runtime bar still driven by `theme.js`).
  - **Backup HTML excluded:** `*-standalone-backup*.html`, `js/crew.js.backup` — not linked from app navigation; left untouched.
  - **QA note:** bump `ASSET_VERSION` in `theme.js` when shipping theme CSS changes.

## 5. Phased migration plan

| Phase | Work | Outcome |
|---|---|---|
| **P0 — Global shell** | `theme-dark.css` + `styles.css`: convert hardcoded color → tokens, strip color `!important`. Add missing tokens (danger/success/error/warning). | Sidebar, modals, buttons, forms, tables, toasts flip app-wide. ~80% of "feel". |
| **P1 — High-traffic pages** | `general.css`, `events.css`, `schedule.css` + their inline `<style>`. | Most-used screens fully themed. |
| **P2 — Heavy pages** | `gear.css` (+ `pages/gear.html` inline), `timesheet.css`, `post-production.css`, `card-log.css`, `flights.css`, `travel-accommodation.css`, `crew-planner.css`. | Remaining feature pages. |
| **P3 — Long tail** | `call-times`, `notes`, `crew-calendar`, `users`, `reimbursements`, `expenses`, `shotlist`, `executive-summary`, `chat`. Auth pages (`login/register/auth`) optional (may stay dark by design). | Full coverage. |
| **P4 — Polish** | `prefers-color-scheme` default, dynamic PWA `theme-color`, verify backups excluded, QA pass each page in both themes. | **Done** — see progress log. |

### Per-file conversion recipe (repeatable)
1. Replace background/text/border hex & rgba with the mapped token.
2. Remove `!important` on color props (keep layout `!important` if needed).
3. Move any `.<page>.dark-theme { color… }` rules to plain `.<page> { color: var(--…) }`.
4. Verify in both themes; spot-check modals opened from that page.

---

## 6. Files already correct (reference patterns)

- `css/settings.css` — token-based, minimal hardcoding. Use as the style template.
- `css/theme-tokens.css`, `css/theme-light.css`, `js/theme.js` — foundation, keep.

---

## 7. Decisions (locked)

- **`.dark-theme` stays as a layout-only class.** Do not rename; do not touch HTML wrappers. Move all color authority to tokens so `data-theme` drives color. Color rules currently scoped to `.dark-theme` get rewritten to read tokens (and, where needed, dropped to the unscoped selector).
- **Auth pages are in scope.** `login.css`, `register.css`, `auth.css` get themed for full consistency (move to P3, but include them).
- **Default theme = dark** when no preference is stored (current behavior). No `prefers-color-scheme` default.
