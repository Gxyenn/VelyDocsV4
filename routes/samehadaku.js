const express = require('express');
const cheerio = require('cheerio');
const router = express.Router();
const { fetchPage, buildPagination, extractPagination, extractVideoData } = require('../lib/scraper');

const BASE = 'https://samehadaku.li';

// Helper: Get full poster URL
function getPoster(img) {
  return img.attr('src') || img.attr('data-lazy-src') || img.attr('data-src') || '';
}

// Helper: Decode base64 mirror value to extract iframe src
function decodeMirrorValue(val) {
  if (!val) return null;
  try {
    const decoded = Buffer.from(val, 'base64').toString('utf-8');
    const match = decoded.match(/src=["']([^"']+)["']/i);
    return match ? match[1] : null;
  } catch {
    // Not base64, try as direct URL
    if (val.startsWith('http')) return val;
    return null;
  }
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
// NOTE: Untuk daftar server/mirror gunakan /servers/:episodeSlug
//       Untuk batch download gunakan /batch/:slug
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

    // Extract default iframe URL
    const videoData = extractVideoData($);
    let iframeUrl = videoData.iframeUrl || null;

    // Try decoding the first mirror option if no iframe found
    if (!iframeUrl) {
      $('select.mirror option').each((i, el) => {
        if (iframeUrl) return;
        const val = $(el).attr('value');
        const name = $(el).text().trim();
        if (val && name && name !== '- Select Server -') {
          const decoded = decodeMirrorValue(val);
          if (decoded) iframeUrl = decoded;
        }
      });
    }

    // Fallback: try additional iframe selectors
    if (!iframeUrl) {
      const iframeSelectors = ['#pembed iframe', '.player-embed iframe', '#player iframe'];
      for (const sel of iframeSelectors) {
        const src = $(sel).attr('src') || $(sel).attr('data-src');
        if (src) {
          iframeUrl = src;
          break;
        }
      }
    }

    // Anime info
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
        iframe: iframeUrl,
        animeInfo,
        endpoints: {
          servers: `/api/samehadaku/servers/${slug}`,
          batch: currentAnimeSlug ? `/api/samehadaku/batch/${currentAnimeSlug}` : null,
        },
      },
    });
  } catch (e) {
    res.status(500).json({ status: false, message: e.message, creator: 'Gxyenn' });
  }
});

// ==================== BATCH DOWNLOAD (Full Scraping) ====================
// Endpoint ini mengambil SEMUA batch download links dari halaman batch,
// termasuk semua kualitas (360p, 480p, 720p, 1080p) dan semua host.
router.get('/batch/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const url = `${BASE}/${slug}/`;
    const html = await fetchPage(url, BASE);
    const $ = cheerio.load(html);

    const title = $('h1.entry-title').text().trim();
    const animeSlug = cleanAnimeSlug(url);

    // Extract anime info
    const animeInfo = {};
    $('.infox .spe span, .spe span').each((i, el) => {
      const text = $(el).text().trim();
      const parts = text.split(':');
      if (parts.length >= 2) {
        animeInfo[parts[0].trim().toLowerCase().replace(/\s+/g, '_')] = parts.slice(1).join(':').trim();
      }
    });

    // ============ EXTRACT ALL DOWNLOAD LINKS ============
    const downloads = [];

    // Method 1: .soraddl layout (tema utama Samehadaku)
    const batchSelectors = [
      '.mctnx .soraddl',
      '.batchlink .soraddl',
      '.download-batch .soraddl',
      '#batch-download .soraddl',
      '.dlbod .soraddl',
      '.bixbox .soraddl',
    ];
    let batchElements = $([]);
    for (const sel of batchSelectors) {
      batchElements = $(sel);
      if (batchElements.length) break;
    }
    // Fallback: semua .soraddl
    if (!batchElements.length) {
      batchElements = $('.soraddl');
    }
    batchElements.each((i, el) => {
      const quality = $(el).find('.sorattl h3, .sorattl span, .sorattl').first().text().trim();
      const links = [];
      $(el).find('.soraurl a').each((j, a) => {
        const host = $(a).text().trim();
        const href = $(a).attr('href') || '';
        if (host && href) {
          links.push({ host, url: href });
        }
      });
      if (quality || links.length) {
        downloads.push({ quality, links });
      }
    });

    // Method 2: Flat list layout
    if (downloads.length === 0) {
      $('.batchlink a, .download-batch a, #batch-download a, .batch-dl a').each((i, el) => {
        const href = $(el).attr('href') || '';
        const text = $(el).text().trim();
        if (href && text && !href.includes('javascript:') && !href.startsWith('#')) {
          const resMatch = text.match(/(\d{3,4})[pP]/);
          const quality = resMatch ? resMatch[1] + 'p' : '';
          downloads.push({ quality, links: [{ host: text, url: href }] });
        }
      });
    }

    // Method 3: Table-based batch download
    if (downloads.length === 0) {
      $('table tr').each((i, el) => {
        if (i === 0 && $(el).find('th').length) return;
        const tds = $(el).find('td');
        if (tds.length >= 2) {
          const quality = $(tds[0]).text().trim();
          const links = [];
          $(el).find('a').each((j, a) => {
            const host = $(a).text().trim();
            const href = $(a).attr('href') || '';
            if (host && href && !href.includes('javascript:')) {
              links.push({ host, url: href });
            }
          });
          if (links.length) downloads.push({ quality, links });
        }
      });
    }

    // Method 4: .downloadzz layout
    if (downloads.length === 0) {
      $('.downloadzz .soraddl, .downloadzz ul li').each((i, el) => {
        if ($(el).is('li')) {
          const a = $(el).find('a');
          const href = a.attr('href') || '';
          const text = $(el).text().trim();
          if (href) {
            const resMatch = text.match(/(\d{3,4})[pP]/);
            const quality = resMatch ? resMatch[1] + 'p' : text;
            downloads.push({ quality, links: [{ host: a.text().trim(), url: href }] });
          }
        } else {
          const quality = $(el).find('.sorattl h3, .sorattl span, .sorattl').first().text().trim();
          const links = [];
          $(el).find('.soraurl a').each((j, a) => {
            const host = $(a).text().trim();
            const href = $(a).attr('href') || '';
            if (host && href) links.push({ host, url: href });
          });
          if (quality || links.length) downloads.push({ quality, links });
        }
      });
    }

    // Method 5: Generic download link scan
    if (downloads.length === 0) {
      $('a[href*="download"], a[href*="dl."], a[class*="download"], a[class*="dl-btn"]').each((i, el) => {
        const href = $(el).attr('href') || '';
        const text = $(el).text().trim();
        if (href && text && !href.includes('javascript:') && !href.startsWith('#')) {
          if (downloads.some(d => d.links.some(l => l.url === href))) return;
          const resMatch = text.match(/(\d{3,4})[pP]/);
          const quality = resMatch ? resMatch[1] + 'p' : '';
          downloads.push({ quality, links: [{ host: text, url: href }] });
        }
      });
    }

    // ============ GROUP BY QUALITY ============
    const byQuality = {};
    downloads.forEach(dl => {
      const key = dl.quality || 'Unknown';
      if (!byQuality[key]) byQuality[key] = [];
      dl.links.forEach(link => {
        byQuality[key].push(link);
      });
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
        title,
        slug,
        animeSlug,
        animeInfo,
        totalQualities: sortedQualities.filter(q => q !== 'Unknown' && q !== '').length,
        totalDownloads: downloads.reduce((sum, d) => sum + d.links.length, 0),
        downloads,
        byQuality: grouped,
      },
    });
  } catch (e) {
    res.status(500).json({ status: false, message: e.message, creator: 'Gxyenn' });
  }
});

// ==================== SERVERS (Episode Mirrors + Downloads) ====================
// Endpoint ini mengambil SEMUA server streaming, mirror, quality, iframe,
// DAN semua download links dari halaman episode secara lengkap.
router.get('/servers/:episodeSlug(*)', async (req, res) => {
  try {
    const episodeSlug = req.params.episodeSlug || '';
    if (!episodeSlug) {
      return res.status(400).json({ status: false, message: 'Episode slug required', creator: 'Gxyenn' });
    }

    const url = `${BASE}/${episodeSlug}/`;
    const html = await fetchPage(url, BASE);
    const $ = cheerio.load(html);

    const title = $('h1.entry-title').text().trim();

    // ============ 1. STREAMING SERVERS (dari mirror/select dropdown) ============
    const streamServers = [];
    const byQuality = {};

    // Method 1: select.mirror option (tema utama Samehadaku)
    $('select.mirror option').each((i, el) => {
      const val = $(el).attr('value');
      const name = $(el).text().trim();
      if (val && name && name !== '- Select Server -' && name !== 'Select Server') {
        const resMatch = name.match(/(\d{3,4})[pP]/);
        const resolution = resMatch ? resMatch[1] + 'p' : 'Unknown';
        const decodedUrl = decodeMirrorValue(val);

        const entry = {
          name,
          resolution,
          iframeUrl: decodedUrl,
          rawValue: val,
          type: name.toLowerCase().includes('download') ? 'download' : 'stream',
        };

        streamServers.push(entry);

        if (!byQuality[resolution]) byQuality[resolution] = [];
        byQuality[resolution].push(entry);
      }
    });

    // Method 2: select[name="server"] option (tema alternatif)
    $('select[name="server"] option, .server-select option').each((i, el) => {
      const val = $(el).attr('value');
      const name = $(el).text().trim();
      if (val && name && name !== '- Select Server -' && name !== 'Select Server') {
        // Cek duplikat
        if (streamServers.some(s => s.rawValue === val)) return;
        const resMatch = name.match(/(\d{3,4})[pP]/);
        const resolution = resMatch ? resMatch[1] + 'p' : 'Unknown';
        const decodedUrl = decodeMirrorValue(val);

        const entry = {
          name,
          resolution,
          iframeUrl: decodedUrl,
          rawValue: val,
          type: 'stream',
        };

        streamServers.push(entry);
        if (!byQuality[resolution]) byQuality[resolution] = [];
        byQuality[resolution].push(entry);
      }
    });

    // Method 3: Tab-based server list (.server-list, .mirror-list)
    $('.mirror-list ul li, .server-list ul li, .mirrorlist ul li').each((i, el) => {
      const a = $(el).find('a');
      const name = a.text().trim() || $(el).text().trim();
      const dataValue = a.attr('data-value') || a.attr('data-src') || a.attr('data-url') || a.attr('href') || '';
      if (name && dataValue) {
        if (streamServers.some(s => s.rawValue === dataValue)) return;
        const resMatch = name.match(/(\d{3,4})[pP]/);
        const resolution = resMatch ? resMatch[1] + 'p' : 'Unknown';
        const decodedUrl = decodeMirrorValue(dataValue);

        const entry = {
          name,
          resolution,
          iframeUrl: decodedUrl || (dataValue.startsWith('http') ? dataValue : null),
          rawValue: dataValue,
          type: 'stream',
        };

        streamServers.push(entry);
        if (!byQuality[resolution]) byQuality[resolution] = [];
        byQuality[resolution].push(entry);
      }
    });

    // Method 4: Data attributes pada elemen player
    $('[data-resolution], [data-quality]').each((i, el) => {
      const quality = $(el).attr('data-resolution') || $(el).attr('data-quality') || '';
      const src = $(el).attr('data-src') || $(el).attr('data-url') || $(el).attr('href') || '';
      const name = $(el).text().trim() || quality;
      if (quality && src) {
        if (streamServers.some(s => s.iframeUrl === src)) return;
        const resolution = quality.match(/(\d{3,4})[pP]/) ? quality : 'Unknown';

        const entry = { name, resolution, iframeUrl: src, rawValue: src, type: 'stream' };
        streamServers.push(entry);
        if (!byQuality[resolution]) byQuality[resolution] = [];
        byQuality[resolution].push(entry);
      }
    });

    // Method 5: Resolution buttons/links
    $('.resolution a, .quality a, [class*="resol"] a, [class*="qualit"] a').each((i, el) => {
      const name = $(el).text().trim();
      const src = $(el).attr('href') || $(el).attr('data-src') || '';
      if (name && src && /\d{3,4}[pP]/.test(name)) {
        if (streamServers.some(s => s.iframeUrl === src)) return;
        const resMatch = name.match(/(\d{3,4})[pP]/);
        const resolution = resMatch ? resMatch[1] + 'p' : 'Unknown';

        const entry = { name, resolution, iframeUrl: src, rawValue: src, type: 'stream' };
        streamServers.push(entry);
        if (!byQuality[resolution]) byQuality[resolution] = [];
        byQuality[resolution].push(entry);
      }
    });

    // Method 6: Semua iframe yang ada di halaman
    const iframeUrls = new Set(streamServers.map(s => s.iframeUrl).filter(Boolean));
    $('iframe[src]').each((i, el) => {
      const src = $(el).attr('src') || '';
      if (src && !iframeUrls.has(src) && !src.includes('googleads') && !src.includes('facebook')) {
        const entry = {
          name: `Iframe Player ${i + 1}`,
          resolution: 'Unknown',
          iframeUrl: src,
          rawValue: src,
          type: 'stream',
        };
        streamServers.push(entry);
        if (!byQuality['Unknown']) byQuality['Unknown'] = [];
        byQuality['Unknown'].push(entry);
      }
    });

    // ============ 2. DOWNLOAD LINKS (semua kualitas, semua host) ============
    const downloads = [];

    // Method 1: .soraddl layout (tema utama Samehadaku)
    const dlSelectors = [
      '.mctnx .soraddl',
      '.downloadzz .soraddl',
      '.download-eps .soraddl',
      '#download-links .soraddl',
      '.dlbod .soraddl',
      '.bixbox .soraddl',
    ];
    let dlElements = $([]);
    for (const sel of dlSelectors) {
      dlElements = $(sel);
      if (dlElements.length) break;
    }
    // Jika tidak ketemu dengan single selector, coba gabungan
    if (!dlElements.length) {
      dlElements = $('.soraddl');
    }
    dlElements.each((i, el) => {
      const quality = $(el).find('.sorattl h3, .sorattl span, .sorattl').first().text().trim();
      const links = [];
      $(el).find('.soraurl a').each((j, a) => {
        const host = $(a).text().trim();
        const href = $(a).attr('href') || '';
        if (host && href) {
          links.push({ host, url: href });
        }
      });
      if (quality || links.length) {
        downloads.push({ quality, links });
      }
    });

    // Method 2: Flat list layout (.downloadzz ul li)
    if (downloads.length === 0) {
      $('.downloadzz ul li, .download-list ul li, #download-box ul li').each((i, el) => {
        const a = $(el).find('a');
        const text = $(el).text().trim();
        const href = a.attr('href') || '';
        if (href) {
          const resMatch = text.match(/(\d{3,4})[pP]/);
          const quality = resMatch ? resMatch[1] + 'p' : text;
          downloads.push({ quality, links: [{ host: a.text().trim(), url: href }] });
        }
      });
    }

    // Method 3: Table-based download links
    if (downloads.length === 0) {
      $('table.download-table tr, table.dlTable tr, .download-area table tr').each((i, el) => {
        if (i === 0 && $(el).find('th').length) return; // skip header
        const tds = $(el).find('td');
        if (tds.length >= 2) {
          const quality = $(tds[0]).text().trim();
          const links = [];
          $(el).find('a').each((j, a) => {
            const host = $(a).text().trim();
            const href = $(a).attr('href') || '';
            if (host && href) links.push({ host, url: href });
          });
          if (links.length) downloads.push({ quality, links });
        }
      });
    }

    // Method 4: Divisi-based download (.download a, #download a)
    if (downloads.length === 0) {
      $('.download a[href], #download a[href], .dl-link a[href], .downloadx a[href]').each((i, el) => {
        const href = $(el).attr('href') || '';
        const text = $(el).text().trim();
        if (href && text && !href.includes('javascript:') && !href.startsWith('#')) {
          const resMatch = text.match(/(\d{3,4})[pP]/);
          const quality = resMatch ? resMatch[1] + 'p' : '';
          downloads.push({ quality, links: [{ host: text, url: href }] });
        }
      });
    }

    // Method 5: Scan semua link dengan kata kunci download di href/class
    if (downloads.length === 0) {
      $('a[href*="download"], a[href*="dl."], a[class*="download"], a[class*="dl-btn"]').each((i, el) => {
        const href = $(el).attr('href') || '';
        const text = $(el).text().trim();
        if (href && text && !href.includes('javascript:') && !href.startsWith('#')) {
          if (downloads.some(d => d.links.some(l => l.url === href))) return;
          const resMatch = text.match(/(\d{3,4})[pP]/);
          const quality = resMatch ? resMatch[1] + 'p' : '';
          downloads.push({ quality, links: [{ host: text, url: href }] });
        }
      });
    }

    // ============ 3. MERGE download quality ke byQuality ============
    downloads.forEach(dl => {
      if (dl.quality) {
        const resMatch = dl.quality.match(/(\d{3,4})[pP]/);
        if (resMatch) {
          const key = resMatch[1] + 'p';
          if (!byQuality[key]) byQuality[key] = [];
          dl.links.forEach(link => {
            byQuality[key].push({
              name: `${link.host} (Download)`,
              resolution: key,
              iframeUrl: null,
              downloadUrl: link.url,
              rawValue: link.url,
              type: 'download',
            });
          });
        }
      }
    });

    // ============ 4. Sort quality keys numerically ============
    const sortedQualities = Object.keys(byQuality).sort((a, b) => {
      if (a === 'Unknown') return 1;
      if (b === 'Unknown') return -1;
      const numA = parseInt(a.replace('p', '')) || 0;
      const numB = parseInt(b.replace('p', '')) || 0;
      return numA - numB;
    });

    const grouped = {};
    sortedQualities.forEach(q => { grouped[q] = byQuality[q]; });

    // ============ 5. Build quality summary ============
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
        title,
        slug: episodeSlug,
        totalServers: streamServers.length,
        totalDownloads: downloads.reduce((sum, d) => sum + d.links.length, 0),
        qualitySummary,
        servers: streamServers,
        downloads,
        byQuality: grouped,
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
