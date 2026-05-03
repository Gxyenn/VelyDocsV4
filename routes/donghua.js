const express = require('express');
const cheerio = require('cheerio');
const router = express.Router();
const { fetchPage, buildPagination, extractPagination } = require('../lib/scraper');

const BASE = 'https://anichin.id';

// GET /api/donghua/home
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
        slug: (a.attr('href') || '').replace(BASE, '').replace(/\//g, '').replace('series', ''),
        url: a.attr('href') || '',
        poster: img.attr('src') || img.attr('data-lazy-src') || '',
        episode: epx.text().trim(),
        rating: rating.text().trim(),
      });
    });

    const popular = [];
    $('.serieslist.pop li, .wpop-items .wpop-item').each((i, el) => {
      const a = $(el).find('a').first();
      const img = $(el).find('img');
      const rating = $(el).find('.numscore').text().trim();
      popular.push({
        rank: i + 1,
        title: a.text().trim() || a.attr('title') || '',
        slug: (a.attr('href') || '').replace(BASE, '').replace(/\//g, '').replace('series', ''),
        url: a.attr('href') || '',
        poster: img.attr('src') || img.attr('data-lazy-src') || '',
        rating,
      });
    });

    res.json({ status: true, creator: 'Gxyenn', data: { latest, popular } });
  } catch (e) {
    res.status(500).json({ status: false, message: e.message, creator: 'Gxyenn' });
  }
});

// GET /api/donghua/recent?page=1
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
        slug: (a.attr('href') || '').replace(BASE, '').replace(/\//g, '').replace('series', ''),
        url: a.attr('href') || '',
        poster: img.attr('src') || img.attr('data-lazy-src') || '',
        episode: epx.text().trim(),
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

// GET /api/donghua/search?q=
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
        slug: (a.attr('href') || '').replace(BASE, '').replace(/\//g, '').replace('series', ''),
        url: a.attr('href') || '',
        poster: img.attr('src') || img.attr('data-lazy-src') || '',
        type: type.text().trim(),
        rating: rating.text().trim(),
      });
    });
    const lastPage = $('.pagination .page-numbers:not(.next)').last().text().trim();
    const totalPages = parseInt(lastPage) || page;
    res.json({ status: true, creator: 'Gxyenn', query: q, pagination: extractPagination($, page), data: results });
  } catch (e) {
    res.status(500).json({ status: false, message: e.message, creator: 'Gxyenn' });
  }
});

// GET /api/donghua/series/:slug
router.get('/series/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const url = `${BASE}/series/${slug}/`;
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
        info[parts[0].trim().toLowerCase().replace(/\s+/g, '_')] = parts.slice(1).join(':').trim();
      }
    });

    const genres = [];
    $('.genxed a').each((i, el) => {
      genres.push({
        name: $(el).text().trim(),
        slug: ($(el).attr('href') || '').split('/genres/')[1]?.replace(/\//g, '') || '',
      });
    });

    const episodes = [];
    $('.eplister ul li').each((i, el) => {
      const a = $(el).find('a');
      const num = $(el).find('.epl-num').text().trim();
      const epTitle = $(el).find('.epl-title').text().trim();
      const sub = $(el).find('.epl-sub span').text().trim();
      const date = $(el).find('.epl-date').text().trim();
      const href = a.attr('href') || '';
      episodes.push({
        number: num,
        title: epTitle,
        sub,
        date,
        slug: href.replace(BASE + '/', '').replace(/\//g, ''),
        url: href,
      });
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

// GET /api/donghua/episode/:slug
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
      },
    });
  } catch (e) {
    res.status(500).json({ status: false, message: e.message, creator: 'Gxyenn' });
  }
});

// GET /api/donghua/genres
router.get('/genres', async (req, res) => {
  try {
    const html = await fetchPage(BASE);
    const $ = cheerio.load(html);
    const genres = [];
    $('a[href*="/genres/"]').each((i, el) => {
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

// GET /api/donghua/genre/:slug?page=1
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
        slug: (a.attr('href') || '').replace(BASE, '').replace(/\//g, '').replace('series', ''),
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

// GET /api/donghua/series-list?page=1&status=&type=&order=
router.get('/series-list', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const status = req.query.status || '';
    const type = req.query.type || '';
    const order = req.query.order || 'update';
    let url = `${BASE}/series/?status=${status}&type=${type}&order=${order}`;
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
        slug: (a.attr('href') || '').replace(BASE, '').replace(/\//g, '').replace('series', ''),
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

// GET /api/donghua/schedule
router.get('/schedule', async (req, res) => {
  try {
    const html = await fetchPage(`${BASE}/schedule/`);
    const $ = cheerio.load(html);
    const schedule = {};
    $('.schedulepage .tab-content > div, .releases').each((i, el) => {
      const day = $(el).attr('id') || $(el).prev('h3').text().trim() || `day_${i}`;
      const items = [];
      $(el).find('li, .bs').each((j, li) => {
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
    res.json({ status: true, creator: 'Gxyenn', data: schedule });
  } catch (e) {
    res.status(500).json({ status: false, message: e.message, creator: 'Gxyenn' });
  }
});

// GET /api/donghua/az-list?letter=A
router.get('/az-list', async (req, res) => {
  try {
    const letter = req.query.letter || '';
    let url = `${BASE}/az-lists/`;
    if (letter) url += `?show=${encodeURIComponent(letter)}`;
    const html = await fetchPage(url);
    const $ = cheerio.load(html);
    const results = [];
    $('.soralist ul li a, .listupd .bs a').each((i, el) => {
      const title = $(el).text().trim() || $(el).attr('title') || '';
      const href = $(el).attr('href') || '';
      if (title) {
        results.push({
          title,
          slug: href.replace(BASE, '').replace(/\//g, '').replace('series', ''),
          url: href,
        });
      }
    });
    res.json({ status: true, creator: 'Gxyenn', letter: letter || 'all', data: results });
  } catch (e) {
    res.status(500).json({ status: false, message: e.message, creator: 'Gxyenn' });
  }
});

// GET /api/donghua/popular
router.get('/popular', async (req, res) => {
  try {
    const html = await fetchPage(BASE);
    const $ = cheerio.load(html);
    const results = [];
    $('.serieslist.pop li, .wpop-items .wpop-item').each((i, el) => {
      const a = $(el).find('a').first();
      const img = $(el).find('img');
      const rating = $(el).find('.numscore').text().trim();
      results.push({
        rank: i + 1,
        title: a.text().trim() || a.attr('title') || '',
        slug: (a.attr('href') || '').replace(BASE, '').replace(/\//g, '').replace('series', ''),
        url: a.attr('href') || '',
        poster: img.attr('src') || img.attr('data-lazy-src') || '',
        rating,
      });
    });
    res.json({ status: true, creator: 'Gxyenn', data: results });
  } catch (e) {
    res.status(500).json({ status: false, message: e.message, creator: 'Gxyenn' });
  }
});

module.exports = router;
