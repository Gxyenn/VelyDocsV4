const express = require('express');
const cheerio = require('cheerio');
const router = express.Router();
const { fetchPage, buildPagination, extractPagination, extractVideoData } = require('../lib/scraper');

const BASE = 'https://anichin.me';

// Helper: Ambil poster URL lengkap
function getPoster(img) {
  return img.attr('src') || img.attr('data-src') || img.attr('data-lazy-src') || '';
}

// Helper: Bersihkan slug anime (bukan episode)
function cleanSlug(href, baseUrl) {
  let slug = href.replace(baseUrl, '').replace(/^\/|\/$/g, '');
  slug = slug.replace(/^anime\//, '');
  // Ambil bagian pertama saja (slug anime, bukan episode)
  return slug.split('/')[0];
}

// ==================== HOME ====================
router.get('/home', async (req, res) => {
  try {
    const html = await fetchPage(BASE);
    const $ = cheerio.load(html);
    const trending = [];
    const latest = [];

    // Trending section
    $('[class*="trending"] .item, .trending-item, .swiper-slide, .trending-slide').each((i, el) => {
      const a = $(el).find('a').first();
      const img = $(el).find('img');
      const title = $(el).find('.title, h3, h2').text().trim() || a.attr('title') || img.attr('alt') || '';
      const href = a.attr('href') || '';
      if (title) {
        trending.push({
          title,
          slug: cleanSlug(href, BASE),
          url: href.startsWith('http') ? href : BASE + href,
          poster: getPoster(img),
        });
      }
    });

    // Latest episodes
    $('[class*="latest"] .item, .latest-episode .item, .episode-list .item, .listupd .bs, [class*="update"] .item').each((i, el) => {
      const a = $(el).find('a').first();
      const img = $(el).find('img');
      const title = $(el).find('.title, h3, .tt, h2').text().trim() || a.attr('title') || img.attr('alt') || '';
      const ep = $(el).find('.episode, .ep, .epx, [class*="ep"]').text().trim();
      const href = a.attr('href') || '';
      if (title) {
        latest.push({
          title,
          slug: cleanSlug(href, BASE),
          url: href.startsWith('http') ? href : BASE + href,
          poster: getPoster(img),
          episode: ep,
        });
      }
    });

    res.json({ status: true, creator: 'Gxyenn', data: { trending, latest } });
  } catch (e) {
    res.status(500).json({ status: false, message: e.message, creator: 'Gxyenn' });
  }
});

// ==================== EXPLORE / DAFTAR ANIME ====================
router.get('/explore', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const sort = req.query.sort || '';
    const letter = req.query.letter || '';
    const status = req.query.status || '';
    const type = req.query.type || '';

    let url = `${BASE}/explore?page=${page}`;
    if (sort) url += `&sort=${sort}`;
    if (letter) url += `&letter=${letter}`;
    if (status) url += `&status=${status}`;
    if (type) url += `&type=${type}`;

    const html = await fetchPage(url);
    const $ = cheerio.load(html);
    const results = [];

    // Coba multiple selector untuk kompatibilitas tema
    $('.anime-card, .item, .bs, [class*="card"], .anime-item, .series-item').each((i, el) => {
      const a = $(el).find('a').first();
      const img = $(el).find('img');
      const title = $(el).find('.title, h3, h2, .tt, [class*="title"]').text().trim() || a.attr('title') || img.attr('alt') || '';
      const rating = $(el).find('.rating, .score, .numscore, [class*="rating"]').text().trim();
      const type = $(el).find('.type, .typez, [class*="type"]').text().trim();
      const status = $(el).find('.status, [class*="status"]').text().trim();
      const href = a.attr('href') || '';

      if (title) {
        results.push({
          title,
          slug: cleanSlug(href, BASE),
          url: href.startsWith('http') ? href : BASE + href,
          poster: getPoster(img),
          rating,
          type,
          status,
        });
      }
    });

    // PERBAIKAN: Pagination yang benar
    const pagination = extractPagination($, page, BASE);

    res.json({ 
      status: true, 
      creator: 'Gxyenn', 
      pagination, 
      filters: { sort, letter, status, type },
      data: results 
    });
  } catch (e) {
    res.status(500).json({ status: false, message: e.message, creator: 'Gxyenn' });
  }
});

// ==================== ANIME DETAIL ====================
router.get('/anime/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const url = `${BASE}/anime/${slug}`;
    const html = await fetchPage(url);
    const $ = cheerio.load(html);

    const title = $('h1, .title, .entry-title, [class*="title"]').first().text().trim();
    const poster = $('.poster img, .thumb img, .cover img, [class*="poster"] img, [class*="cover"] img').first().attr('src') || '';
    const rating = $('[class*="rating"] span, .score, [itemprop="ratingValue"], [class*="score"]').first().text().trim();
    const synopsis = $('[class*="synopsis"], [class*="description"], .entry-content p, [class*="sinopsis"], [class*="summary"]').first().text().trim();

    const info = {};
    $('[class*="info"] span, [class*="detail"] span, .spe span, [class*="meta"] span, [class*="data"] span').each((i, el) => {
      const text = $(el).text().trim();
      const parts = text.split(':');
      if (parts.length >= 2) {
        info[parts[0].trim().toLowerCase().replace(/\s+/g, '_')] = parts.slice(1).join(':').trim();
      }
    });

    const genres = [];
    $('[class*="genre"] a, .genxed a, [class*="tag"] a').each((i, el) => {
      const name = $(el).text().trim();
      const href = $(el).attr('href') || '';
      const slug = href.split('/genres/')[1]?.replace(/^\/|\/$/g, '') || '';
      if (name) genres.push({ name, slug, url: href });
    });

    // Episode list
    const episodes = [];
    $('[class*="episode"] a, .eplister li a, [class*="ep-list"] a, [class*="episode-list"] a').each((i, el) => {
      const epTitle = $(el).text().trim();
      const href = $(el).attr('href') || '';
      const num = href.match(/episode\/(\d+)/)?.[1] || epTitle.match(/(\d+)/)?.[1] || '';

      let epSlug = href.replace(BASE, '').replace(/^\/|\/$/g, '');

      episodes.push({
        number: num,
        title: epTitle,
        slug: epSlug,
        url: href.startsWith('http') ? href : BASE + href,
      });
    });

    // Ongoing / Completed status
    const animeStatus = $('[class*="status"], .status').first().text().trim() || info.status || '';

    res.json({
      status: true,
      creator: 'Gxyenn',
      data: { 
        title, 
        slug, 
        poster, 
        rating, 
        synopsis, 
        status: animeStatus,
        info, 
        genres, 
        totalEpisodes: episodes.length, 
        episodes 
      },
    });
  } catch (e) {
    res.status(500).json({ status: false, message: e.message, creator: 'Gxyenn' });
  }
});

// ==================== EPISODE / WATCH ====================
router.get('/anime/:slug/episode/:number', async (req, res) => {
  try {
    const { slug, number } = req.params;
    const url = `${BASE}/anime/${slug}/episode/${number}`;
    const html = await fetchPage(url);
    const $ = cheerio.load(html);

    const title = $('h1, .title, .entry-title, [class*="title"]').first().text().trim();

    // PERBAIKAN: Ekstrak video data dengan iframe & resolusi
    const videoData = extractVideoData($);

    // Servers dengan resolusi
    const servers = [];
    $('select option, [class*="server"] button, [class*="server"] a, .mirror option, [class*="mirror"] option').each((i, el) => {
      const name = $(el).text().trim();
      const val = $(el).attr('value') || $(el).attr('data-src') || $(el).attr('href') || '';
      if (name && val && !name.toLowerCase().includes('select') && name !== 'Select Server') {
        const resMatch = name.match(/(\d{3,4})[pP]/);
        const resolution = resMatch ? resMatch[1] + 'p' : 'Unknown';

        servers.push({ 
          name, 
          value: val,
          resolution,
          type: name.toLowerCase().includes('download') ? 'download' : 'stream'
        });
      }
    });

    // Resolusi lengkap
    const resolutions = [];
    const seenQualities = new Set();

    servers.forEach(server => {
      if (server.resolution && server.resolution !== 'Unknown') {
        if (!seenQualities.has(server.resolution)) {
          seenQualities.add(server.resolution);
          resolutions.push({
            quality: server.resolution,
            iframe: server.value,
            server: server.name,
          });
        }
      }
    });

    // Download links
    const downloads = [];
    $('[class*="download"] a, .soraddl a, [class*="ddl"] a').each((i, el) => {
      const host = $(el).text().trim();
      const href = $(el).attr('href') || '';
      if (host && href) {
        downloads.push({ host, url: href });
        const resMatch = host.match(/(\d{3,4})[pP]/);
        if (resMatch) {
          const q = resMatch[1] + 'p';
          if (!seenQualities.has(q)) {
            seenQualities.add(q);
            resolutions.push({ quality: q, download: [{ host, url: href }] });
          }
        }
      }
    });

    // Urutkan resolusi: 360p, 480p, 720p, 1080p
    resolutions.sort((a, b) => {
      const getNum = (q) => parseInt(q.replace('p', '')) || 0;
      return getNum(a.quality) - getNum(b.quality);
    });

    // Navigation
    const prevLink = $('a[class*="prev"], .prev a, a:contains("Previous"), [class*="prev"] a').attr('href') || '';
    const nextLink = $('a[class*="next"], .next a, a:contains("Next"), [class*="next"] a').attr('href') || '';

    res.json({
      status: true,
      creator: 'Gxyenn',
      data: {
        title, 
        slug, 
        episode: number,
        iframe: videoData.iframeUrl,
        navigation: {
          prev: prevLink ? (prevLink.startsWith('http') ? prevLink : BASE + prevLink) : null,
          next: nextLink ? (nextLink.startsWith('http') ? nextLink : BASE + nextLink) : null,
        },
        servers,
        resolutions,
        downloads,
      },
    });
  } catch (e) {
    res.status(500).json({ status: false, message: e.message, creator: 'Gxyenn' });
  }
});

// ==================== SEARCH ====================
router.get('/search', async (req, res) => {
  try {
    const q = req.query.q;
    if (!q) return res.status(400).json({ status: false, message: 'Parameter q wajib diisi', creator: 'Gxyenn' });

    const page = parseInt(req.query.page) || 1;
    const url = `${BASE}/explore?q=${encodeURIComponent(q)}&page=${page}`;

    const html = await fetchPage(url);
    const $ = cheerio.load(html);
    const results = [];

    $('.anime-card, .item, .bs, [class*="card"], .anime-item').each((i, el) => {
      const a = $(el).find('a').first();
      const img = $(el).find('img');
      const title = $(el).find('.title, h3, h2, .tt, [class*="title"]').text().trim() || a.attr('title') || img.attr('alt') || '';
      const href = a.attr('href') || '';

      if (title) {
        results.push({
          title,
          slug: cleanSlug(href, BASE),
          url: href.startsWith('http') ? href : BASE + href,
          poster: getPoster(img),
        });
      }
    });

    const pagination = extractPagination($, page, BASE);

    res.json({ 
      status: true, 
      creator: 'Gxyenn', 
      query: q, 
      pagination, 
      data: results 
    });
  } catch (e) {
    res.status(500).json({ status: false, message: e.message, creator: 'Gxyenn' });
  }
});

// ==================== MOVIES ====================
router.get('/movies', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const url = `${BASE}/movies?page=${page}`;

    const html = await fetchPage(url);
    const $ = cheerio.load(html);
    const results = [];

    $('.anime-card, .item, .bs, [class*="card"], .anime-item').each((i, el) => {
      const a = $(el).find('a').first();
      const img = $(el).find('img');
      const title = $(el).find('.title, h3, h2, .tt, [class*="title"]').text().trim() || a.attr('title') || img.attr('alt') || '';
      const href = a.attr('href') || '';

      if (title) {
        results.push({
          title,
          slug: cleanSlug(href, BASE),
          url: href.startsWith('http') ? href : BASE + href,
          poster: getPoster(img),
        });
      }
    });

    const pagination = extractPagination($, page, BASE);

    res.json({ 
      status: true, 
      creator: 'Gxyenn', 
      pagination, 
      data: results 
    });
  } catch (e) {
    res.status(500).json({ status: false, message: e.message, creator: 'Gxyenn' });
  }
});

// ==================== ONGOING ====================
router.get('/ongoing', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const url = `${BASE}/ongoing?page=${page}`;

    const html = await fetchPage(url);
    const $ = cheerio.load(html);
    const results = [];

    $('.anime-card, .item, .bs, [class*="card"], .anime-item').each((i, el) => {
      const a = $(el).find('a').first();
      const img = $(el).find('img');
      const title = $(el).find('.title, h3, h2, .tt').text().trim() || a.attr('title') || img.attr('alt') || '';
      const href = a.attr('href') || '';

      if (title) {
        results.push({
          title,
          slug: cleanSlug(href, BASE),
          url: href.startsWith('http') ? href : BASE + href,
          poster: getPoster(img),
        });
      }
    });

    const pagination = extractPagination($, page, BASE);

    res.json({ 
      status: true, 
      creator: 'Gxyenn', 
      pagination, 
      data: results 
    });
  } catch (e) {
    res.status(500).json({ status: false, message: e.message, creator: 'Gxyenn' });
  }
});

// ==================== COMPLETED ====================
router.get('/completed', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const url = `${BASE}/completed?page=${page}`;

    const html = await fetchPage(url);
    const $ = cheerio.load(html);
    const results = [];

    $('.anime-card, .item, .bs, [class*="card"], .anime-item').each((i, el) => {
      const a = $(el).find('a').first();
      const img = $(el).find('img');
      const title = $(el).find('.title, h3, h2, .tt').text().trim() || a.attr('title') || img.attr('alt') || '';
      const href = a.attr('href') || '';

      if (title) {
        results.push({
          title,
          slug: cleanSlug(href, BASE),
          url: href.startsWith('http') ? href : BASE + href,
          poster: getPoster(img),
        });
      }
    });

    const pagination = extractPagination($, page, BASE);

    res.json({ 
      status: true, 
      creator: 'Gxyenn', 
      pagination, 
      data: results 
    });
  } catch (e) {
    res.status(500).json({ status: false, message: e.message, creator: 'Gxyenn' });
  }
});

// ==================== GENRES ====================
router.get('/genres', async (req, res) => {
  try {
    const html = await fetchPage(BASE);
    const $ = cheerio.load(html);
    const genres = [];

    $('a[href*="/genres/"], [class*="genre"] a').each((i, el) => {
      const name = $(el).text().trim();
      const href = $(el).attr('href') || '';
      const slug = href.split('/genres/')[1]?.replace(/^\/|\/$/g, '') || '';
      if (name && slug && !genres.find(g => g.slug === slug)) {
        genres.push({ name, slug, url: href });
      }
    });

    res.json({ status: true, creator: 'Gxyenn', data: genres });
  } catch (e) {
    res.status(500).json({ status: false, message: e.message, creator: 'Gxyenn' });
  }
});

// ==================== GENRE DETAIL ====================
router.get('/genre/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const page = parseInt(req.query.page) || 1;
    const url = `${BASE}/genres/${slug}?page=${page}`;

    const html = await fetchPage(url);
    const $ = cheerio.load(html);
    const results = [];

    $('.anime-card, .item, .bs, [class*="card"], .anime-item').each((i, el) => {
      const a = $(el).find('a').first();
      const img = $(el).find('img');
      const title = $(el).find('.title, h3, h2, .tt').text().trim() || a.attr('title') || img.attr('alt') || '';
      const href = a.attr('href') || '';

      if (title) {
        results.push({
          title,
          slug: cleanSlug(href, BASE),
          url: href.startsWith('http') ? href : BASE + href,
          poster: getPoster(img),
        });
      }
    });

    const pagination = extractPagination($, page, BASE);

    res.json({ 
      status: true, 
      creator: 'Gxyenn', 
      genre: slug, 
      pagination, 
      data: results 
    });
  } catch (e) {
    res.status(500).json({ status: false, message: e.message, creator: 'Gxyenn' });
  }
});

// ==================== SEASONS ====================
router.get('/seasons', async (req, res) => {
  try {
    const html = await fetchPage(BASE);
    const $ = cheerio.load(html);
    const seasons = [];

    $('a[href*="/season/"], a[href*="/seasons/"], [class*="season"] a').each((i, el) => {
      const name = $(el).text().trim();
      const href = $(el).attr('href') || '';
      const slug = href.split('/season/')[1]?.replace(/^\/|\/$/g, '') || 
                   href.split('/seasons/')[1]?.replace(/^\/|\/$/g, '') || '';
      if (name && slug && !seasons.find(s => s.slug === slug)) {
        seasons.push({ name, slug, url: href });
      }
    });

    res.json({ status: true, creator: 'Gxyenn', data: seasons });
  } catch (e) {
    res.status(500).json({ status: false, message: e.message, creator: 'Gxyenn' });
  }
});

// ==================== SEASON DETAIL ====================
router.get('/season/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const page = parseInt(req.query.page) || 1;
    const url = `${BASE}/season/${slug}?page=${page}`;

    const html = await fetchPage(url);
    const $ = cheerio.load(html);
    const results = [];

    $('.anime-card, .item, .bs, [class*="card"], .anime-item').each((i, el) => {
      const a = $(el).find('a').first();
      const img = $(el).find('img');
      const title = $(el).find('.title, h3, h2, .tt').text().trim() || a.attr('title') || img.attr('alt') || '';
      const href = a.attr('href') || '';

      if (title) {
        results.push({
          title,
          slug: cleanSlug(href, BASE),
          url: href.startsWith('http') ? href : BASE + href,
          poster: getPoster(img),
        });
      }
    });

    const pagination = extractPagination($, page, BASE);

    res.json({ 
      status: true, 
      creator: 'Gxyenn', 
      season: slug, 
      pagination, 
      data: results 
    });
  } catch (e) {
    res.status(500).json({ status: false, message: e.message, creator: 'Gxyenn' });
  }
});

module.exports = router;
