const express = require('express');
const cheerio = require('cheerio');
const router = express.Router();
const { fetchPage, buildPagination, extractPagination } = require('../lib/scraper');

const BASE = 'https://samehadaku.li';

// GET /api/samehadaku/home
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
      latest.push({
        title: a.attr('title') || img.attr('alt') || '',
        slug: (a.attr('href') || '').replace(BASE, '').replace(/\//g, '').replace('anime', ''),
        url: a.attr('href') || '',
        poster: img.attr('src') || img.attr('data-lazy-src') || img.attr('data-src') || '',
        episode: epx.text().trim(),
        rating: rating.text().trim(),
      });
    });

    const popular = [];
    $('.serieslist.pop li').each((i, el) => {
      const a = $(el).find('.leftseries h2 a');
      const img = $(el).find('img');
      const rating = $(el).find('.rating .numscore');
      const genres = [];
      $(el).find('.leftseries .genreseries a').each((j, g) => genres.push($(g).text().trim()));
      popular.push({
        rank: i + 1,
        title: a.text().trim(),
        slug: (a.attr('href') || '').replace(BASE, '').replace(/\//g, '').replace('anime', ''),
        url: a.attr('href') || '',
        poster: img.attr('src') || img.attr('data-lazy-src') || '',
        rating: rating.text().trim(),
        genres,
      });
    });

    res.json({ status: true, creator: 'Gxyenn', data: { latest, popular } });
  } catch (e) {
    res.status(500).json({ status: false, message: e.message, creator: 'Gxyenn' });
  }
});

// GET /api/samehadaku/recent?page=1
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
      results.push({
        title: a.attr('title') || img.attr('alt') || '',
        slug: (a.attr('href') || '').replace(BASE, '').replace(/\//g, '').replace('anime', ''),
        url: a.attr('href') || '',
        poster: img.attr('src') || img.attr('data-lazy-src') || '',
        episode: epx.text().trim(),
        rating: rating.text().trim(),
      });
    });

    const lastPage = $('.pagination .page-numbers:not(.next)').last().text().trim();
    const totalPages = parseInt(lastPage) || page;
    res.json({
      status: true,
      creator: 'Gxyenn',
      pagination: extractPagination($, page),
      data: results,
    });
  } catch (e) {
    res.status(500).json({ status: false, message: e.message, creator: 'Gxyenn' });
  }
});

// GET /api/samehadaku/search?q=naruto&page=1
router.get('/search', async (req, res) => {
  try {
    const q = req.query.q;
    if (!q) return res.status(400).json({ status: false, message: 'Parameter q required', creator: 'Gxyenn' });
    const page = parseInt(req.query.page) || 1;
    const url = page > 1 ? `${BASE}/page/${page}/?s=${encodeURIComponent(q)}` : `${BASE}/?s=${encodeURIComponent(q)}`;
    const html = await fetchPage(url);
    const $ = cheerio.load(html);
    const results = [];
    $('.listupd .bs').each((i, el) => {
      const a = $(el).find('.bsx a');
      const img = $(el).find('img');
      const type = $(el).find('.bt .typez');
      const rating = $(el).find('.rating .numscore');
      results.push({
        title: a.attr('title') || img.attr('alt') || '',
        slug: (a.attr('href') || '').replace(BASE, '').replace(/\//g, '').replace('anime', ''),
        url: a.attr('href') || '',
        poster: img.attr('src') || img.attr('data-lazy-src') || '',
        type: type.text().trim(),
        rating: rating.text().trim(),
      });
    });

    const lastPage = $('.pagination .page-numbers:not(.next)').last().text().trim();
    const totalPages = parseInt(lastPage) || page;
    res.json({
      status: true,
      creator: 'Gxyenn',
      query: q,
      pagination: extractPagination($, page),
      data: results,
    });
  } catch (e) {
    res.status(500).json({ status: false, message: e.message, creator: 'Gxyenn' });
  }
});

// GET /api/samehadaku/anime/:slug
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
    $('.genxed a').each((i, el) => genres.push({
      name: $(el).text().trim(),
      slug: ($(el).attr('href') || '').split('/genres/')[1]?.replace(/\//g, '') || '',
    }));

    const episodes = [];
    $('.eplister ul li').each((i, el) => {
      const a = $(el).find('a');
      const num = $(el).find('.epl-num').text().trim();
      const title = $(el).find('.epl-title').text().trim();
      const sub = $(el).find('.epl-sub span').text().trim();
      const date = $(el).find('.epl-date').text().trim();
      const href = a.attr('href') || '';
      const epSlug = href.replace(BASE + '/', '').replace(/\//g, '');
      episodes.push({ number: num, title, sub, date, slug: epSlug, url: href });
    });

    res.json({
      status: true,
      creator: 'Gxyenn',
      data: { title, slug, poster, rating, synopsis, info, genres, totalEpisodes: episodes.length, episodes },
    });
  } catch (e) {
    res.status(500).json({ status: false, message: e.message, creator: 'Gxyenn' });
  }
});

// GET /api/samehadaku/episode/:slug
router.get('/episode/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const url = `${BASE}/${slug}/`;
    const html = await fetchPage(url);
    const $ = cheerio.load(html);

    const title = $('h1.entry-title').text().trim();
    const prevEp = $('.naveps .nvs.l a').attr('href') || '';
    const nextEp = $('.naveps .nvs.r a').attr('href') || '';

    const servers = [];
    $('select.mirror option').each((i, el) => {
      const val = $(el).attr('value');
      const name = $(el).text().trim();
      if (val && name !== '- Select Server -') {
        servers.push({ name, value: val });
      }
    });

    const downloads = [];
    $('.mctnx .soraddl').each((i, el) => {
      const quality = $(el).find('.sorattl h3').text().trim();
      const links = [];
      $(el).find('.soraurl a').each((j, a) => {
        links.push({ host: $(a).text().trim(), url: $(a).attr('href') || '' });
      });
      if (quality || links.length) downloads.push({ quality, links });
    });

    const animeInfo = {};
    $('.infox .spe span').each((i, el) => {
      const text = $(el).text().trim();
      const parts = text.split(':');
      if (parts.length >= 2) {
        animeInfo[parts[0].trim().toLowerCase().replace(/\s+/g, '_')] = parts.slice(1).join(':').trim();
      }
    });

    res.json({
      status: true,
      creator: 'Gxyenn',
      data: {
        title, slug,
        navigation: {
          prev: prevEp ? prevEp.replace(BASE + '/', '').replace(/\//g, '') : null,
          next: nextEp ? nextEp.replace(BASE + '/', '').replace(/\//g, '') : null,
        },
        servers,
        downloads,
        animeInfo,
      },
    });
  } catch (e) {
    res.status(500).json({ status: false, message: e.message, creator: 'Gxyenn' });
  }
});

// GET /api/samehadaku/genres
router.get('/genres', async (req, res) => {
  try {
    const html = await fetchPage(BASE);
    const $ = cheerio.load(html);
    const genres = [];
    $('ul.genre li a, .genre-item a, a[href*="/genres/"]').each((i, el) => {
      const name = $(el).text().trim();
      const href = $(el).attr('href') || '';
      const slug = href.split('/genres/')[1]?.replace(/\//g, '') || '';
      if (name && slug && !genres.find(g => g.slug === slug)) {
        genres.push({ name, slug });
      }
    });
    res.json({ status: true, creator: 'Gxyenn', data: genres });
  } catch (e) {
    res.status(500).json({ status: false, message: e.message, creator: 'Gxyenn' });
  }
});

// GET /api/samehadaku/genre/:slug?page=1
router.get('/genre/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const page = parseInt(req.query.page) || 1;
    const url = page > 1 ? `${BASE}/genres/${slug}/page/${page}/` : `${BASE}/genres/${slug}/`;
    const html = await fetchPage(url);
    const $ = cheerio.load(html);
    const results = [];
    $('.listupd .bs').each((i, el) => {
      const a = $(el).find('.bsx a');
      const img = $(el).find('img');
      const type = $(el).find('.bt .typez');
      const rating = $(el).find('.rating .numscore');
      results.push({
        title: a.attr('title') || img.attr('alt') || '',
        slug: (a.attr('href') || '').replace(BASE, '').replace(/\//g, '').replace('anime', ''),
        url: a.attr('href') || '',
        poster: img.attr('src') || img.attr('data-lazy-src') || '',
        type: type.text().trim(),
        rating: rating.text().trim(),
      });
    });
    const lastPage = $('.pagination .page-numbers:not(.next)').last().text().trim();
    const totalPages = parseInt(lastPage) || page;
    res.json({ status: true, creator: 'Gxyenn', genre: slug, pagination: extractPagination($, page), data: results });
  } catch (e) {
    res.status(500).json({ status: false, message: e.message, creator: 'Gxyenn' });
  }
});

// GET /api/samehadaku/az-list?letter=A&page=1
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
      results.push({
        title: a.text().trim() || a.attr('title') || '',
        slug: (a.attr('href') || '').replace(BASE, '').replace(/\//g, '').replace('anime', ''),
        url: a.attr('href') || '',
      });
    });
    res.json({ status: true, creator: 'Gxyenn', letter: letter || 'all', page, data: results });
  } catch (e) {
    res.status(500).json({ status: false, message: e.message, creator: 'Gxyenn' });
  }
});

// GET /api/samehadaku/schedule
router.get('/schedule', async (req, res) => {
  try {
    const html = await fetchPage(`${BASE}/jadwal-rilis/`);
    const $ = cheerio.load(html);
    const schedule = {};
    $('.schedulepage .tab-content .releases').each((i, el) => {
      const day = $(el).prev('.schedule-header, h3, .tab-title').text().trim() || `day_${i}`;
      const items = [];
      $(el).find('li, .bs').each((j, li) => {
        const a = $(li).find('a').first();
        const img = $(li).find('img');
        const time = $(li).find('.schedule-time, time').text().trim();
        items.push({
          title: a.text().trim() || a.attr('title') || '',
          slug: (a.attr('href') || '').replace(BASE, '').replace(/\//g, '').replace('anime', ''),
          url: a.attr('href') || '',
          poster: img.attr('src') || img.attr('data-lazy-src') || '',
          time,
        });
      });
      if (items.length) schedule[day] = items;
    });

    // Fallback: try tab-based schedule
    if (!Object.keys(schedule).length) {
      $('.tab-content > div, .schedule-widget .day-schedule').each((i, el) => {
        const day = $(el).attr('id') || $(el).find('h3').text().trim() || `day_${i}`;
        const items = [];
        $(el).find('li, .bs, .bsx').each((j, li) => {
          const a = $(li).find('a').first();
          const img = $(li).find('img');
          items.push({
            title: a.text().trim() || a.attr('title') || '',
            slug: (a.attr('href') || '').replace(BASE, '').replace(/\//g, ''),
            url: a.attr('href') || '',
            poster: img.attr('src') || img.attr('data-lazy-src') || '',
          });
        });
        if (items.length) schedule[day] = items;
      });
    }

    res.json({ status: true, creator: 'Gxyenn', data: schedule });
  } catch (e) {
    res.status(500).json({ status: false, message: e.message, creator: 'Gxyenn' });
  }
});

// GET /api/samehadaku/popular?period=weekly
router.get('/popular', async (req, res) => {
  try {
    const html = await fetchPage(BASE);
    const $ = cheerio.load(html);
    const results = [];
    // Try sidebar popular
    $('.serieslist.pop li, .wpop-items .wpop-item').each((i, el) => {
      const a = $(el).find('a').first();
      const img = $(el).find('img');
      const rating = $(el).find('.numscore, .rating').text().trim();
      const views = $(el).find('.view, .count').text().trim();
      results.push({
        rank: i + 1,
        title: a.text().trim() || a.attr('title') || '',
        slug: (a.attr('href') || '').replace(BASE, '').replace(/\//g, '').replace('anime', ''),
        url: a.attr('href') || '',
        poster: img.attr('src') || img.attr('data-lazy-src') || '',
        rating, views,
      });
    });
    res.json({ status: true, creator: 'Gxyenn', data: results });
  } catch (e) {
    res.status(500).json({ status: false, message: e.message, creator: 'Gxyenn' });
  }
});

// GET /api/samehadaku/anime-list?page=1&status=&type=&order=
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
      results.push({
        title: a.attr('title') || img.attr('alt') || '',
        slug: (a.attr('href') || '').replace(BASE, '').replace(/\//g, '').replace('anime', ''),
        url: a.attr('href') || '',
        poster: img.attr('src') || img.attr('data-lazy-src') || '',
        type: type.text().trim(),
        rating: rating.text().trim(),
      });
    });
    const lastPage = $('.pagination .page-numbers:not(.next)').last().text().trim();
    const totalPages = parseInt(lastPage) || page;
    res.json({ status: true, creator: 'Gxyenn', pagination: extractPagination($, page), data: results });
  } catch (e) {
    res.status(500).json({ status: false, message: e.message, creator: 'Gxyenn' });
  }
});

module.exports = router;
