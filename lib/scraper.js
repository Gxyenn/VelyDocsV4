const axios = require('axios');
const NodeCache = require('node-cache');

// Cache dengan TTL lebih lama untuk performa
const cache = new NodeCache({ stdTTL: 600, checkperiod: 120 });

// User Agents yang lebih banyak dan terbaru
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64; rv:126.0) Gecko/20100101 Firefox/126.0',
];

function getRandomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function randomDelay(min = 300, max = 800) {
  return new Promise(r => setTimeout(r, min + Math.random() * (max - min)));
}

/**
 * Fetch page dengan optimasi performa + anti-block
 */
async function fetchPage(url, referer = null, retries = 3) {
  const cacheKey = `page:${url}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log(`[CACHE HIT] ${url}`);
    return cached;
  }

  let lastError;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      // Delay lebih pendek tapi tetap acak
      await randomDelay(300 + attempt * 200, 800 + attempt * 400);

      const headers = {
        'User-Agent': getRandomUA(),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Cache-Control': 'max-age=0',
      };

      if (referer) headers['Referer'] = referer;

      const response = await axios.get(url, {
        headers,
        timeout: 10000,  // Timeout lebih pendek (10 detik)
        maxRedirects: 3,  // Kurangi redirect
        validateStatus: s => s < 400,
        decompress: true,
        // Optimasi: jangan parse response yang terlalu besar
        maxContentLength: 5 * 1024 * 1024,  // Max 5MB
      });

      cache.set(cacheKey, response.data);
      console.log(`[FETCH OK] ${url}`);
      return response.data;
    } catch (error) {
      lastError = error;
      console.log(`[FETCH ERROR] Attempt ${attempt + 1}/${retries} for ${url}: ${error.message}`);

      if (error.response?.status === 403 || error.response?.status === 429) {
        await randomDelay(2000, 4000);
      }
    }
  }

  throw lastError;
}

function clearCacheFor(pattern) {
  const keys = cache.keys();
  keys.forEach(k => { if (k.includes(pattern)) cache.del(k); });
}

/**
 * Build pagination object
 */
function buildPagination(currentPage, totalPages, totalItems = null) {
  const cur = parseInt(currentPage) || 1;
  const total = parseInt(totalPages) || cur;

  return {
    currentPage: cur,
    hasPrevPage: cur > 1,
    prevPage: cur > 1 ? cur - 1 : null,
    hasNextPage: cur < total,
    nextPage: cur < total ? cur + 1 : null,
    totalPages: total,
    totalItems: totalItems,
  };
}

/**
 * Extract pagination info dari cheerio $ object - VERSI PERBAIKAN
 */
function extractPagination($, currentPage, baseUrl = null) {
  const page = parseInt(currentPage) || 1;
  let totalPages = page;
  let hasNext = false;
  let hasPrev = false;
  let totalItems = null;

  // Method 1: .hpage (samehadaku.li theme)
  const hpage = $('.hpage');
  if (hpage.length) {
    hasPrev = hpage.find('a.l').length > 0;
    hasNext = hpage.find('a.r').length > 0;

    const nextHref = hpage.find('a.r').attr('href') || '';
    const prevHref = hpage.find('a.l').attr('href') || '';

    const pageNums = [];
    [nextHref, prevHref].forEach(h => {
      const m = h.match(/page[=/](\d+)/);
      if (m) pageNums.push(parseInt(m[1]));
    });

    if (hasNext) {
      totalPages = Math.max(page + 1, ...pageNums);
    }
  }

  // Method 2: .pagination .page-numbers (classic WP)
  const pageNumbers = $('.pagination .page-numbers:not(.next):not(.prev), .nav-links .page-numbers:not(.next):not(.prev), .page-numbers:not(.next):not(.prev)');
  if (pageNumbers.length) {
    pageNumbers.each((i, el) => {
      const num = parseInt($(el).text().trim());
      if (!isNaN(num) && num > totalPages) totalPages = num;
    });
    hasNext = $('.pagination .next, .nav-links .next, .page-numbers.next').length > 0;
    hasPrev = $('.pagination .prev, .nav-links .prev, .page-numbers.prev').length > 0;
  }

  // Method 3: Look for "Last" or page links
  $('a[href*="page/"], a[href*="page="], a[href*="?page="]').each((i, el) => {
    const href = $(el).attr('href') || '';
    const m = href.match(/page[=/](\d+)/);
    if (m) {
      const num = parseInt(m[1]);
      if (num > totalPages) totalPages = num;
    }
  });

  // Method 4: Look for "Last" / "Terakhir" links
  $('a').each((i, el) => {
    const text = $(el).text().trim().toLowerCase();
    const href = $(el).attr('href') || '';
    if (text.includes('last') || text.includes('terakhir')) {
      const m = href.match(/page[=/](\d+)/);
      if (m) {
        const num = parseInt(m[1]);
        if (num > totalPages) totalPages = num;
      }
    }
  });

  if (!hasNext && !hasPrev && page === 1) {
    hasNext = $('a.next, a.r, .hpage a.r, .pagination .next, .page-numbers.next').length > 0;
  }

  if (hasNext && totalPages <= page) totalPages = page + 1;

  return {
    currentPage: page,
    hasPrevPage: page > 1 || hasPrev,
    prevPage: (page > 1 || hasPrev) ? page - 1 : null,
    hasNextPage: hasNext || page < totalPages,
    nextPage: (hasNext || page < totalPages) ? page + 1 : null,
    totalPages: totalPages,
    totalItems: totalItems,
  };
}

/**
 * Extract iframe URL dan resolutions dari episode page
 */
function extractVideoData($) {
  const servers = [];
  const resolutions = [];
  let iframeUrl = null;

  // Method 1: Select mirror/server dropdown
  $('select.mirror option, select[name="server"] option, .server-select option').each((i, el) => {
    const val = $(el).attr('value');
    const name = $(el).text().trim();
    if (val && name && name !== '- Select Server -' && name !== 'Select Server') {
      servers.push({ name, value: val });
      const resMatch = name.match(/(\d{3,4})[pP]/);
      if (resMatch && !resolutions.find(r => r.quality === resMatch[1] + 'p')) {
        resolutions.push({ quality: resMatch[1] + 'p', server: name, url: val });
      }
    }
  });

  // Method 2: Direct iframe
  $('iframe[src*="embed"], iframe[src*="player"], iframe[src*="stream"]').each((i, el) => {
    const src = $(el).attr('src');
    if (src && !iframeUrl) iframeUrl = src;
  });

  // Method 3: Video player containers
  $('.player-embed iframe, .video-player iframe, #player iframe').each((i, el) => {
    const src = $(el).attr('src');
    if (src && !iframeUrl) iframeUrl = src;
  });

  // Method 4: Resolution buttons/links
  $('.resolution a, .quality a, [class*="resol"] a, [class*="qualit"] a').each((i, el) => {
    const quality = $(el).text().trim();
    const url = $(el).attr('href') || $(el).attr('data-src');
    if (quality && url && /\d{3,4}[pP]/.test(quality)) {
      resolutions.push({ quality, url });
    }
  });

  // Method 5: Data attributes
  $('[data-resolution], [data-quality]').each((i, el) => {
    const quality = $(el).attr('data-resolution') || $(el).attr('data-quality');
    const url = $(el).attr('data-src') || $(el).attr('href');
    if (quality && url) {
      resolutions.push({ quality, url });
    }
  });

  return { servers, iframeUrl, resolutions };
}

module.exports = { 
  fetchPage, 
  cache, 
  getRandomUA, 
  randomDelay, 
  clearCacheFor, 
  buildPagination, 
  extractPagination,
  extractVideoData 
};
