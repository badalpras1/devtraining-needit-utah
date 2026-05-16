(() => {
  if (window.__fbLeadsInjected) return;
  window.__fbLeadsInjected = true;

  // ── profile URL validation ─────────────────────────────────────────────────

  const SKIP_PATHS = [
    '/groups/', '/pages/', '/events/', '/photo/', '/photos/',
    '/video/', '/videos/', '/stories/', '/marketplace/', '/watch/',
    '/gaming/', '/notifications/', '/messages/', '/bookmarks/',
    '/friends/', '/help/', '/privacy/', '/settings/', '/ads/',
    '/hashtag/', '/search/', '/login', '/checkpoint', '/recover',
    '/composer/', '/share', '/sharer', '/dialog/', '/policies/',
    '/about/', '/directory/', '/places/', '/business/',
  ];

  const FB_HOSTS = new Set([
    'www.facebook.com', 'web.facebook.com', 'facebook.com', 'm.facebook.com',
  ]);

  function isProfileHref(href) {
    if (!href) return false;
    try {
      const url = new URL(href, location.origin);
      if (!FB_HOSTS.has(url.hostname)) return false;
      const path = url.pathname;
      const low = path.toLowerCase();
      if (path.length < 2 || path === '/') return false;
      if (SKIP_PATHS.some((p) => low.startsWith(p))) return false;
      const first = path.split('/')[1] || '';
      if (first.includes('.php') && first !== 'profile.php') return false;
      if (low === '/profile.php') return url.searchParams.has('id');
      if (low.startsWith('/people/')) return true;
      if (low.startsWith('/user/')) return true;
      if (/^\/[a-zA-Z][a-zA-Z0-9._-]{2,}$/.test(path)) return true;
      return false;
    } catch { return false; }
  }

  function cleanUrl(href) {
    try {
      const url = new URL(href, location.origin);
      if (url.pathname.toLowerCase() === '/profile.php') {
        return `${url.origin}/profile.php?id=${url.searchParams.get('id')}`;
      }
      return url.origin + url.pathname.replace(/\/$/, '');
    } catch { return href; }
  }

  function extractName(el) {
    const txt = el.textContent.trim();
    if (txt.length >= 2 && txt.length < 80) return txt;
    const lbl = el.getAttribute('aria-label') || '';
    if (lbl.length >= 2) return lbl.trim();
    return '';
  }

  // ── contact detail extraction from free text ───────────────────────────────

  const EMAIL_RE  = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
  // Broad phone: 7–15 digits with optional spaces/dashes/parens/plus
  const PHONE_RE  = /(?:\+?\d[\d\s\-().]{6,}\d)/g;
  const URL_RE    = /https?:\/\/(?!(?:www\.)?facebook\.com)[^\s"'<>]{4,}/g;
  // WhatsApp links
  const WA_RE     = /wa\.me\/\d+|whatsapp[^\s"'<>]*/gi;

  function parseContacts(text) {
    const emails  = [...new Set((text.match(EMAIL_RE)  || []))];
    const phones  = [...new Set((text.match(PHONE_RE)  || []).map((s) => s.trim()).filter((s) => s.replace(/\D/g, '').length >= 7))];
    const websites = [...new Set((text.match(URL_RE)  || []))];
    const whatsapp = [...new Set((text.match(WA_RE)   || []))];
    return { emails, phones, websites, whatsapp };
  }

  // ── strategy 1: articles (post feed) ──────────────────────────────────────

  function extractFromArticles() {
    const leads = [];
    const seen  = new Set();

    document.querySelectorAll('[role="article"]').forEach((article) => {
      const links = article.querySelectorAll('a[href]');
      for (const link of links) {
        if (!isProfileHref(link.href)) continue;

        const profileUrl = cleanUrl(link.href);
        if (seen.has(profileUrl)) break;
        seen.add(profileUrl);

        const name = extractName(link);
        if (!name) break;

        // Capture all visible text in the article for contact parsing
        const fullText = article.innerText || article.textContent || '';

        // First substantial text block that isn't the author name
        let postText = '';
        article.querySelectorAll('[dir="auto"]').forEach((el) => {
          if (postText) return;
          const t = el.textContent.trim();
          if (t.length > 40 && t !== name) postText = t.slice(0, 400);
        });

        const postLink =
          article.querySelector('a[href*="/posts/"]')  ||
          article.querySelector('a[href*="/permalink/"]') ||
          article.querySelector('a[href*="?story_fbid"]');
        const postUrl = postLink ? cleanUrl(postLink.href) : '';

        const contacts = parseContacts(fullText);

        leads.push({
          name, profileUrl, postText, postUrl, source: 'posts',
          ...contacts,
          extractedAt: new Date().toISOString(),
        });
        break;
      }
    });

    return leads;
  }

  // ── strategy 2: list items (members page) ─────────────────────────────────

  function extractFromListItems() {
    const leads = [];
    const seen  = new Set();

    const items = [
      ...document.querySelectorAll('[role="listitem"]'),
      ...document.querySelectorAll('[role="list"] > div'),
    ];

    items.forEach((item) => {
      const links = item.querySelectorAll('a[href]');
      for (const link of links) {
        if (!isProfileHref(link.href)) continue;

        const profileUrl = cleanUrl(link.href);
        if (seen.has(profileUrl)) return;
        seen.add(profileUrl);

        const name = extractName(link);
        if (!name) return;

        const spans = item.querySelectorAll('span[dir="auto"]');
        const postText = spans.length > 1 ? spans[1].textContent.trim() : '';

        const fullText = item.innerText || item.textContent || '';
        const contacts = parseContacts(fullText);

        leads.push({
          name, profileUrl, postText, postUrl: '', source: 'members',
          ...contacts,
          extractedAt: new Date().toISOString(),
        });
        break;
      }
    });

    return leads;
  }

  // ── strategy 3: full-page link scan (fallback) ────────────────────────────

  function scanAllProfileLinks() {
    const leads = [];
    const seen  = new Set();

    document.querySelectorAll('a[href]').forEach((link) => {
      if (!isProfileHref(link.href)) return;

      const profileUrl = cleanUrl(link.href);
      if (seen.has(profileUrl)) return;
      seen.add(profileUrl);

      const name = extractName(link);
      if (!name || name.length < 2) return;

      leads.push({
        name, profileUrl, postText: '', postUrl: '',
        emails: [], phones: [], websites: [], whatsapp: [],
        source: 'scan',
        extractedAt: new Date().toISOString(),
      });
    });

    return leads;
  }

  // ── debug snapshot ─────────────────────────────────────────────────────────

  function debugSnapshot() {
    const articles     = document.querySelectorAll('[role="article"]').length;
    const listItems    = document.querySelectorAll('[role="listitem"]').length;
    const allLinks     = document.querySelectorAll('a[href]').length;
    const profileLinks = [...document.querySelectorAll('a[href]')]
      .filter((a) => isProfileHref(a.href)).length;
    const sampleHrefs  = [...document.querySelectorAll('a[href]')]
      .slice(0, 15).map((a) => a.href);
    return { articles, listItems, allLinks, profileLinks, sampleHrefs, url: location.href };
  }

  // ── main ───────────────────────────────────────────────────────────────────

  function run(mode) {
    const isMembers = location.pathname.toLowerCase().includes('/members');
    let leads = [];

    if (mode === 'members' || (mode === 'auto' && isMembers)) {
      leads = extractFromListItems();
      if (leads.length === 0) leads = extractFromArticles();
    } else {
      leads = extractFromArticles();
    }

    if (leads.length === 0) leads = scanAllProfileLinks();

    return { leads, debug: debugSnapshot() };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === 'extract') sendResponse(run(msg.mode || 'auto'));
    if (msg.action === 'ping')    sendResponse({ ok: true });
    return true;
  });
})();
