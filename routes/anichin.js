const express = require('express');
const cheerio = require('cheerio');
const router = express.Router();
const { fetchPage, buildPagination, cache } = require('../lib/scraper');

const BASE = 'https://anichin.me';

// ==================== INERTIA DATA EXTRACTOR ====================
// Anichin uses Inertia.js SPA — all page data lives inside a
// <div data-page="..."> attribute as a JSON blob. There are ZERO
// <a> tags to scrape. Every route must parse this JSON.

function extractInertia(html) {
  if (!html) return null;
  const $ = cheerio.load(html);
  let data = null;
  $('[data-page]').each((i, el) => {
    try {
      data = JSON.parse($(el).attr('data-page'));
    } catch {}
  });
  return data; // { component, props, url, version, … }
}

// ==================== HELPERS ====================

/** Map a single anime object from Inertia to the API response shape */
function mapAnime(a) {
  return {
    id: a.id,
    title: a.title || '',
    slug: a.slug || '',
    poster: a.poster || '',
    rating: a.rating || '',
    synopsis: a.synopsis || '',
    status: a.status || '',
    type: a.type || '',
    episodes_count: a.episodes_count || 0,
    release_year: a.release_year || null,
    studio: a.studio || '',
    views_count: a.views_count || 0,
    genres: (a.genres || []).map(g => ({ id: g.id, name: g.name, slug: g.slug })),
    url: `${BASE}/anime/${a.slug || a.id}`,
  };
}

/** Map an episode object from Inertia to the API response shape */
function mapEpisode(ep) {
  return {
    id: ep.id,
    number: ep.number || '',
    title: ep.title || '',
    slug: ep.slug || '',
    url: `${BASE}/anime/${ep.anime_id || ''}/episode/${ep.number || ''}`,
    video_url: ep.video_url || '',
    mirror_streams: ep.mirror_streams || [],
    download_urls: ep.download_urls || [],
    duration: ep.duration || '',
    release_date: ep.release_date || '',
  };
}

/** Build pagination from Laravel pagination object */
function laravelPagination(laravelPage, currentQuery) {
  if (!laravelPage) {
    return buildPagination(1, 1, 0);
  }
  const pagination = buildPagination(
    laravelPage.current_page,
    laravelPage.last_page,
    laravelPage.total
  );
  pagination.next_page_url = laravelPage.next_page_url || null;
  pagination.prev_page_url = laravelPage.prev_page_url || null;
  pagination.per_page = laravelPage.per_page || null;
  pagination.from = laravelPage.from || null;
  pagination.to = laravelPage.to || null;
  return pagination;
}

/** Ensure absolute URL */
function absUrl(href) {
  if (!href) return '';
  return href.startsWith('http') ? href : BASE + (href.startsWith('/') ? '' : '/') + href;
}

/** Build resolutions array from mirror_streams + download_urls */
function buildResolutions(mirrorStreams, downloadUrls) {
  const resolutions = [];
  const seenQualities = new Set();

  // From mirror streams (streaming)
  (mirrorStreams || []).forEach(m => {
    const resMatch = (m.label || '').match(/(\d{3,4})[pP]/);
    if (resMatch) {
      const q = resMatch[1] + 'p';
      if (!seenQualities.has(q)) {
        seenQualities.add(q);
        resolutions.push({ quality: q, url: m.url, server: m.label });
      }
    }
  });

  // From download urls
  (downloadUrls || []).forEach(d => {
    const resMatch = (d.label || '').match(/(\d{3,4})[pP]/);
    if (resMatch) {
      const q = resMatch[1] + 'p';
      if (!seenQualities.has(q)) {
        seenQualities.add(q);
        resolutions.push({ quality: q, url: d.url, server: d.label });
      }
    }
  });

  // Sort ascending
  resolutions.sort((a, b) => {
    const getNum = q => parseInt((q.quality || '0').replace('p', '')) || 0;
    return getNum(a) - getNum(b);
  });

  return resolutions;
}

// ==================== HOME ====================
router.get('/home', async (req, res) => {
  try {
    const html = await fetchPage(BASE, BASE);
    const inertia = extractInertia(html);

    if (!inertia || !inertia.props) {
      return res.status(503).json({
        status: false,
        message: 'Failed to parse Inertia data from homepage',
        creator: 'Gxyenn',
      });
    }

    const props = inertia.props;

    // Featured / trending
    const featured = Array.isArray(props.featured) ? props.featured : [];
    const trending = featured.map(a => ({
      title: a.title || '',
      slug: a.slug || '',
      poster: a.poster || '',
      rating: a.rating || '',
      type: a.type || '',
      url: `${BASE}/anime/${a.slug || a.id}`,
    }));

    // Latest updates — each anime may contain its latest episode
    const latestRaw = Array.isArray(props.latestUpdates) ? props.latestUpdates : [];
    const latest = latestRaw.map(a => {
      const latestEp = Array.isArray(a.episodes) && a.episodes.length
        ? a.episodes[a.episodes.length - 1]
        : null;
      return {
        title: a.title || '',
        slug: a.slug || '',
        poster: a.poster || '',
        rating: a.rating || '',
        episode: latestEp ? `Episode ${latestEp.number}` : '',
        episode_url: latestEp ? `${BASE}/anime/${a.slug}/episode/${latestEp.number}` : '',
        url: `${BASE}/anime/${a.slug}`,
      };
    });

    // Popular — can be an array OR an object with category keys (All, Ongoing, Complete, Movie)
    let popular = [];
    if (Array.isArray(props.popular)) {
      popular = props.popular.map(a => ({
        title: a.title || '',
        slug: a.slug || '',
        poster: a.poster || '',
        rating: a.rating || '',
        type: a.type || '',
        status: a.status || '',
        url: `${BASE}/anime/${a.slug}`,
      }));
    } else if (props.popular && typeof props.popular === 'object') {
      // Object with categories: { All: [...], Ongoing: [...], ... }
      const popularObj = {};
      for (const [category, items] of Object.entries(props.popular)) {
        if (Array.isArray(items)) {
          popularObj[category] = items.map(a => ({
            title: a.title || '',
            slug: a.slug || '',
            poster: a.poster || '',
            rating: a.rating || '',
            type: a.type || '',
            status: a.status || '',
            url: `${BASE}/anime/${a.slug || a.id}`,
          }));
        }
      }
      // Flatten all categories into one array for backward compat, but also expose categorized
      popular = Object.values(popularObj).flat();
      // Add categorized popular as separate field
      res.locals.popularCategories = popularObj;
    }

    // Recommended
    const recommendedRaw = Array.isArray(props.recommended) ? props.recommended : [];
    const recommended = recommendedRaw.map(a => ({
      title: a.title || '',
      slug: a.slug || '',
      poster: a.poster || '',
      rating: a.rating || '',
      type: a.type || '',
      url: `${BASE}/anime/${a.slug || a.id}`,
    }));

    // Popular manga
    const popularMangaRaw = Array.isArray(props.popularManga) ? props.popularManga : [];
    const popularManga = popularMangaRaw.map(a => ({
      title: a.title || '',
      slug: a.slug || '',
      poster: a.poster || '',
    }));

    // Trending manga
    const trendingMangaRaw = Array.isArray(props.trendingManga) ? props.trendingManga : [];
    const trendingManga = trendingMangaRaw.map(a => ({
      title: a.title || '',
      slug: a.slug || '',
      poster: a.poster || '',
    }));

    const responseData = { trending, latest, popular, recommended, popularManga, trendingManga };
    if (res.locals.popularCategories) {
      responseData.popularByCategory = res.locals.popularCategories;
    }

    res.json({
      status: true,
      creator: 'Gxyenn',
      data: responseData,
    });
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
    const q = req.query.q || '';
    const genres = req.query.genres || '';

    let url = `${BASE}/explore?page=${page}`;
    if (sort) url += `&sort=${encodeURIComponent(sort)}`;
    if (letter) url += `&letter=${encodeURIComponent(letter)}`;
    if (status) url += `&status=${encodeURIComponent(status)}`;
    if (type) url += `&type=${encodeURIComponent(type)}`;
    if (q) url += `&q=${encodeURIComponent(q)}`;
    if (genres) url += `&genres=${encodeURIComponent(genres)}`;

    const html = await fetchPage(url, BASE);
    const inertia = extractInertia(html);

    if (!inertia || !inertia.props || !inertia.props.animes) {
      return res.status(503).json({
        status: false,
        message: 'Failed to parse Inertia data from explore page',
        creator: 'Gxyenn',
      });
    }

    const animesPage = inertia.props.animes;
    const results = (animesPage.data || []).map(mapAnime);

    res.json({
      status: true,
      creator: 'Gxyenn',
      pagination: laravelPagination(animesPage, req.query),
      filters: { sort, letter, status, type, q, genres },
      genres: inertia.props.genres || [],
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
    const page = parseInt(req.query.page) || 1;
    let url = `${BASE}/anime/${slug}`;
    if (page > 1) url += `?page=${page}`;

    const html = await fetchPage(url, BASE);
    const inertia = extractInertia(html);

    if (!inertia || !inertia.props || !inertia.props.anime) {
      return res.status(404).json({
        status: false,
        message: `Anime "${slug}" not found or Inertia data unavailable`,
        creator: 'Gxyenn',
      });
    }

    const anime = inertia.props.anime;

    // Episodes may be Laravel paginated or a plain array
    let episodesRaw = [];
    let episodePagination = null;
    if (anime.episodes) {
      if (anime.episodes.data) {
        episodesRaw = anime.episodes.data;
        episodePagination = laravelPagination(anime.episodes, req.query);
      } else if (Array.isArray(anime.episodes)) {
        episodesRaw = anime.episodes;
      }
    }

    const episodes = episodesRaw.map(ep => ({
      number: String(ep.number || ''),
      title: ep.title || '',
      slug: `${slug}/episode/${ep.number}`,
      url: `${BASE}/anime/${slug}/episode/${ep.number}`,
    }));

    res.json({
      status: true,
      creator: 'Gxyenn',
      data: {
        title: anime.title || '',
        slug: anime.slug || slug,
        poster: anime.poster || '',
        rating: anime.rating || '',
        synopsis: anime.synopsis || '',
        status: anime.status || '',
        type: anime.type || '',
        studio: anime.studio || '',
        release_year: anime.release_year || null,
        episodes_count: anime.episodes_count || 0,
        genres: (anime.genres || []).map(g => ({ id: g.id, name: g.name, slug: g.slug })),
        totalEpisodes: episodes.length,
        episodes,
        ...(episodePagination ? { episodePagination } : {}),
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

    const html = await fetchPage(url, `${BASE}/anime/${slug}`);
    const inertia = extractInertia(html);

    if (!inertia || !inertia.props) {
      return res.status(404).json({
        status: false,
        message: `Episode data unavailable for ${slug} episode ${number}`,
        creator: 'Gxyenn',
      });
    }

    const { episode, anime, allEpisodes } = inertia.props;

    if (!episode) {
      return res.status(404).json({
        status: false,
        message: `Episode ${number} not found`,
        creator: 'Gxyenn',
      });
    }

    const mirrorStreams = episode.mirror_streams || [];
    const downloadUrls = episode.download_urls || [];
    const resolutions = buildResolutions(mirrorStreams, downloadUrls);

    // Navigation: prev / next episode from allEpisodes list
    let prev = null;
    let next = null;
    if (Array.isArray(allEpisodes)) {
      const idx = allEpisodes.findIndex(
        e => String(e.number) === String(number) || e.id === episode.id
      );
      if (idx > 0) {
        const p = allEpisodes[idx - 1];
        prev = {
          number: p.number,
          title: p.title,
          url: `${BASE}/anime/${slug}/episode/${p.number}`,
        };
      }
      if (idx >= 0 && idx < allEpisodes.length - 1) {
        const n = allEpisodes[idx + 1];
        next = {
          number: n.number,
          title: n.title,
          url: `${BASE}/anime/${slug}/episode/${n.number}`,
        };
      }
    }

    // Anime info summary
    const animeInfo = anime
      ? {
          title: anime.title || '',
          slug: anime.slug || slug,
          poster: anime.poster || '',
          rating: anime.rating || '',
          status: anime.status || '',
          type: anime.type || '',
          studio: anime.studio || '',
          genres: (anime.genres || []).map(g => ({ id: g.id, name: g.name, slug: g.slug })),
        }
      : null;

    res.json({
      status: true,
      creator: 'Gxyenn',
      data: {
        title: episode.title || `${anime?.title || slug} Episode ${number}`,
        slug,
        episode: episode.number || number,
        video_url: episode.video_url || '',
        mirror_streams: mirrorStreams,
        download_urls: downloadUrls,
        resolutions,
        duration: episode.duration || '',
        release_date: episode.release_date || '',
        navigation: { prev, next },
        anime_info: animeInfo,
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
    if (!q) {
      return res.status(400).json({
        status: false,
        message: 'Parameter q is required',
        creator: 'Gxyenn',
      });
    }

    const page = parseInt(req.query.page) || 1;
    const url = `${BASE}/explore?q=${encodeURIComponent(q)}&page=${page}`;

    const html = await fetchPage(url, BASE);
    const inertia = extractInertia(html);

    if (!inertia || !inertia.props || !inertia.props.animes) {
      return res.status(503).json({
        status: false,
        message: 'Failed to parse search results',
        creator: 'Gxyenn',
      });
    }

    const animesPage = inertia.props.animes;
    const results = (animesPage.data || []).map(mapAnime);

    res.json({
      status: true,
      creator: 'Gxyenn',
      query: q,
      pagination: laravelPagination(animesPage, req.query),
      data: results,
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

    const html = await fetchPage(url, BASE);
    const inertia = extractInertia(html);

    if (!inertia || !inertia.props || !inertia.props.animes) {
      return res.status(503).json({
        status: false,
        message: 'Failed to parse movies data',
        creator: 'Gxyenn',
      });
    }

    const animesPage = inertia.props.animes;
    const results = (animesPage.data || []).map(a => ({
      ...mapAnime(a),
      type: 'Movie',
    }));

    res.json({
      status: true,
      creator: 'Gxyenn',
      pagination: laravelPagination(animesPage, req.query),
      data: results,
    });
  } catch (e) {
    res.status(500).json({ status: false, message: e.message, creator: 'Gxyenn' });
  }
});

// ==================== ONGOING ====================
router.get('/ongoing', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const url = `${BASE}/explore?status=Ongoing&page=${page}`;

    const html = await fetchPage(url, BASE);
    const inertia = extractInertia(html);

    if (!inertia || !inertia.props || !inertia.props.animes) {
      return res.status(503).json({
        status: false,
        message: 'Failed to parse ongoing anime data',
        creator: 'Gxyenn',
      });
    }

    const animesPage = inertia.props.animes;
    const results = (animesPage.data || []).map(a => ({
      ...mapAnime(a),
      status: 'Ongoing',
    }));

    res.json({
      status: true,
      creator: 'Gxyenn',
      pagination: laravelPagination(animesPage, req.query),
      data: results,
    });
  } catch (e) {
    res.status(500).json({ status: false, message: e.message, creator: 'Gxyenn' });
  }
});

// ==================== COMPLETED ====================
router.get('/completed', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const url = `${BASE}/explore?status=Completed&page=${page}`;

    const html = await fetchPage(url, BASE);
    const inertia = extractInertia(html);

    if (!inertia || !inertia.props || !inertia.props.animes) {
      return res.status(503).json({
        status: false,
        message: 'Failed to parse completed anime data',
        creator: 'Gxyenn',
      });
    }

    const animesPage = inertia.props.animes;
    const results = (animesPage.data || []).map(a => ({
      ...mapAnime(a),
      status: 'Completed',
    }));

    res.json({
      status: true,
      creator: 'Gxyenn',
      pagination: laravelPagination(animesPage, req.query),
      data: results,
    });
  } catch (e) {
    res.status(500).json({ status: false, message: e.message, creator: 'Gxyenn' });
  }
});

// ==================== GENRES ====================
router.get('/genres', async (req, res) => {
  try {
    // Anichin has no /genres page — extract genres from /explore props
    const html = await fetchPage(`${BASE}/explore`, BASE);
    const inertia = extractInertia(html);

    if (!inertia || !inertia.props || !inertia.props.genres) {
      return res.status(503).json({
        status: false,
        message: 'Failed to extract genres from explore page',
        creator: 'Gxyenn',
      });
    }

    const genres = inertia.props.genres.map(g => ({
      id: g.id,
      name: g.name,
      slug: g.slug,
      url: `${BASE}/genre/${g.slug}`,
    }));

    res.json({
      status: true,
      creator: 'Gxyenn',
      total: genres.length,
      data: genres,
    });
  } catch (e) {
    res.status(500).json({ status: false, message: e.message, creator: 'Gxyenn' });
  }
});

// ==================== GENRE DETAIL ====================
router.get('/genre/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const page = parseInt(req.query.page) || 1;

    // Try /explore?genres=slug first
    let url = `${BASE}/explore?genres=${encodeURIComponent(slug)}&page=${page}`;

    const html = await fetchPage(url, BASE);
    const inertia = extractInertia(html);

    if (!inertia || !inertia.props || !inertia.props.animes) {
      // Fallback: try /explore and filter client-side
      const fallbackHtml = await fetchPage(`${BASE}/explore`, BASE);
      const fallbackInertia = extractInertia(fallbackHtml);

      if (!fallbackInertia || !fallbackInertia.props) {
        return res.status(404).json({
          status: false,
          message: `Genre "${slug}" not found`,
          creator: 'Gxyenn',
        });
      }

      // Client-side filter from all explore results
      const allAnimes = fallbackInertia.props.animes?.data || [];
      const filtered = allAnimes.filter(a =>
        (a.genres || []).some(g => String(g.slug) === String(slug) || String(g.name).toLowerCase() === slug.toLowerCase())
      );

      if (filtered.length === 0) {
        return res.status(404).json({
          status: false,
          message: `No anime found for genre "${slug}"`,
          creator: 'Gxyenn',
        });
      }

      return res.json({
        status: true,
        creator: 'Gxyenn',
        genre: slug,
        pagination: buildPagination(1, 1, filtered.length),
        data: filtered.map(mapAnime),
      });
    }

    const animesPage = inertia.props.animes;
    const results = (animesPage.data || []).map(mapAnime);

    res.json({
      status: true,
      creator: 'Gxyenn',
      genre: slug,
      pagination: laravelPagination(animesPage, req.query),
      data: results,
    });
  } catch (e) {
    res.status(500).json({ status: false, message: e.message, creator: 'Gxyenn' });
  }
});

// ==================== SEASONS ====================
router.get('/seasons', async (req, res) => {
  try {
    // Anichin has no /seasons page.
    // Extract what we can from the explore page and return helpful info.
    const html = await fetchPage(`${BASE}/explore`, BASE);
    const inertia = extractInertia(html);

    // Derive unique years from the anime data as a proxy for seasons
    const animes = inertia?.props?.animes?.data || [];
    const yearsSet = new Set();
    animes.forEach(a => {
      if (a.release_year) yearsSet.add(a.release_year);
    });
    const years = [...yearsSet].sort((a, b) => b - a);

    res.json({
      status: true,
      creator: 'Gxyenn',
      message: 'Anichin does not have a dedicated seasons page. Use /explore with filters instead.',
      total: years.length,
      data: years.map(y => ({
        name: `Anime ${y}`,
        slug: String(y),
        url: `${BASE}/season/${y}`,
      })),
    });
  } catch (e) {
    res.status(500).json({ status: false, message: e.message, creator: 'Gxyenn' });
  }
});

// ==================== SEASON DETAIL ====================
router.get('/season/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const page = parseInt(req.query.page) || 1;

    // Anichin has no /season/:slug page. Try /explore with season filter.
    // The slug could be a year like "2024" or a season name like "winter-2024"
    let url = `${BASE}/explore?season=${encodeURIComponent(slug)}&page=${page}`;

    const html = await fetchPage(url, BASE);
    const inertia = extractInertia(html);

    if (!inertia || !inertia.props || !inertia.props.animes) {
      // Fallback: fetch explore and filter by release_year if slug is numeric
      const exploreUrl = `${BASE}/explore?page=${page}`;
      const exploreHtml = await fetchPage(exploreUrl, BASE);
      const exploreInertia = extractInertia(exploreHtml);

      if (!exploreInertia || !exploreInertia.props) {
        return res.status(404).json({
          status: false,
          message: `Season "${slug}" not available on Anichin`,
          creator: 'Gxyenn',
        });
      }

      const allAnimes = exploreInertia.props.animes?.data || [];

      // Try filtering by release_year if slug is a number
      const year = parseInt(slug);
      const filtered = year
        ? allAnimes.filter(a => a.release_year === year)
        : [];

      if (filtered.length === 0) {
        return res.json({
          status: true,
          creator: 'Gxyenn',
          season: slug,
          message: 'Anichin does not have a dedicated season page. Showing empty results.',
          pagination: buildPagination(1, 1, 0),
          data: [],
        });
      }

      return res.json({
        status: true,
        creator: 'Gxyenn',
        season: slug,
        pagination: buildPagination(1, 1, filtered.length),
        data: filtered.map(mapAnime),
      });
    }

    const animesPage = inertia.props.animes;
    const results = (animesPage.data || []).map(mapAnime);

    res.json({
      status: true,
      creator: 'Gxyenn',
      season: slug,
      pagination: laravelPagination(animesPage, req.query),
      data: results,
    });
  } catch (e) {
    res.status(500).json({ status: false, message: e.message, creator: 'Gxyenn' });
  }
});

// ==================== SCHEDULE ====================
router.get('/schedule', async (req, res) => {
  // Anichin does not have a /schedule page.
  // Return a helpful message instead of a 404.
  res.json({
    status: true,
    creator: 'Gxyenn',
    message: 'Anichin does not have a dedicated schedule page. Use /explore?status=Ongoing to see currently airing anime.',
    data: [],
  });
});

module.exports = router;
