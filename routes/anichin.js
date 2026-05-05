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
    url: `${BASE}/anime/${ep.anime_slug || ep.anime?.slug || ''}/episode/${ep.number || ''}`,
    thumbnail: ep.thumbnail || ep.poster || '',
    video_url: ep.video_url || '',
    mirror_streams: ep.mirror_streams || [],
    download_urls: ep.download_urls || [],
    duration: ep.duration || '',
    release_date: ep.release_date || '',
    created_at: ep.created_at || ep.release_date || '',
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
// NOTE: Untuk daftar server/mirror gunakan /anime/:slug/episode/:number/servers
//       Untuk batch download gunakan /batch/:slug
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

    // --- Video URL: check multiple fields ---
    let videoUrl = episode.video_url || episode.iframe || episode.embed_url || '';

    // Fallback: extract iframe src from raw HTML if no video URL found
    if (!videoUrl) {
      const $ = cheerio.load(html);
      const iframeSrc = $('iframe[src]').first().attr('src');
      if (iframeSrc) {
        videoUrl = iframeSrc.startsWith('http') ? iframeSrc : absUrl(iframeSrc);
      }
    }

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
        video_url: videoUrl,
        duration: episode.duration || '',
        release_date: episode.release_date || '',
        navigation: { prev, next },
        anime_info: animeInfo,
        endpoints: {
          servers: `/api/anichin/anime/${slug}/episode/${number}/servers`,
          batch: `/api/anichin/batch/${slug}`,
        },
      },
    });
  } catch (e) {
    res.status(500).json({ status: false, message: e.message, creator: 'Gxyenn' });
  }
});

// ==================== SERVERS (Full Scraping) ====================
// Endpoint ini mengambil SEMUA server streaming, mirror, download URLs,
// quality levels, dan iframe URLs dari episode secara lengkap & maksimal.
router.get('/anime/:slug/episode/:number/servers', async (req, res) => {
  try {
    const { slug, number } = req.params;
    const url = `${BASE}/anime/${slug}/episode/${number}`;

    const html = await fetchPage(url, `${BASE}/anime/${slug}`);
    const inertia = extractInertia(html);

    if (!inertia || !inertia.props || !inertia.props.episode) {
      return res.status(404).json({
        status: false,
        message: `Server data unavailable for ${slug} episode ${number}`,
        creator: 'Gxyenn',
      });
    }

    const episode = inertia.props.episode;
    const $ = cheerio.load(html);

    // Helper: extract resolution (360p, 480p, 720p, 1080p) from any string
    function extractResolution(str) {
      if (!str) return 'Unknown';
      const m = str.match(/(\d{3,4})[pP]/);
      return m ? m[1] + 'p' : 'Unknown';
    }

    // Helper: extract file size from string like "Mp4 360p - ODFiles (41.3 MB)"
    function extractSize(str) {
      if (!str) return '';
      const m = str.match(/\(([^)]*[MG]B[^)]*)\)/i);
      return m ? m[1].trim() : '';
    }

    // Helper: extract server/host name from string
    function extractServerName(str) {
      if (!str) return '';
      // Remove resolution and size parts
      let name = str.replace(/\d{3,4}[pP]/g, '').replace(/\([^)]*\)/g, '').replace(/^Mp4\s*/i, '').replace(/^\s*-\s*/, '').replace(/\s*-\s*$/, '').trim();
      return name || str;
    }

    // ============ 1. COLLECT ALL SOURCES ============
    const streamServers = [];
    const downloadLinks = [];
    const byQuality = {};
    const seenUrls = new Set();

    function addEntry(entry, isDownload) {
      if (!entry.url || seenUrls.has(entry.url)) return;
      seenUrls.add(entry.url);

      if (isDownload) {
        downloadLinks.push(entry);
      } else {
        streamServers.push(entry);
      }

      const key = entry.quality || 'Unknown';
      if (!byQuality[key]) byQuality[key] = [];
      byQuality[key].push(entry);
    }

    // Source 1: episode.servers array
    if (Array.isArray(episode.servers)) {
      episode.servers.forEach(s => {
        const rawName = s.name || s.label || s.server || '';
        const serverUrl = s.url || s.src || s.embed || '';
        const quality = extractResolution(s.quality || s.resolution || rawName);
        const serverName = extractServerName(rawName);
        const isDownload = (s.type || 'stream').toLowerCase() === 'download';

        addEntry({
          name: serverName || rawName,
          url: serverUrl,
          quality,
          type: isDownload ? 'download' : 'stream',
        }, isDownload);
      });
    }

    // Source 2: mirror_streams
    let mirrorStreams = episode.mirror_streams || [];
    if (mirrorStreams && !Array.isArray(mirrorStreams) && typeof mirrorStreams === 'object') {
      mirrorStreams = Object.entries(mirrorStreams).map(([key, val]) => ({
        label: key,
        url: typeof val === 'string' ? val : (val && (val.url || val.src || val.embed)) || '',
        server: (val && val.server) || (val && val.name) || key,
      }));
    }
    if (Array.isArray(mirrorStreams)) {
      mirrorStreams.forEach(m => {
        const rawLabel = m.label || m.name || m.server || '';
        const mUrl = m.url || m.src || m.embed || '';
        if (!mUrl) return;
        const quality = extractResolution(m.quality || m.label || m.resolution || rawLabel);
        const serverName = extractServerName(rawLabel);

        addEntry({
          name: serverName || rawLabel,
          url: mUrl,
          quality,
          type: 'stream',
        }, false);
      });
    }

    // Source 3: download_urls
    let dlUrls = episode.download_urls || episode.downloads || [];
    if (dlUrls && !Array.isArray(dlUrls) && typeof dlUrls === 'object') {
      dlUrls = Object.entries(dlUrls).map(([key, val]) => ({
        label: key,
        url: typeof val === 'string' ? val : (val && (val.url || val.link)) || '',
        name: (val && val.name) || (val && val.host) || key,
        size: (val && val.size) || '',
      }));
    }
    if (Array.isArray(dlUrls)) {
      dlUrls.forEach(d => {
        const rawLabel = d.label || d.name || d.server || d.host || '';
        const dUrl = d.url || d.link || '';
        if (!dUrl) return;
        const quality = extractResolution(d.quality || d.label || d.resolution || rawLabel);
        const serverName = extractServerName(rawLabel);
        const size = d.size || extractSize(rawLabel);

        addEntry({
          name: serverName || rawLabel,
          url: dUrl,
          quality,
          type: 'download',
          size,
        }, true);
      });
    }

    // Source 4: episode.sources / episode.videos
    const extraSources = episode.sources || episode.videos || episode.embeds || [];
    if (Array.isArray(extraSources)) {
      extraSources.forEach(s => {
        const rawName = s.name || s.label || s.server || '';
        const sUrl = s.url || s.src || s.embed || '';
        if (!sUrl) return;
        const quality = extractResolution(s.quality || s.resolution || rawName);

        addEntry({
          name: extractServerName(rawName) || rawName,
          url: sUrl,
          quality,
          type: 'stream',
        }, false);
      });
    }

    // Source 5: Iframe / embed URL fallback
    const defaultIframe = episode.iframe || episode.embed_url || episode.video_url || '';
    if (defaultIframe) {
      addEntry({
        name: 'Default Player',
        url: defaultIframe,
        quality: 'Unknown',
        type: 'stream',
      }, false);
    }

    // Source 6: Extract iframes from raw HTML
    $('iframe[src]').each((i, el) => {
      const src = $(el).attr('src') || '';
      if (src && !src.includes('googleads') && !src.includes('facebook') && !src.includes('recaptcha')) {
        const iframeSrc = src.startsWith('http') ? src : absUrl(src);
        addEntry({
          name: `Iframe Player ${i + 1}`,
          url: iframeSrc,
          quality: 'Unknown',
          type: 'stream',
        }, false);
      }
    });

    // Source 7: video/source elements
    $('video source[src]').each((i, el) => {
      const src = $(el).attr('src') || '';
      const rawQuality = $(el).attr('label') || $(el).attr('data-quality') || $(el).attr('size') || '';
      if (src) {
        const quality = extractResolution(rawQuality);
        addEntry({
          name: `Direct Video ${rawQuality || i + 1}`,
          url: src.startsWith('http') ? src : absUrl(src),
          quality,
          type: 'stream',
        }, false);
      }
    });

    // ============ 2. SORT & GROUP BY QUALITY ============
    const qualityOrder = ['360p', '480p', '720p', '1080p', 'Unknown'];
    const sortedQualities = Object.keys(byQuality).sort((a, b) => {
      const idxA = qualityOrder.indexOf(a);
      const idxB = qualityOrder.indexOf(b);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      const numA = parseInt(a.replace('p', '')) || 0;
      const numB = parseInt(b.replace('p', '')) || 0;
      return numA - numB;
    });

    const grouped = {};
    sortedQualities.forEach(q => { grouped[q] = byQuality[q]; });

    // ============ 3. QUALITY SUMMARY ============
    const qualitySummary = sortedQualities
      .filter(q => q !== 'Unknown')
      .map(q => ({
        quality: q,
        totalStreaming: (byQuality[q] || []).filter(s => s.type === 'stream').length,
        totalDownload: (byQuality[q] || []).filter(s => s.type === 'download').length,
      }));

    res.json({
      status: true,
      creator: 'Gxyenn',
      data: {
        slug,
        episode: number,
        totalServers: streamServers.length,
        totalDownloads: downloadLinks.length,
        qualitySummary,
        servers: streamServers,
        downloads: downloadLinks,
        byQuality: grouped,
      },
    });
  } catch (e) {
    res.status(500).json({ status: false, message: e.message, creator: 'Gxyenn' });
  }
});

// ==================== BATCH DOWNLOAD (Full Scraping) ====================
// Endpoint ini mengambil SEMUA batch download links, termasuk dari halaman
// anime detail DAN halaman batch khusus, semua kualitas dan semua host.
router.get('/batch/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const url = `${BASE}/anime/${slug}`;

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
    const props = inertia.props;

    // ============ COLLECT ALL BATCH DOWNLOADS ============
    let allDownloads = [];

    // Source 1: anime.batch_downloads
    const src1 = anime.batch_downloads || null;
    if (src1) allDownloads.push({ source: 'anime.batch_downloads', data: src1 });

    // Source 2: props.batch
    const src2 = props.batch || null;
    if (src2) allDownloads.push({ source: 'props.batch', data: src2 });

    // Source 3: anime.downloads
    const src3 = anime.downloads || null;
    if (src3) allDownloads.push({ source: 'anime.downloads', data: src3 });

    // Source 4: props.downloads
    const src4 = props.downloads || null;
    if (src4) allDownloads.push({ source: 'props.downloads', data: src4 });

    // Source 5: anime.batch
    const src5 = anime.batch || null;
    if (src5) allDownloads.push({ source: 'anime.batch', data: src5 });

    // Source 6: Try fetching dedicated batch page
    const batchPages = [
      `${BASE}/anime/${slug}/batch`,
      `${BASE}/batch/${slug}`,
      `${BASE}/anime/${slug}/download`,
    ];
    for (const batchUrl of batchPages) {
      try {
        const batchHtml = await fetchPage(batchUrl, url);
        const batchInertia = extractInertia(batchHtml);
        if (batchInertia && batchInertia.props) {
          const bp = batchInertia.props;
          const candidates = [
            bp.batch_downloads,
            bp.batch,
            bp.downloads,
            bp.anime?.batch_downloads,
            bp.anime?.downloads,
            bp.anime?.batch,
            bp.links,
            bp.download_links,
          ].filter(Boolean);

          candidates.forEach(c => {
            allDownloads.push({ source: `batch_page:${batchUrl}`, data: c });
          });

          if (candidates.length) break; // Stop if we found data
        }

        // Also try scraping HTML directly (non-Inertia fallback)
        const $ = cheerio.load(batchHtml);
        const htmlLinks = [];
        $('a[href]').each((i, el) => {
          const href = $(el).attr('href') || '';
          const text = $(el).text().trim();
          if (href && text && !href.includes('javascript:') && !href.startsWith('#') &&
              (href.includes('download') || href.includes('dl.') || href.includes('drive') ||
               href.includes('mega') || href.includes('mediafire') || href.includes('zippyshare') ||
               href.includes('mp4') || href.includes('mkv'))) {
            htmlLinks.push({ name: text, url: href, quality: '', size: '' });
          }
        });
        if (htmlLinks.length) {
          allDownloads.push({ source: `html_scrape:${batchUrl}`, data: htmlLinks });
        }
      } catch (_) {
        // Page doesn't exist, continue
      }
    }

    // ============ NORMALIZE ALL DOWNLOADS ============
    const downloads = [];
    const seenUrls = new Set();

    function normalizeAndAdd(data) {
      if (Array.isArray(data)) {
        data.forEach(d => {
          const name = d.name || d.label || d.server || d.host || '';
          const dUrl = d.url || d.link || d.href || '';
          const quality = d.quality || d.resolution || '';
          const size = d.size || d.filesize || '';
          if (dUrl && !seenUrls.has(dUrl)) {
            seenUrls.add(dUrl);
            downloads.push({ name, url: dUrl, quality, size });
          }
        });
      } else if (data && typeof data === 'object') {
        // Quality-keyed: { "720p": "url", "1080p": { url, size } }
        Object.entries(data).forEach(([key, val]) => {
          if (typeof val === 'string') {
            if (!seenUrls.has(val)) {
              seenUrls.add(val);
              downloads.push({ name: key, url: val, quality: key, size: '' });
            }
          } else if (val && typeof val === 'object') {
            // Could be { url, size, name, ... } or array
            if (Array.isArray(val)) {
              val.forEach(v => {
                const vUrl = v.url || v.link || '';
                if (vUrl && !seenUrls.has(vUrl)) {
                  seenUrls.add(vUrl);
                  downloads.push({
                    name: v.name || v.label || v.host || key,
                    url: vUrl,
                    quality: v.quality || key,
                    size: v.size || '',
                  });
                }
              });
            } else {
              const vUrl = val.url || val.link || val.href || '';
              if (vUrl && !seenUrls.has(vUrl)) {
                seenUrls.add(vUrl);
                downloads.push({
                  name: val.name || val.label || val.host || key,
                  url: vUrl,
                  quality: val.quality || key,
                  size: val.size || '',
                });
              }
            }
          }
        });
      }
    }

    allDownloads.forEach(item => normalizeAndAdd(item.data));

    // ============ GROUP BY QUALITY ============
    const byQuality = {};
    downloads.forEach(dl => {
      const key = dl.quality || 'Unknown';
      if (!byQuality[key]) byQuality[key] = [];
      byQuality[key].push(dl);
    });

    // Sort quality keys
    const sortedQualities = Object.keys(byQuality).sort((a, b) => {
      if (a === 'Unknown' || !a) return 1;
      if (b === 'Unknown' || !b) return -1;
      const numA = parseInt(a.replace('p', '')) || 0;
      const numB = parseInt(b.replace('p', '')) || 0;
      return numA - numB;
    });

    const grouped = {};
    sortedQualities.forEach(q => { grouped[q] = byQuality[q]; });

    res.json({
      status: true,
      creator: 'Gxyenn',
      data: {
        title: anime.title || '',
        slug: anime.slug || slug,
        poster: anime.poster || '',
        total_episodes: anime.episodes_count || 0,
        batch_available: downloads.length > 0,
        totalQualities: sortedQualities.filter(q => q !== 'Unknown' && q !== '').length,
        totalDownloads: downloads.length,
        downloads,
        byQuality: grouped,
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
