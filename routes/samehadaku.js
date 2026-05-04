const express = require('express');
const cheerio = require('cheerio');
const router = express.Router();
const { fetchPage, buildPagination, extractPagination, extractVideoData } = require('../lib/scraper');

const BASE = 'https://samehadaku.li';

// Helper: Get full poster URL
function getPoster(img) {
  return img.attr('src') || img.attr('data-lazy-src') || img.attr('data-src') || '';
}

// Helper: Clean slug from href — returns episode-style slug (full path segment)
function cleanSlug(href) {
  let slug = href.replace(BASE, '').replace(/^\/|\/$/g, '');
  slug = slug.replace(/^anime\//, '').split('/')[0];
  return slug;
}

// Helper: Extract ANIME slug from any URL (episode or anime page)
// Episode URL: /anime-name-episode-N-subtitle-indonesia/ → anime-name
// Anime URL:   /anime/anime-name/                        → anime-name
function cleanAnimeSlug(href) {
  if (!href) return '';
  let path = href.replace(BASE, '').replace(/^\/|\/$/g, '');

  // If it's an /anime/ URL, extract directly
  if (path.startsWith('anime/')) {
    return path.replace(/^anime\//, '').split('/')[0];
  }

  // Episode URL pattern: {anime-slug}-episode-{N}[-subtitle-indonesia]
  const epMatch = path.match(/^(.+?)-episode-\d+/);
  if (epMatch) {
    return epMatch[1];
  }

  // Batch/movie pattern: {anime-slug}-batch[-subtitle-indonesia]
  const batchMatch = path.match(/^(.+?)-batch/);
  if (batchMatch) {
    return batchMatch[1];
  }

  // Subtitle pattern without episode: {anime-slug}-subtitle-indonesia
  const subMatch = path.match(/^(.+?)-subtitle-indonesia$/);
  if (subMatch) {
    return subMatch[1];
  }

  // Fallback: return as-is (first path segment)
  return path.split('/')[0];
}

// ==================== HOME ====================
router.get('/home', async (req, res) => {
  try {
    const html = await fetchPage(BASE, BASE);
    const $ = cheerio.load(html);

    const latest = [];
    $('.listupd .bs').each((i, el) => {
      const a = $(el).find('.bsx a');
      const img = $(el).find('img');
      const epx = $(el).find('.bt .epx');
      const rating = $(el).find('.rating .numscore');
      const type = $(el).find('.bt .typez');

      const href = a.attr('href') || '';
      const animeSlug = cleanAnimeSlug(href);
      const episodeSlug = cleanSlug(href);

      latest.push({
        title: (a.attr('title') || img.attr('alt') || '').replace(/\s*Subtitle Indonesia$/i, '').replace(/\s*Episode\s*\d+.*$/i, '').trim(),
        slug: animeSlug,
        episodeSlug,
        url: href,
        animeUrl: `${BASE}/anime/${animeSlug}/`,
        poster: getPoster(img),
        episode: epx.text().trim(),
        rating: rating.text().trim(),
        type: type.text().trim(),
      });
    });

    const popular = [];
    $('.serieslist.pop li').each((i, el) => {
      // Title link: try h4 first (actual structure), then h2, h3, or any .series link
      const a = $(el).find('.leftseries h4 a').first().length
        ? $(el).find('.leftseries h4 a').first()
        : $(el).find('.leftseries h2 a, .leftseries h3 a, .leftseries a.series').first().length
          ? $(el).find('.leftseries h2 a, .leftseries h3 a, .leftseries a.series').first()
          : $(el).find('a[href*="/anime/"]').first();
      const img = $(el).find('img');
      const rating = $(el).find('.rating .numscore').text().trim() ||
                     $(el).find('.numscore').text().trim();
      const genres = [];
      $(el).find('.leftseries .genreseries a, .leftseries span a[href*="/genres/"], .leftseries .genre a').each((j, g) => genres.push($(g).text().trim()));

      const href = a.attr('href') || '';
      const slug = cleanAnimeSlug(href);
      const title = a.text().trim() || img.attr('title') || img.attr('alt') || '';

      if (slug) {
        popular.push({
          rank: i + 1,
          title,
          slug,
          url: href,
          poster: getPoster(img),
          rating,
          genres,
        });
      }
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
    const html = await fetchPage(url, BASE);
    const $ = cheerio.load(html);

    const results = [];
    $('.listupd .bs').each((i, el) => {
      const a = $(el).find('.bsx a');
      const img = $(el).find('img');
      const epx = $(el).find('.bt .epx');
      const rating = $(el).find('.rating .numscore');

      const href = a.attr('href') || '';
      const animeSlug = cleanAnimeSlug(href);
      const episodeSlug = cleanSlug(href);

      results.push({
        title: (a.attr('title') || img.attr('alt') || '').replace(/\s*Subtitle Indonesia$/i, '').replace(/\s*Episode\s*\d+.*$/i, '').trim(),
        slug: animeSlug,
        episodeSlug,
        url: href,
        animeUrl: `${BASE}/anime/${animeSlug}/`,
        poster: getPoster(img),
        episode: epx.text().trim(),
        rating: rating.text().trim(),
      });
    });

    const pagination = extractPagination($, page, BASE);
    pagination.totalItems = results.length > 0 ? results.length : null;

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
    if (!q) return res.status(400).json({ status: false, message: 'Parameter q wajib diisi', creator: 'Gxyenn' });

    const page = parseInt(req.query.page) || 1;
    const url = page > 1
      ? `${BASE}/page/${page}/?s=${encodeURIComponent(q)}`
      : `${BASE}/?s=${encodeURIComponent(q)}`;

    let html = await fetchPage(url, BASE);
    let $ = cheerio.load(html);

    const results = [];

    // Try primary selector: .listupd .bs
    $('.listupd .bs').each((i, el) => {
      const a = $(el).find('.bsx a');
      const img = $(el).find('img');
      const type = $(el).find('.bt .typez');
      const rating = $(el).find('.rating .numscore');

      const href = a.attr('href') || '';
      const slug = cleanAnimeSlug(href);

      results.push({
        title: (a.attr('title') || img.attr('alt') || '').replace(/\s*Subtitle Indonesia$/i, '').trim(),
        slug,
        url: href,
        poster: getPoster(img),
        type: type.text().trim(),
        rating: rating.text().trim(),
      });
    });

    // Fallback selectors if primary returns nothing
    if (results.length === 0) {
      // Try alternative page selectors
      $('article.post, .page-item, .result-item, .post-item, .hentry').each((i, el) => {
        const a = $(el).find('a').first();
        const img = $(el).find('img').first();
        const href = a.attr('href') || '';
        const slug = cleanAnimeSlug(href);
        const title = a.text().trim() || a.attr('title') || img.attr('alt') || '';
        if (title && slug) {
          results.push({
            title,
            slug,
            url: href,
            poster: getPoster(img),
            type: '',
            rating: '',
          });
        }
      });
    }

    // Fallback: WordPress REST API if no results from page scraping
    if (results.length === 0 && page === 1) {
      try {
        const apiRaw = await fetchPage(
          `${BASE}/wp-json/wp/v2/posts?search=${encodeURIComponent(q)}&per_page=20`,
          BASE
        );
        const apiData = JSON.parse(apiRaw);
        if (Array.isArray(apiData)) {
          apiData.forEach((post) => {
            // Extract featured image
            let poster = '';
            if (post.featured_media && post._embedded && post._embedded['wp:featuredmedia']) {
              const media = post._embedded['wp:featuredmedia'][0];
              poster = media.source_url || '';
            }
            // Try to extract slug from link
            const postSlug = cleanAnimeSlug(post.link || '');
            results.push({
              title: post.title?.rendered ? $(post.title.rendered).text().trim() : '',
              slug: postSlug,
              url: post.link || '',
              poster,
              type: '',
              rating: '',
            });
          });
        }
      } catch {
        // REST API not available, silently continue with empty results
      }
    }

    const pagination = extractPagination($, page, BASE);

    res.json({
      status: true,
      creator: 'Gxyenn',
      query: q,
      totalResults: results.length,
      pagination,
      data: results,
    });
  } catch (e) {
    res.status(500).json({ status: false, message: `Gagal mencari: ${e.message}`, creator: 'Gxyenn' });
  }
});

// ==================== ANIME DETAIL ====================
router.get('/anime/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const url = `${BASE}/anime/${slug}/`;
    const html = await fetchPage(url, BASE);
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

    // Episode list with proper slugs
    const episodes = [];
    $('.eplister ul li').each((i, el) => {
      const a = $(el).find('a');
      const num = $(el).find('.epl-num').text().trim();
      const epTitle = $(el).find('.epl-title').text().trim();
      const sub = $(el).find('.epl-sub span').text().trim();
      const date = $(el).find('.epl-date').text().trim();
      const href = a.attr('href') || '';

      let epSlug = href.replace(BASE + '/', '').replace(/^\/|\/$/g, '');

      episodes.push({
        number: num,
        title: epTitle,
        sub,
        date,
        slug: epSlug,
        url: href,
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
        episodes,
      },
    });
  } catch (e) {
    res.status(500).json({ status: false, message: e.message, creator: 'Gxyenn' });
  }
});

// ==================== EPISODE / WATCH ====================
// Gunakan wildcard untuk menangkap slug dengan subpath
router.get('/episode/*', async (req, res) => {
  try {
    // Ambil full slug dari wildcard params
    const slug = req.params[0] || req.params.slug || '';
    if (!slug) {
      return res.status(400).json({ status: false, message: 'Episode slug required', creator: 'Gxyenn' });
    }

    const url = `${BASE}/${slug}/`;
    const html = await fetchPage(url, BASE);
    const $ = cheerio.load(html);

    const title = $('h1.entry-title').text().trim();
    const prevEp = $('.naveps .nvs.l a').attr('href') || '';
    const nextEp = $('.naveps .nvs.r a').attr('href') || '';

    // Extract video data (iframe & resolutions)
    const videoData = extractVideoData($);

    // Enhanced server extraction with resolution parsing
    const servers = [];
    $('select.mirror option').each((i, el) => {
      const val = $(el).attr('value');
      const name = $(el).text().trim();
      if (val && name && name !== '- Select Server -') {
        const resMatch = name.match(/(\d{3,4})[pP]/);
        const resolution = resMatch ? resMatch[1] + 'p' : 'Unknown';

        servers.push({
          name,
          value: val,
          resolution,
          type: name.toLowerCase().includes('download') ? 'download' : 'stream',
        });
      }
    });

    // Collect all resolutions
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
    $('.mctnx .soraddl').each((i, el) => {
      const quality = $(el).find('.sorattl h3').text().trim();
      const links = [];
      $(el).find('.soraurl a').each((j, a) => {
        links.push({ host: $(a).text().trim(), url: $(a).attr('href') || '' });
      });
      if (quality || links.length) {
        downloads.push({ quality, links });
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
    // Fetch dedicated genres page, fallback to homepage
    let html;
    try {
      html = await fetchPage(`${BASE}/genres/`, BASE);
    } catch {
      html = await fetchPage(BASE, BASE);
    }
    const $ = cheerio.load(html);
    const genres = [];

    // Multiple selectors for genre detection
    $('ul.genre li a, .genre-item a, a[href*="/genres/"], .tax_lst a').each((i, el) => {
      const name = $(el).text().trim();
      const href = $(el).attr('href') || '';
      const slug = href.split('/genres/')[1]?.replace(/^\/|\/$/g, '') || '';
      if (name && slug && !genres.find(g => g.slug === slug)) {
        genres.push({ name, slug, url: href });
      }
    });

    res.json({ status: true, creator: 'Gxyenn', total: genres.length, data: genres });
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

    const html = await fetchPage(url, `${BASE}/genres/`);
    const $ = cheerio.load(html);

    const results = [];
    $('.listupd .bs').each((i, el) => {
      const a = $(el).find('.bsx a');
      const img = $(el).find('img');
      const type = $(el).find('.bt .typez');
      const rating = $(el).find('.rating .numscore');

      const href = a.attr('href') || '';
      const animeSlug = cleanAnimeSlug(href);

      results.push({
        title: (a.attr('title') || img.attr('alt') || '').replace(/\s*Subtitle Indonesia$/i, '').trim(),
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
      data: results,
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

    const html = await fetchPage(url, BASE);
    const $ = cheerio.load(html);

    const results = [];
    // Multiple selectors for different AZ list layouts
    $('.listupd .bs').each((i, el) => {
      const a = $(el).find('.bsx a');
      const img = $(el).find('img');
      const href = a.attr('href') || '';
      const slug = cleanAnimeSlug(href);
      const title = (a.attr('title') || img.attr('alt') || '').replace(/\s*Subtitle Indonesia$/i, '').trim();

      if (title && slug) {
        results.push({
          title,
          slug,
          url: href,
          poster: getPoster(img),
        });
      }
    });

    // Fallback: soralist, azlist, listanime
    if (results.length === 0) {
      $('.soralist ul li, .azlist .item, .listanime a').each((i, el) => {
        const a = $(el).is('a') ? $(el) : $(el).find('a').first();
        const href = a.attr('href') || '';
        const slug = cleanAnimeSlug(href);
        const title = a.text().trim() || a.attr('title') || '';

        if (title && slug) {
          results.push({
            title,
            slug,
            url: href,
          });
        }
      });
    }

    const pagination = extractPagination($, page, BASE);

    res.json({
      status: true,
      creator: 'Gxyenn',
      letter: letter || 'all',
      pagination,
      data: results,
    });
  } catch (e) {
    res.status(500).json({ status: false, message: e.message, creator: 'Gxyenn' });
  }
});

// ==================== POPULAR ====================
router.get('/popular', async (req, res) => {
  try {
    const period = req.query.period || 'weekly';
    // Try dedicated popular page first, fallback to homepage sidebar
    let html;
    let fromDedicated = false;
    try {
      html = await fetchPage(`${BASE}/popular/`, BASE);
      // Verify the page actually loaded (not a 404/error page)
      const $check = cheerio.load(html);
      if ($check('.listupd .bs, .popularpage .bs').length > 0) {
        fromDedicated = true;
      } else {
        // Dedicated page exists but has no results — fall back to homepage
        html = await fetchPage(BASE, BASE);
      }
    } catch {
      html = await fetchPage(BASE, BASE);
    }
    const $ = cheerio.load(html);
    const results = [];

    const selectors = fromDedicated
      ? '.listupd .bs, .popularpage .bs'
      : '.serieslist.pop li, .wpop-items .wpop-item';

    $(selectors).each((i, el) => {
      let a, title, img, rating, views;

      if (fromDedicated) {
        // Dedicated popular page layout
        a = $(el).find('.bsx a, a').first();
        img = $(el).find('img');
        rating = $(el).find('.numscore, .rating .numscore').text().trim();
        views = $(el).find('.view, .count').text().trim();
        title = a.attr('title') || img.attr('alt') || a.text().trim();
      } else {
        // Sidebar widget layout — title is inside nested heading (h4 or h2/h3)
        a = $(el).find('.leftseries h4 a').first().length
          ? $(el).find('.leftseries h4 a').first()
          : $(el).find('.leftseries h2 a, .leftseries h3 a, .leftseries a.series, a[href*="/anime/"]').first();
        img = $(el).find('img');
        rating = $(el).find('.numscore, .rating').text().trim();
        views = $(el).find('.view, .count').text().trim();
        title = a.text().trim() || a.attr('title') || img.attr('title') || img.attr('alt') || '';
      }

      const href = a.attr('href') || '';
      const slug = cleanAnimeSlug(href);

      if (title && slug) {
        results.push({
          rank: i + 1,
          title,
          slug,
          url: href,
          poster: getPoster(img),
          rating,
          views,
        });
      }
    });

    // Additional fallback: if still no results from sidebar selectors, try broader selectors
    if (results.length === 0) {
      $('.listupd .bs, .bsx, article.post, .post-item').each((i, el) => {
        const a = $(el).find('a').first();
        const img = $(el).find('img');
        const href = a.attr('href') || '';
        const slug = cleanAnimeSlug(href);
        const title = a.attr('title') || img.attr('alt') || a.text().trim();
        if (title && slug && !results.find(r => r.slug === slug)) {
          results.push({
            rank: results.length + 1,
            title,
            slug,
            url: href,
            poster: getPoster(img),
            rating: '',
            views: '',
          });
        }
      });
    }

    res.json({ status: true, creator: 'Gxyenn', period, totalResults: results.length, data: results });
  } catch (e) {
    res.status(500).json({ status: false, message: `Gagal memuat popular: ${e.message}`, creator: 'Gxyenn' });
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

    const html = await fetchPage(url, BASE);
    const $ = cheerio.load(html);

    const results = [];
    $('.listupd .bs').each((i, el) => {
      const a = $(el).find('.bsx a');
      const img = $(el).find('img');
      const typeEl = $(el).find('.bt .typez');
      const rating = $(el).find('.rating .numscore');

      const href = a.attr('href') || '';
      const slug = cleanAnimeSlug(href);

      results.push({
        title: (a.attr('title') || img.attr('alt') || '').replace(/\s*Subtitle Indonesia$/i, '').trim(),
        slug,
        url: href,
        poster: getPoster(img),
        type: typeEl.text().trim(),
        rating: rating.text().trim(),
      });
    });

    const pagination = extractPagination($, page, BASE);

    res.json({
      status: true,
      creator: 'Gxyenn',
      filters: { status, type, order },
      pagination,
      data: results,
    });
  } catch (e) {
    res.status(500).json({ status: false, message: e.message, creator: 'Gxyenn' });
  }
});

// ==================== SCHEDULE (Samehadaku) ====================
router.get('/schedule', async (req, res) => {
  try {
    const html = await fetchPage(`${BASE}/jadwal-rilis/`, BASE);
    const $ = cheerio.load(html);
    const schedule = {};

    // Method 1: Tab-based schedule (tema baru)
    $('.schedulepage .tab-content, .schedule-tabs .tab-content').each((i, el) => {
      const dayHeader = $(el).prev('.schedule-header, h3, .tab-title, .day-title').text().trim() ||
                       $(el).find('.schedule-header, h3, .day-title').first().text().trim() ||
                       $(el).attr('id') || `Hari ${i + 1}`;

      const items = [];
      $(el).find('li, .bs, .bsx, .schedule-item').each((j, li) => {
        const a = $(li).find('a').first();
        const img = $(li).find('img');
        const time = $(li).find('.schedule-time, time, .jam, [class*="time"]').text().trim();
        const episode = $(li).find('.epl-num, .episode, [class*="ep"]').text().trim();

        const href = a.attr('href') || '';
        const slug = cleanSlug(href);

        if (a.text().trim() || a.attr('title')) {
          items.push({
            title: a.text().trim() || a.attr('title') || '',
            slug,
            url: href,
            poster: getPoster(img),
            time,
            episode,
          });
        }
      });

      if (items.length) schedule[dayHeader] = items;
    });

    // Method 2: Widget-based schedule (fallback)
    if (!Object.keys(schedule).length) {
      $('.schedule-widget .day-schedule, .widget-schedule, [class*="schedule"] [class*="day"]').each((i, el) => {
        const day = $(el).find('h3, h4, .day-name, [class*="day"]').first().text().trim() || `Hari ${i + 1}`;
        const items = [];

        $(el).find('li, .item, .bs, .bsx').each((j, li) => {
          const a = $(li).find('a').first();
          const img = $(li).find('img');
          const time = $(li).find('.schedule-time, time, .jam').text().trim();
          const href = a.attr('href') || '';

          if (a.text().trim() || a.attr('title')) {
            items.push({
              title: a.text().trim() || a.attr('title') || '',
              slug: cleanSlug(href),
              url: href,
              poster: getPoster(img),
              time,
            });
          }
        });

        if (items.length) schedule[day] = items;
      });
    }

    res.json({
      status: true,
      creator: 'Gxyenn',
      source: 'samehadaku',
      totalDays: Object.keys(schedule).length,
      data: schedule,
    });
  } catch (e) {
    // Schedule page may not exist — return graceful message instead of error
    res.status(200).json({
      status: true,
      creator: 'Gxyenn',
      source: 'samehadaku',
      totalDays: 0,
      message: 'Jadwal rilis tidak tersedia saat ini. Halaman jadwal mungkin telah dihapus atau dipindahkan.',
      data: {},
    });
  }
});

module.exports = router;
