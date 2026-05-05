const axios = require('axios');
const http = require('http');
const https = require('https');
const NodeCache = require('node-cache');

// Cache dengan TTL lebih lama untuk performa
const cache = new NodeCache({ stdTTL: 600, checkperiod: 120 });

// ==================== HTTP AGENT POOLING ====================
// Reuse TCP connections to avoid socket exhaustion under high load
const httpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 50,
  maxFreeSockets: 10,
  timeout: 30000,
});
const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 50,
  maxFreeSockets: 10,
  timeout: 30000,
  rejectUnauthorized: false,  // Some anime sites have bad certs
});

// ==================== ANTI-BLOCK SYSTEM v2 ====================

// ==================== 1. PROXY ROTATION SYSTEM ====================
let PROXY_LIST = []; // Configurable via setProxies()
let proxyIndex = 0;

function setProxies(proxies) {
  if (!Array.isArray(proxies)) throw new Error('Proxies must be an array of proxy URL strings');
  PROXY_LIST = proxies.map(p => p.trim()).filter(Boolean);
  proxyIndex = 0;
  console.log(`[ANTI-BLOCK] Loaded ${PROXY_LIST.length} proxy(ies)`);
}

function getNextProxy() {
  if (!PROXY_LIST.length) return null;
  const proxy = PROXY_LIST[proxyIndex % PROXY_LIST.length];
  proxyIndex++;
  return proxy;
}

function getRandomProxy() {
  if (!PROXY_LIST.length) return null;
  return PROXY_LIST[Math.floor(Math.random() * PROXY_LIST.length)];
}

function parseProxyUrl(proxyUrl) {
  try {
    const url = new URL(proxyUrl);
    return {
      protocol: url.protocol.replace(':', ''),
      host: url.hostname,
      port: parseInt(url.port) || (url.protocol === 'https:' ? 443 : 80),
      username: decodeURIComponent(url.username || ''),
      password: decodeURIComponent(url.password || ''),
      full: proxyUrl,
    };
  } catch (e) {
    console.error(`[ANTI-BLOCK] Failed to parse proxy URL: ${proxyUrl}`, e.message);
    return null;
  }
}

// ==================== 2. USER AGENTS (2025-2026 era) ====================

const USER_AGENTS = [
  // Chrome 130-136 (Windows, Mac, Linux)
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
  // Firefox 130-134
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:134.0) Gecko/20100101 Firefox/134.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:134.0) Gecko/20100101 Firefox/134.0',
  'Mozilla/5.0 (X11; Linux x86_64; rv:134.0) Gecko/20100101 Firefox/134.0',
  // Edge 130+
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36 Edg/136.0.0.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36 Edg/134.0.0.0',
  // Safari 18+
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Safari/605.1.15',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_2) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15',
  // Mobile
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Mobile Safari/537.36',
];

// Accept-Language variations untuk naturalness
const ACCEPT_LANGUAGES = [
  'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
  'id-ID,id;q=0.9,en;q=0.8',
  'id,en-US;q=0.9,en;q=0.8',
  'en-US,en;q=0.9,id;q=0.8',
  'id-ID,id;q=0.8,en-US;q=0.6,en;q=0.4',
];

// ==================== 3. TLS FINGERPRINT ====================
const TLS_CIPHERS = [
  'TLS_AES_128_GCM_SHA256',
  'TLS_AES_256_GCM_SHA384',
  'TLS_CHACHA20_POLY1305_SHA256',
];

// ==================== 4. SESSION MANAGEMENT ====================
let sessionUA = null;
let sessionRequestCount = 0;
const SESSION_UA_ROTATION_INTERVAL = 50; // Rotate UA every 50 requests
const COOKIE_STALE_THRESHOLD = 30 * 60 * 1000; // 30 minutes

// Per-session stats
const sessionStats = {
  totalRequests: 0,
  totalSuccess: 0,
  totalFailures: 0,
  totalBlocks: 0,
  totalRetries: 0,
  proxyRotations: 0,
  uaRotations: 0,
  startTime: Date.now(),
  domainStats: new Map(), // domain -> { requests, success, failures, blocks, avgResponseTime, lastRequest }
};

function getSessionUA() {
  if (!sessionUA) {
    sessionUA = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
    console.log(`[ANTI-BLOCK] New session UA selected`);
  }
  return sessionUA;
}

function rotateSessionUA() {
  const oldUA = sessionUA;
  do {
    sessionUA = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  } while (sessionUA === oldUA && USER_AGENTS.length > 1);
  sessionUA = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  sessionStats.uaRotations++;
  console.log(`[ANTI-BLOCK] Session UA rotated (rotation #${sessionStats.uaRotations})`);
}

function trackSessionRequest(domain, success, responseTimeMs, blocked) {
  sessionStats.totalRequests++;
  sessionRequestCount++;

  if (success) {
    sessionStats.totalSuccess++;
  } else {
    sessionStats.totalFailures++;
  }

  if (blocked) {
    sessionStats.totalBlocks++;
  }

  // Auto-rotate session UA every N requests
  if (sessionRequestCount >= SESSION_UA_ROTATION_INTERVAL) {
    sessionRequestCount = 0;
    rotateSessionUA();
  }

  // Track per-domain stats
  if (!domain) return;
  const domainData = sessionStats.domainStats.get(domain) || {
    requests: 0, success: 0, failures: 0, blocks: 0,
    avgResponseTime: 0, totalResponseTime: 0, lastRequest: 0,
  };

  domainData.requests++;
  domainData.lastRequest = Date.now();
  if (success) domainData.success++;
  else domainData.failures++;
  if (blocked) domainData.blocks++;
  domainData.totalResponseTime += responseTimeMs;
  domainData.avgResponseTime = Math.round(domainData.totalResponseTime / domainData.requests);

  sessionStats.domainStats.set(domain, domainData);
}

function getSessionStats() {
  const domains = {};
  sessionStats.domainStats.forEach((data, domain) => {
    domains[domain] = { ...data };
  });

  return {
    ...sessionStats,
    domains,
    uptimeSeconds: Math.round((Date.now() - sessionStats.startTime) / 1000),
    activeProxies: PROXY_LIST.length,
    currentUA: getSessionUA(),
    requestsSinceUARotation: sessionRequestCount,
  };
}

// ==================== 5. HELPER FUNCTIONS ====================

function getRandomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function getRandomAcceptLang() {
  return ACCEPT_LANGUAGES[Math.floor(Math.random() * ACCEPT_LANGUAGES.length)];
}

/**
 * Random delay with jitter (±30% by default)
 */
function randomDelay(min = 300, max = 800) {
  const jitter = 0.3;
  const mid = (min + max) / 2;
  const range = (max - min) / 2;
  const jMin = mid - range * (1 + jitter);
  const jMax = mid + range * (1 + jitter);
  const finalMin = Math.max(0, jMin);
  const finalMax = Math.max(finalMin + 50, jMax);
  return new Promise(r => setTimeout(r, finalMin + Math.random() * (finalMax - finalMin)));
}

function getDomain(url) {
  try { return new URL(url).hostname; } catch { return ''; }
}

// ==================== 6. COOKIE JAR (per-domain) ====================
const cookieJar = new Map(); // domain -> { cookies: {}, timestamp: Date }

function storeCookies(url, response) {
  const domain = getDomain(url);
  if (!domain) return;
  const setCookies = response.headers['set-cookie'];
  if (!setCookies) return;

  const entry = cookieJar.get(domain) || { cookies: {}, timestamp: Date.now() };
  const cookieArray = Array.isArray(setCookies) ? setCookies : [setCookies];

  cookieArray.forEach(raw => {
    const parts = raw.split(';')[0].trim().split('=');
    if (parts.length >= 2) {
      const name = parts[0].trim();
      const value = parts.slice(1).join('=').trim();
      entry.cookies[name] = value;
    }
  });

  entry.timestamp = Date.now();
  cookieJar.set(domain, entry);
}

function getCookieString(url) {
  const domain = getDomain(url);
  const entry = cookieJar.get(domain);
  if (!entry || !Object.keys(entry.cookies).length) return '';
  return Object.entries(entry.cookies).map(([k, v]) => `${k}=${v}`).join('; ');
}

function clearStaleCookies() {
  const now = Date.now();
  let cleared = 0;
  cookieJar.forEach((entry, domain) => {
    if (now - entry.timestamp > COOKIE_STALE_THRESHOLD) {
      cookieJar.delete(domain);
      cleared++;
    }
  });
  if (cleared > 0) {
    console.log(`[ANTI-BLOCK] Cleared stale cookies for ${cleared} domain(s)`);
  }
}

// ==================== 7. PER-DOMAIN THROTTLING (adaptive) ====================
const domainThrottleState = new Map(); // domain -> { lastRequest, minInterval, consecutiveBlocks, blockedUntil, avgResponseTime }

const DEFAULT_MIN_INTERVAL = 500; // ms between requests to same domain
const MIN_INTERVAL_FLOOR = 300; // Never go below this
const MIN_INTERVAL_CEILING = 5000; // Never go above this
const BLOCK_COOLDOWN = 60000; // 60 seconds cooldown after 3+ consecutive blocks
const CONSECUTIVE_BLOCK_THRESHOLD = 3;

function getDomainThrottleState(domain) {
  if (!domainThrottleState.has(domain)) {
    domainThrottleState.set(domain, {
      lastRequest: 0,
      minInterval: DEFAULT_MIN_INTERVAL,
      consecutiveBlocks: 0,
      blockedUntil: 0,
      avgResponseTime: 0,
      totalResponseTime: 0,
      responseCount: 0,
    });
  }
  return domainThrottleState.get(domain);
}

async function throttleDomain(url) {
  const domain = getDomain(url);
  if (!domain) return;

  const state = getDomainThrottleState(domain);
  const now = Date.now();

  // Check if domain is in cooldown
  if (state.blockedUntil > now) {
    const waitTime = state.blockedUntil - now;
    console.log(`[ANTI-BLOCK] Domain ${domain} is in cooldown. Waiting ${waitTime}ms`);
    await randomDelay(waitTime, waitTime + 2000);
  }

  const elapsed = now - (state.lastRequest || 0);
  const interval = state.minInterval;

  if (elapsed < interval) {
    await randomDelay(interval - elapsed, interval - elapsed + 300);
  }

  state.lastRequest = Date.now();
}

function adaptThrottleForDomain(domain, responseTimeMs, success) {
  if (!domain) return;
  const state = getDomainThrottleState(domain);

  // Track response time
  state.responseCount++;
  state.totalResponseTime += responseTimeMs;
  state.avgResponseTime = Math.round(state.totalResponseTime / state.responseCount);

  if (success) {
    // Successful request - gradually reduce interval (but not below floor)
    state.consecutiveBlocks = 0;
    if (state.avgResponseTime < 2000 && state.minInterval > MIN_INTERVAL_FLOOR) {
      state.minInterval = Math.max(MIN_INTERVAL_FLOOR, state.minInterval - 50);
      console.log(`[ANTI-BLOCK] ${domain}: Decreased interval to ${state.minInterval}ms (avg response: ${state.avgResponseTime}ms)`);
    }
  } else {
    // Failed request - increase interval
    state.consecutiveBlocks++;
    if (state.consecutiveBlocks >= CONSECUTIVE_BLOCK_THRESHOLD) {
      state.blockedUntil = Date.now() + BLOCK_COOLDOWN;
      state.minInterval = Math.min(MIN_INTERVAL_CEILING, state.minInterval * 2);
      console.log(`[ANTI-BLOCK] ${domain}: ${state.consecutiveBlocks} consecutive blocks. Backing off for ${BLOCK_COOLDOWN / 1000}s. Interval: ${state.minInterval}ms`);
    } else {
      state.minInterval = Math.min(MIN_INTERVAL_CEILING, state.minInterval + 200);
      console.log(`[ANTI-BLOCK] ${domain}: Increased interval to ${state.minInterval}ms after failure`);
    }
  }
}

// ==================== 8. DNS CACHING ====================
const dnsCache = new Map(); // hostname -> { resolved: string, timestamp: number }
const DNS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCachedDNS(hostname) {
  const entry = dnsCache.get(hostname);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > DNS_CACHE_TTL) {
    dnsCache.delete(hostname);
    return null;
  }
  return entry;
}

function setDNSCache(hostname) {
  dnsCache.set(hostname, { resolved: hostname, timestamp: Date.now() });
}

// ==================== 9. CLOUDFLARE CHALLENGE DETECTION ====================
function isCloudflareChallenge(html) {
  if (!html || typeof html !== 'string') return false;
  const lower = html.substring(0, 50000).toLowerCase();
  return (
    lower.includes('cf-browser-verification') ||
    lower.includes('just a moment') ||
    lower.includes('challenge-platform') ||
    lower.includes('cf-ray') && lower.includes('cloudflare') ||
    lower.includes('_cf_chl') ||
    lower.includes('cf_clearance') ||
    lower.includes('challenge-running') ||
    lower.includes('checking your browser') ||
    lower.includes('please wait') && lower.includes('cloudflare')
  );
}

// ==================== 10. REQUEST HEADERS BUILDER ====================

/**
 * Build realistic browser headers with pattern randomization
 */
function buildHeaders(url, referer, attempt) {
  const ua = getSessionUA();
  const isFirefox = ua.includes('Firefox');
  const isEdge = ua.includes('Edg/');
  const isSafari = ua.includes('Safari') && !ua.includes('Chrome') && !ua.includes('Edg');

  const headers = {
    'User-Agent': ua,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': getRandomAcceptLang(),
    'Accept-Encoding': 'gzip, deflate, br',
    'DNT': '1',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Cache-Control': attempt === 0 ? 'max-age=0' : 'no-cache',
  };

  // Browser-specific Sec-* headers (Chrome / Edge)
  if (!isFirefox && !isSafari) {
    // Sec-Ch-Ua - match to UA version
    const chromeVersion = ua.match(/Chrome\/(\d+)/)?.[1] || '136';
    if (isEdge) {
      headers['Sec-Ch-Ua'] = `"Microsoft Edge";v="${chromeVersion}", "Chromium";v="${chromeVersion}", "Not.A/Brand";v="99"`;
    } else {
      headers['Sec-Ch-Ua'] = `"Chromium";v="${chromeVersion}", "Google Chrome";v="${chromeVersion}", "Not.A/Brand";v="99"`;
    }
    headers['Sec-Ch-Ua-Mobile'] = '?0';
    headers['Sec-Ch-Ua-Platform'] = '"Windows"';

    // --- Request Pattern Randomization (Upgrade #3) ---
    // Randomly sometimes include 'document', sometimes 'empty'
    if (attempt > 0 && Math.random() < 0.2) {
      headers['Sec-Fetch-Dest'] = 'empty';
    } else {
      headers['Sec-Fetch-Dest'] = 'document';
    }
    headers['Sec-Fetch-Mode'] = 'navigate';
    headers['Sec-Fetch-Site'] = referer ? 'same-origin' : 'none';
    headers['Sec-Fetch-User'] = '?1';
    headers['Priority'] = 'u=0, i';

    // Occasionally omit a non-critical header (real browsers sometimes do)
    if (Math.random() < 0.1) {
      delete headers['Priority'];
    }
    if (Math.random() < 0.05) {
      delete headers['DNT'];
    }

    // --- Browser Fingerprint Headers (Upgrade #4) ---
    // Only add these ~60% of the time to appear more natural
    if (Math.random() < 0.6) {
      headers['Viewport-Width'] = '1920';
      headers['Viewport-Height'] = '1080';
    }
    if (Math.random() < 0.4) {
      headers['Device-Memory'] = '8';
      headers['Dpr'] = '1';
      headers['Downlink'] = '10';
      headers['Ect'] = '4g';
      headers['Rtt'] = String(Math.floor(30 + Math.random() * 50));
      headers['Save-Data'] = 'off';
    }
  } else if (isFirefox) {
    headers['Sec-Fetch-Dest'] = 'document';
    headers['Sec-Fetch-Mode'] = 'navigate';
    headers['Sec-Fetch-Site'] = referer ? 'same-origin' : 'none';
    headers['Sec-Fetch-User'] = '?1';
    headers['TE'] = 'trailers';

    // Firefox occasionally omits TE
    if (Math.random() < 0.08) {
      delete headers['TE'];
    }
  }
  // Safari doesn't send Sec-* headers

  if (referer) headers['Referer'] = referer;

  // Attach stored cookies
  const cookieStr = getCookieString(url);
  if (cookieStr) headers['Cookie'] = cookieStr;

  // --- Request Headers Cleanup (Upgrade #10) ---
  // Never send X-Requested-With (bot indicator)
  delete headers['X-Requested-With'];

  return headers;
}

// ==================== FETCH PAGE (anti-block v2) ====================

/**
 * Fetch page dengan anti-block berlapis v2
 * @param {string} url - URL to fetch
 * @param {string|null} referer - Custom referer (auto-detect if null)
 * @param {number} retries - Max retry attempts
 */
async function fetchPage(url, referer = null, retries = 5) {
  const cacheKey = `page:${url}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log(`[CACHE HIT] ${url}`);
    return cached;
  }

  // Periodically clear stale cookies
  clearStaleCookies();

  // Cache DNS entry
  const domain = getDomain(url);
  if (domain) setDNSCache(domain);

  // Auto-referer: use site homepage if not specified
  if (!referer) {
    try {
      const parsed = new URL(url);
      referer = `${parsed.protocol}//${parsed.hostname}/`;
    } catch {}
  }

  // Throttle per domain (adaptive)
  await throttleDomain(url);

  let lastError;
  let currentUA = getSessionUA();

  for (let attempt = 0; attempt < retries; attempt++) {
    const requestStart = Date.now();
    try {
      // Progressive delay with jitter (exponential backoff ±30%)
      const baseDelay = Math.min(300 * Math.pow(1.5, attempt), 5000);
      await randomDelay(baseDelay, baseDelay + 500);

      currentUA = getSessionUA();
      const headers = buildHeaders(url, referer, attempt);

      // Build axios config
      const axiosConfig = {
        headers,
        timeout: 15000,
        maxRedirects: 5,
        validateStatus: s => s < 400,
        decompress: true,
        maxContentLength: 10 * 1024 * 1024, // 10MB
        httpAgent: httpAgent,
        httpsAgent: httpsAgent,
      };

      // --- Proxy Rotation (Upgrade #1) ---
      let usedProxy = null;
      if (PROXY_LIST.length > 0) {
        // On retry (attempt > 0), rotate proxy
        const proxyUrl = attempt > 0 ? getRandomProxy() : getNextProxy();
        if (proxyUrl) {
          const parsed = parseProxyUrl(proxyUrl);
          if (parsed) {
            usedProxy = proxyUrl;
            axiosConfig.proxy = {
              protocol: parsed.protocol,
              host: parsed.host,
              port: parsed.port,
              auth: parsed.username ? { username: parsed.username, password: parsed.password } : undefined,
            };
            console.log(`[ANTI-BLOCK] Using proxy: ${parsed.host}:${parsed.port} (attempt ${attempt + 1})`);
          }
        }
      }

      const response = await axios.get(url, axiosConfig);
      const responseTime = Date.now() - requestStart;

      // Store any cookies from response
      storeCookies(url, response);

      // --- Cloudflare Challenge Detection (Upgrade #9) ---
      const html = typeof response.data === 'string' ? response.data : '';
      if (isCloudflareChallenge(html)) {
        console.log(`[ANTI-BLOCK] Cloudflare challenge detected for ${domain} (attempt ${attempt + 1})`);
        trackSessionRequest(domain, false, responseTime, true);
        adaptThrottleForDomain(domain, responseTime, false);

        // Wait longer and rotate UA + proxy
        const cfWait = Math.min(5000 * Math.pow(1.5, attempt), 30000);
        console.log(`[ANTI-BLOCK] CF challenge: waiting ${cfWait}ms, rotating UA and proxy`);
        sessionUA = null; // Force new UA
        if (PROXY_LIST.length > 0) {
          getRandomProxy(); // Rotate proxy
          sessionStats.proxyRotations++;
        }
        await randomDelay(cfWait, cfWait + 3000);
        continue; // Retry
      }

      // Success!
      trackSessionRequest(domain, true, responseTime, false);
      adaptThrottleForDomain(domain, responseTime, true);
      cache.set(cacheKey, response.data);
      console.log(`[FETCH OK] ${url} (attempt ${attempt + 1}, ${responseTime}ms${usedProxy ? ', proxied' : ''})`);
      return response.data;

    } catch (error) {
      lastError = error;
      const status = error.response?.status;
      const responseTime = Date.now() - requestStart;
      console.log(`[FETCH ERROR] Attempt ${attempt + 1}/${retries} for ${url}: ${status || error.message}`);

      // Store cookies even on error responses (some sites set cookies on 403)
      if (error.response) {
        storeCookies(url, error.response);
      }

      // --- Enhanced Retry Strategy (Upgrade #5) ---
      if (status === 403 || status === 429 || status === 503) {
        // Aggressive backoff for anti-bot responses — rotate UA AND proxy
        sessionStats.totalRetries++;
        sessionUA = null; // Force new UA on next iteration
        if (PROXY_LIST.length > 0) {
          getRandomProxy(); // Rotate proxy
          sessionStats.proxyRotations++;
        }
        const backoff = Math.min(3000 * Math.pow(2, attempt), 30000);
        const jitteredBackoff = backoff * (0.7 + Math.random() * 0.6);
        console.log(`[ANTI-BLOCK] ${status} received. Backing off ${Math.round(jitteredBackoff)}ms. UA + proxy rotated.`);
        await randomDelay(jitteredBackoff, jitteredBackoff + 2000);
        trackSessionRequest(domain, false, responseTime, true);
        adaptThrottleForDomain(domain, responseTime, false);
      } else if (status >= 520 && status <= 524) {
        // Cloudflare 520-524 errors — wait longer (up to 30s) and rotate both
        sessionStats.totalRetries++;
        sessionUA = null;
        if (PROXY_LIST.length > 0) {
          getRandomProxy();
          sessionStats.proxyRotations++;
        }
        const backoff = Math.min(5000 * Math.pow(1.8, attempt), 30000);
        const jitteredBackoff = backoff * (0.7 + Math.random() * 0.6);
        console.log(`[ANTI-BLOCK] Cloudflare ${status}. Waiting ${Math.round(jitteredBackoff)}ms. UA + proxy rotated.`);
        await randomDelay(jitteredBackoff, jitteredBackoff + 3000);
        trackSessionRequest(domain, false, responseTime, true);
        adaptThrottleForDomain(domain, responseTime, false);
      } else if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT' || error.code === 'ECONNREFUSED') {
        // Connection timeout — try different proxy if available
        sessionStats.totalRetries++;
        if (PROXY_LIST.length > 0) {
          getRandomProxy();
          sessionStats.proxyRotations++;
          console.log(`[ANTI-BLOCK] Connection error (${error.code}). Rotating proxy.`);
        }
        const backoff = Math.min(2000 * Math.pow(1.5, attempt), 10000);
        await randomDelay(backoff, backoff + 1000);
        trackSessionRequest(domain, false, responseTime, false);
      } else {
        trackSessionRequest(domain, false, responseTime, false);
      }
    }
  }

  throw lastError;
}

// ==================== UTILITY EXPORTS ====================

function clearCacheFor(pattern) {
  const keys = cache.keys();
  keys.forEach(k => { if (k.includes(pattern)) cache.del(k); });
}

// Clear specific domain cookies (useful for debugging)
function clearCookiesFor(domain) {
  cookieJar.delete(domain);
}

// Clear all cookies across all domains
function clearAllCookies() {
  const count = cookieJar.size;
  cookieJar.clear();
  console.log(`[ANTI-BLOCK] Cleared all cookies for ${count} domain(s)`);
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
 * Samehadaku uses .hpage with a.l (prev) and a.r (next) only.
 * No total page numbers are available - only prev/next with ?page=N.
 */
function extractPagination($, currentPage, baseUrl = null) {
  const page = parseInt(currentPage) || 1;
  let totalPages = page;
  let hasNext = false;
  let hasPrev = false;
  let totalItems = null;

  // Try to extract total items from page text
  const bodyText = $('body').text();
  const totalMatch = bodyText.match(/(?:of|dari|total)\s+(\d+)\s+(?:results?|items?|anime|entries)/i);
  if (totalMatch) {
    totalItems = parseInt(totalMatch[1]);
  }

  // WordPress-style "Page X of Y" text
  const pageOfMatch = bodyText.match(/(?:page|halaman)\s+\d+\s+(?:of|dari)\s+(\d+)/i);
  if (pageOfMatch) {
    const total = parseInt(pageOfMatch[1]);
    if (total > totalPages) totalPages = total;
  }

  // Helper: extract page number from any URL format
  function extractPageNum(href) {
    if (!href) return null;
    // Match /page/N/ or page=N or ?page=N
    const m = href.match(/(?:\/page\/|[?&]page=)(\d+)/);
    return m ? parseInt(m[1]) : null;
  }

  // Method 1: .hpage (samehadaku.me theme) - a.l = prev, a.r = next
  const hpage = $('.hpage');
  if (hpage.length) {
    const prevLink = hpage.find('a.l');
    const nextLink = hpage.find('a.r');
    hasPrev = prevLink.length > 0;
    hasNext = nextLink.length > 0;

    // Extract page numbers from all links in .hpage
    hpage.find('a').each((i, el) => {
      const num = extractPageNum($(el).attr('href'));
      if (num && num > totalPages) totalPages = num;
    });

    // Also check text content for page numbers
    hpage.find('a, span, strong, em').each((i, el) => {
      const text = $(el).text().trim();
      const num = parseInt(text);
      if (!isNaN(num) && num > 0 && num > totalPages) totalPages = num;
    });
  }

  // Method 2: .pagination .page-numbers (classic WP)
  const pageNumbers = $('.pagination .page-numbers:not(.next):not(.prev), .nav-links .page-numbers:not(.next):not(.prev), .page-numbers:not(.next):not(.prev)');
  if (pageNumbers.length) {
    pageNumbers.each((i, el) => {
      const num = parseInt($(el).text().trim());
      if (!isNaN(num) && num > totalPages) totalPages = num;
      const hrefNum = extractPageNum($(el).attr('href'));
      if (hrefNum && hrefNum > totalPages) totalPages = hrefNum;
    });
    hasNext = hasNext || $('.pagination .next, .nav-links .next, .page-numbers.next').length > 0;
    hasPrev = hasPrev || $('.pagination .prev, .nav-links .prev, .page-numbers.prev').length > 0;
  }

  // Method 3: Scan semua link dengan page parameter (both /page/N/ and ?page=N)
  $('a[href*="page/"], a[href*="page="]').each((i, el) => {
    const num = extractPageNum($(el).attr('href'));
    if (num && num > totalPages) totalPages = num;
  });

  // Method 4: "Last" / ">>" link
  $('a').each((i, el) => {
    const text = $(el).text().trim().toLowerCase();
    if (text.includes('last') || text.includes('terakhir') || text === '>>' || text === '»') {
      const num = extractPageNum($(el).attr('href'));
      if (num && num > totalPages) totalPages = num;
    }
  });

  // Method 5: Dots/ellipsis pagination
  $('.page-numbers.dots, .pagination .dots').each((i, el) => {
    const nextEl = $(el).next();
    if (nextEl.length) {
      const num = extractPageNum(nextEl.attr('href'));
      if (num && num > totalPages) totalPages = num;
      const textNum = parseInt(nextEl.text().trim());
      if (!isNaN(textNum) && textNum > totalPages) totalPages = textNum;
    }
  });

  // Fallback: detect next/prev if not yet detected
  if (!hasNext && !hasPrev) {
    hasNext = $('a.next, a.r, .hpage a.r, .pagination .next, .page-numbers.next, a[rel="next"]').length > 0;
    hasPrev = $('a.prev, a.l, .hpage a.l, .pagination .prev, .page-numbers.prev, a[rel="prev"]').length > 0;
  }

  // If we have next but totalPages <= current page, at least totalPages = page + 1
  if (hasNext && totalPages <= page) totalPages = page + 1;

  // totalPages minimal = current page
  if (totalPages < page) totalPages = page;

  const hasPrevPage = page > 1;
  const hasNextPage = hasNext || page < totalPages;

  // Estimate totalItems if not found — only count items in MAIN content area
  // Avoid counting sidebar items (.widget .bs, aside .bsx etc)
  if (totalItems === null) {
    // Scope counting to main content wrappers only
    const mainSelectors = [
      '.listupd > .bs',                    // Main listing grid items
      '.postbody .listupd .bs',            // Inside post body
      'main .bs',                          // Inside <main>
      '#content .bs',                      // Inside #content
      '.content-area .bs',                 // Inside content area
    ];
    let itemCount = 0;
    for (const sel of mainSelectors) {
      itemCount = $(sel).length;
      if (itemCount > 0) break;
    }
    // Fallback to broader selector if main selectors find nothing
    if (itemCount === 0) {
      itemCount = $('.listupd .bs').length;
      // Subtract sidebar items if widget containers exist
      const sidebarItems = $('aside .bs, .sidebar .bs, .widget .bs').length;
      itemCount = Math.max(0, itemCount - sidebarItems);
    }
    if (itemCount > 0 && totalPages > 0) {
      totalItems = itemCount * totalPages;
    }
  }

  return {
    currentPage: page,
    hasPrevPage: hasPrevPage,
    prevPage: hasPrevPage ? page - 1 : null,
    hasNextPage: hasNextPage,
    nextPage: hasNextPage ? page + 1 : null,
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

// ==================== MODULE EXPORTS ====================
// All original exports preserved + 4 new exports
module.exports = {
  // Original exports (backward compatible)
  fetchPage,
  cache,
  getRandomUA,
  randomDelay,
  clearCacheFor,
  clearCookiesFor,
  buildPagination,
  extractPagination,
  extractVideoData,
  // New exports
  setProxies,
  getNextProxy,
  getSessionStats,
  clearAllCookies,
};
