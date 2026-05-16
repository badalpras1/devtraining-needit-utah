const $ = (id) => document.getElementById(id);

let sessionNew    = 0;
let scrollInterval = null;
let allLeads      = [];
let enriching     = false;
let pendingEntries = []; // marketplace entries parsed from file

const statusBar    = $('status-bar');
const countBadge   = $('count-badge');
const sessionBadge = $('session-badge');
const enrichBadge  = $('enrich-badge');
const mpBadge      = $('mp-badge');
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
const btnToggleMP  = $('btn-toggle-marketplace');
const mpPanel      = $('marketplace-panel');
const fileInput    = $('file-input');
const fileName     = $('file-name');
const fileInfo     = $('file-info');
const btnProcessFile = $('btn-process-file');

// ── helpers ───────────────────────────────────────────────────────────────────

function setStatus(msg, color = '#fff') {
  statusBar.textContent = msg;
  statusBar.style.color = color;
}

function updateBadges() {
  countBadge.textContent   = `${allLeads.length} leads stored`;
  sessionBadge.textContent = `${sessionNew} new this session`;

  const enrichedCount = allLeads.filter((l) => l.enriched).length;
  enrichBadge.textContent  = `${enrichedCount} enriched`;
  enrichBadge.style.display = enrichedCount > 0 ? '' : 'none';

  const mpCount = allLeads.filter((l) => l.source === 'marketplace').length;
  mpBadge.textContent  = `${mpCount} marketplace`;
  mpBadge.style.display = mpCount > 0 ? '' : 'none';

  const toEnrich = allLeads.filter((l) => !l.enriched).length;
  btnEnrich.textContent = toEnrich > 0
    ? `⚡ Enrich ${toEnrich} Profiles`
    : '⚡ Re-enrich All';
  btnEnrich.disabled = allLeads.length === 0 || enriching;
}

function renderTable() {
  leadsBody.innerHTML = '';
  if (allLeads.length === 0) { leadsBody.appendChild(emptyRow); return; }

  allLeads.forEach((lead, i) => {
    const srcClass =
      lead.source === 'members'     ? 'src-members' :
      lead.source === 'posts'       ? 'src-posts'   :
      lead.source === 'marketplace' ? 'src-mp'      : 'src-scan';

    const enrichMark = lead.enriched ? ' ✓' : '';
    const snippet = lead.source === 'marketplace'
      ? (lead.itemTitle || lead.listingDesc || lead.postText || '')
      : (lead.postText || '');

    const tr = document.createElement('tr');
    if (lead.enriched)             tr.classList.add('enriched-row');
    if (lead.source === 'marketplace') tr.classList.add('mp-row');

    tr.innerHTML = `
      <td>${i + 1}</td>
      <td title="${esc(lead.name)}">${esc(lead.name)}${enrichMark}</td>
      <td><a href="${esc(lead.profileUrl)}" target="_blank">${shortUrl(lead.profileUrl)}</a></td>
      <td class="contact-cell">${fmtList(lead.emails, 'mailto:')}</td>
      <td class="contact-cell">${fmtList(lead.phones)}</td>
      <td class="contact-cell">${fmtList(lead.whatsapp)}</td>
      <td class="contact-cell">${fmtList(lead.websites, '')}</td>
      <td class="contact-cell">${fmtLines(lead.work)}</td>
      <td class="contact-cell">${esc(lead.location || '')}</td>
      <td class="info-cell" title="${esc(snippet)}">${esc(snippet.slice(0, 70))}</td>
      <td class="contact-cell">${esc(lead.price || '')}</td>
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
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
}

function shortUrl(url = '') {
  try { const p = new URL(url).pathname.replace(/\//g,'').slice(0,20); return p || new URL(url).hostname; }
  catch { return url.slice(0, 20); }
}

function showDebug(dbg) {
  if (!dbg) { debugBox.style.display = 'none'; return; }
  debugBox.style.display = 'block';
  debugBox.innerHTML = `
    <strong>Debug</strong> — articles: <b>${dbg.articles}</b>,
    list items: <b>${dbg.listItems}</b>,
    profile links: <b>${dbg.profileLinks}</b> / ${dbg.allLinks} total.
    ${dbg.profileLinks === 0
      ? '<br><span class="warn">No profile links detected — scroll down to load content then extract again.</span>'
      : ''}
  `;
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
function isFbGroup(tab) { return /facebook\.com\/groups\//i.test(tab.url || ''); }

// ── extract from group ────────────────────────────────────────────────────────

btnExtract.addEventListener('click', async () => {
  const tab = await getCurrentTab();
  if (!isFbGroup(tab)) { setStatus('Navigate to a Facebook Group page first.', '#ffd700'); return; }

  btnExtract.disabled = true;
  debugBox.style.display = 'none';
  setStatus('Extracting…');

  try { await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] }); } catch (_) {}

  chrome.tabs.sendMessage(tab.id, { action: 'extract', mode: modeSelect.value }, (res) => {
    btnExtract.disabled = false;
    if (chrome.runtime.lastError || !res) {
      setStatus('Could not connect — refresh the Facebook page and try again.', '#ffd700'); return;
    }
    showDebug(res.debug);
    if (!res.leads || res.leads.length === 0) {
      setStatus('No leads found — scroll down to load more posts then extract again.', '#ffd700'); return;
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
    clearInterval(scrollInterval); scrollInterval = null;
    btnScroll.textContent = '⇓ Auto-scroll';
    btnScroll.classList.remove('scrolling');
    setStatus('Stopped. Click Extract Leads.'); return;
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
    clearInterval(scrollInterval); scrollInterval = null;
    btnScroll.textContent = '⇓ Auto-scroll';
    btnScroll.classList.remove('scrolling');
    setStatus('Done scrolling — click Extract Leads.');
  }, 120_000);
});

// ── enrich group leads ────────────────────────────────────────────────────────

btnEnrich.addEventListener('click', () => {
  if (enriching || allLeads.length === 0) return;
  const targets = allLeads.filter((l) => !l.enriched);
  const profileUrls = (targets.length > 0 ? targets : allLeads).map((l) => l.profileUrl);
  startProcessing();
  chrome.runtime.sendMessage({ action: 'startEnrichment', profileUrls });
});

// ── marketplace file upload ───────────────────────────────────────────────────

btnToggleMP.addEventListener('click', () => {
  const open = mpPanel.style.display !== 'none';
  mpPanel.style.display = open ? 'none' : 'block';
  btnToggleMP.textContent = open ? '🛒 Marketplace File' : '✕ Close Marketplace';
});

fileInput.addEventListener('change', () => {
  const file = fileInput.files[0];
  if (!file) return;

  fileName.textContent = file.name;
  fileInfo.style.display = 'none';
  btnProcessFile.disabled = true;
  pendingEntries = [];

  const reader = new FileReader();
  reader.onload = (e) => {
    const text = e.target.result;
    const ext  = file.name.split('.').pop().toLowerCase();

    let urls = [];
    if (ext === 'json')        urls = parseJson(text);
    else if (ext === 'csv')    urls = parseCsv(text);
    else                       urls = extractFbUrls(text);

    pendingEntries = classifyUrls([...new Set(urls)]);

    const listingCount = pendingEntries.filter((e) => e.type === 'listing').length;
    const profileCount = pendingEntries.filter((e) => e.type === 'profile').length;

    if (pendingEntries.length === 0) {
      fileInfo.style.display = 'block';
      fileInfo.className = 'file-info error';
      fileInfo.textContent = 'No Facebook URLs found in this file.';
      return;
    }

    fileInfo.style.display = 'block';
    fileInfo.className = 'file-info success';
    fileInfo.textContent =
      `Found ${pendingEntries.length} URLs — ${listingCount} listing(s), ${profileCount} profile(s).`;

    btnProcessFile.disabled = false;
    btnProcessFile.textContent = `⚡ Process ${pendingEntries.length} Entries`;
  };
  reader.readAsText(file);
});

btnProcessFile.addEventListener('click', () => {
  if (!pendingEntries.length || enriching) return;
  startProcessing();
  chrome.runtime.sendMessage({ action: 'startMarketplaceProcessing', entries: pendingEntries });
  mpPanel.style.display = 'none';
  btnToggleMP.textContent = '🛒 Marketplace File';
});

// ── file parsing ──────────────────────────────────────────────────────────────

const FB_URL_RE = /https?:\/\/(?:www\.|web\.|m\.)?facebook\.com\/[^\s"'<>,;\]\[]+/gi;

function extractFbUrls(text) {
  return (text.match(FB_URL_RE) || []).map((u) => u.replace(/[)\].,;'"]+$/, ''));
}

function classifyUrls(urls) {
  return urls.map((url) => ({
    url,
    type: url.includes('/marketplace/item/') ? 'listing' : 'profile',
  }));
}

function parseJson(text) {
  try {
    const data = JSON.parse(text);
    const arr = Array.isArray(data) ? data : [data];
    const urls = [];
    arr.forEach((item) => {
      if (typeof item === 'string') { urls.push(...extractFbUrls(item)); return; }
      if (typeof item === 'object' && item) {
        const urlKeys = ['url','link','href','listingUrl','profileUrl','listing_url','profile_url','listingLink'];
        let found = false;
        for (const k of urlKeys) {
          if (typeof item[k] === 'string') {
            urls.push(...extractFbUrls(item[k])); found = true; break;
          }
        }
        if (!found) urls.push(...extractFbUrls(JSON.stringify(item)));
      }
    });
    return urls;
  } catch {
    return extractFbUrls(text);
  }
}

function parseCsv(text) {
  const urls = [];
  text.split('\n').forEach((line) => {
    line.split(/,|;|\t/).forEach((cell) => {
      urls.push(...extractFbUrls(cell.replace(/^["']|["']$/g, '')));
    });
  });
  return urls;
}

// ── progress handling (shared between enrichment + marketplace) ───────────────

function startProcessing() {
  enriching = true;
  btnEnrich.disabled   = true;
  btnExtract.disabled  = true;
  btnProcessFile.disabled = true;
  enrichBar.style.display    = 'flex';
  progressLabel.style.display = 'block';
  progressFill.style.width   = '0%';
  progressText.textContent   = '0 / 0';
  progressLabel.textContent  = 'Starting…';
  setStatus('Processing — visiting profiles in the background…');
}

function finishProcessing(msg) {
  enriching = false;
  btnEnrich.disabled   = false;
  btnExtract.disabled  = false;
  btnProcessFile.disabled = pendingEntries.length === 0;
  setTimeout(() => {
    enrichBar.style.display    = 'none';
    progressLabel.style.display = 'none';
  }, 3000);
  setStatus(msg, '#c6ffa0');
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action !== 'enrichProgress') return;

  const pct = msg.total > 0 ? Math.round((msg.current / msg.total) * 100) : 0;
  progressFill.style.width = pct + '%';
  progressText.textContent = `${msg.current} / ${msg.total}`;

  const modeLabel = msg.mode === 'marketplace' ? 'Marketplace' : 'Enrichment';
  const statusMap = {
    scraping:  `${modeLabel}: visiting listing for ${msg.name || ''}…`,
    enriching: `${modeLabel}: scraping About page for ${msg.name || ''}…`,
    done:      `✓ ${msg.name || 'Done'}`,
    error:     `Error on ${msg.name || ''} — skipped`,
    blocked:   'Facebook login required — stopped.',
    stopped:   'Stopped by user.',
    complete:  `${modeLabel} complete — ${msg.total} processed.`,
  };
  progressLabel.textContent = statusMap[msg.status] || msg.status;

  if (['complete', 'stopped', 'blocked'].includes(msg.status)) {
    finishProcessing(statusMap[msg.status]);
  }

  loadLeads();
});

// ── stop ──────────────────────────────────────────────────────────────────────

btnStopEnrich.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'stopEnrichment' });
  setStatus('Stopping after current profile…', '#ffd700');
});

// ── export CSV ────────────────────────────────────────────────────────────────

btnExportCsv.addEventListener('click', () => {
  if (allLeads.length === 0) { setStatus('Nothing to export.', '#ffd700'); return; }

  const headers = [
    '#','Name','Profile URL','Emails','Phones','WhatsApp','Websites',
    'Work','Education','Location','Hometown',
    'Item Title','Price','Listing URL',
    'Post / Listing Snippet','Source','Extracted At','Enriched At',
  ];
  const rows = allLeads.map((l, i) => [
    i + 1,
    csvCell(l.name),
    csvCell(l.profileUrl),
    csvCell((l.emails    || []).join(' | ')),
    csvCell((l.phones    || []).join(' | ')),
    csvCell((l.whatsapp  || []).join(' | ')),
    csvCell((l.websites  || []).join(' | ')),
    csvCell((l.work      || []).join(' | ')),
    csvCell((l.education || []).join(' | ')),
    csvCell(l.location  || ''),
    csvCell(l.hometown  || ''),
    csvCell(l.itemTitle || ''),
    csvCell(l.price     || ''),
    csvCell(l.listingUrl || ''),
    csvCell(l.listingDesc || l.postText || ''),
    csvCell(l.source),
    csvCell(l.extractedAt || ''),
    csvCell(l.enrichedAt  || ''),
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
    allLeads = []; sessionNew = 0;
    updateBadges(); renderTable();
    debugBox.style.display = 'none';
    setStatus('All leads cleared.');
  });
});

// ── utils ─────────────────────────────────────────────────────────────────────

function csvCell(val = '') { return `"${String(val).replace(/"/g,'""')}"`; }
function dateTag() { return new Date().toISOString().slice(0, 10); }
function downloadText(content, filename, mime) {
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([content], { type: mime })),
    download: filename,
  });
  a.click();
  URL.revokeObjectURL(a.href);
}

// ── init ──────────────────────────────────────────────────────────────────────

(async () => {
  loadLeads();

  chrome.runtime.sendMessage({ action: 'getEnrichProgress' }, (prog) => {
    if (prog && prog.status === 'scraping') {
      enriching = true;
      enrichBar.style.display    = 'flex';
      progressLabel.style.display = 'block';
      progressLabel.textContent  = `Visiting ${prog.name || ''}…`;
      const pct = prog.total > 0 ? Math.round((prog.current / prog.total) * 100) : 0;
      progressFill.style.width = pct + '%';
      progressText.textContent = `${prog.current} / ${prog.total}`;
    }
  });

  const tab = await getCurrentTab();
  if (tab && isFbGroup(tab)) {
    const path = new URL(tab.url).pathname;
    modeSelect.value = path.includes('/members') ? 'members' : 'auto';
    setStatus(path.includes('/members') ? 'Members page — ready.' : 'Group feed — ready.');
  }
})();
