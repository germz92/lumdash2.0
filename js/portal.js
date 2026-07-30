/**
 * Public client video portal (magic link, no login).
 * Gallery of delivered + in-review projects, Bunny player with
 * Frame.io-style timestamped comments via Player.js.
 *
 * Two link types:
 * - Personal contact token: identity is known from the link
 * - Shared team token: one link for the whole client; reviewers enter their name once
 */
(function() {
  'use strict';

  const API_BASE = window.API_BASE || '';
  const params = new URLSearchParams(location.search);
  const token = params.get('token') || '';
  const AUTHOR_KEY = `portalAuthor:${token}`;

  let portalData = null;   // { clientName, contactName, shared, projects }
  let project = null;      // current project detail
  let currentVersionId = null;
  let player = null;
  let composeTimecode = null;
  let composeTimecodeEnd = null;
  let composeTimecodeAttached = true; // default: stamp comments with the playhead
  let composePickingEnd = false; // lock start; playhead sets the end
  let reviewerName = '';   // set for shared links (or from personal contact)
  let annotate = null;
  let annotateTool = 'off';
  let compareMode = false;
  let compareVersionId = null;
  let viewingCommentId = null;
  let playerListenersBound = false;
  let annotationWatchTimer = null;
  let cachedPlayerDuration = 0;

  // Gallery toolbar state (persists across re-renders)
  let gallerySearch = '';
  let galleryStatusFilter = 'all'; // all | in_review | delivered
  let galleryFolderFilter = '';    // '' | folderId | __other__
  let gallerySort = 'newest';      // newest | oldest | title_asc | title_desc | due_soon

  const container = document.getElementById('ptContainer');

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtDate(d) {
    if (!d) return '';
    const date = new Date(d);
    if (isNaN(date)) return '';
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function fmtTimecode(seconds) {
    const s = Math.max(0, Math.floor(Number(seconds) || 0));
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, '0')}`;
  }

  function fmtCommentTimecode(c) {
    if (c?.timecodeSeconds == null) return '';
    const start = fmtTimecode(c.timecodeSeconds);
    if (c.timecodeEndSeconds != null && c.timecodeEndSeconds > c.timecodeSeconds) {
      return `${start}–${fmtTimecode(c.timecodeEndSeconds)}`;
    }
    return start;
  }

  function authorInitials(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function hasSeekTimecode(c) {
    if (c == null || c.timecodeSeconds == null || c.timecodeSeconds === '') return false;
    const n = Number(c.timecodeSeconds);
    return Number.isFinite(n) && n >= 0;
  }

  function versionDurationSeconds() {
    const fromMeta = Number(currentVersion()?.durationSeconds) || 0;
    if (fromMeta > 0) return fromMeta;
    return cachedPlayerDuration > 0 ? cachedPlayerDuration : 0;
  }

  function toDirectDownloadUrl(url) {
    if (!url) return '';
    try {
      const u = new URL(url);
      if (!/(^|\.)drive\.google\.com$/i.test(u.hostname)) return url;
      const fromPath = u.pathname.match(/\/file\/d\/([^/]+)/);
      const id = fromPath?.[1] || u.searchParams.get('id');
      if (!id) return url;
      return `https://drive.google.com/uc?export=download&confirm=t&id=${encodeURIComponent(id)}`;
    } catch {
      return url;
    }
  }

  async function api(path, options = {}) {
    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {})
      }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  function showError(message) {
    container.innerHTML = `<div class="pt-error">${escapeHtml(message)}</div>`;
  }

  function loadSavedAuthor() {
    try { return (sessionStorage.getItem(AUTHOR_KEY) || '').trim(); }
    catch { return ''; }
  }

  function saveAuthor(name) {
    reviewerName = String(name || '').trim();
    try { sessionStorage.setItem(AUTHOR_KEY, reviewerName); } catch { /* private mode */ }
  }

  function clearAuthor() {
    reviewerName = '';
    try { sessionStorage.removeItem(AUTHOR_KEY); } catch { /* noop */ }
  }

  function needsNameGate() {
    return !!(portalData?.shared && !reviewerName);
  }

  function displayClientName() {
    return portalData?.branding?.displayName || portalData?.clientName || '';
  }

  function applyBranding(branding) {
    const b = branding || {};
    const accent = b.accentColor || '#CC0007';
    document.documentElement.style.setProperty('--pt-accent', accent);
    // Soften accent for links/hover text
    document.documentElement.style.setProperty('--pt-accent-soft', accent);

    const name = b.displayName || portalData?.clientName || 'Video Portal';
    const brandName = document.getElementById('ptBrandName');
    const brandLogo = document.getElementById('ptBrandLogo');
    if (brandName) brandName.textContent = name;
    if (brandLogo) {
      if (b.logoUrl) {
        brandLogo.src = b.logoUrl;
        brandLogo.alt = name;
        brandLogo.classList.add('is-visible');
      } else {
        brandLogo.removeAttribute('src');
        brandLogo.alt = '';
        brandLogo.classList.remove('is-visible');
      }
    }
    document.title = `${name} — Video Portal`;
  }

  function updateHeader() {
    const who = reviewerName || portalData.contactName;
    const clientLabel = displayClientName();
    document.getElementById('ptHeaderClient').innerHTML =
      `${who ? `Hi <strong>${escapeHtml(who.split(' ')[0])}</strong>` : escapeHtml(clientLabel)}`;
  }

  // ---- Name gate (shared team link) ----
  function renderNameGate(changing = false) {
    container.classList.remove('pt-full');
    container.innerHTML = `
      <div class="pt-gate">
        <h2>${changing ? 'Change your name' : 'Who\'s reviewing?'}</h2>
        <p>This is a shared portal link for <strong>${escapeHtml(displayClientName())}</strong>.
           Enter your name so our editors know who each comment is from.</p>
        <input type="text" id="ptGateName" placeholder="Your name" maxlength="80" value="${escapeHtml(reviewerName)}" autocomplete="name">
        <button class="pt-gate-btn" id="ptGateBtn">${changing ? 'Continue' : 'Enter Portal'}</button>
      </div>`;

    const input = document.getElementById('ptGateName');
    const btn = document.getElementById('ptGateBtn');
    input.focus();
    input.select();

    const submit = () => {
      const name = input.value.trim();
      if (!name) { input.focus(); return; }
      saveAuthor(name);
      updateHeader();
      const projectId = new URLSearchParams(location.search).get('project');
      if (projectId) openProject(projectId, false);
      else renderGallery();
    };
    btn.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  }

  function groupProjectsByFolder(list) {
    const folders = [...(portalData.folders || [])].sort(
      (a, b) => (a.sortOrder || 0) - (b.sortOrder || 0) || String(a.name).localeCompare(String(b.name))
    );
    const hasFolders = folders.length > 0;
    if (!hasFolders) {
      // Soft grouping by legacy category when no folders configured
      const byCat = new Map();
      list.forEach(p => {
        const key = (p.category || '').trim() || '__other__';
        if (!byCat.has(key)) byCat.set(key, []);
        byCat.get(key).push(p);
      });
      if (byCat.size <= 1 && byCat.has('__other__')) {
        return [{ id: null, name: null, projects: list }];
      }
      const groups = [];
      [...byCat.keys()].filter(k => k !== '__other__').sort((a, b) => a.localeCompare(b)).forEach(name => {
        groups.push({ id: null, name, projects: byCat.get(name) });
      });
      if (byCat.has('__other__')) groups.push({ id: null, name: 'Other', projects: byCat.get('__other__') });
      return groups;
    }

    const folderIds = new Set(folders.map(f => String(f._id)));
    const buckets = new Map(folders.map(f => [String(f._id), []]));
    const other = [];
    const orphanCats = new Map();

    list.forEach(p => {
      const fid = p.folderId ? String(p.folderId) : '';
      if (fid && folderIds.has(fid)) {
        buckets.get(fid).push(p);
        return;
      }
      const cat = (p.category || '').trim();
      if (!fid && cat) {
        // Match folder by name if id missing
        const match = folders.find(f => f.name.toLowerCase() === cat.toLowerCase());
        if (match) {
          buckets.get(String(match._id)).push(p);
          return;
        }
        if (!orphanCats.has(cat)) orphanCats.set(cat, []);
        orphanCats.get(cat).push(p);
        return;
      }
      other.push(p);
    });

    const groups = [];
    folders.forEach(f => {
      const projects = buckets.get(String(f._id)) || [];
      if (projects.length) groups.push({ id: f._id, name: f.name, projects });
    });
    [...orphanCats.keys()].sort((a, b) => a.localeCompare(b)).forEach(name => {
      groups.push({ id: null, name, projects: orphanCats.get(name) });
    });
    if (other.length) groups.push({ id: null, name: 'Other', projects: other });
    return groups;
  }

  function projectFolderKey(p) {
    if (p.folderId) return String(p.folderId);
    const cat = (p.category || '').trim();
    if (cat) {
      const match = (portalData.folders || []).find(f => f.name.toLowerCase() === cat.toLowerCase());
      if (match) return String(match._id);
      return `cat:${cat.toLowerCase()}`;
    }
    return '__other__';
  }

  function projectFolderLabel(p) {
    if (p.folderId) {
      const f = (portalData.folders || []).find(x => String(x._id) === String(p.folderId));
      if (f) return f.name;
    }
    return (p.category || '').trim() || 'Other';
  }

  function galleryFolderOptions() {
    const folders = [...(portalData.folders || [])].sort(
      (a, b) => (a.sortOrder || 0) - (b.sortOrder || 0) || String(a.name).localeCompare(String(b.name))
    );
    const opts = [{ value: '', label: 'All folders' }];
    folders.forEach(f => opts.push({ value: String(f._id), label: f.name }));

    const known = new Set(folders.map(f => String(f._id)));
    const orphanCats = new Set();
    let hasOther = false;
    (portalData.projects || []).forEach(p => {
      if (p.folderId && known.has(String(p.folderId))) return;
      const cat = (p.category || '').trim();
      if (!p.folderId && cat) {
        const match = folders.find(f => f.name.toLowerCase() === cat.toLowerCase());
        if (!match) orphanCats.add(cat);
        return;
      }
      if (!p.folderId) hasOther = true;
    });
    [...orphanCats].sort((a, b) => a.localeCompare(b)).forEach(cat => {
      opts.push({ value: `cat:${cat.toLowerCase()}`, label: cat });
    });
    if (hasOther || folders.length) opts.push({ value: '__other__', label: 'Other' });
    return opts;
  }

  function filteredGalleryProjects() {
    const q = gallerySearch.trim().toLowerCase();
    let items = [...(portalData.projects || [])];

    if (galleryStatusFilter === 'in_review') {
      items = items.filter(p => p.status === 'in_review');
    } else if (galleryStatusFilter === 'delivered') {
      items = items.filter(p => p.status === 'delivered');
    }

    if (galleryFolderFilter) {
      items = items.filter(p => projectFolderKey(p) === galleryFolderFilter);
    }

    if (q) {
      items = items.filter(p => {
        const hay = [
          p.title,
          p.category,
          projectFolderLabel(p),
          p.status === 'delivered' ? 'delivered' : 'in review',
          p.reviewDecision?.status === 'approved' ? 'approved' : ''
        ].join(' ').toLowerCase();
        return hay.includes(q);
      });
    }

    const titleCmp = (a, b) => String(a.title || '').localeCompare(String(b.title || ''), undefined, { sensitivity: 'base' });
    const timeOf = (p) => {
      const raw = p.updatedAt || p.deliveredAt || 0;
      const t = new Date(raw).getTime();
      return Number.isNaN(t) ? 0 : t;
    };
    const dueOf = (p) => {
      if (!p.feedbackDueAt) return Number.POSITIVE_INFINITY;
      const t = new Date(p.feedbackDueAt).getTime();
      return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
    };

    items.sort((a, b) => {
      if (gallerySort === 'oldest') return timeOf(a) - timeOf(b);
      if (gallerySort === 'title_asc') return titleCmp(a, b);
      if (gallerySort === 'title_desc') return titleCmp(b, a);
      if (gallerySort === 'due_soon') {
        const da = dueOf(a);
        const db = dueOf(b);
        if (da !== db) return da - db;
        return timeOf(b) - timeOf(a);
      }
      // newest (default)
      return timeOf(b) - timeOf(a);
    });

    return items;
  }

  function renderGalleryToolbar(resultCount) {
    const folderOpts = galleryFolderOptions();
    const showFolderFilter = folderOpts.length > 1; // more than just "All folders"
    return `
      <div class="pt-toolbar" id="ptGalleryToolbar">
        <div class="pt-search">
          <span class="pt-search-icon" aria-hidden="true">⌕</span>
          <input type="search" id="ptGallerySearch" placeholder="Search videos…" value="${escapeHtml(gallerySearch)}" autocomplete="off">
        </div>
        <select id="ptGalleryStatus" aria-label="Filter by status">
          <option value="all"${galleryStatusFilter === 'all' ? ' selected' : ''}>All statuses</option>
          <option value="in_review"${galleryStatusFilter === 'in_review' ? ' selected' : ''}>In Review</option>
          <option value="delivered"${galleryStatusFilter === 'delivered' ? ' selected' : ''}>Delivered</option>
        </select>
        ${showFolderFilter ? `
        <select id="ptGalleryFolder" aria-label="Filter by folder">
          ${folderOpts.map(o =>
            `<option value="${escapeHtml(o.value)}"${galleryFolderFilter === o.value ? ' selected' : ''}>${escapeHtml(o.label)}</option>`
          ).join('')}
        </select>` : ''}
        <select id="ptGallerySort" aria-label="Sort videos">
          <option value="newest"${gallerySort === 'newest' ? ' selected' : ''}>Newest first</option>
          <option value="oldest"${gallerySort === 'oldest' ? ' selected' : ''}>Oldest first</option>
          <option value="title_asc"${gallerySort === 'title_asc' ? ' selected' : ''}>Title A–Z</option>
          <option value="title_desc"${gallerySort === 'title_desc' ? ' selected' : ''}>Title Z–A</option>
          <option value="due_soon"${gallerySort === 'due_soon' ? ' selected' : ''}>Feedback due soon</option>
        </select>
        <div class="pt-toolbar-meta">${resultCount} video${resultCount === 1 ? '' : 's'}</div>
      </div>`;
  }

  function wireGalleryToolbar() {
    const search = document.getElementById('ptGallerySearch');
    const status = document.getElementById('ptGalleryStatus');
    const folder = document.getElementById('ptGalleryFolder');
    const sort = document.getElementById('ptGallerySort');

    if (search) {
      search.addEventListener('input', () => {
        gallerySearch = search.value;
        renderGallery();
        const again = document.getElementById('ptGallerySearch');
        if (again) {
          again.focus();
          const len = again.value.length;
          again.setSelectionRange(len, len);
        }
      });
    }
    if (status) {
      status.addEventListener('change', () => {
        galleryStatusFilter = status.value;
        renderGallery();
      });
    }
    if (folder) {
      folder.addEventListener('change', () => {
        galleryFolderFilter = folder.value;
        renderGallery();
      });
    }
    if (sort) {
      sort.addEventListener('change', () => {
        gallerySort = sort.value;
        renderGallery();
      });
    }
  }

  // ---- Gallery ----
  function renderGallery() {
    if (needsNameGate()) { renderNameGate(); return; }
    updateHeader();

    const filtered = filteredGalleryProjects();
    const inReview = filtered.filter(p => p.status === 'in_review');
    const delivered = filtered.filter(p => p.status === 'delivered');
    const useFolderChrome = (portalData.folders || []).length > 0 ||
      portalData.projects.some(p => (p.category || '').trim());
    const hasActiveFilters = !!(gallerySearch.trim() || galleryStatusFilter !== 'all' || galleryFolderFilter);

    const card = (p, { hideFolderMeta = false } = {}) => {
      const thumb = p.thumbnailUrl
        ? `<img src="${escapeHtml(p.thumbnailUrl)}" alt="" loading="lazy">`
        : (p.latestVersionStatus === 'processing' ? 'Processing…' : 'No preview yet');
      const decision = p.reviewDecision?.status || 'none';
      let tag;
      if (p.status === 'delivered') tag = `<span class="pt-card-tag">Delivered</span>`;
      else if (decision === 'approved') tag = `<span class="pt-card-tag approved">Approved</span>`;
      else tag = `<span class="pt-card-tag review">Needs your review</span>`;
      const meta = p.status === 'delivered'
        ? `${!hideFolderMeta && p.category ? `${escapeHtml(p.category)} · ` : ''}Delivered ${fmtDate(p.deliveredAt)}`
        : `${!hideFolderMeta && p.category ? `${escapeHtml(p.category)} · ` : ''}v${p.latestVersionNumber || 1}`;
      const due = (p.status === 'in_review' && decision !== 'approved' && p.feedbackDueAt)
        ? `<div class="pt-due-pill">Feedback due ${fmtDate(p.feedbackDueAt)}</div>`
        : '';
      const downloadUrl = (p.status === 'delivered' && p.masterFileUrl)
        ? toDirectDownloadUrl(p.masterFileUrl)
        : '';
      const downloadBtn = downloadUrl
        ? `<a class="pt-card-download" href="${escapeHtml(downloadUrl)}" target="_blank" rel="noopener" title="Download final video" aria-label="Download final video" data-download="1">&#11015;</a>`
        : '';
      return `
        <div class="pt-card" data-id="${p._id}">
          <div class="pt-card-thumb">${thumb}${tag}${downloadBtn}</div>
          <div class="pt-card-body">
            <div class="pt-card-title">${escapeHtml(p.title)}</div>
            <div class="pt-card-meta">${meta}</div>
            ${due}
          </div>
        </div>`;
    };

    const renderSection = (title, sub, projects) => {
      if (!projects.length) return '';
      const groups = groupProjectsByFolder(projects);
      const showFolderHeads = useFolderChrome && !(groups.length === 1 && !groups[0].name);
      let body = '';
      if (!showFolderHeads) {
        body = `<div class="pt-grid">${projects.map(p => card(p, { hideFolderMeta: false })).join('')}</div>`;
      } else {
        body = groups.map(g => `
          <div class="pt-folder-block">
            ${g.name ? `<div class="pt-folder-title">${escapeHtml(g.name)}</div>` : ''}
            <div class="pt-grid">${g.projects.map(p => card(p, { hideFolderMeta: !!g.name })).join('')}</div>
          </div>`).join('');
      }
      return `
        <div class="pt-section">
          <div class="pt-section-title">${title}</div>
          <div class="pt-section-sub">${sub}</div>
          ${body}
        </div>`;
    };

    let html = renderGalleryToolbar(filtered.length);

    if (!(portalData.projects || []).length) {
      html += '<div class="pt-loading">Nothing here yet — your videos will appear as soon as they\'re ready.</div>';
    } else if (!filtered.length) {
      html += `<div class="pt-empty-filter">${hasActiveFilters
        ? 'No videos match your search or filters.'
        : 'Nothing here yet — your videos will appear as soon as they\'re ready.'}</div>`;
    } else {
      html += renderSection(
        'In Review',
        'These cuts are waiting on your feedback — open one and leave comments right on the video.',
        inReview
      );
      html += renderSection(
        'Delivered',
        'Your finished videos, ready to watch and download.',
        delivered
      );
    }

    html += '<div class="pt-note">This portal link can be shared with your team. Questions? Email <a href="mailto:info@lumetrymedia.com">info@lumetrymedia.com</a></div>';

    container.innerHTML = html;
    wireGalleryToolbar();
    container.querySelectorAll('.pt-card').forEach(el =>
      el.addEventListener('click', () => openProject(el.dataset.id)));
    container.querySelectorAll('.pt-card-download').forEach(el => {
      el.addEventListener('click', (e) => e.stopPropagation());
    });
  }

  // ---- Project view ----
  async function openProject(projectId, pushState = true) {
    if (needsNameGate()) { renderNameGate(); return; }

    try {
      project = await api(`/api/portal/${encodeURIComponent(token)}/projects/${projectId}`);
    } catch (err) {
      showError(err.message);
      return;
    }

    if (project.branding) applyBranding(project.branding);

    if (pushState) {
      const url = new URL(location.href);
      url.searchParams.set('project', projectId);
      history.pushState({ projectId }, '', url);
    }

    const versions = project.versions || [];
    currentVersionId = versions.length ? versions[versions.length - 1]._id : null;
    composeTimecodeAttached = true;
    composePickingEnd = false;
    composeTimecode = 0;
    composeTimecodeEnd = null;
    viewingCommentId = null;
    container.classList.add('pt-full');
    renderProject();
    window.scrollTo(0, 0);
  }

  function currentVersion() {
    return (project?.versions || []).find(v => v._id === currentVersionId) || null;
  }

  function authorPayload() {
    return portalData.shared ? { authorName: reviewerName } : {};
  }

  function renderProject() {
    updateHeader();
    const versions = [...(project.versions || [])].reverse();
    const versionOptions = versions.map(v =>
      `<option value="${v._id}">Version ${v.versionNumber}${v.uploadedAt ? ` — ${fmtDate(v.uploadedAt)}` : ''}</option>`).join('');

    const authorRow = portalData.shared
      ? `<div class="pt-author-row">Commenting as <strong>${escapeHtml(reviewerName)}</strong>
           <button type="button" class="pt-author-change" id="ptChangeAuthor">Not you?</button></div>`
      : '';

    const decision = project.reviewDecision || { status: 'none' };
    const isApproved = decision.status === 'approved';
    let decisionHtml = '';
    if (project.status === 'in_review') {
      if (isApproved) {
        decisionHtml = `<div class="pt-decision-box"><div class="pt-decision-result approved">&#10003; Approved by ${escapeHtml(decision.decidedByName || 'you')}${decision.versionNumber ? ` (v${decision.versionNumber})` : ''} on ${fmtDate(decision.decidedAt)}</div></div>`;
      } else {
        decisionHtml = `
          <div class="pt-decision-box" id="ptDecisionBox">
            <div class="pt-decision-title">Ready to approve?</div>
            <div class="pt-decision-sub">${project.feedbackDueAt ? `Feedback is due ${fmtDate(project.feedbackDueAt)}. ` : ''}Leave notes in the comments, then approve when this cut looks good.</div>
            <div class="pt-decision-actions">
              <button type="button" class="pt-decision-approve" id="ptApproveBtn">Approve</button>
            </div>
            <div class="pt-compose-hint" id="ptDecisionHint"></div>
          </div>`;
      }
    }

    const sub = project.status === 'delivered'
      ? `Delivered ${fmtDate(project.deliveredAt)}`
      : (isApproved
        ? 'Approved — waiting on final delivery'
        : 'In review — your comments go straight to our editors');

    container.innerHTML = `
      <button class="pt-back" id="ptBackBtn">&larr; All videos</button>
      <div class="pt-project-head">
        <div class="pt-project-title">${escapeHtml(project.title)}</div>
        <div class="pt-project-sub">${project.category ? `${escapeHtml(project.category)} · ` : ''}${sub}</div>
      </div>
      <div class="pt-project-layout">
        <div class="pt-player-col">
          <div class="pt-version-bar">
            <select id="ptVersionSelect">${versionOptions || '<option>No versions yet</option>'}</select>
            <span class="pt-version-note" id="ptVersionNote"></span>
            ${versions.length >= 2 ? `<button type="button" class="pt-compare-btn" id="ptCompareBtn">${compareMode ? 'Exit compare' : 'Compare'}</button>` : ''}
          </div>
          <div class="pt-player-stack ${compareMode ? 'compare-on' : ''}" id="ptPlayerStack">
            <div class="pt-player-wrap" id="ptPlayerWrap"></div>
            <div class="pt-compare-pane" id="ptComparePane" style="display:${compareMode ? 'block' : 'none'};">
              <div class="pt-version-bar">
                <select id="ptCompareSelect"></select>
              </div>
              <div class="pt-player-wrap" id="ptCompareWrap"></div>
            </div>
          </div>
          <div class="pt-marker-rail" id="ptMarkerRail" hidden aria-label="Comment markers on timeline"></div>
          ${project.status === 'in_review' ? `
          <div class="pt-annotate-bar">
            <button type="button" class="pt-tool-btn" id="ptPenBtn" title="Draw on frame">&#9998;</button>
            <button type="button" class="pt-tool-btn" id="ptArrowBtn" title="Arrow">&#8599;</button>
            <button type="button" class="pt-tool-btn" id="ptClearDrawBtn" title="Clear drawing">&#10005;</button>
            <span class="pt-annotate-hint" id="ptAnnotateHint"></span>
          </div>` : ''}
          ${project.masterFileUrl ? `<a class="pt-download" href="${escapeHtml(toDirectDownloadUrl(project.masterFileUrl))}" target="_blank" rel="noopener">&#11015; Download Final Video</a>` : ''}
          ${decisionHtml}
          ${project.status === 'in_review' && !isApproved ? `
          <div class="pt-howto">Pause where you want a change, then send. Time follows the playhead — tap it to remove, or add an end time for a range.</div>` : ''}
        </div>
        <div class="pt-comments-col">
          <div class="pt-comments-title">Comments</div>
          <div class="pt-comments-list" id="ptCommentsList"></div>
          <div class="pt-compose">
            ${authorRow}
            <textarea id="ptCommentText" placeholder="Add a comment… Time follows the playhead (tap the time to remove it)"></textarea>
            <div class="pt-compose-row">
              <button class="pt-tc-btn active" id="ptTcBtn" title="Remove timestamp from this comment">&#9201; <span id="ptTcLabel">0:00</span></button>
              <button class="pt-tc-btn" id="ptTcEndBtn" title="Lock this time as the start, then scrub to set the end" style="display:inline-flex;"><span id="ptTcEndLabel">Add end time</span></button>
              <button class="pt-send-btn" id="ptSendBtn">Send</button>
            </div>
            <div class="pt-compose-hint" id="ptComposeHint"></div>
          </div>
        </div>
      </div>`;

    document.getElementById('ptBackBtn').addEventListener('click', () => backToGallery());
    document.getElementById('ptVersionSelect').addEventListener('change', (e) => {
      currentVersionId = e.target.value;
      composeTimecodeEnd = null;
      composePickingEnd = false;
      composeTimecodeAttached = true;
      composeTimecode = 0;
      updateTcLabel();
      renderPlayer();
      renderComments();
    });
    if (currentVersionId) document.getElementById('ptVersionSelect').value = currentVersionId;

    document.getElementById('ptCompareBtn')?.addEventListener('click', () => {
      compareMode = !compareMode;
      renderProject();
    });
    document.getElementById('ptPenBtn')?.addEventListener('click', () => setAnnotateTool(annotateTool === 'pen' ? 'off' : 'pen'));
    document.getElementById('ptArrowBtn')?.addEventListener('click', () => setAnnotateTool(annotateTool === 'arrow' ? 'off' : 'arrow'));
    document.getElementById('ptClearDrawBtn')?.addEventListener('click', () => {
      if (annotate) annotate.clear();
      setAnnotateTool('off');
    });

    document.getElementById('ptTcBtn').addEventListener('click', toggleTimecode);
    document.getElementById('ptTcEndBtn')?.addEventListener('click', toggleTimecodeEnd);
    document.getElementById('ptSendBtn').addEventListener('click', sendComment);
    const changeBtn = document.getElementById('ptChangeAuthor');
    if (changeBtn) {
      changeBtn.addEventListener('click', () => {
        clearAuthor();
        renderNameGate(true);
      });
    }

    const approveBtn = document.getElementById('ptApproveBtn');
    if (approveBtn) {
      approveBtn.addEventListener('click', () => submitDecision('approved'));
    }

    renderPlayer();
    if (compareMode) renderComparePlayer();
    renderComments();
    updateTcLabel();
  }

  async function submitDecision(decision) {
    if (portalData.shared && !reviewerName) {
      renderNameGate();
      return;
    }
    const hint = document.getElementById('ptDecisionHint');
    const approveBtn = document.getElementById('ptApproveBtn');
    if (approveBtn) approveBtn.disabled = true;
    try {
      const result = await api(`/api/portal/${encodeURIComponent(token)}/projects/${project._id}/decision`, {
        method: 'POST',
        body: JSON.stringify({ decision, ...authorPayload() })
      });
      project.reviewDecision = result.reviewDecision;
      // Keep gallery in sync
      const g = portalData.projects.find(p => p._id === project._id);
      if (g) g.reviewDecision = result.reviewDecision;
      renderProject();
    } catch (err) {
      if (hint) hint.textContent = err.message;
      if (approveBtn) approveBtn.disabled = false;
    }
  }

  function renderPlayer() {
    const wrap = document.getElementById('ptPlayerWrap');
    const v = currentVersion();
    player = null;
    if (annotate) { annotate.destroy(); annotate = null; }

    const note = document.getElementById('ptVersionNote');
    if (note) {
      if (v && v.notes) note.textContent = v.notes;
      else note.textContent = '';
    }

    if (!v) {
      wrap.innerHTML = '<div class="pt-player-placeholder">No video available yet — check back soon.</div>';
      cachedPlayerDuration = 0;
      renderCommentMarkers();
      return;
    }
    if (!v.embedUrl) {
      wrap.innerHTML = `<div class="pt-player-placeholder">${v.videoStatus === 'error' ? 'This version hit a processing error — we\'re on it.' : 'This video is still processing. Check back in a few minutes.'}</div>`;
      cachedPlayerDuration = 0;
      renderCommentMarkers();
      return;
    }

    wrap.innerHTML = `<iframe src="${escapeHtml(v.embedUrl)}" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen id="ptPlayerFrame"></iframe>`;
    playerListenersBound = false;
    viewingCommentId = null;
    cachedPlayerDuration = Number(v.durationSeconds) || 0;
    if (window.playerjs) {
      try {
        player = new window.playerjs.Player(document.getElementById('ptPlayerFrame'));
        bindPlayerAnnotationListeners(player);
      } catch { player = null; }
    }
    if (window.PortalAnnotate && project.status === 'in_review') {
      annotate = window.PortalAnnotate.createOverlay(wrap);
      setAnnotateTool(annotateTool === 'view' ? 'off' : annotateTool);
    }
    renderCommentMarkers();
  }

  function bindPlayerAnnotationListeners(p) {
    if (!p || playerListenersBound) return;
    playerListenersBound = true;
    try {
      const refreshDuration = () => {
        try {
          p.getDuration((d) => {
            const n = Number(d) || 0;
            if (n > 0) {
              cachedPlayerDuration = n;
              renderCommentMarkers();
            }
          });
        } catch { /* noop */ }
      };
      p.on('ready', () => {
        refreshDuration();
        if (composeTimecodeAttached) captureComposeTimecode();
      });
      refreshDuration();
      if (composeTimecodeAttached) captureComposeTimecode();
      p.on('play', () => {
        if (!viewingCommentId || !project) return;
        const c = project.comments.find(x => x._id === viewingCommentId);
        if (!c || c.timecodeSeconds == null) {
          clearAnnotationView();
          return;
        }
        const hasRange = c.timecodeEndSeconds != null && c.timecodeEndSeconds > c.timecodeSeconds;
        if (!hasRange) clearAnnotationView();
        else startAnnotationWatch();
      });
      p.on('timeupdate', (data) => {
        const t = playerTimeFromEvent(data);
        syncComposeTimecodeFromPlayhead(t);
        syncAnnotationVisibility(t);
      });
    } catch { /* noop */ }
  }

  function syncComposeTimecodeFromPlayhead(t) {
    if (!composeTimecodeAttached) return;
    if (t == null || Number.isNaN(Number(t))) return;
    const next = Math.floor(Number(t) || 0);

    if (composePickingEnd && composeTimecode != null) {
      if (next > composeTimecode) {
        if (composeTimecodeEnd === next) return;
        composeTimecodeEnd = next;
        updateTcLabel();
      }
      return;
    }

    if (composeTimecodeEnd != null) return;
    if (composeTimecode === next) return;
    composeTimecode = next;
    updateTcLabel();
  }

  function captureComposeTimecode(cb) {
    composeTimecodeAttached = true;
    if (!player) {
      if (composeTimecode == null) composeTimecode = 0;
      updateTcLabel();
      cb?.();
      return;
    }
    try {
      player.getCurrentTime((t) => {
        if (!composeTimecodeAttached) return;
        if (!composePickingEnd && composeTimecodeEnd == null) {
          composeTimecode = Math.floor(Number(t) || 0);
        } else if (composePickingEnd && composeTimecode != null) {
          const next = Math.floor(Number(t) || 0);
          if (next > composeTimecode) composeTimecodeEnd = next;
        }
        updateTcLabel();
        cb?.();
      });
    } catch {
      if (composeTimecode == null) composeTimecode = 0;
      updateTcLabel();
      cb?.();
    }
  }

  function clearComposeTimecode() {
    composeTimecodeAttached = false;
    composePickingEnd = false;
    composeTimecode = null;
    composeTimecodeEnd = null;
    updateTcLabel();
  }

  function clearComposeEnd() {
    composePickingEnd = false;
    composeTimecodeEnd = null;
    updateTcLabel();
    captureComposeTimecode();
  }

  function beginComposeEndPick() {
    if (!composeTimecodeAttached || composeTimecode == null) return;
    const hint = document.getElementById('ptComposeHint');
    if (!player) {
      if (hint) hint.textContent = 'Start the video first, then add an end time.';
      return;
    }
    composePickingEnd = true;
    composeTimecodeEnd = null;
    try {
      player.getCurrentTime((t) => {
        composeTimecode = Math.floor(Number(t) || 0);
        updateTcLabel();
        if (hint) hint.textContent = 'Scrub to the end of the range, then send.';
      });
    } catch {
      updateTcLabel();
    }
  }

  function playerTimeFromEvent(data) {
    if (data == null) return null;
    if (typeof data === 'number') return data;
    if (typeof data === 'object' && data.seconds != null) return Number(data.seconds);
    return Number(data);
  }

  function syncAnnotationVisibility(time) {
    if (!viewingCommentId) return;
    const c = (project?.comments || []).find(x => x._id === viewingCommentId);
    if (!c || c.timecodeSeconds == null) {
      clearAnnotationView();
      return;
    }
    if (time == null || Number.isNaN(Number(time))) return;
    const t = Number(time);
    const start = Number(c.timecodeSeconds);
    const hasRange = c.timecodeEndSeconds != null && c.timecodeEndSeconds > start;
    if (hasRange) {
      if (t < start - 0.25 || t > Number(c.timecodeEndSeconds) + 0.05) clearAnnotationView();
    } else if (Math.abs(t - start) > 0.45) {
      clearAnnotationView();
    }
  }

  function startAnnotationWatch() {
    stopAnnotationWatch();
    if (!viewingCommentId || !player) return;
    annotationWatchTimer = setInterval(() => {
      if (!viewingCommentId || !player) {
        stopAnnotationWatch();
        return;
      }
      try {
        player.getCurrentTime((t) => syncAnnotationVisibility(t));
      } catch {
        stopAnnotationWatch();
      }
    }, 200);
  }

  function stopAnnotationWatch() {
    if (annotationWatchTimer) {
      clearInterval(annotationWatchTimer);
      annotationWatchTimer = null;
    }
  }

  function renderComparePlayer() {
    const sel = document.getElementById('ptCompareSelect');
    const wrap = document.getElementById('ptCompareWrap');
    if (!sel || !wrap) return;
    const versions = [...(project.versions || [])].reverse();
    if (!compareVersionId) {
      compareVersionId = versions.find(v => v._id !== currentVersionId)?._id || versions[0]?._id || null;
    }
    sel.innerHTML = versions.map(v =>
      `<option value="${v._id}">Version ${v.versionNumber}${v.uploadedAt ? ` — ${fmtDate(v.uploadedAt)}` : ''}</option>`).join('');
    if (compareVersionId) sel.value = compareVersionId;
    sel.onchange = () => {
      compareVersionId = sel.value;
      renderComparePlayer();
    };
    const v = versions.find(x => x._id === (compareVersionId || sel.value));
    if (!v?.embedUrl) {
      wrap.innerHTML = '<div class="pt-player-placeholder">Version not ready</div>';
      return;
    }
    wrap.innerHTML = `<iframe src="${escapeHtml(v.embedUrl)}" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>`;
  }

  function setAnnotateTool(tool) {
    if (tool === 'pen' || tool === 'arrow') clearAnnotationView();
    annotateTool = tool;
    document.getElementById('ptPenBtn')?.classList.toggle('active', tool === 'pen');
    document.getElementById('ptArrowBtn')?.classList.toggle('active', tool === 'arrow');
    if (annotate) annotate.setMode(tool === 'pen' || tool === 'arrow' ? tool : 'off');
    const hint = document.getElementById('ptAnnotateHint');
    if (hint) {
      hint.textContent = tool === 'pen' || tool === 'arrow'
        ? 'Drawing — attaches to your next comment'
        : '';
    }
    if ((tool === 'pen' || tool === 'arrow') && player) {
      try {
        player.pause();
        if (!composeTimecodeAttached || composeTimecode == null) {
          composeTimecodeEnd = null;
          captureComposeTimecode();
        }
      } catch { /* noop */ }
    }
  }

  function clearAnnotationView(opts = {}) {
    stopAnnotationWatch();
    if (!opts.keepSelection) viewingCommentId = null;
    if (annotateTool === 'view') annotateTool = 'off';
    if (annotate) {
      annotate.clear();
      annotate.setMode(annotateTool === 'pen' || annotateTool === 'arrow' ? annotateTool : 'off');
    }
    document.getElementById('ptPenBtn')?.classList.toggle('active', annotateTool === 'pen');
    document.getElementById('ptArrowBtn')?.classList.toggle('active', annotateTool === 'arrow');
    updateActiveCommentHighlight();
  }

  function updateActiveCommentHighlight() {
    document.querySelectorAll('#ptCommentsList .pt-comment').forEach(el => {
      el.classList.toggle('is-active', !!viewingCommentId && el.dataset.id === viewingCommentId);
    });
    document.querySelectorAll('#ptMarkerRail .pt-marker').forEach(el => {
      el.classList.toggle('is-active', !!viewingCommentId && el.dataset.id === viewingCommentId);
    });
  }

  function renderCommentMarkers() {
    const rail = document.getElementById('ptMarkerRail');
    if (!rail) return;

    const duration = versionDurationSeconds();
    const items = commentsForCurrentVersion().filter(hasSeekTimecode);

    if (!duration || items.length === 0) {
      rail.hidden = true;
      rail.innerHTML = '';
      return;
    }

    rail.hidden = false;
    const rangesHtml = items.map(c => {
      const start = Number(c.timecodeSeconds);
      const end = c.timecodeEndSeconds != null && c.timecodeEndSeconds > start
        ? Number(c.timecodeEndSeconds)
        : null;
      if (end == null) return '';
      const left = Math.min(100, Math.max(0, (start / duration) * 100));
      const width = Math.min(100 - left, Math.max(0.4, ((end - start) / duration) * 100));
      return `<div class="pt-marker-range-bar ${c.resolved ? 'resolved' : ''}" style="left:${left}%;width:${width}%;"></div>`;
    }).join('');

    const markersHtml = items.map(c => {
      const start = Number(c.timecodeSeconds);
      const left = Math.min(100, Math.max(0, (start / duration) * 100));
      const active = viewingCommentId && viewingCommentId === c._id;
      const tip = `${c.authorName || 'Comment'} · ${fmtCommentTimecode(c)}${c.text ? ` — ${String(c.text).slice(0, 80)}` : ''}`;
      return `<button type="button" class="pt-marker ${c.authorType || ''} ${c.resolved ? 'resolved' : ''}${active ? ' is-active' : ''}" data-id="${c._id}" style="left:${left}%;" title="${escapeHtml(tip)}" aria-label="${escapeHtml(tip)}">${escapeHtml(authorInitials(c.authorName))}</button>`;
    }).join('');

    rail.innerHTML = `<div class="pt-marker-track">${rangesHtml}${markersHtml}</div>`;

    rail.querySelectorAll('.pt-marker').forEach(btn => {
      btn.addEventListener('click', () => {
        const c = project?.comments?.find(x => x._id === btn.dataset.id);
        if (!c) return;
        jumpToComment(c);
        document.querySelector(`#ptCommentsList .pt-comment[data-id="${c._id}"]`)
          ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      });
    });
  }

  function showCommentAnnotation(comment) {
    if (!annotate || !window.PortalAnnotate?.hasAnnotation(comment?.annotation)) {
      clearAnnotationView({ keepSelection: true });
      return;
    }
    viewingCommentId = comment._id;
    annotate.setData(comment.annotation);
    annotate.setMode('view');
    annotateTool = 'view';
    document.getElementById('ptPenBtn')?.classList.remove('active');
    document.getElementById('ptArrowBtn')?.classList.remove('active');
    startAnnotationWatch();
    updateActiveCommentHighlight();
  }

  function jumpToComment(comment) {
    if (!player || comment?.timecodeSeconds == null) return;
    try {
      player.setCurrentTime(Number(comment.timecodeSeconds));
      player.pause();
    } catch { return; }
    viewingCommentId = comment._id;
    updateActiveCommentHighlight();
    if (window.PortalAnnotate?.hasAnnotation(comment.annotation)) {
      setTimeout(() => showCommentAnnotation(comment), 120);
    } else {
      clearAnnotationView({ keepSelection: true });
    }
  }

  function backToGallery() {
    project = null;
    player = null;
    viewingCommentId = null;
    stopAnnotationWatch();
    if (annotate) { annotate.destroy(); annotate = null; }
    compareMode = false;
    composeTimecodeAttached = true;
    composePickingEnd = false;
    composeTimecode = null;
    composeTimecodeEnd = null;
    container.classList.remove('pt-full');
    const url = new URL(location.href);
    url.searchParams.delete('project');
    history.pushState({}, '', url);
    renderGallery();
  }

  // ---- Comments ----
  function commentsForCurrentVersion() {
    const items = (project?.comments || []).filter(c => c.versionId === currentVersionId);
    return [...items].sort((a, b) => {
      const ta = a.timecodeSeconds == null ? Number.MAX_SAFE_INTEGER : a.timecodeSeconds;
      const tb = b.timecodeSeconds == null ? Number.MAX_SAFE_INTEGER : b.timecodeSeconds;
      if (ta !== tb) return ta - tb;
      return new Date(a.createdAt) - new Date(b.createdAt);
    });
  }

  function renderComments() {
    const list = document.getElementById('ptCommentsList');
    const items = commentsForCurrentVersion();
    renderCommentMarkers();

    if (items.length === 0) {
      list.innerHTML = '<div class="pt-comments-empty">No comments on this version yet.<br>Be the first — we read every one.</div>';
      return;
    }

    list.innerHTML = items.map(c => {
      const hasTc = c.timecodeSeconds != null;
      const active = viewingCommentId && viewingCommentId === c._id;
      return `
      <div class="pt-comment ${c.resolved ? 'resolved' : ''}${hasTc ? ' has-tc' : ''}${active ? ' is-active' : ''}" data-id="${c._id}"${hasTc ? ' data-seek="1"' : ''}>
        ${c.resolved ? '<span class="pt-resolved-tag" title="Resolved">&#10003;</span>' : ''}
        <div class="pt-comment-head">
          <span class="pt-comment-author ${c.authorType}">${escapeHtml(c.authorName)}</span>
          ${window.PortalAnnotate?.hasAnnotation(c.annotation) ? '<span class="pt-ann-tag">Drawing</span>' : ''}
          <span class="pt-comment-date">${fmtDate(c.createdAt)}</span>
        </div>
        <div class="pt-comment-body">
          ${hasTc ? `<span class="pt-comment-tc">${fmtCommentTimecode(c)}</span>` : ''}
          <span class="pt-comment-text">${escapeHtml(c.text)}</span>
        </div>
        ${(c.replies || []).map(r => `
          <div class="pt-reply">
            <div class="pt-comment-head">
              <span class="pt-comment-author ${r.authorType}">${escapeHtml(r.authorName)}</span>
              <span class="pt-comment-date">${fmtDate(r.createdAt)}</span>
            </div>
            <div class="pt-comment-text">${escapeHtml(r.text)}</div>
          </div>`).join('')}
        <div class="pt-comment-actions">
          <button type="button" class="pt-comment-icon-btn" data-reply="${c._id}" title="Reply" aria-label="Reply">&#8617;</button>
        </div>
        <form class="pt-reply-form" data-comment="${c._id}" style="display:none;">
          <input type="text" placeholder="Write a reply…" required>
          <button type="submit" class="pt-send-btn" style="margin-left:0;padding:7px 14px;font-size:0.78rem;">Send</button>
        </form>
      </div>`;
    }).join('');

    list.querySelectorAll('.pt-comment[data-seek]').forEach(card => {
      card.addEventListener('click', () => {
        const c = project.comments.find(x => x._id === card.dataset.id);
        if (c) jumpToComment(c);
      });
    });

    const stop = (el) => {
      el.addEventListener('click', (e) => e.stopPropagation());
      el.addEventListener('mousedown', (e) => e.stopPropagation());
    };
    list.querySelectorAll('.pt-comment-actions, .pt-reply-form, .pt-reply').forEach(stop);

    list.querySelectorAll('[data-reply]').forEach(btn =>
      btn.addEventListener('click', () => {
        const form = list.querySelector(`.pt-reply-form[data-comment="${btn.dataset.reply}"]`);
        form.style.display = form.style.display === 'none' ? 'flex' : 'none';
        if (form.style.display === 'flex') form.querySelector('input').focus();
      }));

    list.querySelectorAll('.pt-reply-form').forEach(form =>
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const input = form.querySelector('input');
        const text = input.value.trim();
        if (!text) return;
        try {
          const updated = await api(`/api/portal/${encodeURIComponent(token)}/comments/${form.dataset.comment}/replies`, {
            method: 'POST',
            body: JSON.stringify({ text, ...authorPayload() })
          });
          const idx = project.comments.findIndex(c => c._id === updated._id);
          if (idx >= 0) project.comments[idx] = updated;
          renderComments();
        } catch (err) {
          document.getElementById('ptComposeHint').textContent = err.message;
        }
      }));
  }

  function updateTcLabel() {
    const btn = document.getElementById('ptTcBtn');
    const label = document.getElementById('ptTcLabel');
    const endBtn = document.getElementById('ptTcEndBtn');
    const endLabel = document.getElementById('ptTcEndLabel');
    if (!btn || !label) return;
    if (composeTimecodeAttached && composeTimecode != null) {
      if (composeTimecodeEnd != null && composeTimecodeEnd > composeTimecode) {
        label.textContent = `${fmtTimecode(composeTimecode)}–${fmtTimecode(composeTimecodeEnd)}`;
      } else if (composePickingEnd) {
        label.textContent = `${fmtTimecode(composeTimecode)}–…`;
      } else {
        label.textContent = fmtTimecode(composeTimecode);
      }
      btn.classList.add('active');
      btn.title = 'Remove timestamp from this comment';
      if (endBtn) endBtn.style.display = 'inline-flex';
    } else {
      label.textContent = 'No time';
      btn.classList.remove('active');
      btn.title = 'Attach current playhead time';
      composePickingEnd = false;
      composeTimecodeEnd = null;
      if (endBtn) endBtn.style.display = 'none';
    }
    if (endBtn && endLabel) {
      const hasEnd = composePickingEnd || (composeTimecodeEnd != null && composeTimecode != null && composeTimecodeEnd > composeTimecode);
      endBtn.classList.toggle('active', hasEnd);
      endLabel.textContent = hasEnd ? 'Clear end' : 'Add end time';
      endBtn.title = hasEnd
        ? 'Remove end time and go back to a single timestamp'
        : 'Lock this time as the start, then scrub to set the end';
    }
  }

  function toggleTimecode() {
    const hint = document.getElementById('ptComposeHint');
    if (composeTimecodeAttached) {
      clearComposeTimecode();
      if (hint) hint.textContent = '';
      return;
    }
    if (!player) {
      hint.textContent = 'Start the video first, then tap this to attach the current time.';
      return;
    }
    composeTimecodeEnd = null;
    composePickingEnd = false;
    captureComposeTimecode(() => {
      if (hint) hint.textContent = '';
      document.getElementById('ptCommentText')?.focus();
    });
  }

  function toggleTimecodeEnd() {
    if (!composeTimecodeAttached || composeTimecode == null) return;
    const hint = document.getElementById('ptComposeHint');
    if (composePickingEnd || composeTimecodeEnd != null) {
      clearComposeEnd();
      if (hint) hint.textContent = '';
      return;
    }
    beginComposeEndPick();
  }

  async function sendComment() {
    const textarea = document.getElementById('ptCommentText');
    const hint = document.getElementById('ptComposeHint');
    const btn = document.getElementById('ptSendBtn');
    const text = textarea.value.trim();
    if (!text || !currentVersionId) return;

    if (portalData.shared && !reviewerName) {
      renderNameGate();
      return;
    }

    const annotation = annotate?.getData?.() || null;

    btn.disabled = true;
    try {
      const comment = await api(`/api/portal/${encodeURIComponent(token)}/projects/${project._id}/comments`, {
        method: 'POST',
        body: JSON.stringify({
          versionId: currentVersionId,
          timecodeSeconds: composeTimecode,
          timecodeEndSeconds: composeTimecodeEnd,
          text,
          annotation,
          ...authorPayload()
        })
      });
      project.comments.push(comment);
      textarea.value = '';
      composeTimecodeEnd = null;
      composePickingEnd = false;
      composeTimecodeAttached = true;
      if (annotate) annotate.clear();
      setAnnotateTool('off');
      captureComposeTimecode();
      hint.textContent = 'Sent! Our team has been notified.';
      setTimeout(() => { if (hint.textContent.startsWith('Sent')) hint.textContent = ''; }, 4000);
      renderComments();
    } catch (err) {
      hint.textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  }

  // ---- Init ----
  window.addEventListener('popstate', () => {
    const projectId = new URLSearchParams(location.search).get('project');
    if (projectId && portalData) {
      openProject(projectId, false);
    } else if (portalData) {
      project = null;
      container.classList.remove('pt-full');
      renderGallery();
    }
  });

  (async function init() {
    if (!token) {
      showError('This link is missing its access token. Please use the link from your email.');
      return;
    }
    try {
      portalData = await api(`/api/portal/${encodeURIComponent(token)}`);
    } catch (err) {
      showError(err.message);
      return;
    }

    applyBranding(portalData.branding);

    // Personal links already know who you are; shared links ask once
    if (portalData.shared) {
      reviewerName = loadSavedAuthor();
    } else {
      reviewerName = portalData.contactName || '';
    }

    if (needsNameGate()) {
      renderNameGate();
      return;
    }

    updateHeader();
    const projectId = params.get('project');
    if (projectId) {
      await openProject(projectId, false);
    } else {
      renderGallery();
    }
  })();
})();
