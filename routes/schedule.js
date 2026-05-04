const express = require('express');
const cheerio = require('cheerio');
const router = express.Router();
const { fetchPage } = require('../lib/scraper');

const SAMEHADAKU_BASE = 'https://samehadaku.li';
const ANICHIN_BASE = 'https://anichin.me';

// ==================== SAMEHADAKU SCHEDULE ====================
router.get('/samehadaku', async (req, res) => {
  try {
    const html = await fetchPage(`${SAMEHADAKU_BASE}/jadwal-rilis/`);
    const $ = cheerio.load(html);
    const schedule = {};

    // Method 1: Tab-based schedule (tema baru)
    $('.schedulepage .tab-content, .schedule-tabs .tab-content').each((i, el) => {
      // Cari header/hari
      const dayHeader = $(el).prev('.schedule-header, h3, .tab-title, .day-title').text().trim() ||
                       $(el).find('.schedule-header, h3, .day-title').first().text().trim() ||
                       $(el).attr('id') || `Hari ${i + 1}`;

      const day = dayHeader;
      const items = [];

      $(el).find('li, .bs, .bsx, .schedule-item').each((j, li) => {
        const a = $(li).find('a').first();
        const img = $(li).find('img');
        const time = $(li).find('.schedule-time, time, .jam, [class*="time"]').text().trim();
        const episode = $(li).find('.epl-num, .episode, [class*="ep"]').text().trim();

        const href = a.attr('href') || '';
        // PERBAIKAN: Gunakan slug anime, bukan episode
        let slug = href.replace(SAMEHADAKU_BASE, '').replace(/^\/|\/$/g, '');
        slug = slug.replace(/^anime\//, '').split('/')[0];

        if (a.text().trim() || a.attr('title')) {
          items.push({
            title: a.text().trim() || a.attr('title') || '',
            slug: slug,
            url: href,
            poster: img.attr('src') || img.attr('data-lazy-src') || '',
            time,
            episode,
          });
        }
      });

      if (items.length) schedule[day] = items;
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
          let slug = href.replace(SAMEHADAKU_BASE, '').replace(/^\/|\/$/g, '');
          slug = slug.replace(/^anime\//, '').split('/')[0];

          if (a.text().trim() || a.attr('title')) {
            items.push({
              title: a.text().trim() || a.attr('title') || '',
              slug: slug,
              url: href,
              poster: img.attr('src') || img.attr('data-lazy-src') || '',
              time,
            });
          }
        });

        if (items.length) schedule[day] = items;
      });
    }

    // Method 3: Table-based schedule (fallback)
    if (!Object.keys(schedule).length) {
      $('.schedule-table tr, table[class*="schedule"] tr').each((i, el) => {
        const cells = $(el).find('td, th');
        if (cells.length >= 2) {
          const day = $(cells[0]).text().trim();
          const items = [];

          $(cells[1]).find('a').each((j, a) => {
            const href = $(a).attr('href') || '';
            let slug = href.replace(SAMEHADAKU_BASE, '').replace(/^\/|\/$/g, '');
            slug = slug.replace(/^anime\//, '').split('/')[0];

            items.push({
              title: $(a).text().trim(),
              slug: slug,
              url: href,
            });
          });

          if (items.length) schedule[day] = items;
        }
      });
    }

    res.json({ 
      status: true, 
      creator: 'Gxyenn', 
      source: 'samehadaku',
      totalDays: Object.keys(schedule).length,
      data: schedule 
    });
  } catch (e) {
    res.status(500).json({ status: false, message: e.message, creator: 'Gxyenn', source: 'samehadaku' });
  }
});

// ==================== ANICHIN SCHEDULE ====================
router.get('/anichin', async (req, res) => {
  try {
    const html = await fetchPage(`${ANICHIN_BASE}/schedule/`);
    const $ = cheerio.load(html);
    const schedule = {};

    // Method 1: Tab-based schedule
    $('.schedulepage .tab-content, .schedule-tabs .tab-content, [class*="schedule"] .tab-content').each((i, el) => {
      const dayHeader = $(el).prev('.schedule-header, h3, .tab-title, .day-title').text().trim() ||
                       $(el).find('.schedule-header, h3, .day-title').first().text().trim() ||
                       $(el).attr('id') || `Hari ${i + 1}`;

      const day = dayHeader;
      const items = [];

      $(el).find('li, .bs, .bsx, .schedule-item, .item').each((j, li) => {
        const a = $(li).find('a').first();
        const img = $(li).find('img');
        const time = $(li).find('.schedule-time, time, .jam, [class*="time"]').text().trim();
        const episode = $(li).find('.epl-num, .episode, [class*="ep"]').text().trim();

        const href = a.attr('href') || '';
        let slug = href.replace(ANICHIN_BASE, '').replace(/^\/|\/$/g, '');
        slug = slug.replace(/^anime\//, '').split('/')[0];

        if (a.text().trim() || a.attr('title')) {
          items.push({
            title: a.text().trim() || a.attr('title') || '',
            slug: slug,
            url: href.startsWith('http') ? href : ANICHIN_BASE + href,
            poster: img.attr('src') || img.attr('data-src') || '',
            time,
            episode,
          });
        }
      });

      if (items.length) schedule[day] = items;
    });

    // Method 2: Widget-based (fallback)
    if (!Object.keys(schedule).length) {
      $('.schedule-widget .day-schedule, .widget-schedule, [class*="schedule"] [class*="day"]').each((i, el) => {
        const day = $(el).find('h3, h4, .day-name, [class*="day"]').first().text().trim() || `Hari ${i + 1}`;
        const items = [];

        $(el).find('li, .item, .bs, .bsx').each((j, li) => {
          const a = $(li).find('a').first();
          const img = $(li).find('img');
          const time = $(li).find('.schedule-time, time, .jam').text().trim();

          const href = a.attr('href') || '';
          let slug = href.replace(ANICHIN_BASE, '').replace(/^\/|\/$/g, '');
          slug = slug.replace(/^anime\//, '').split('/')[0];

          if (a.text().trim() || a.attr('title')) {
            items.push({
              title: a.text().trim() || a.attr('title') || '',
              slug: slug,
              url: href.startsWith('http') ? href : ANICHIN_BASE + href,
              poster: img.attr('src') || img.attr('data-src') || '',
              time,
            });
          }
        });

        if (items.length) schedule[day] = items;
      });
    }

    // Method 3: Table-based (fallback)
    if (!Object.keys(schedule).length) {
      $('.schedule-table tr, table[class*="schedule"] tr').each((i, el) => {
        const cells = $(el).find('td, th');
        if (cells.length >= 2) {
          const day = $(cells[0]).text().trim();
          const items = [];

          $(cells[1]).find('a').each((j, a) => {
            const href = $(a).attr('href') || '';
            let slug = href.replace(ANICHIN_BASE, '').replace(/^\/|\/$/g, '');
            slug = slug.replace(/^anime\//, '').split('/')[0];

            items.push({
              title: $(a).text().trim(),
              slug: slug,
              url: href.startsWith('http') ? href : ANICHIN_BASE + href,
            });
          });

          if (items.length) schedule[day] = items;
        }
      });
    }

    res.json({ 
      status: true, 
      creator: 'Gxyenn', 
      source: 'anichin',
      totalDays: Object.keys(schedule).length,
      data: schedule 
    });
  } catch (e) {
    res.status(500).json({ status: false, message: e.message, creator: 'Gxyenn', source: 'anichin' });
  }
});

// ==================== COMBINED SCHEDULE ====================
router.get('/all', async (req, res) => {
  try {
    const [samehadakuHtml, anichinHtml] = await Promise.allSettled([
      fetchPage(`${SAMEHADAKU_BASE}/jadwal-rilis/`),
      fetchPage(`${ANICHIN_BASE}/schedule/`)
    ]);

    const result = {
      samehadaku: null,
      anichin: null
    };

    // Parse Samehadaku
    if (samehadakuHtml.status === 'fulfilled') {
      const $ = cheerio.load(samehadakuHtml.value);
      const schedule = {};

      $('.schedulepage .tab-content, .schedule-tabs .tab-content').each((i, el) => {
        const day = $(el).prev('.schedule-header, h3, .tab-title').text().trim() || $(el).attr('id') || `Hari ${i + 1}`;
        const items = [];

        $(el).find('li, .bs, .bsx, .schedule-item').each((j, li) => {
          const a = $(li).find('a').first();
          const img = $(li).find('img');
          const time = $(li).find('.schedule-time, time, .jam').text().trim();

          const href = a.attr('href') || '';
          let slug = href.replace(SAMEHADAKU_BASE, '').replace(/^\/|\/$/g, '');
          slug = slug.replace(/^anime\//, '').split('/')[0];

          if (a.text().trim()) {
            items.push({
              title: a.text().trim() || a.attr('title') || '',
              slug,
              url: href,
              poster: img.attr('src') || img.attr('data-lazy-src') || '',
              time,
            });
          }
        });

        if (items.length) schedule[day] = items;
      });

      result.samehadaku = { status: true, totalDays: Object.keys(schedule).length, data: schedule };
    } else {
      result.samehadaku = { status: false, message: samehadakuHtml.reason?.message };
    }

    // Parse Anichin
    if (anichinHtml.status === 'fulfilled') {
      const $ = cheerio.load(anichinHtml.value);
      const schedule = {};

      $('.schedulepage .tab-content, .schedule-tabs .tab-content, [class*="schedule"] .tab-content').each((i, el) => {
        const day = $(el).prev('.schedule-header, h3, .tab-title').text().trim() || $(el).attr('id') || `Hari ${i + 1}`;
        const items = [];

        $(el).find('li, .bs, .bsx, .schedule-item').each((j, li) => {
          const a = $(li).find('a').first();
          const img = $(li).find('img');
          const time = $(li).find('.schedule-time, time, .jam').text().trim();

          const href = a.attr('href') || '';
          let slug = href.replace(ANICHIN_BASE, '').replace(/^\/|\/$/g, '');
          slug = slug.replace(/^anime\//, '').split('/')[0];

          if (a.text().trim()) {
            items.push({
              title: a.text().trim() || a.attr('title') || '',
              slug,
              url: href.startsWith('http') ? href : ANICHIN_BASE + href,
              poster: img.attr('src') || img.attr('data-src') || '',
              time,
            });
          }
        });

        if (items.length) schedule[day] = items;
      });

      result.anichin = { status: true, totalDays: Object.keys(schedule).length, data: schedule };
    } else {
      result.anichin = { status: false, message: anichinHtml.reason?.message };
    }

    res.json({
      status: true,
      creator: 'Gxyenn',
      data: result
    });
  } catch (e) {
    res.status(500).json({ status: false, message: e.message, creator: 'Gxyenn' });
  }
});

module.exports = router;
