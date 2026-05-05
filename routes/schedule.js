const express = require('express');
const cheerio = require('cheerio');
const router = express.Router();
const { fetchPage } = require('../lib/scraper');

const SAMEHADAKU_BASE = 'https://samehadaku.me';
const ANICHIN_BASE = 'https://anichin.me';

// Helper functions
function getPoster(img) {
  return img.attr('src') || img.attr('data-lazy-src') || img.attr('data-src') || '';
}

function cleanSlug(href, base) {
  let slug = href.replace(base, '').replace(/^\/|\/$/g, '');
  slug = slug.replace(/^anime\//, '').split('/')[0];
  return slug;
}

function absUrl(href, base) {
  if (!href) return '';
  return href.startsWith('http') ? href : base + (href.startsWith('/') ? '' : '/') + href;
}

// ==================== SAMEHADAKU SCHEDULE ====================
router.get('/samehadaku', async (req, res) => {
  try {
    // Try multiple URL candidates
    const shUrls = [
      `${SAMEHADAKU_BASE}/jadwal-rilis/`,
      `${SAMEHADAKU_BASE}/jadwal/`,
      `${SAMEHADAKU_BASE}/schedule/`,
      `${SAMEHADAKU_BASE}/release-schedule/`,
      SAMEHADAKU_BASE, // Homepage fallback (may have sidebar schedule)
    ];
    let html = null;
    for (const u of shUrls) {
      try {
        html = await fetchPage(u, SAMEHADAKU_BASE);
        if (html && !html.includes('class="error404"') && !html.includes('404.png')) break;
        html = null;
      } catch { html = null; }
    }
    if (!html) throw new Error('Schedule page not found');
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
        const slug = cleanSlug(href, SAMEHADAKU_BASE);

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
              slug: cleanSlug(href, SAMEHADAKU_BASE),
              url: href,
              poster: getPoster(img),
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
            items.push({
              title: $(a).text().trim(),
              slug: cleanSlug(href, SAMEHADAKU_BASE),
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
      data: schedule,
    });
  } catch (e) {
    // Jadwal rilis mungkin tidak tersedia - kembalikan pesan yang informatif
    res.status(200).json({
      status: true,
      creator: 'Gxyenn',
      source: 'samehadaku',
      totalDays: 0,
      message: 'Jadwal rilis tidak tersedia saat ini. Halaman schedule mungkin telah dihapus atau dipindahkan.',
      data: {},
    });
  }
});

// ==================== ANICHIN SCHEDULE ====================
router.get('/anichin', async (req, res) => {
  try {
    // Anichin has no dedicated schedule page
    // Try to extract from homepage or explore page
    const urlCandidates = [
      `${ANICHIN_BASE}/schedule`,
      `${ANICHIN_BASE}/jadwal`,
      ANICHIN_BASE, // Homepage fallback
    ];
    
    let schedule = {};
    
    for (const candidateUrl of urlCandidates) {
      try {
        const html = await fetchPage(candidateUrl, ANICHIN_BASE);
        
        // Try Inertia.js extraction (Anichin uses Inertia)
        const cheerioPage = cheerio.load(html);
        let inertiaData = null;
        cheerioPage('[data-page]').each((i, el) => {
          try {
            inertiaData = JSON.parse(cheerioPage(el).attr('data-page'));
          } catch {}
        });
        
        if (inertiaData?.props) {
          const props = inertiaData.props;
          // Look for schedule data in props
          const scheduleData = props.schedule || props.schedules || props.releaseSchedule || null;
          
          if (scheduleData && typeof scheduleData === 'object') {
            if (Array.isArray(scheduleData)) {
              schedule['Semua'] = scheduleData.map(item => ({
                title: item.title || item.anime?.title || '',
                slug: item.slug || item.anime?.slug || '',
                url: `${ANICHIN_BASE}/anime/${item.slug || item.anime?.slug || ''}`,
                poster: item.poster || item.anime?.poster || '',
                episode: item.episode_number ? `Episode ${item.episode_number}` : '',
                release_date: item.release_date || item.air_date || '',
              }));
            } else {
              // Object keyed by day
              for (const [day, items] of Object.entries(scheduleData)) {
                if (Array.isArray(items)) {
                  schedule[day] = items.map(item => ({
                    title: item.title || item.anime?.title || '',
                    slug: item.slug || item.anime?.slug || '',
                    url: `${ANICHIN_BASE}/anime/${item.slug || item.anime?.slug || ''}`,
                    poster: item.poster || item.anime?.poster || '',
                    episode: item.episode_number ? `Episode ${item.episode_number}` : '',
                  }));
                }
              }
            }
          }
          
          if (Object.keys(schedule).length > 0) break;
        }
      } catch {
        // URL failed, try next
      }
    }

    res.json({
      status: true,
      creator: 'Gxyenn',
      source: 'anichin',
      totalDays: Object.keys(schedule).length,
      message: Object.keys(schedule).length === 0
        ? 'Anichin tidak menyediakan halaman jadwal khusus. Gunakan /api/anichin/ongoing untuk melihat anime yang sedang tayang.'
        : undefined,
      data: schedule,
    });
  } catch (e) {
    res.json({
      status: true,
      creator: 'Gxyenn',
      source: 'anichin',
      totalDays: 0,
      message: 'Jadwal anichin tidak tersedia: ' + e.message,
      data: {},
    });
  }
});

// ==================== COMBINED SCHEDULE ====================
router.get('/all', async (req, res) => {
  try {
    const [samehadakuHtml, anichinHtml] = await Promise.allSettled([
      fetchPage(`${SAMEHADAKU_BASE}/jadwal-rilis/`, SAMEHADAKU_BASE),
      fetchPage(`${ANICHIN_BASE}/schedule/`, ANICHIN_BASE),
    ]);

    const result = {
      samehadaku: null,
      anichin: null,
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

          if (a.text().trim()) {
            items.push({
              title: a.text().trim() || a.attr('title') || '',
              slug: cleanSlug(href, SAMEHADAKU_BASE),
              url: href,
              poster: getPoster(img),
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

          if (a.text().trim()) {
            items.push({
              title: a.text().trim() || a.attr('title') || '',
              slug: cleanSlug(href, ANICHIN_BASE),
              url: absUrl(href, ANICHIN_BASE),
              poster: getPoster(img),
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
      data: result,
    });
  } catch (e) {
    res.status(200).json({
      status: true,
      creator: 'Gxyenn',
      data: {
        samehadaku: { status: false, message: 'Jadwal rilis tidak tersedia saat ini.' },
        anichin: { status: false, message: 'Jadwal rilis tidak tersedia saat ini.' },
      },
    });
  }
});

module.exports = router;
