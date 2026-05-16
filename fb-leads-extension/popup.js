const $ = (id) => document.getElementById(id);

let sessionNew   = 0;
let scrollInterval = null;
let allLeads     = [];
let enriching    = false;

const statusBar    = $('status-bar');
const countBadge   = $('count-badge');
const sessionBadge = $('session-badge');
const enrichBadge  = $('enrich-badge');
const leadsBody    = $('leads-body');
const emptyRow     = $('empty-row');
const debugBox     = $('debug-box');
const enrichBar    = $('enrich-bar');
const progressFill = $('progress-fill');
const progressText = $('progress-text');
const progressLabel= $('progress-label');
const btnExtract   = $('btn-extract');
const btnScroll    = $('btn-scroll');
const btnEnrich    = $('btn-enrich');
const btnStopEnrich= $('btn-stop-enrich');
const btnExportCsv = $('btn-export-csv');
const btnExportJson= $('btn-export-json');
const btnClear     = $('btn-clear');
const modeSelect   = $('mode-select');

// ── helpers ───────────────────────────────────────────────────────────────────

function setStatus(msg, color = '#fff') {
  statusBar.textContent = msg;
  statusBar.style.color = color;
}

function updateBadges() {
  countBadge.textContent   = `${allLeads.length} leads stored`;
  sessionBadge.textContent = `${sessionNew} new this session`;
  const enrichedCount = allLeads.filter((l) => l.enriched).length;
  if (enrichedCount > 0) {
    enrichBadge.textContent = `${enrichedCount} enriched`;
    enrichBadge.style.display = '';
  } else {
    enrichBadge.style.display = 'none';
  }
  const toEnrich = allLeads.filter((l) => !l.enriched).length;
  btnEnrich.textContent = toEnrich > 0
    ? `⚡ Enrich ${toEnrich} Profiles`
    : '⚡ Re-enrich All';
  btnEnrich.disabled = allLeads.length === 0;
}

function showDebug(dbg) {
  if (!dbg) { debugBox.style.display = 'none'; return; }
  debugBox.style.display = 'block';
  debugBox.innerHTML = `
    <strong>Debug</strong> — articles: <b>${dbg.articles}</b>,
    list items: <b>${dbg.listItems}</b>,
    profile links: <b>${dbg.profileLinks}</b> / ${dbg.allLinks} total.
    ${dbg.profileLinks === 0
      ? '<br><span class="warn">No profile links detected — scroll down to load content, then extract again.</span>'
      : ''}
  `;
}

function renderTable() {
  leadsBody.innerHTML = '';
  if (allLeads.length === 0) {
    leadsBody.appendChild(emptyRow);
    return;
  }
  allLeads.forEach((lead, i) => {
    const srcClass = lead.source === 'members' ? 'src-members'
                   : lead.source === 'posts'   ? 'src-posts'
                   : 'src-scan';
    const enrichedMark = lead.enriched ? ' ✓' : '';
    const tr = document.createElement('tr');
    if (lead.enriched) tr.classList.add('enriched-row');
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td title="${esc(lead.name)}">${esc(lead.name)}${enrichedMark}</td>
      <td><a href="${esc(lead.profileUrl)}" target="_blank">${shortUrl(lead.profileUrl)}</a></td>
      <td class="contact-cell">${fmtList(lead.emails, 'mailto:')}</td>
      <td class="contact-cell">${fmtList(lead.phones)}</td>
      <td class="contact-cell">${fmtList(lead.whatsapp)}</td>
      <td class="contact-cell">${fmtList(lead.websites, '')}</td>
      <td class="contact-cell">${fmtLines(lead.work)}</td>
      <td class="contact-cell">${esc(lead.location || '')}</td>
      <td class="info-cell" title="${esc(lead.postText)}">${esc((lead.postText || '').slice(0, 70))}</td>
      <td><span class="src-tag ${srcClass}">${lead.source}</span></td>
    `;
    leadsBody.appendChild(tr);
  });
}

function fmtList(arr = [], prefix = '') {
  if (!arr || arr.length === 0) return '<span class="none">—</span>';
  return arr.map((v) =>
    prefix
      ? `<a href="${esc(prefix + v)}" target="_blank">${esc(v)}</a>`
      : esc(v)
  ).join('<br>');
}

function fmtLines(arr = []) {
  if (!arr || arr.length === 0) return '<span class="none">—</span>';
  return arr.slice(0, 3).map(esc).join('<br>');
}

function esc(str = '') {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

function shortUrl(url = '') {
  try {
    const u = new URL(url);
    const p = u.pathname.replace(/\//g, '').slice(0, 20);
    return p || u.hostname;
  } catch { return url.slice(0, 20); }
}

// ── storage ───────────────────────────────────────────────────────────────────

function loadLeads() {
  chrome.runtime.sendMessage({ action: 'getLeads' }, (res) => {
    allLeads = (res && res.leads) || [];
    updateBadges();
    renderTable();
  });
}

// ── tab helpers ───────────────────────────────────────────────────────────────

async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function isFbGroup(tab) {
  return /facebook\.com\/groups\//i.test(tab.url || '');
}

// ── extract ───────────────────────────────────────────────────────────────────

btnExtract.addEventListener('click', async () => {
  const tab = await getCurrentTab();
  if (!isFbGroup(tab)) {
    setStatus('Navigate to a Facebook Group page first.', '#ffd700');
    return;
  }

  btnExtract.disabled = true;
  debugBox.style.display = 'none';
  setStatus('Extracting…');

  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
  } catch (_) {}

  chrome.tabs.sendMessage(tab.id, { action: 'extract', mode: modeSelect.value }, (res) => {
    btnExtract.disabled = false;

    if (chrome.runtime.lastError || !res) {
      setStatus('Could not connect — refresh the Facebook page and try again.', '#ffd700');
      return;
    }

    showDebug(res.debug);

    if (!res.leads || res.leads.length === 0) {
      setStatus('No leads found — scroll down to load more posts, then extract again.', '#ffd700');
      return;
    }

    chrome.runtime.sendMessage({ action: 'saveLeads', leads: res.leads }, (saveRes) => {
      const fresh = saveRes ? saveRes.saved : 0;
      sessionNew += fresh;
      loadLeads();
      setStatus(`Extracted ${res.leads.length} profiles — ${fresh} new saved.`, '#c6ffa0');
    });
  });
});

// ── auto-scroll ───────────────────────────────────────────────────────────────

btnScroll.addEventListener('click', async () => {
  if (scrollInterval) {
    clearInterval(scrollInterval);
    scrollInterval = null;
    btnScroll.textContent = '⇓ Auto-scroll';
    btnScroll.classList.remove('scrolling');
    setStatus('Stopped. Click Extract Leads.');
    return;
  }

  const tab = await getCurrentTab();
  if (!isFbGroup(tab)) { setStatus('Navigate to a Facebook Group first.', '#ffd700'); return; }

  btnScroll.textContent = '◼ Stop scrolling';
  btnScroll.classList.add('scrolling');
  setStatus('Auto-scrolling…');

  const doScroll = () => chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => window.scrollBy({ top: 800, behavior: 'smooth' }),
  });

  doScroll();
  scrollInterval = setInterval(doScroll, 1800);

  setTimeout(() => {
    if (!scrollInterval) return;
    clearInterval(scrollInterval);
    scrollInterval = null;
    btnScroll.textContent = '⇓ Auto-scroll';
    btnScroll.classList.remove('scrolling');
    setStatus('Done scrolling — click Extract Leads.');
  }, 120_000);
});

// ── enrich ────────────────────────────────────────────────────────────────────

btnEnrich.addEventListener('click', () => {
  if (enriching) return;
  if (allLeads.length === 0) { setStatus('No leads to enrich.', '#ffd700'); return; }

  const targets = allLeads.filter((l) => !l.enriched);
  const profileUrls = (targets.length > 0 ? targets : allLeads).map((l) => l.profileUrl);

  enriching = true;
  btnEnrich.disabled = true;
  btnExtract.disabled = true;
  enrichBar.style.display    = 'flex';
  progressLabel.style.display = 'block';
  setStatus('Enrichment running — visiting each profile About page…');

  chrome.runtime.sendMessage({ action: 'startEnrichment', profileUrls });
});

btnStopEnrich.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'stopEnrichment' });
  setStatus('Stopping enrichment after current profile…', '#ffd700');
});

// Listen for progress from background
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action !== 'enrichProgress') return;

  const pct = msg.total > 0 ? Math.round((msg.current / msg.total) * 100) : 0;
  progressFill.style.width = pct + '%';
  progressText.textContent = `${msg.current} / ${msg.total}`;

  const statusMap = {
    scraping: `Visiting ${msg.name || ''}…`,
    done:     `Enriched: ${msg.name || ''}`,
    error:    `Error on ${msg.name || ''} — skipped`,
    blocked:  'Facebook login required — enrichment stopped',
    stopped:  'Enrichment stopped.',
    complete: `Done! ${msg.total} profiles enriched.`,
  };
  progressLabel.textContent = statusMap[msg.status] || msg.status;

  if (['complete', 'stopped', 'blocked'].includes(msg.status)) {
    enriching = false;
    btnEnrich.disabled  = false;
    btnExtract.disabled = false;
    setTimeout(() => {
      enrichBar.style.display    = 'none';
      progressLabel.style.display = 'none';
    }, 3000);
    setStatus(statusMap[msg.status] || 'Done.', '#c6ffa0');
  }

  // Reload table to reflect updated leads
  loadLeads();
});

// ── export CSV ────────────────────────────────────────────────────────────────

btnExportCsv.addEventListener('click', () => {
  if (allLeads.length === 0) { setStatus('Nothing to export.', '#ffd700'); return; }

  const headers = [
    '#', 'Name', 'Profile URL', 'Emails', 'Phones', 'WhatsApp',
    'Websites', 'Work', 'Education', 'Location', 'Hometown',
    'Post Snippet', 'Post URL', 'Source', 'Extracted At', 'Enriched At',
  ];
  const rows = allLeads.map((l, i) => [
    i + 1,
    csvCell(l.name),
    csvCell(l.profileUrl),
    csvCell((l.emails     || []).join(' | ')),
    csvCell((l.phones     || []).join(' | ')),
    csvCell((l.whatsapp   || []).join(' | ')),
    csvCell((l.websites   || []).join(' | ')),
    csvCell((l.work       || []).join(' | ')),
    csvCell((l.education  || []).join(' | ')),
    csvCell(l.location   || ''),
    csvCell(l.hometown   || ''),
    csvCell(l.postText   || ''),
    csvCell(l.postUrl    || ''),
    csvCell(l.source),
    csvCell(l.extractedAt),
    csvCell(l.enrichedAt || ''),
  ]);

  const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  downloadText(csv, `fb-leads-${dateTag()}.csv`, 'text/csv');
  setStatus(`Exported ${allLeads.length} leads as CSV.`, '#c6ffa0');
});

// ── export JSON ───────────────────────────────────────────────────────────────

btnExportJson.addEventListener('click', () => {
  if (allLeads.length === 0) { setStatus('Nothing to export.', '#ffd700'); return; }
  downloadText(JSON.stringify(allLeads, null, 2), `fb-leads-${dateTag()}.json`, 'application/json');
  setStatus(`Exported ${allLeads.length} leads as JSON.`, '#c6ffa0');
});

// ── clear ─────────────────────────────────────────────────────────────────────

btnClear.addEventListener('click', () => {
  if (!confirm('Clear all stored leads?')) return;
  chrome.runtime.sendMessage({ action: 'clearLeads' }, () => {
    allLeads = [];
    sessionNew = 0;
    updateBadges();
    renderTable();
    debugBox.style.display = 'none';
    setStatus('All leads cleared.');
  });
});

// ── utils ─────────────────────────────────────────────────────────────────────

function csvCell(val = '') {
  return `"${String(val).replace(/"/g, '""')}"`;
}

function dateTag() {
  return new Date().toISOString().slice(0, 10);
}

function downloadText(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ── init ──────────────────────────────────────────────────────────────────────

(async () => {
  loadLeads();

  // Resume progress display if enrichment was running before popup was closed
  chrome.runtime.sendMessage({ action: 'getEnrichProgress' }, (prog) => {
    if (prog && prog.status === 'scraping') {
      enriching = true;
      enrichBar.style.display    = 'flex';
      progressLabel.style.display = 'block';
      progressLabel.textContent  = `Visiting ${prog.name || ''}…`;
      const pct = prog.total > 0 ? Math.round((prog.current / prog.total) * 100) : 0;
      progressFill.style.width  = pct + '%';
      progressText.textContent  = `${prog.current} / ${prog.total}`;
    }
  });

  const tab = await getCurrentTab();
  if (tab && isFbGroup(tab)) {
    const path = new URL(tab.url).pathname;
    modeSelect.value = path.includes('/members') ? 'members' : 'auto';
    setStatus(path.includes('/members') ? 'Members page — ready.' : 'Group feed — ready.');
  }
})();
