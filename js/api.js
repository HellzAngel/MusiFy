/* =============================================
   MusiFy - JioSaavn API Integration
   Tamil & Malayalam music via saavnapi-nine.vercel.app
   ============================================= */

const JamendoAPI = (function () {
  const BASE = 'https://saavnapi-nine.vercel.app';

  const LANGUAGES = { ml: 'Malayalam', ta: 'Tamil', hi: 'Hindi', en: 'English' };

  function mapTrack(t) {
    // JioSaavn CDN serves .mp4 (AAC) streams
    const audio = t.media_url || t.media_preview_url || '';
    const cover = (t.image || '')
      .replace('150x150', '500x500')
      .replace('50x50', '500x500');
    return {
      id:         String(t.id || t.songid || ('id_' + Math.random())),
      title:      t.song   || t.name           || 'Unknown Title',
      artist:     t.primary_artists || t.singers || 'Unknown Artist',
      album:      t.album  || 'Unknown Album',
      cover:      cover,
      audio:      audio,
      duration:   parseInt(t.duration, 10) || 0,
      genre:      t.language || '',
      lang:       (t.language || '').toLowerCase().startsWith('tamil') ? 'ta'
                : (t.language || '').toLowerCase().startsWith('hindi') ? 'hi'
                : (t.language || '').toLowerCase().startsWith('english') ? 'en'
                : 'ml',
      license:    '',
      jamendoUrl: t.perma_url || ''
    };
  }

  async function saavnFetch(query, limit) {
    limit = limit || 20;
    const url = BASE + '/result/?query=' + encodeURIComponent(query);
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 14000);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(tid);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      const arr  = Array.isArray(data) ? data : (data.value || data.results || []);
      const tracks = arr
        .filter(t => t.media_url || t.media_preview_url)
        .slice(0, limit)
        .map(mapTrack);
      if (!tracks.length) throw new Error('empty');
      return tracks;
    } catch (err) {
      clearTimeout(tid);
      console.warn('[Saavn]', err.message);
      throw err;
    }
  }

  // Fetch from multiple queries, deduplicate by id
  async function fetchAll(queries, limit) {
    limit = limit || 50;
    const perQuery = Math.max(15, Math.ceil(limit / queries.length));
    const results = await Promise.allSettled(queries.map(q => saavnFetch(q, perQuery)));
    const seen = new Set();
    const merged = [];
    for (const r of results) {
      if (r.status === 'fulfilled') {
        for (const t of r.value) {
          if (!seen.has(t.id)) { seen.add(t.id); merged.push(t); }
        }
      }
    }
    return merged.length ? merged : null;
  }

  // ---- Fallback tracks (when API unavailable) ----
  const FALLBACK = [
    { id: 'f01', title: 'Malare',                       artist: 'Vijay Yesudas',       album: 'Premam',               lang: 'ml' },
    { id: 'f02', title: 'Entammede Jimikki Kammal',      artist: 'Vineeth Sreenivasan', album: 'Velipadinte Pusthakam', lang: 'ml' },
    { id: 'f03', title: 'Oru Adaar Love',                artist: 'Vineeth Sreenivasan', album: 'Oru Adaar Love',        lang: 'ml' },
    { id: 'f04', title: 'Njandukalude Nattil Oridavela', artist: 'Vineeth Sreenivasan', album: 'Ohm Shanthi Oshaana',   lang: 'ml' },
    { id: 'f05', title: 'Mazha',                         artist: 'Haricharan',          album: 'Charlie',               lang: 'ml' },
    { id: 'f06', title: 'Thumbi Vaa',                    artist: 'Sid Sriram',          album: 'Varisu',                lang: 'ta' },
    { id: 'f07', title: 'Rowdy Baby',                    artist: 'Dhanush',             album: 'Maari 2',               lang: 'ta' },
    { id: 'f08', title: 'Kannaana Kanney',               artist: 'D. Imman',            album: 'Viswasam',              lang: 'ta' },
    { id: 'f09', title: 'Unnai Kaanadhu Naan',           artist: 'Haricharan',          album: 'Mersal',                lang: 'ta' },
    { id: 'f10', title: 'Vaathi Coming',                 artist: 'Anirudh Ravichander', album: 'Master',                lang: 'ta' },
    { id: 'f11', title: 'Mazhai Kuruvi',                 artist: 'A.R. Rahman',         album: 'Chekka Chivantha Vaanam', lang: 'ta' },
    { id: 'f12', title: 'Pranayame',                     artist: 'KJ Yesudas',          album: 'Golden Hits',           lang: 'ml' },
    { id: 'f13', title: 'Kesariya',                      artist: 'Arijit Singh',        album: 'Brahmastra',            lang: 'hi' },
    { id: 'f14', title: 'Tum Hi Ho',                     artist: 'Arijit Singh',        album: 'Aashiqui 2',            lang: 'hi' },
    { id: 'f15', title: 'Blinding Lights',               artist: 'The Weeknd',          album: 'After Hours',           lang: 'en' },
    { id: 'f16', title: 'Shape of You',                  artist: 'Ed Sheeran',          album: 'Divide',                lang: 'en' },
  ].map(t => ({
    ...t,
    cover:      'https://picsum.photos/seed/' + t.id + '/300/300',
    audio:      '',
    duration:   210,
      genre:      t.lang === 'ta' ? 'tamil' : t.lang === 'hi' ? 'hindi' : t.lang === 'en' ? 'english' : 'malayalam',
    license:    '',
    jamendoUrl: ''
  }));

  function getDemoTracks() { return FALLBACK.slice(); }

  // ---- Public API ----

  async function getFeatured(limit) {
    const tracks = await fetchAll([
      'top tamil songs 2024', 'malayalam hits 2024',
      'best hindi songs 2024', 'top english hits 2024'
    ], limit);
    return tracks || getDemoTracks();
  }

  async function getTrending(limit) {
    const tracks = await fetchAll([
      'trending tamil 2025', 'top malayalam 2025',
      'trending hindi 2025', 'trending english songs 2025'
    ], limit);
    return tracks || getDemoTracks();
  }

  async function getNewReleases(limit) {
    const tracks = await fetchAll([
      'new tamil songs 2025', 'new malayalam songs 2025',
      'new hindi songs 2025', 'new english songs 2025'
    ], limit);
    return tracks || getDemoTracks();
  }

  async function searchTracks(query, limit) {
    if (!query || !query.trim()) return [];
    try { return await saavnFetch(query.trim(), limit || 50); }
    catch (e) { return getDemoTracks(); }
  }

  async function getByGenre(tag, limit) {
    const tracks = await fetchAll([
      'tamil ' + tag, 'malayalam ' + tag, 'hindi ' + tag, 'english ' + tag
    ], limit);
    return tracks || getDemoTracks();
  }

  async function getByLanguage(lang, limit) {
    const queryMap = {
      ta: [
        'top tamil songs 2025', 'best tamil hits', 'popular tamil songs',
        'new tamil songs 2025', 'tamil blockbuster songs', 'tamil love songs',
        'tamil mass songs', 'tamil melody songs', 'anirudh songs',
        'vijay sethupathi tamil songs'
      ],
      ml: [
        'top malayalam songs 2025', 'best malayalam hits', 'popular malayalam songs',
        'new malayalam songs 2025', 'malayalam love songs', 'vineeth sreenivasan songs',
        'sid sriram malayalam', 'malayalam melody songs', 'ouseppachan hits',
        'malayalam blockbuster songs'
      ],
      hi: [
        'top hindi songs 2025', 'best hindi hits', 'popular hindi songs',
        'new hindi songs 2025', 'arijit singh songs', 'atif aslam songs',
        'hindi love songs', 'bollywood hits 2024', 'hindi trending songs',
        'rahman hindi songs'
      ],
      en: [
        'top english songs 2025', 'best english hits', 'popular english songs',
        'new english songs 2025', 'top pop songs 2025', 'ed sheeran songs',
        'the weeknd songs', 'taylor swift songs', 'english love songs',
        'trending english songs'
      ]
    };
    const queries = queryMap[lang] || queryMap.en;
    const tracks = await fetchAll(queries, limit || 80);
    return tracks || getDemoTracks();
  }

  async function getByMood(mood, limit) {
    const tracks = await fetchAll([
      'tamil ' + mood + ' songs', 'malayalam ' + mood + ' songs',
      'hindi ' + mood + ' songs', 'english ' + mood + ' songs'
    ], limit);
    return tracks || getDemoTracks();
  }

  async function getMoreTracks(type) {
    const map = {
      featured: ['tamil blockbuster songs',  'malayalam blockbuster songs', 'hindi blockbuster songs', 'english hits'],
      trending:  ['trending tamil 2025',      'trending malayalam 2025',      'trending hindi 2025',    'trending english 2025'],
      new:       ['latest tamil songs 2025',  'latest malayalam songs 2025',  'latest hindi songs 2025','latest english songs 2025']
    };
    const queries = map[type] || map.featured;
    const tracks = await fetchAll(queries);
    return tracks || [];
  }

  return {
    LANGUAGES,
    getFeatured, getTrending, getNewReleases, searchTracks,
    getByGenre, getByLanguage, getByMood, getMoreTracks,
    getDemoTracks
  };
})();
