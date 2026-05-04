# VelyDocs V4 - Anime API Documentation

**Versi:** 2.1.0  
**Creator:** Gxyenn  
**Contact:** [t.me/@Gxyenn969](https://t.me/@Gxyenn969)  
**Status:** Production Ready

---

## API Key System

### Free Key (Gratis)
- **Limit:** 30 request per menit
- **Keys yang tersedia:**
  - `vely-docs-free-2026`
  - `gxyenn-public-key`
  - `demo-access-key`

Cara pakai:
```
GET /api/samehadaku/home?key=vely-docs-free-2026
```

Atau via header:
```
X-API-Key: vely-docs-free-2026
```

### Premium Key (Berbayar)
- **Unlimited request**
- **Prioritas tinggi**
- **Support penuh**

**Hubungi:** [t.me/@Gxyenn969](https://t.me/@Gxyenn969)

---

## Perbaikan Performa (v2.1.0)

### 1. Cache Lebih Lama
- **Sebelum:** 5 menit
- **Sekarang:** 10 menit
- **Hasil:** Response lebih cepat, lebih sedikit request ke website target

### 2. Timeout Lebih Pendek
- **Sebelum:** 15 detik
- **Sekarang:** 10 detik
- **Hasil:** Tidak nunggu lama kalau website target lambat

### 3. Limit Content Size
- **Max:** 5MB per page
- **Hasil:** Memory lebih efisien

### 4. Retry Logic
- **Max retry:** 3 kali
- **Delay:** Bertahap (300ms → 500ms → 700ms)
- **Hasil:** Lebih stabil, tidak stuck

---

## Fitur Lengkap

### 1. Pagination yang Benar
- Menghitung SEMUA halaman di endpoint
- Deteksi dari `.pagination`, `.hpage`, link "Last", dll.

### 2. Slug System yang Benar
- **Home/Lainnya:** Slug anime detail
- **Anime Detail:** List slug episode
- **Episode/Watch:** Slug anime parent + slug episode

### 3. Separated Endpoints
- **Episode:** Info dasar + iframe + navigasi (clean, ringan)
- **Servers:** Semua server/mirror grouped by quality (dedicated endpoint)
- **Batch:** Batch download links per anime (dedicated endpoint)

### 4. Jadwal Rilis (Schedule)
- **Samehadaku:** `/api/schedule/samehadaku`
- **Anichin:** `/api/schedule/anichin`
- **Combined:** `/api/schedule/all`

### 5. Anti-Block System
- Rotating User-Agents (10+ browser)
- Random delay antara request
- Retry mechanism (3x attempt)
- Smart caching (10 menit)

### 6. Keamanan
- API Key system (Free & Premium)
- CORS enabled untuk semua origin
- Helmet.js security headers
- Rate limiting (100 req/15 menit global)
- Compression enabled

---

## Instalasi

```bash
# Clone repository
git clone https://github.com/Gxyenn/VelyDocsV4.git
cd VelyDocsV4

# Install dependencies
npm install

# Jalankan server
npm start

# Atau mode development
npm run dev
```

Server akan berjalan di `http://localhost:3000`

---

## Endpoints

### Samehadaku (`/api/samehadaku`)

| Method | Endpoint | Deskripsi | Parameter |
|--------|----------|-----------|-----------|
| GET | `/home?key=...` | Homepage - Latest & Popular | `key` |
| GET | `/recent?page=1&key=...` | Update terbaru | `page`, `key` |
| GET | `/search?q=naruto&page=1&key=...` | Cari anime | `q`, `page`, `key` |
| GET | `/anime/:slug?key=...` | Detail anime + episode list | `slug`, `key` |
| GET | `/episode/:slug?key=...` | Detail episode + video iframe | `slug`, `key` |
| GET | `/servers/:episodeSlug?key=...` | Streaming servers/mirrors by quality | `slug`, `key` |
| GET | `/batch/:slug?key=...` | Batch download links | `slug`, `key` |
| GET | `/genres?key=...` | Daftar genre | `key` |
| GET | `/genre/:slug?page=1&key=...` | Anime per genre | `slug`, `page`, `key` |
| GET | `/az-list?letter=A&page=1&key=...` | Daftar A-Z | `letter`, `page`, `key` |
| GET | `/schedule?key=...` | Jadwal rilis | `key` |
| GET | `/popular?period=weekly&key=...` | Anime populer | `period`, `key` |
| GET | `/anime-list?page=1&status=&type=&order=&key=...` | Daftar anime + filter | `page`, `status`, `type`, `order`, `key` |

### Anichin (`/api/anichin`)

| Method | Endpoint | Deskripsi | Parameter |
|--------|----------|-----------|-----------|
| GET | `/home?key=...` | Homepage - Trending & Latest | `key` |
| GET | `/explore?page=1&sort=&letter=&status=&type=&key=...` | Jelajahi anime | `page`, `sort`, `letter`, `status`, `type`, `key` |
| GET | `/anime/:slug?key=...` | Detail anime | `slug`, `key` |
| GET | `/anime/:slug/episode/:number?key=...` | Detail episode + video URL | `slug`, `number`, `key` |
| GET | `/anime/:slug/episode/:number/servers?key=...` | Streaming servers/mirrors by quality | `slug`, `number`, `key` |
| GET | `/batch/:slug?key=...` | Batch download links | `slug`, `key` |
| GET | `/search?q=&page=1&key=...` | Cari anime | `q`, `page`, `key` |
| GET | `/movies?page=1&key=...` | Film anime | `page`, `key` |
| GET | `/ongoing?page=1&key=...` | Anime ongoing | `page`, `key` |
| GET | `/completed?page=1&key=...` | Anime completed | `page`, `key` |
| GET | `/genres?key=...` | Daftar genre | `key` |
| GET | `/genre/:slug?page=1&key=...` | Anime per genre | `slug`, `page`, `key` |
| GET | `/seasons?key=...` | Daftar season | `key` |
| GET | `/season/:slug?page=1&key=...` | Anime per season | `slug`, `page`, `key` |

### Schedule (`/api/schedule`)

| Method | Endpoint | Deskripsi | Parameter |
|--------|----------|-----------|-----------|
| GET | `/samehadaku?key=...` | Jadwal Samehadaku | `key` |
| GET | `/anichin?key=...` | Jadwal Anichin | `key` |
| GET | `/all?key=...` | Gabungan kedua sumber | `key` |

---

## Contoh Response

### Home Samehadaku
```json
{
  "status": true,
  "creator": "Gxyenn",
  "data": {
    "latest": [
      {
        "title": "One Piece",
        "slug": "one-piece",
        "url": "https://samehadaku.li/anime/one-piece/",
        "poster": "https://samehadaku.li/wp-content/uploads/...",
        "episode": "Episode 1095",
        "rating": "8.5",
        "type": "TV"
      }
    ],
    "popular": [
      {
        "rank": 1,
        "title": "Jujutsu Kaisen",
        "slug": "jujutsu-kaisen",
        "url": "...",
        "poster": "...",
        "rating": "9.1",
        "genres": ["Action", "Supernatural"]
      }
    ]
  }
}
```

### Episode Detail (Clean Response)
```json
{
  "status": true,
  "creator": "Gxyenn",
  "data": {
    "title": "One Piece Episode 1095 Subtitle Indonesia",
    "slug": "one-piece-episode-1095-subtitle-indonesia",
    "animeSlug": "one-piece",
    "navigation": {
      "prev": "one-piece-episode-1094-subtitle-indonesia",
      "next": "one-piece-episode-1096-subtitle-indonesia"
    },
    "iframe": "https://stream.example.com/embed/abc123",
    "animeInfo": {
      "status": "Ongoing",
      "type": "TV"
    },
    "endpoints": {
      "servers": "/api/samehadaku/servers/one-piece-episode-1095-subtitle-indonesia",
      "batch": "/api/samehadaku/batch/one-piece"
    }
  }
}
```

### Pagination Response
```json
{
  "pagination": {
    "currentPage": 1,
    "hasPrevPage": false,
    "prevPage": null,
    "hasNextPage": true,
    "nextPage": 2,
    "totalPages": 156
  }
}
```

---

## Troubleshooting Performa

### API Lambat / Timeout
1. **Cek cache:** Response pertama lambat (fetch dari website target), response berikutnya cepat (dari cache)
2. **Website target down:** Kalau samehadaku.li atau anichin.me down, API akan timeout. Tunggu beberapa menit.
3. **Gunakan parameter yang spesifik:** Hindari fetch halaman 1 dari endpoint dengan banyak data

### Error 429 (Rate Limit)
- Free key: max 30 req/menit. Tunggu 1 menit atau upgrade premium.
- Global limit: 100 req/15 menit per IP.

### Error 403 (Blocked)
- Website target mungkin block IP server. Coba:
  - Restart server (dapat IP baru di some platforms)
  - Tambah proxy (untuk premium user)

---

## Changelog

### v2.1.0 (2026)
- **Tambah:** API Key system (Free & Premium)
- **Perbaiki:** Cache TTL 5 menit → 10 menit
- **Perbaiki:** Timeout 15 detik → 10 detik
- **Perbaiki:** Limit content size 5MB
- **Perbaiki:** Retry logic lebih cepat
- **Tambah:** Contact info t.me/@Gxyenn969

### v2.0.0 (2026)
- Perbaikan pagination (hitung semua halaman)
- Perbaikan slug system (anime vs episode)
- Tambah iframe URL & resolusi lengkap
- Perbaikan jadwal rilis (samehadaku + anichin)
- Tambah endpoint baru (ongoing, completed, seasons)
- Anti-block system ditingkatkan
- Security middleware (helmet, rate limit, CORS)

### v1.0.0
- Initial release
- Basic scraping samehadaku & anichin

---

**Dibuat dengan ❤️ oleh Gxyenn**

**Beli Premium:** [t.me/@Gxyenn969](https://t.me/@Gxyenn969)
