const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

// ==================== SECURITY / BOT PROTECTION ====================
const {
  botDetector,
  ipBlacklist,
  requestValidator,
  honeypot,
  ddosProtection,
  getSecurityStats,
} = require('./lib/security');

// ==================== ANTI-BLOCK PROXY SUPPORT ====================
const { setProxies, getSessionStats, clearAllCookies, cache } = require('./lib/scraper');

// Load proxies from environment variable (comma-separated)
if (process.env.PROXIES) {
  const proxyList = process.env.PROXIES.split(',').map(p => p.trim()).filter(Boolean);
  if (proxyList.length) {
    setProxies(proxyList);
    console.log(`Loaded ${proxyList.length} proxy(ies) for anti-block protection`);
  }
}

// ==================== API KEY SYSTEM ====================
// Free keys (limited requests)
const FREE_KEYS = new Set([
"keys-free",
]);

// Premium keys (unlimited / higher limit)
const PREMIUM_KEYS = new Set([
  'Gxyenn969',
]);

// Track usage per key with sliding window
const keyUsage = new Map(); // key -> { count, resetTime }

// ==================== ANTI-BLOCK: REQUEST QUEUE ====================
// Serialize outgoing scrape requests to avoid overwhelming target sites
// when hundreds of users hit the API simultaneously.
const requestQueue = [];
let activeRequests = 0;
const MAX_CONCURRENT_SCRAPES = parseInt(process.env.MAX_CONCURRENT_SCRAPES) || 5;

function enqueueRequest() {
  return new Promise(resolve => {
    if (activeRequests < MAX_CONCURRENT_SCRAPES) {
      activeRequests++;
      resolve();
    } else {
      requestQueue.push(resolve);
    }
  });
}

function dequeueRequest() {
  activeRequests--;
  if (requestQueue.length > 0 && activeRequests < MAX_CONCURRENT_SCRAPES) {
    activeRequests++;
    const next = requestQueue.shift();
    next();
  }
}

// Middleware: queue concurrent scrape requests (skip for static endpoints)
function concurrencyLimiter(req, res, next) {
  if (req.path === '/' || req.path === '/health' || req.path === '/stats') {
    return next();
  }
  enqueueRequest().then(() => {
    res.on('finish', dequeueRequest);
    res.on('close', dequeueRequest);
    // Safety: ensure dequeue only happens once
    let dequeued = false;
    const originalDequeue = dequeueRequest;
    const safeDequeue = () => {
      if (!dequeued) {
        dequeued = true;
        originalDequeue();
      }
    };
    res.removeAllListeners('finish');
    res.removeAllListeners('close');
    res.on('finish', safeDequeue);
    res.on('close', safeDequeue);
    next();
  });
}

function checkApiKey(req, res, next) {
  const apiKey = req.query.key || req.headers['x-api-key'];

  // Skip check untuk endpoint dokumentasi
  if (req.path === '/' || req.path === '/health') {
    return next();
  }

  if (!apiKey) {
    return res.status(401).json({
      status: false,
      message: 'API Key diperlukan. Tambahkan ?key=YOUR_KEY di URL atau X-API-Key di header.',
      info: 'Hubungi t.me/@Gxyenn969 untuk membeli API Key premium.',
      freeKeys: ([
      'keys-free'
      ]),
    });
  }

  // Cek premium key
  if (PREMIUM_KEYS.has(apiKey)) {
    req.isPremium = true;
    req.apiKey = apiKey;
    return next();
  }

  // Cek free key
  if (FREE_KEYS.has(apiKey)) {
    // Rate limit untuk free key: 50 request per menit
    const now = Date.now();
    const windowMs = 60 * 1000; // 1 menit
    const maxRequests = 50;

    if (!keyUsage.has(apiKey)) {
      keyUsage.set(apiKey, { count: 1, resetTime: now + windowMs });
    } else {
      const usage = keyUsage.get(apiKey);
      if (now > usage.resetTime) {
        usage.count = 1;
        usage.resetTime = now + windowMs;
      } else {
        usage.count++;
        if (usage.count > maxRequests) {
          return res.status(429).json({
            status: false,
            message: 'Rate limit tercapai untuk free key. Coba lagi dalam 1 menit.',
            info: 'Upgrade ke premium: t.me/@Gxyenn969',
            retryAfter: Math.ceil((usage.resetTime - now) / 1000),
          });
        }
      }
    }

    req.isPremium = false;
    req.apiKey = apiKey;
    return next();
  }

  // Key tidak valid
  return res.status(403).json({
    status: false,
    message: 'API Key tidak valid.',
    info: 'Hubungi t.me/@Gxyenn969 untuk membeli API Key.',
  });
}

// ==================== MIDDLEWARE ====================
// Trust proxy (needed for rate-limit behind reverse proxies like Nginx/Cloudflare)
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));

app.use(compression());

// ==================== SECURITY MIDDLEWARE ====================
// Helper: check if request carries a premium/admin API key
function isPremiumRequest(req) {
  const apiKey = req.query.key || req.headers['x-api-key'];
  return apiKey && PREMIUM_KEYS.has(apiKey);
}

// Honeypot endpoints (auto-blacklist scanners) — always active
app.use(honeypot);

// DDoS protection — skip for premium keys
app.use((req, res, next) => {
  if (isPremiumRequest(req)) return next();
  return ddosProtection(req, res, next);
});

// Request validation — always active (protects against injection even from premium)
app.use(requestValidator);

// Bot detector — skip for premium keys
app.use((req, res, next) => {
  if (isPremiumRequest(req)) return next();
  return botDetector(req, res, next);
});

// CORS - Allow all origins
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
}));

// Rate limiting global - per IP (skip untuk premium/admin keys)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,  // increased from 100 for high traffic
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Use API key as rate limit key if available, otherwise IP
    return req.query.key || req.headers['x-api-key'] || req.ip;
  },
  message: {
    status: false,
    message: 'Terlalu banyak request, coba lagi nanti.',
  },
  skip: (req) => {
    // Admin/premium keys bypass global rate limit sepenuhnya
    const apiKey = req.query.key || req.headers['x-api-key'];
    return PREMIUM_KEYS.has(apiKey);
  },
});
app.use(limiter);

// Parse JSON
app.use(express.json({ limit: '10mb' }));

// API Key middleware
app.use(checkApiKey);

// Concurrency limiter to prevent overwhelming target sites
app.use(concurrencyLimiter);

// ==================== ROUTES ====================
const samehadakuRouter = require('./routes/samehadaku');
const anichinRouter = require('./routes/anichin');
const scheduleRouter = require('./routes/schedule');

app.use('/api/samehadaku', samehadakuRouter);
app.use('/api/anichin', anichinRouter);
app.use('/api/schedule', scheduleRouter);

// ==================== API DOCUMENTATION ====================
app.get('/', (req, res) => {
  res.json({
    status: true,
    message: 'VelyDocs V4 - Anime API',
    creator: 'Gxyenn',
    version: '2.3.0',
    contact: 't.me/@Gxyenn969',
    pricing: {
      free: {
        description: 'Gratis dengan limit 50 req/menit',
        keys: "keys-free",
      },
      premium: {
        description: 'Unlimited request, prioritas tinggi',
        contact: 't.me/@Gxyenn969',
        price: 'Hubungi admin',
      },
    },
    documentation: {
      samehadaku: {
        base: '/api/samehadaku',
        endpoints: [
          { method: 'GET', path: '/home?key=YOUR_KEY', desc: 'Homepage - Latest & Popular anime' },
          { method: 'GET', path: '/recent?page=1&key=YOUR_KEY', desc: 'Recent updates with pagination' },
          { method: 'GET', path: '/search?q=naruto&page=1&key=YOUR_KEY', desc: 'Search anime' },
          { method: 'GET', path: '/anime/:slug?key=YOUR_KEY', desc: 'Anime detail with episodes list' },
          { method: 'GET', path: '/episode/:slug?key=YOUR_KEY', desc: 'Episode detail with video iframe & navigation' },
          { method: 'GET', path: '/servers/:episodeSlug?key=YOUR_KEY', desc: 'All streaming servers/mirrors grouped by quality' },
          { method: 'GET', path: '/batch/:slug?key=YOUR_KEY', desc: 'Batch download links for an anime' },
          { method: 'GET', path: '/genres?key=YOUR_KEY', desc: 'List all genres' },
          { method: 'GET', path: '/genre/:slug?page=1&key=YOUR_KEY', desc: 'Anime by genre' },
          { method: 'GET', path: '/az-list?letter=A&page=1&key=YOUR_KEY', desc: 'A-Z anime list' },
          { method: 'GET', path: '/popular?period=weekly&key=YOUR_KEY', desc: 'Popular anime' },
          { method: 'GET', path: '/anime-list?page=1&status=&type=&order=&key=YOUR_KEY', desc: 'Full anime list with filters' },
          { method: 'GET', path: '/schedule?key=YOUR_KEY', desc: 'Samehadaku release schedule' },
        ]
      },
      anichin: {
        base: '/api/anichin',
        endpoints: [
          { method: 'GET', path: '/home?key=YOUR_KEY', desc: 'Homepage - Trending & Latest' },
          { method: 'GET', path: '/explore?page=1&sort=&letter=&status=&type=&key=YOUR_KEY', desc: 'Explore anime with filters' },
          { method: 'GET', path: '/anime/:slug?key=YOUR_KEY', desc: 'Anime detail with episode list' },
          { method: 'GET', path: '/anime/:slug/episode/:number?key=YOUR_KEY', desc: 'Episode detail with video URL & navigation' },
          { method: 'GET', path: '/anime/:slug/episode/:number/servers?key=YOUR_KEY', desc: 'All streaming servers/mirrors grouped by quality' },
          { method: 'GET', path: '/batch/:slug?key=YOUR_KEY', desc: 'Batch download links for an anime' },
          { method: 'GET', path: '/search?q=naruto&page=1&key=YOUR_KEY', desc: 'Search anime' },
          { method: 'GET', path: '/movies?page=1&key=YOUR_KEY', desc: 'Anime movies' },
          { method: 'GET', path: '/ongoing?page=1&key=YOUR_KEY', desc: 'Anime ongoing' },
          { method: 'GET', path: '/completed?page=1&key=YOUR_KEY', desc: 'Anime completed' },
          { method: 'GET', path: '/genres?key=YOUR_KEY', desc: 'List all genres' },
          { method: 'GET', path: '/genre/:slug?page=1&key=YOUR_KEY', desc: 'Anime by genre' },
          { method: 'GET', path: '/seasons?key=YOUR_KEY', desc: 'List all seasons' },
          { method: 'GET', path: '/season/:slug?page=1&key=YOUR_KEY', desc: 'Anime by season' },
          { method: 'GET', path: '/schedule?key=YOUR_KEY', desc: 'Anichin release schedule' },
        ]
      },
      schedule: {
        base: '/api/schedule',
        endpoints: [
          { method: 'GET', path: '/samehadaku?key=YOUR_KEY', desc: 'Samehadaku release schedule' },
          { method: 'GET', path: '/anichin?key=YOUR_KEY', desc: 'Anichin release schedule' },
          { method: 'GET', path: '/all?key=YOUR_KEY', desc: 'Combined schedule' },
        ]
      }
    },
    features: [
      'Anti-block scraping dengan rotating User-Agents & proxy rotation',
      'Smart caching untuk response cepat',
      'Pagination lengkap dengan totalItems',
      'Multiple video resolution support via dedicated /servers endpoint',
      'Base64 iframe decoder untuk Samehadaku mirrors',
      'Batch download via dedicated /batch endpoint',
      'Server/mirror listing grouped by quality (separate endpoint)',
      'CORS enabled untuk semua origins',
      'Rate limiting per-IP dan per-key untuk proteksi',
      'API Key system (Free & Premium)',
      'Bot detection & auto-blacklist (suspicious UA, missing headers)',
      'DDoS protection (sliding window rate limiter)',
      'Request validation (SQL injection, XSS, path traversal)',
      'Honeypot endpoints (auto-ban scanners)',
      'IP blacklist management dengan auto-expiry',
      'Concurrency limiter untuk mencegah blocking dari sumber',
      'HTTP connection pooling untuk performa tinggi',
      'Cloudflare challenge detection & bypass',
      'Adaptive throttling per-domain',
      'Mendukung ratusan/ribuan user secara bersamaan',
    ],
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: true, 
    uptime: process.uptime(), 
    timestamp: new Date().toISOString(),
    memory: process.memoryUsage(),
  });
});

// Session stats endpoint (premium only)
app.get('/stats', (req, res) => {
  const apiKey = req.query.key || req.headers['x-api-key'];
  if (!PREMIUM_KEYS.has(apiKey)) {
    return res.status(403).json({ status: false, message: 'Hanya premium key yang bisa akses stats.' });
  }
  res.json({ status: true, stats: getSessionStats(), security: getSecurityStats() });
});

// Cache management endpoint (premium only)
app.post('/cache/clear', (req, res) => {
  const apiKey = req.query.key || req.headers['x-api-key'];
  if (!PREMIUM_KEYS.has(apiKey)) {
    return res.status(403).json({ status: false, message: 'Hanya premium key yang bisa clear cache.' });
  }
  cache.flushAll();
  clearAllCookies();
  res.json({ status: true, message: 'Cache dan cookies berhasil dibersihkan.' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ status: false, message: 'Endpoint tidak ditemukan', path: req.path });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ status: false, message: 'Internal server error', error: err.message });
});

app.listen(PORT, () => {
  console.log(`✅ VelyDocs V4 Server running on port ${PORT}`);
  console.log(`📚 API Docs: http://localhost:${PORT}/`);
  console.log(`💰 Contact: t.me/@Gxyenn969`);
});

module.exports = app;
