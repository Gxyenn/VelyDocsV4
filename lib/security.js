"use strict";

const { Router } = require("express");

// ---------------------------------------------------------------------------
// Shared state (Maps for zero-dep tracking)
// ---------------------------------------------------------------------------
const stats = {
  totalBlocked: 0,
  botTriggers: 0,
  ipOffenses: new Map(), // ip -> count
};

// ---------------------------------------------------------------------------
// 1. IP Blacklist manager
// ---------------------------------------------------------------------------
const _blacklist = new Map(); // ip -> { reason, expiresAt }

const ipBlacklist = {
  /**
   * Add an IP to the blacklist.
   * @param {string} ip
   * @param {string} reason
   * @param {number} durationMs  Default 1 hour.
   */
  add(ip, reason = "unknown", durationMs = 3_600_000) {
    _blacklist.set(ip, {
      reason,
      expiresAt: Date.now() + durationMs,
      addedAt: new Date().toISOString(),
    });
  },

  /** Remove an IP from the blacklist. */
  remove(ip) {
    _blacklist.delete(ip);
  },

  /** Check whether an IP is currently blocked (auto-expires). */
  isBlocked(ip) {
    const entry = _blacklist.get(ip);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      _blacklist.delete(ip);
      return false;
    }
    return true;
  },

  /** Return all currently-blocked entries (expired ones are pruned). */
  getAll() {
    const now = Date.now();
    const result = {};
    for (const [ip, entry] of _blacklist) {
      if (now > entry.expiresAt) {
        _blacklist.delete(ip);
      } else {
        result[ip] = entry;
      }
    }
    return result;
  },
};

// ---------------------------------------------------------------------------
// 2. Bot Detector middleware
// ---------------------------------------------------------------------------
const SUSPICIOUS_UA_PATTERNS = [
  /curl\//i,
  /wget\//i,
  /python-requests/i,
  /python-urllib/i,
  /scrapy/i,
  /httpclient/i,
  /java\//i,
  /libwww-perl/i,
  /go-http-client/i,
  /node-fetch/i,
  /axios/i,
  /postman/i,
  /insomnia/i,
  /\bbot\b/i,
  /\bspider\b/i,
  /\bcrawler\b/i,
  /\bscraper\b/i,
  /headlesschrome/i,
  /phantomjs/i,
  /selenium/i,
];

const WHITELISTED_PATHS = new Set(["/", "/health"]);

// Sliding-window request tracking per IP (bot heuristic)
const _requestLog = new Map();   // ip -> [timestamp, ...]
const _botStrikes = new Map();   // ip -> strike count
const BOT_WINDOW_MS = 5_000;    // 5 seconds
const BOT_WINDOW_MAX = 20;      // max requests per window before flagged
const BOT_STRIKE_LIMIT = 5;     // strikes before auto-blacklist

function _recordRequest(ip) {
  const now = Date.now();
  let timestamps = _requestLog.get(ip);
  if (!timestamps) {
    timestamps = [];
    _requestLog.set(ip, timestamps);
  }
  timestamps.push(now);
  // Trim entries outside the window
  const cutoff = now - BOT_WINDOW_MS;
  while (timestamps.length && timestamps[0] < cutoff) timestamps.shift();
  return timestamps.length;
}

function _addStrike(ip) {
  const count = (_botStrikes.get(ip) || 0) + 1;
  _botStrikes.set(ip, count);
  return count;
}

function _recordOffense(ip) {
  stats.ipOffenses.set(ip, (stats.ipOffenses.get(ip) || 0) + 1);
}

function _block(res, message) {
  stats.totalBlocked++;
  return res.status(403).json({ error: "Forbidden", message });
}

function botDetector(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress || "unknown";

  // Whitelisted paths bypass all checks
  if (WHITELISTED_PATHS.has(req.path)) return next();

  // Already blacklisted?
  if (ipBlacklist.isBlocked(ip)) {
    _recordOffense(ip);
    return _block(res, "Your IP has been temporarily blocked.");
  }

  let suspicious = false;
  let reason = "";

  // 1. User-Agent checks
  const ua = req.headers["user-agent"] || "";
  if (!ua) {
    suspicious = true;
    reason = "Missing User-Agent header.";
  } else {
    for (const pattern of SUSPICIOUS_UA_PATTERNS) {
      if (pattern.test(ua)) {
        suspicious = true;
        reason = `Suspicious User-Agent detected: ${ua}`;
        break;
      }
    }
  }

  // 2. Missing standard browser headers
  if (!suspicious) {
    if (!req.headers["accept"]) {
      suspicious = true;
      reason = "Missing Accept header.";
    } else if (!req.headers["accept-language"]) {
      suspicious = true;
      reason = "Missing Accept-Language header.";
    }
  }

  // 3. Sliding-window rate heuristic
  const recentCount = _recordRequest(ip);
  if (!suspicious && recentCount > BOT_WINDOW_MAX) {
    suspicious = true;
    reason = "Abnormal request rate detected.";
  }

  if (suspicious) {
    stats.botTriggers++;
    _recordOffense(ip);
    const strikes = _addStrike(ip);

    if (strikes >= BOT_STRIKE_LIMIT) {
      ipBlacklist.add(ip, `Auto-blacklisted after ${strikes} bot strikes`, 3_600_000);
    }

    return _block(res, reason);
  }

  next();
}

// ---------------------------------------------------------------------------
// 3. Request Validator middleware
// ---------------------------------------------------------------------------
const SQL_PATTERNS = [
  /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|EXEC|UNION)\b\s)/i,
  /(--|;|\/\*|\*\/|'(\s)*(OR|AND)\s)/i,
  /(\bOR\b\s+\d+\s*=\s*\d+)/i,
  /(\bAND\b\s+\d+\s*=\s*\d+)/i,
  /(SLEEP\s*\(|BENCHMARK\s*\(|WAITFOR\s+DELAY)/i,
];

const XSS_PATTERNS = [
  /<script[\s>]/i,
  /javascript\s*:/i,
  /on(load|error|click|mouseover|focus|blur)\s*=/i,
  /(<iframe|<object|<embed|<applet)/i,
  /(document\.(cookie|domain|write)|window\.location)/i,
  /eval\s*\(/i,
];

const PATH_TRAVERSAL = /(\.\.(\/|\\))/;

function requestValidator(req, res, next) {
  // 1. URL length
  if (req.originalUrl && req.originalUrl.length > 2000) {
    stats.totalBlocked++;
    return res.status(414).json({ error: "URI Too Long", message: "URL exceeds maximum allowed length." });
  }

  // 2. Too many query parameters
  const queryKeys = Object.keys(req.query || {});
  if (queryKeys.length > 20) {
    stats.totalBlocked++;
    return res.status(400).json({ error: "Bad Request", message: "Too many query parameters." });
  }

  // 3. Suspicious query values
  const queryString = req.originalUrl || "";
  for (const pattern of SQL_PATTERNS) {
    if (pattern.test(queryString)) {
      stats.totalBlocked++;
      _recordOffense(req.ip || "unknown");
      return _block(res, "Potentially malicious input detected (SQL).");
    }
  }
  for (const pattern of XSS_PATTERNS) {
    if (pattern.test(queryString)) {
      stats.totalBlocked++;
      _recordOffense(req.ip || "unknown");
      return _block(res, "Potentially malicious input detected (XSS).");
    }
  }

  // 4. Path traversal
  if (PATH_TRAVERSAL.test(req.path)) {
    stats.totalBlocked++;
    _recordOffense(req.ip || "unknown");
    return _block(res, "Path traversal attempt detected.");
  }

  next();
}

// ---------------------------------------------------------------------------
// 4. Honeypot router
// ---------------------------------------------------------------------------
const HONEYPOT_PATHS = [
  "/wp-admin",
  "/wp-login.php",
  "/.env",
  "/admin",
  "/phpmyadmin",
  "/config.php",
];

const HONEYPOT_BAN_MS = 24 * 60 * 60 * 1000; // 24 hours

const honeypot = Router();

HONEYPOT_PATHS.forEach((path) => {
  honeypot.all(path, (req, res) => {
    const ip = req.ip || req.connection.remoteAddress || "unknown";
    ipBlacklist.add(ip, `Honeypot hit: ${path}`, HONEYPOT_BAN_MS);
    stats.totalBlocked++;
    _recordOffense(ip);
    res.status(403).json({
      error: "Forbidden",
      message: "Access denied.",
    });
  });
});

// ---------------------------------------------------------------------------
// 5. DDoS Protection middleware
// ---------------------------------------------------------------------------
const DDOS_WINDOW_MS = 10_000;   // 10 seconds
const DDOS_MAX_REQ = 30;          // max requests per window
const DDOS_BAN_MS = 5 * 60_000;  // 5 minutes

const _ddosLog = new Map();       // ip -> [timestamp, ...]

function ddosProtection(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress || "unknown";

  // Already blacklisted?
  if (ipBlacklist.isBlocked(ip)) {
    stats.totalBlocked++;
    return res.status(429).json({
      error: "Too Many Requests",
      message: "You have been temporarily rate-limited.",
    });
  }

  const now = Date.now();
  let timestamps = _ddosLog.get(ip);
  if (!timestamps) {
    timestamps = [];
    _ddosLog.set(ip, timestamps);
  }
  timestamps.push(now);

  // Trim outside window
  const cutoff = now - DDOS_WINDOW_MS;
  while (timestamps.length && timestamps[0] < cutoff) timestamps.shift();

  if (timestamps.length > DDOS_MAX_REQ) {
    ipBlacklist.add(ip, "DDoS rate limit exceeded", DDOS_BAN_MS);
    stats.totalBlocked++;
    _recordOffense(ip);
    return res.status(429).json({
      error: "Too Many Requests",
      message: "Rate limit exceeded. Try again later.",
    });
  }

  next();
}

// ---------------------------------------------------------------------------
// 6. Security Stats
// ---------------------------------------------------------------------------
function getSecurityStats() {
  // Top offending IPs (sorted descending by offense count)
  const topOffenders = [...stats.ipOffenses.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([ip, count]) => ({ ip, count }));

  const blacklisted = ipBlacklist.getAll();

  return {
    totalBlocked: stats.totalBlocked,
    botDetectionTriggers: stats.botTriggers,
    currentlyBlacklistedCount: Object.keys(blacklisted).length,
    blacklistedIPs: blacklisted,
    topOffendingIPs: topOffenders,
  };
}

// ---------------------------------------------------------------------------
// Cleanup intervals (prevent memory leaks)
// ---------------------------------------------------------------------------
// Run every 5 minutes: prune expired blacklist entries, stale tracking maps
const CLEANUP_INTERVAL_MS = 5 * 60_000;

const _cleanupTimer = setInterval(() => {
  const now = Date.now();

  // Prune blacklist (getAll already prunes, but call explicitly)
  ipBlacklist.getAll();

  // Prune bot request log
  for (const [ip, timestamps] of _requestLog) {
    const cutoff = now - BOT_WINDOW_MS;
    while (timestamps.length && timestamps[0] < cutoff) timestamps.shift();
    if (!timestamps.length) _requestLog.delete(ip);
  }

  // Prune bot strikes older than 1 hour (implicit decay)
  // We keep strikes indefinitely for simplicity but cap the map size
  if (_botStrikes.size > 50_000) {
    _botStrikes.clear();
  }

  // Prune DDoS log
  for (const [ip, timestamps] of _ddosLog) {
    const cutoff = now - DDOS_WINDOW_MS;
    while (timestamps.length && timestamps[0] < cutoff) timestamps.shift();
    if (!timestamps.length) _ddosLog.delete(ip);
  }

  // Cap offense tracking
  if (stats.ipOffenses.size > 100_000) {
    // Keep only top 10k
    const sorted = [...stats.ipOffenses.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10_000);
    stats.ipOffenses.clear();
    for (const [ip, count] of sorted) stats.ipOffenses.set(ip, count);
  }
}, CLEANUP_INTERVAL_MS);

// Allow the process to exit cleanly without waiting for the timer
if (_cleanupTimer && typeof _cleanupTimer.unref === "function") {
  _cleanupTimer.unref();
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
module.exports = {
  botDetector,
  ipBlacklist,
  requestValidator,
  honeypot,
  ddosProtection,
  getSecurityStats,
};
