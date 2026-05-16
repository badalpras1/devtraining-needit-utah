(() => {
  // Avoid re-injecting
  if (window.__fbLeadsInjected) return;
  window.__fbLeadsInjected = true;

  const SELECTORS = {
    // Members page: each member card
    memberCard: '[data-visualcompletion="ignore-dynamic"] a[href*="/user/"], a[href*="facebook.com/"][role="link"]',
    // Group feed: post containers
    postContainer: '[data-pagelet^="FeedUnit"], [role="article"]',
    // Author link inside a post
    postAuthorLink: 'h2 a[href*="facebook.com/"], strong a[href*="facebook.com/"]',
    // Post text content
    postText: '[data-ad-comet-preview="message"], [data-ad-preview="message"], [dir="auto"] > div > div',
    // Post timestamp link
    postTimestamp: 'a[href*="?__cft__"], a[aria-label][href*="/posts/"], a[href*="/permalink/"]',
  };

  function cleanProfileUrl(raw) {
    try {
      const url = new URL(raw, 'https://www.facebook.com');
      // Strip tracking params, keep only path
      const clean = url.origin + url.pathname;
      return clean.replace(/\/$/, '');
    } catch {
      return raw;
    }
  }

  function extractMembers() {
    const leads = [];
    const seen = new Set();

    // Try member list view (facebook.com/groups/xxx/members)
    const memberRows = document.querySelectorAll('[role="listitem"]');
    memberRows.forEach((row) => {
      const link = row.querySelector('a[href*="facebook.com/"]');
      if (!link) return;

      const profileUrl = cleanProfileUrl(link.href);
      if (seen.has(profileUrl)) return;
      seen.add(profileUrl);

      const nameEl = row.querySelector('span[dir="auto"]') || link;
      const name = nameEl ? nameEl.textContent.trim() : '';
      if (!name || name.length < 2) return;

      const imgEl = row.querySelector('img[src]');
      const avatar = imgEl ? imgEl.src : '';

      const subtitleEls = row.querySelectorAll('span[dir="auto"]');
      const subtitle = subtitleEls.length > 1 ? subtitleEls[1].textContent.trim() : '';

      leads.push({
        name,
        profileUrl,
        avatar,
        subtitle,
        source: 'members',
        extractedAt: new Date().toISOString(),
      });
    });

    return leads;
  }

  function extractPostAuthors() {
    const leads = [];
    const seen = new Set();

    const articles = document.querySelectorAll('[role="article"]');
    articles.forEach((article) => {
      // Author link — usually a strong > a or h2 > a near the top
      const authorLink =
        article.querySelector('h2 a[href*="facebook.com/"]') ||
        article.querySelector('strong > a[href*="facebook.com/"]') ||
        article.querySelector('a[aria-label][href*="facebook.com/"]');

      if (!authorLink) return;

      const profileUrl = cleanProfileUrl(authorLink.href);
      if (seen.has(profileUrl)) return;
      seen.add(profileUrl);

      const name = authorLink.textContent.trim();
      if (!name || name.length < 2) return;

      // Post text — grab the first substantial text block
      const textCandidates = article.querySelectorAll('[dir="auto"]');
      let postText = '';
      textCandidates.forEach((el) => {
        if (postText) return;
        const t = el.textContent.trim();
        if (t.length > 30 && !el.querySelector('a')) postText = t.slice(0, 300);
      });

      // Timestamp
      const tsLink =
        article.querySelector('a[href*="/posts/"]') ||
        article.querySelector('a[href*="/permalink/"]') ||
        article.querySelector('abbr[data-utime]');
      const postUrl = tsLink ? cleanProfileUrl(tsLink.href) : '';

      leads.push({
        name,
        profileUrl,
        avatar: '',
        subtitle: postText,
        postUrl,
        source: 'posts',
        extractedAt: new Date().toISOString(),
      });
    });

    return leads;
  }

  function run(mode) {
    const isMembers = window.location.pathname.includes('/members');
    let leads = [];

    if (mode === 'members' || isMembers) {
      leads = extractMembers();
      if (leads.length === 0) leads = extractPostAuthors(); // fallback
    } else {
      leads = extractPostAuthors();
    }

    return { leads, url: window.location.href, title: document.title };
  }

  // Listen for messages from popup
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === 'extract') {
      const result = run(msg.mode || 'auto');
      sendResponse(result);
    }
    if (msg.action === 'ping') {
      sendResponse({ ok: true });
    }
    return true; // keep channel open for async
  });
})();
