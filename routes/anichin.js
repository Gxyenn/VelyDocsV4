const express = require('express');
const cheerio = require('cheerio');
const router = express.Router();
const { fetchPage, buildPagination, extractPagination } = require('../lib/scraper');

const BASE = 'https://anichin.me';

// GET /api/anichin/home
router.get('/home', async (req, res) => {
  try {
    const html = await fetchPage(BASE);
    const $ = cheerio.load(html);
    const trending = [];
    const latest = [];

    // Trending section
    $('[class*="trending"] .item, .trending-item, .swiper-slide').each((i, el) => {
      const a = $(el).find('a').first();
      const img = $(el).find('img');
      const title = $(el).find('.title, h3, h2').text().trim() || a.attr('title') || img.attr('alt') || '';
      const href = a.attr('href') || '';
      if (title) {
        trending.push({
          title,
          slug: href.replace(BASE, '').replace(/\//g, '').replace('anime', ''),
          url: href.startsWith('http') ? href : BASE + href,
          poster: img.attr('src') || img.attr('data-src') || '',
        });
      }
    });

    // Latest episodes
    $('[class*="latest"] .item, .latest-episode .item, .episode-list .item, .listupd .bs').each((i, el) => {
      const a = $(el).find('a').first();
      const img = $(el).find('img');
      const title = $(el).find('.title, h3, .tt').text().trim() || a.attr('title') || img.attr('alt') || '';
      const ep = $(el).find('.episode, .ep, .epx').text().trim();
      const href = a.attr('href') || '';
      if (title) {
        latest.push({
          title,
          slug: href.replace(BASE, '').replace(/\//g, ''),
          url: href.startsWith('http') ? href : BASE + href,
          poster: img.attr('src') || img.attr('data-src') || '',
          episode: ep,
        });
      }
    });

    res.json({ status: true, creator: 'Gxyenn', data: { trending, latest } });
  } catch (e) {
    res.status(500).json({ status: false, message: e.message, creator: 'Gxyenn' });
  }
});

// GET /api/anichin/explore?page=1&sort=latest_update
router.get('/explore', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const sort = req.query.sort || '';
    const letter = req.query.letter || '';
    let url = `${BASE}/explore?page=${page}`;
    if (sort) url += `&sort=${sort}`;
    if (letter) url += `&letter=${letter}`;
    const html = await fetchPage(url);
    const $ = cheerio.load(html);
    const results = [];

    // Try multiple selectors
    $('.anime-card, .item, .bs, [class*="card"]').each((i, el) => {
      const a = $(el).find('a').first();
      const img = $(el).find('img');
      const title = $(el).find('.title, h3, h2, .tt').text().trim() || a.attr('title') || img.attr('alt') || '';
      const rating = $(el).find('.rating, .score, .numscore').text().trim();
      const type = $(el).find('.type, .typez').text().trim();
      const href = a.attr('href') || '';
      if (title) {
        results.push({
          title,
          slug: href.replace(BASE, '').replace(/^\/anime\//, '').replace(/\//g, ''),
          url: href.startsWith('http') ? href : BASE + href,
          poster: img.attr('src') || img.attr('data-src') || '',
          rating,
          type,
        });
      }
    });

    res.json({ status: true, creator: 'Gxyenn', pagination: buildPagination(page, 74), sort, data: results });
  } catch (e) {
    res.status(500).json({ status: false, message: e.message, creator: 'Gxyenn' });
  }
});

// GET /api/anichin/anime/:slug
router.get('/anime/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const url = `${BASE}/anime/${slug}`;
    const html = await fetchPage(url);
    const $ = cheerio.load(html);

    const title = $('h1, .title, .entry-title').first().text().trim();
    const poster = $('.poster img, .thumb img, .cover img').first().attr('src') ||
                   $('img[class*="poster"], img[class*="cover"]').first().attr('src') || '';
    const rating = $('[class*="rating"] span, .score, [itemprop="ratingValue"]').first().text().trim();
    const synopsis = $('[class*="synopsis"], [class*="description"], .entry-content p, [class*="sinopsis"]').first().text().trim();

    const info = {};
    $('[class*="info"] span, [class*="detail"] span, .spe span, [class*="meta"] span').each((i, el) => {
      const text = $(el).text().trim();
      const parts = text.split(':');
      if (parts.length >= 2) {
        info[parts[0].trim().toLowerCase().replace(/\s+/g, '_')] = parts.slice(1).join(':').trim();
      }
    });

    const genres = [];
    $('[class*="genre"] a, .genxed a').each((i, el) => {
      genres.push({ name: $(el).text().trim(), url: $(el).attr('href') || '' });
    });

    const episodes = [];
    $('[class*="episode"] a, .eplister li a, [class*="ep-list"] a').each((i, el) => {
      const epTitle = $(el).text().trim();
      const href = $(el).attr('href') || '';
      const num = href.match(/episode\/(\d+)/)?.[1] || epTitle.match(/(\d+)/)?.[1] || '';
      episodes.push({
        number: num,
        title: epTitle,
        url: href.startsWith('http') ? href : BASE + href,
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

// GET /api/anichin/anime/:slug/episode/:number
router.get('/anime/:slug/episode/:number', async (req, res) => {
  try {
    const { slug, number } = req.params;
    const url = `${BASE}/anime/${slug}/episode/${number}`;
    const html = await fetchPage(url);
    const $ = cheerio.load(html);

    const title = $('h1, .title, .entry-title').first().text().trim();

    const servers = [];
    $('select option, [class*="server"] button, [class*="server"] a, .mirror option').each((i, el) => {
      const name = $(el).text().trim();
      const val = $(el).attr('value') || $(el).attr('data-src') || $(el).attr('href') || '';
      if (name && val && name !== 'Select Server') {
        servers.push({ name, value: val });
      }
    });

    const downloads = [];
    $('[class*="download"] a, .soraddl a').each((i, el) => {
      const host = $(el).text().trim();
      const href = $(el).attr('href') || '';
      if (host && href) downloads.push({ host, url: href });
    });

    // Navigation
    const prevLink = $('a[class*="prev"], .prev a, a:contains("Previous")').attr('href') || '';
    const nextLink = $('a[class*="next"], .next a, a:contains("Next")').attr('href') || '';

    res.json({
      status: true,
      creator: 'Gxyenn',
      data: {
        title, slug, episode: number,
        navigation: {
          prev: prevLink ? (prevLink.startsWith('http') ? prevLink : BASE + prevLink) : null,
          next: nextLink ? (nextLink.startsWith('http') ? nextLink : BASE + nextLink) : null,
        },
        servers,
        downloads,
      },
    });
  } catch (e) {
    res.status(500).json({ status: false, message: e.message, creator: 'Gxyenn' });
  }
});

// GET /api/anichin/search?q=one+piece
router.get('/search', async (req, res) => {
  try {
    const q = req.query.q;
    if (!q) return res.status(400).json({ status: false, message: 'Parameter q required', creator: 'Gxyenn' });
    const page = parseInt(req.query.page) || 1;
    const url = `${BASE}/explore?q=${encodeURIComponent(q)}&page=${page}`;
    const html = await fetchPage(url);
    const $ = cheerio.load(html);
    const results = [];
    $('.anime-card, .item, .bs, [class*="card"]').each((i, el) => {
      const a = $(el).find('a').first();
      const img = $(el).find('img');
      const title = $(el).find('.title, h3, h2, .tt').text().trim() || a.attr('title') || img.attr('alt') || '';
      const href = a.attr('href') || '';
      if (title) {
        results.push({
          title,
          slug: href.replace(BASE, '').replace(/^\/anime\//, '').replace(/\//g, ''),
          url: href.startsWith('http') ? href : BASE + href,
          poster: img.attr('src') || img.attr('data-src') || '',
        });
      }
    });
    res.json({ status: true, creator: 'Gxyenn', query: q, pagination: buildPagination(page, page + (results.length > 0 ? 1 : 0)), data: results });
  } catch (e) {
    res.status(500).json({ status: false, message: e.message, creator: 'Gxyenn' });
  }
});

// GET /api/anichin/movies?page=1
router.get('/movies', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const url = `${BASE}/movies?page=${page}`;
    const html = await fetchPage(url);
    const $ = cheerio.load(html);
    const results = [];
    $('.anime-card, .item, .bs, [class*="card"]').each((i, el) => {
      const a = $(el).find('a').first();
      const img = $(el).find('img');
      const title = $(el).find('.title, h3, h2, .tt').text().trim() || a.attr('title') || img.attr('alt') || '';
      const href = a.attr('href') || '';
      if (title) {
        results.push({
          title,
          slug: href.replace(BASE, '').replace(/^\/anime\//, '').replace(/\//g, ''),
          url: href.startsWith('http') ? href : BASE + href,
          poster: img.attr('src') || img.attr('data-src') || '',
        });
      }
    });
    res.json({ status: true, creator: 'Gxyenn', pagination: buildPagination(page, page + (results.length > 0 ? 1 : 0)), data: results });
  } catch (e) {
    res.status(500).json({ status: false, message: e.message, creator: 'Gxyenn' });
  }
});

module.exports = router;
