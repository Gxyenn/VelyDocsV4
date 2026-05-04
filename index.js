const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

// ==================== API KEY SYSTEM ====================
// Free keys (limited requests)
const FREE_KEYS = new Set([
"keys-free",
]);

// Premium keys (unlimited / higher limit)
const PREMIUM_KEYS = new Set([
  'Gxyenn969',
]);

// Track usage
const keyUsage = new Map(); // key -> { count, resetTime }

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
      freeKeys: ['keys-free'],
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
    // Rate limit untuk free key: 30 request per menit
    const now = Date.now();
    const windowMs = 60 * 1000; // 1 menit
    const maxRequests = 30;

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
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));

app.use(compression());

// CORS - Allow all origins
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
}));

// Rate limiting global
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: false,
    message: 'Terlalu banyak request, coba lagi nanti.',
  },
});
app.use(limiter);

// Parse JSON
app.use(express.json({ limit: '10mb' }));

// API Key middleware
app.use(checkApiKey);

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
    version: '2.1.0',
    contact: 't.me/@Gxyenn969',
    pricing: {
      free: {
        description: 'Gratis dengan limit 30 req/menit',
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
          { method: 'GET', path: '/episode/:slug?key=YOUR_KEY', desc: 'Episode detail with video servers & downloads' },
          { method: 'GET', path: '/genres?key=YOUR_KEY', desc: 'List all genres' },
          { method: 'GET', path: '/genre/:slug?page=1&key=YOUR_KEY', desc: 'Anime by genre' },
          { method: 'GET', path: '/az-list?letter=A&page=1&key=YOUR_KEY', desc: 'A-Z anime list' },
          { method: 'GET', path: '/schedule?key=YOUR_KEY', desc: 'Release schedule' },
          { method: 'GET', path: '/popular?period=weekly&key=YOUR_KEY', desc: 'Popular anime' },
          { method: 'GET', path: '/anime-list?page=1&status=&type=&order=&key=YOUR_KEY', desc: 'Full anime list with filters' },
        ]
      },
      anichin: {
        base: '/api/anichin',
        endpoints: [
          { method: 'GET', path: '/home?key=YOUR_KEY', desc: 'Homepage - Trending & Latest' },
          { method: 'GET', path: '/explore?page=1&sort=&letter=&key=YOUR_KEY', desc: 'Explore anime' },
          { method: 'GET', path: '/anime/:slug?key=YOUR_KEY', desc: 'Anime detail' },
          { method: 'GET', path: '/anime/:slug/episode/:number?key=YOUR_KEY', desc: 'Episode with video' },
          { method: 'GET', path: '/search?q=&page=1&key=YOUR_KEY', desc: 'Search anime' },
          { method: 'GET', path: '/movies?page=1&key=YOUR_KEY', desc: 'Anime movies' },
          { method: 'GET', path: '/ongoing?page=1&key=YOUR_KEY', desc: 'Anime ongoing' },
          { method: 'GET', path: '/completed?page=1&key=YOUR_KEY', desc: 'Anime completed' },
          { method: 'GET', path: '/genres?key=YOUR_KEY', desc: 'List genres' },
          { method: 'GET', path: '/genre/:slug?page=1&key=YOUR_KEY', desc: 'Anime by genre' },
          { method: 'GET', path: '/seasons?key=YOUR_KEY', desc: 'List seasons' },
          { method: 'GET', path: '/season/:slug?page=1&key=YOUR_KEY', desc: 'Anime by season' },
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
      'Anti-block scraping dengan rotating User-Agents',
      'Smart caching untuk response cepat',
      'Pagination lengkap',
      'Multiple video resolution support',
      'CORS enabled untuk semua origins',
      'Rate limiting untuk proteksi',
      'API Key system (Free & Premium)',
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
