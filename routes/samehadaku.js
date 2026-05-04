const express = require('express');
const cheerio = require('cheerio');
const router = express.Router();
const { fetchPage, buildPagination, extractPagination, extractVideoData } = require('../lib/scraper');

const BASE = 'https://samehadaku.li';

// Helper: Extract anime slug (NOT episode slug) from element
function extractAnimeSlug($, el, baseUrl) {
  const a = $(el).find('.bsx a, a').first();
  const href = a.attr('href') || '';
  // Remove base URL and clean
  let slug = href.replace(baseUrl, '').replace(/^\/|\/$/g, '');
  // If it's an episode link, extract anime slug
  if (slug.includes('/')) {
    slug = slug.split('/')[0];
  }
  return slug;
}

// Helper: Get full poster URL
function getPoster(img) {
  return img.attr('src') || img.attr('data-lazy-src') || img.attr('data-src') || '';
}

// ==================== HOME ====================
router.get('/home', async (req, res) => {
  try {
    const html = await fetchPage(BASE);
    const $ = cheerio.load(html);

    const latest = [];
    $('.listupd .bs').each((i, el) => {
      const a = $(el).find('.bsx a');
      const img = $(el).find('img');
      const epx = $(el).find('.bt .epx');
      const rating = $(el).find('.rating .numscore');
      const type = $(el).find('.bt .typez');

      // FIXED: Use anime slug, not episode slug
      const href = a.attr('href') || '';
      let slug = href.replace(BASE, '').replace(/^\/|\/$/g, '');
      // Remove 'anime/' prefix if exists and get clean slug
      slug = slug.replace(/^anime\//, '').split('/')[0];

      latest.push({
        title: a.attr('title') || img.attr('alt') || '',
        slug: slug,
        url: href,
        poster: getPoster(img),
        episode: epx.text().trim(),
        rating: rating.text().trim(),
        type: type.text().trim(),
      });
    });

    const popular = [];
    $('.serieslist.pop li').each((i, el) => {
      const a = $(el).find('.leftseries h2 a');
      const img = $(el).find('img');
      const rating = $(el).find('.rating .numscore');
      const genres = [];
      $(el).find('.leftseries .genreseries a').each((j, g) => genres.push($(g).text().trim()));

      const href = a.attr('href') || '';
      let slug = href.replace(BASE, '').replace(/^\/|\/$/g, '').replace(/^anime\//, '');

      popular.push({
        rank: i + 1,
        title: a.text().trim(),
        slug: slug,
        url: href,
        poster: getPoster(img),
        rating: rating.text().trim(),
        genres,
      });
    });

    res.json({ status: true, creator: 'Gxyenn', data: { latest, popular } });
  } catch (e) {
    res.status(500).json({ status: false, message: e.message, creator: 'Gxyenn' });
  }
});

// ==================== RECENT ====================
router.get('/recent', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const url = page > 1 ? `${BASE}/page/${page}/` : BASE;
    const html = await fetchPage(url);
    const $ = cheerio.load(html);

    const results = [];
    $('.listupd .bs').each((i, el) => {
      const a = $(el).find('.bsx a');
      const img = $(el).find('img');
      const epx = $(el).find('.bt .epx');
      const rating = $(el).find('.rating .numscore');

      const href = a.attr('href') || '';
      let slug = href.replace(BASE, '').replace(/^\/|\/$/g, '').replace(/^anime\//, '');

      results.push({
        title: a.attr('title') || img.attr('alt') || '',
        slug: slug,
        url: href,
        poster: getPoster(img),
        episode: epx.text().trim(),
        rating: rating.text().trim(),
      });
    });

    // FIXED: Proper pagination extraction
    const pagination = extractPagination($, page, BASE);

    res.json({
      status: true,
      creator: 'Gxyenn',
      pagination,
      data: results,
    });
  } catch (e) {
    res.status(500).json({ status: false, message: e.message, creator: 'Gxyenn' });
  }
});

// ==================== SEARCH ====================
router.get('/search', async (req, res) => {
  try {
    const q = req.query.q;
    if (!q) return res.status(400).json({ status: false, message: 'Parameter q required', creator: 'Gxyenn' });

    const page = parseInt(req.query.page) || 1;
    const url = page > 1 
      ? `${BASE}/page/${page}/?s=${encodeURIComponent(q)}` 
      : `${BASE}/?s=${encodeURIComponent(q)}`;

    const html = await fetchPage(url);
    const $ = cheerio.load(html);

    const results = [];
    $('.listupd .bs').each((i, el) => {
      const a = $(el).find('.bsx a');
      const img = $(el).find('img');
      const type = $(el).find('.bt .typez');
      const rating = $(el).find('.rating .numscore');

      const href = a.attr('href') || '';
      let slug = href.replace(BASE, '').replace(/^\/|\/$/g, '').replace(/^anime\//, '');

      results.push({
        title: a.attr('title') || img.attr('alt') || '',
        slug: slug,
        url: href,
        poster: getPoster(img),
        type: type.text().trim(),
        rating: rating.text().trim(),
      });
    });

    const pagination = extractPagination($, page, BASE);

    res.json({
      status: true,
      creator: 'Gxyenn',
      query: q,
      pagination,
      data: results,
    });
  } catch (e) {
    res.status(500).json({ status: false, message: e.message, creator: 'Gxyenn' });
  }
});

// ==================== ANIME DETAIL ====================
router.get('/anime/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const url = `${BASE}/anime/${slug}/`;
    const html = await fetchPage(url);
    const $ = cheerio.load(html);

    const title = $('h1.entry-title').text().trim();
    const poster = $('.thumb img').attr('src') || $('.thumb img').attr('data-lazy-src') || '';
    const rating = $('[itemprop="ratingValue"]').text().trim();
    const synopsis = $('.entry-content p').first().text().trim();

    const info = {};
    $('.spe span').each((i, el) => {
      const text = $(el).text().trim();
      const parts = text.split(':');
      if (parts.length >= 2) {
        const key = parts[0].trim().toLowerCase().replace(/\s+/g, '_');
        info[key] = parts.slice(1).join(':').trim();
      }
    });

    const genres = [];
    $('.genxed a').each((i, el) => {
      const genreName = $(el).text().trim();
      const genreSlug = ($(el).attr('href') || '').split('/genres/')[1]?.replace(/\//g, '') || '';
      genres.push({ name: genreName, slug: genreSlug });
    });

    // FIXED: Episode list with proper slugs
    const episodes = [];
    $('.eplister ul li').each((i, el) => {
      const a = $(el).find('a');
      const num = $(el).find('.epl-num').text().trim();
      const epTitle = $(el).find('.epl-title').text().trim();
      const sub = $(el).find('.epl-sub span').text().trim();
      const date = $(el).find('.epl-date').text().trim();
      const href = a.attr('href') || '';

      // Extract episode slug
      let epSlug = href.replace(BASE + '/', '').replace(/^\/|\/$/g, '');

      episodes.push({ 
        number: num, 
        title: epTitle, 
        sub, 
        date, 
        slug: epSlug, 
        url: href 
      });
    });

    res.json({
      status: true,
      creator: 'Gxyenn',
      data: { 
        title, 
        slug, 
        poster, 
        rating, 
        synopsis, 
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
router.get('/episode/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const url = `${BASE}/${slug}/`;
    const html = await fetchPage(url);
    const $ = cheerio.load(html);

    const title = $('h1.entry-title').text().trim();
    const prevEp = $('.naveps .nvs.l a').attr('href') || '';
    const nextEp = $('.naveps .nvs.r a').attr('href') || '';

    // FIXED: Extract video data with iframe and resolutions
    const videoData = extractVideoData($);

    // Enhanced server extraction with resolution parsing
    const servers = [];
    $('select.mirror option').each((i, el) => {
      const val = $(el).attr('value');
      const name = $(el).text().trim();
      if (val && name && name !== '- Select Server -') {
        // Extract resolution from server name
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

    // FIXED: Extract all resolutions with iframe URLs
    const resolutions = [];
    const seenQualities = new Set();

    // From servers
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

    // From download links
    const downloads = [];
    $('.mctnx .soraddl').each((i, el) => {
      const quality = $(el).find('.sorattl h3').text().trim();
      const links = [];
      $(el).find('.soraurl a').each((j, a) => {
        links.push({ host: $(a).text().trim(), url: $(a).attr('href') || '' });
      });
      if (quality || links.length) {
        downloads.push({ quality, links });
        // Add to resolutions if quality matches pattern
        const resMatch = quality.match(/(\d{3,4})[pP]/);
        if (resMatch) {
          const q = resMatch[1] + 'p';
          if (!seenQualities.has(q)) {
            seenQualities.add(q);
            resolutions.push({ quality: q, download: links });
          }
        }
      }
    });

    // Sort resolutions: 360p, 480p, 720p, 1080p
    resolutions.sort((a, b) => {
      const getNum = (q) => parseInt(q.replace('p', '')) || 0;
      return getNum(a.quality) - getNum(b.quality);
    });

    const animeInfo = {};
    $('.infox .spe span').each((i, el) => {
      const text = $(el).text().trim();
      const parts = text.split(':');
      if (parts.length >= 2) {
        animeInfo[parts[0].trim().toLowerCase().replace(/\s+/g, '_')] = parts.slice(1).join(':').trim();
      }
    });

    // Get current anime slug for navigation
    let currentAnimeSlug = '';
    const animeLink = $('.naveps .nvs a[href*="/anime/"]').attr('href') || '';
    if (animeLink) {
      currentAnimeSlug = animeLink.replace(BASE + '/anime/', '').replace(/\//g, '');
    }

    res.json({
      status: true,
      creator: 'Gxyenn',
      data: {
        title, 
        slug,
        animeSlug: currentAnimeSlug,
        navigation: {
          prev: prevEp ? prevEp.replace(BASE + '/', '').replace(/^\/|\/$/g, '') : null,
          next: nextEp ? nextEp.replace(BASE + '/', '').replace(/^\/|\/$/g, '') : null,
        },
        iframe: videoData.iframeUrl,
        servers,
        resolutions,
        downloads,
        animeInfo,
      },
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

    $('ul.genre li a, .genre-item a, a[href*="/genres/"]').each((i, el) => {
      const name = $(el).text().trim();
      const href = $(el).attr('href') || '';
      const slug = href.split('/genres/')[1]?.replace(/^\/|\/$/g, '') || '';
      if (name && slug && !genres.find(g => g.slug === slug)) {
        genres.push({ name, slug });
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
    const url = page > 1 
      ? `${BASE}/genres/${slug}/page/${page}/` 
      : `${BASE}/genres/${slug}/`;

    const html = await fetchPage(url);
    const $ = cheerio.load(html);

    const results = [];
    $('.listupd .bs').each((i, el) => {
      const a = $(el).find('.bsx a');
      const img = $(el).find('img');
      const type = $(el).find('.bt .typez');
      const rating = $(el).find('.rating .numscore');

      const href = a.attr('href') || '';
      let animeSlug = href.replace(BASE, '').replace(/^\/|\/$/g, '').replace(/^anime\//, '');

      results.push({
        title: a.attr('title') || img.attr('alt') || '',
        slug: animeSlug,
        url: href,
        poster: getPoster(img),
        type: type.text().trim(),
        rating: rating.text().trim(),
      });
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

// ==================== A-Z LIST ====================
router.get('/az-list', async (req, res) => {
  try {
    const letter = req.query.letter || '';
    const page = parseInt(req.query.page) || 1;
    let url = `${BASE}/az-list/`;
    if (letter) url += `?show=${encodeURIComponent(letter)}`;
    if (page > 1) url += (letter ? '&' : '?') + `page=${page}`;

    const html = await fetchPage(url);
    const $ = cheerio.load(html);

    const results = [];
    $('.listupd .bs, .soralist ul li').each((i, el) => {
      const a = $(el).find('a').first();
      const href = a.attr('href') || '';
      let slug = href.replace(BASE, '').replace(/^\/|\/$/g, '').replace(/^anime\//, '');

      results.push({
        title: a.text().trim() || a.attr('title') || '',
        slug: slug,
        url: href,
      });
    });

    const pagination = extractPagination($, page, BASE);

    res.json({ 
      status: true, 
      creator: 'Gxyenn', 
      letter: letter || 'all', 
      pagination,
      data: results 
    });
  } catch (e) {
    res.status(500).json({ status: false, message: e.message, creator: 'Gxyenn' });
  }
});

// ==================== POPULAR ====================
router.get('/popular', async (req, res) => {
  try {
    const html = await fetchPage(BASE);
    const $ = cheerio.load(html);
    const results = [];

    $('.serieslist.pop li, .wpop-items .wpop-item').each((i, el) => {
      const a = $(el).find('a').first();
      const img = $(el).find('img');
      const rating = $(el).find('.numscore, .rating').text().trim();
      const views = $(el).find('.view, .count').text().trim();

      const href = a.attr('href') || '';
      let slug = href.replace(BASE, '').replace(/^\/|\/$/g, '').replace(/^anime\//, '');

      results.push({
        rank: i + 1,
        title: a.text().trim() || a.attr('title') || '',
        slug: slug,
        url: href,
        poster: getPoster(img),
        rating, 
        views,
      });
    });

    res.json({ status: true, creator: 'Gxyenn', data: results });
  } catch (e) {
    res.status(500).json({ status: false, message: e.message, creator: 'Gxyenn' });
  }
});

// ==================== ANIME LIST (with filters) ====================
router.get('/anime-list', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const status = req.query.status || '';
    const type = req.query.type || '';
    const order = req.query.order || 'update';

    let url = `${BASE}/anime/?status=${status}&type=${type}&order=${order}`;
    if (page > 1) url += `&page=${page}`;

    const html = await fetchPage(url);
    const $ = cheerio.load(html);

    const results = [];
    $('.listupd .bs').each((i, el) => {
      const a = $(el).find('.bsx a');
      const img = $(el).find('img');
      const type = $(el).find('.bt .typez');
      const rating = $(el).find('.rating .numscore');

      const href = a.attr('href') || '';
      let slug = href.replace(BASE, '').replace(/^\/|\/$/g, '').replace(/^anime\//, '');

      results.push({
        title: a.attr('title') || img.attr('alt') || '',
        slug: slug,
        url: href,
        poster: getPoster(img),
        type: type.text().trim(),
        rating: rating.text().trim(),
      });
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

module.exports = router;
