// ── storage helpers ────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ leads: [], enrichProgress: null });
});

function getStorage(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

function setStorage(data) {
  return new Promise((resolve) => chrome.storage.local.set(data, resolve));
}

// ── basic lead CRUD ────────────────────────────────────────────────────────

async function handleSaveLeads(leads) {
  const { leads: existing } = await getStorage({ leads: [] });
  const existingUrls = new Set(existing.map((l) => l.profileUrl));
  const fresh = leads.filter((l) => !existingUrls.has(l.profileUrl));
  const merged = [...existing, ...fresh];
  await setStorage({ leads: merged });
  return { saved: fresh.length, total: merged.length };
}

async function handleUpdateLead(profileUrl, patch) {
  const { leads } = await getStorage({ leads: [] });
  const updated = leads.map((l) =>
    l.profileUrl === profileUrl ? { ...l, ...patch } : l
  );
  await setStorage({ leads: updated });
}

// ── tab orchestration ──────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function waitForLoad(tabId, timeout = 15000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, timeout);

    function listener(id, info) {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }

    chrome.tabs.onUpdated.addListener(listener);

    // Already complete?
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) return;
      if (tab && tab.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    });
  });
}

function buildAboutUrl(profileUrl, section) {
  try {
    const url = new URL(profileUrl);
    if (url.pathname.toLowerCase() === '/profile.php') {
      url.searchParams.set('sk', section);
      return url.toString();
    }
    return `${url.origin}${url.pathname.replace(/\/$/, '')}/${section}`;
  } catch {
    return `${profileUrl}/${section}`;
  }
}

async function scrapeAboutPage(url, page) {
  let tabId = null;
  try {
    const tab = await chrome.tabs.create({ url, active: false, pinned: false });
    tabId = tab.id;

    await waitForLoad(tabId);
    await sleep(2500); // allow React to render

    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['profile_scraper.js'],
    });

    await sleep(400);

    const result = await chrome.tabs.sendMessage(tabId, {
      action: 'scrapeProfile',
      page,
    });
    return result || {};
  } catch (e) {
    return { error: e.message };
  } finally {
    if (tabId) chrome.tabs.remove(tabId).catch(() => {});
  }
}

// ── enrichment orchestration ───────────────────────────────────────────────

let enrichActive = false;
let enrichStop   = false;

function broadcastProgress(data) {
  chrome.storage.local.set({ enrichProgress: data });
  // Fire-and-forget to popup (may not be open)
  chrome.runtime.sendMessage({ action: 'enrichProgress', ...data }).catch(() => {});
}

async function enrichOne(lead) {
  const profileUrl = lead.profileUrl;

  // --- contact page ---
  const contact = await scrapeAboutPage(
    buildAboutUrl(profileUrl, 'about_contact_and_basic_info'),
    'contact'
  );
  if (contact.error === 'login_required') return { blocked: true };

  if (enrichStop) return null;
  await sleep(1200 + Math.random() * 800);

  // --- work / education page ---
  const work = await scrapeAboutPage(
    buildAboutUrl(profileUrl, 'about_work_and_education'),
    'work'
  );

  if (enrichStop) return null;
  await sleep(1000 + Math.random() * 800);

  // --- places page ---
  const places = await scrapeAboutPage(
    buildAboutUrl(profileUrl, 'about_places'),
    'places'
  );

  // Merge with what we already had from group extraction
  return {
    emails:    [...new Set([...(lead.emails   || []), ...(contact.emails   || [])])],
    phones:    [...new Set([...(lead.phones   || []), ...(contact.phones   || [])])],
    websites:  [...new Set([...(lead.websites || []), ...(contact.websites || [])])],
    whatsapp:  [...new Set([...(lead.whatsapp || []), ...(contact.whatsapp || [])])],
    work:      work.work        || [],
    education: work.education   || [],
    location:  places.location  || '',
    hometown:  places.hometown  || '',
    enriched:  true,
    enrichedAt: new Date().toISOString(),
  };
}

async function runEnrichment(profileUrls) {
  if (enrichActive) return;
  enrichActive = true;
  enrichStop   = false;

  const { leads } = await getStorage({ leads: [] });
  const targets = leads.filter((l) => profileUrls.includes(l.profileUrl));

  for (let i = 0; i < targets.length; i++) {
    if (enrichStop) break;

    const lead = targets[i];
    broadcastProgress({ current: i, total: targets.length, name: lead.name, status: 'scraping' });

    try {
      const patch = await enrichOne(lead);
      if (patch && !patch.blocked) {
        await handleUpdateLead(lead.profileUrl, patch);
        broadcastProgress({ current: i + 1, total: targets.length, name: lead.name, status: 'done' });
      } else if (patch && patch.blocked) {
        broadcastProgress({ current: i + 1, total: targets.length, name: lead.name, status: 'blocked' });
        // Login wall hit — abort remaining
        break;
      } else {
        broadcastProgress({ current: i + 1, total: targets.length, name: lead.name, status: 'stopped' });
        break;
      }
    } catch (e) {
      broadcastProgress({ current: i + 1, total: targets.length, name: lead.name, status: 'error' });
    }

    // Rate-limit delay between profiles (2–4 s)
    if (i < targets.length - 1 && !enrichStop) {
      await sleep(2000 + Math.random() * 2000);
    }
  }

  enrichActive = false;
  broadcastProgress({
    current: targets.length,
    total: targets.length,
    name: '',
    status: enrichStop ? 'stopped' : 'complete',
  });
}

// ── message router ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'saveLeads') {
    handleSaveLeads(msg.leads || []).then(sendResponse);
    return true;
  }

  if (msg.action === 'clearLeads') {
    setStorage({ leads: [], enrichProgress: null }).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (msg.action === 'getLeads') {
    getStorage({ leads: [] }).then(sendResponse);
    return true;
  }

  if (msg.action === 'startEnrichment') {
    runEnrichment(msg.profileUrls || []).catch(console.error);
    sendResponse({ started: true });
    return true;
  }

  if (msg.action === 'stopEnrichment') {
    enrichStop = true;
    sendResponse({ ok: true });
    return true;
  }

  if (msg.action === 'getEnrichProgress') {
    getStorage({ enrichProgress: null }).then((d) => sendResponse(d.enrichProgress));
    return true;
  }
});
