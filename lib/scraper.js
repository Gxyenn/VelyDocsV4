const axios = require('axios');
const NodeCache = require('node-cache');

const cache = new NodeCache({ stdTTL: 300, checkperiod: 60 });

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:126.0) Gecko/20100101 Firefox/126.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36',
];

function getRandomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function randomDelay(min = 200, max = 800) {
  return new Promise(r => setTimeout(r, min + Math.random() * (max - min)));
}

async function fetchPage(url, referer = null) {
  const cacheKey = `page:${url}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  await randomDelay();

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
    timeout: 15000,
    maxRedirects: 5,
    validateStatus: s => s < 400,
  });

  cache.set(cacheKey, response.data);
  return response.data;
}

function clearCacheFor(pattern) {
  const keys = cache.keys();
  keys.forEach(k => { if (k.includes(pattern)) cache.del(k); });
}

function buildPagination(currentPage, totalPages) {
  const cur = parseInt(currentPage) || 1;
  const total = parseInt(totalPages) || cur;
  return {
    currentPage: cur,
    hasPrevPage: cur > 1,
    prevPage: cur > 1 ? cur - 1 : null,
    hasNextPage: cur < total,
    nextPage: cur < total ? cur + 1 : null,
    totalPages: total,
  };
}

/**
 * Extract pagination info from cheerio $ object.
 * Supports multiple WordPress themes:
 * - .hpage with .l (prev) and .r (next) links
 * - .pagination .page-numbers
 * - nav.navigation .page-numbers
 */
function extractPagination($, currentPage) {
  const page = parseInt(currentPage) || 1;
  let totalPages = page;
  let hasNext = false;
  let hasPrev = false;

  // Method 1: .hpage (samehadaku.li theme)
  const hpage = $('.hpage');
  if (hpage.length) {
    hasPrev = hpage.find('a.l').length > 0;
    hasNext = hpage.find('a.r').length > 0;

    // Try to extract page number from prev/next URLs
    const nextHref = hpage.find('a.r').attr('href') || '';
    const prevHref = hpage.find('a.l').attr('href') || '';

    // Extract the highest page number we can find from links
    const pageNums = [];
    [nextHref, prevHref].forEach(h => {
      const m = h.match(/page[=/](\d+)/);
      if (m) pageNums.push(parseInt(m[1]));
    });

    if (hasNext) {
      // We know there's at least one more page
      totalPages = Math.max(page + 1, ...pageNums);
    } else {
      totalPages = page;
    }
  }

  // Method 2: .pagination .page-numbers (classic WP)
  const pageNumbers = $('.pagination .page-numbers:not(.next):not(.prev), .nav-links .page-numbers:not(.next):not(.prev)');
  if (pageNumbers.length) {
    pageNumbers.each((i, el) => {
      const num = parseInt($(el).text().trim());
      if (!isNaN(num) && num > totalPages) totalPages = num;
    });
    hasNext = $('.pagination .next, .nav-links .next').length > 0;
    hasPrev = $('.pagination .prev, .nav-links .prev').length > 0;
  }

  // Method 3: numbered page links in navigation
  $('a[href*="page/"], a[href*="page="]').each((i, el) => {
    const href = $(el).attr('href') || '';
    const m = href.match(/page[=/](\d+)/);
    if (m) {
      const num = parseInt(m[1]);
      if (num > totalPages) totalPages = num;
    }
  });

  // If we still only know current page but there is a next link
  if (!hasNext && !hasPrev && page === 1) {
    // Check for any next indicators
    hasNext = $('a.next, a.r, .hpage a.r, .pagination .next').length > 0;
  }

  if (hasNext && totalPages <= page) totalPages = page + 1;

  return {
    currentPage: page,
    hasPrevPage: page > 1,
    prevPage: page > 1 ? page - 1 : null,
    hasNextPage: hasNext || page < totalPages,
    nextPage: (hasNext || page < totalPages) ? page + 1 : null,
    totalPages: totalPages,
  };
}

module.exports = { fetchPage, cache, getRandomUA, randomDelay, clearCacheFor, buildPagination, extractPagination };
