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
    limit = limit || 80;
    // Give each query a generous slice so API limits don't starve the pool
    const perQuery = Math.max(20, Math.ceil(limit / Math.max(1, queries.length)));
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

  // ---- Randomization helpers ----
  function pickRandom(arr, n) {
    return arr.slice().sort(() => Math.random() - 0.5).slice(0, Math.min(n, arr.length));
  }

  // Large query pools — random subset is picked each login so featured & new differ every time
  const FEATURED_POOLS = {
    ta: [
      'top tamil songs 2024', 'best tamil hits', 'popular tamil songs',
      'anirudh hits', 'vijay blockbuster songs', 'harris jayaraj hits',
      'yuvan shankar raja hits', 'ar rahman tamil songs', 'ilayaraja classics',
      'dhanush songs', 'sid sriram tamil', 'thalapathy songs',
      'tamil melody hits', 'tamil kuthu songs', 'kollywood hits 2024',
      'tamil love songs hits', 'tamil mass songs', 'rajini hit songs',
      'kamal haasan songs', 'tamil folk songs hits'
    ],
    ml: [
      'top malayalam songs 2024', 'best malayalam hits', 'vineeth sreenivasan songs',
      'ouseppachan hits', 'gopi sundar songs', 'bijibal hits',
      'sajid yahiya songs', 'shaan rahman songs', 'alphons joseph songs',
      'mollywood hits 2024', 'malayalam melody songs', 'malayalam love songs',
      'mohanlal superhit songs', 'mammootty songs', 'prithviraj songs',
      'kerala music hits', 'old malayalam songs', 'new malayalam 2024',
      'malayalam evergreen hits', 'onam songs malayalam'
    ],
    hi: [
      'top hindi songs 2024', 'arijit singh hits', 'atif aslam songs',
      'shreya ghoshal songs', 'sonu nigam hits', 'neha kakkar songs',
      'badshah songs', 'ar rahman hindi songs', 'pritam bollywood hits',
      'amit trivedi songs', 'kk best songs', 'vishal shekhar hits',
      'hindi love songs 2024', 'bollywood romance hits', 'hindi party songs',
      'shankar ehsaan loy songs', 'kumar sanu hits', 'lata mangeshkar songs',
      'kishore kumar hits', 'hindi trending 2024'
    ],
    en: [
      'top english songs 2024', 'ed sheeran hits', 'the weeknd best songs',
      'taylor swift songs', 'billie eilish songs', 'post malone hits',
      'adele songs', 'dua lipa songs', 'harry styles songs',
      'coldplay hits', 'imagine dragons songs', 'twenty one pilots songs',
      'charlie puth songs', 'shawn mendes songs', 'ariana grande hits',
      'english indie hits', 'pop hits 2024', 'english r&b 2024',
      'lewis capaldi songs', 'olivia rodrigo songs'
    ]
  };

  const NEW_RELEASE_POOLS = {
    ta: [
      'new tamil songs 2025', 'latest tamil songs 2025', 'new kollywood songs 2025',
      'tamil releases 2025', 'new tamil movie songs 2025', 'latest anirudh 2025',
      'new sid sriram songs 2025', 'latest vijay songs 2025',
      'fresh tamil songs 2025', 'hot tamil 2025', 'tamil new release 2025'
    ],
    ml: [
      'new malayalam songs 2025', 'latest malayalam songs 2025', 'new mollywood 2025',
      'kerala new songs 2025', 'new malayalam movie songs 2025', 'malayalam releases 2025',
      'latest kerala music 2025', 'new vineeth songs 2025', 'fresh malayalam 2025',
      'new gopi sundar 2025', 'latest mollywood 2025', 'malayalam new release 2025'
    ],
    hi: [
      'new hindi songs 2025', 'latest bollywood 2025', 'new hindi releases 2025',
      'fresh bollywood 2025', 'new hindi movie songs 2025', 'latest arijit 2025',
      'hindi new singles 2025', 'bollywood new songs 2025', 'latest hindi music 2025',
      'fresh hindi 2025', 'hindi releases 2025', 'new bollywood 2025'
    ],
    en: [
      'new english songs 2025', 'latest pop songs 2025', 'new releases 2025',
      'fresh pop 2025', 'new english singles 2025', 'top new songs 2025',
      'latest music 2025', 'new pop hits 2025', 'newest songs 2025',
      'fresh english 2025', 'new pop release 2025', 'english new release 2025'
    ]
  };

  // ---- Public API ----

  async function getFeatured(limit) {
    // Pick 2 random queries per language — different every login
    const queries = [
      ...pickRandom(FEATURED_POOLS.ta, 2),
      ...pickRandom(FEATURED_POOLS.ml, 2),
      ...pickRandom(FEATURED_POOLS.hi, 2),
      ...pickRandom(FEATURED_POOLS.en, 2),
    ];
    const tracks = await fetchAll(queries, limit);
    // Shuffle so card order also varies
    return tracks ? tracks.sort(() => Math.random() - 0.5) : getDemoTracks();
  }

  async function getTrending(limit) {
    const tracks = await fetchAll([
      'trending tamil 2025', 'top malayalam 2025',
      'trending hindi 2025', 'trending english songs 2025'
    ], limit);
    return tracks || getDemoTracks();
  }

  async function getNewReleases(limit) {
    // Pick fresh random queries each call so the list differs each login
    const queries = [
      ...pickRandom(NEW_RELEASE_POOLS.ta, 2),
      ...pickRandom(NEW_RELEASE_POOLS.ml, 2),
      ...pickRandom(NEW_RELEASE_POOLS.hi, 2),
      ...pickRandom(NEW_RELEASE_POOLS.en, 2),
    ];
    const tracks = await fetchAll(queries, limit);
    return tracks ? tracks.sort(() => Math.random() - 0.5) : getDemoTracks();
  }

  async function searchTracks(query, limit, type) {
    if (!query || !query.trim()) return [];
    const q = query.trim();
    let queries;
    if (type === 'artist') {
      queries = [
        q + ' songs', q + ' hits', q + ' latest songs',
        q + ' best songs', q + ' top songs', q + ' all songs',
        q + ' 2024', q + ' 2025', q + ' romantic songs',
        q + ' sad songs', q + ' album', q + ' jukebox',
        q + ' playlist', q + ' superhit songs',
      ];
    } else if (type === 'album') {
      queries = [
        q + ' album', q + ' album songs', q + ' full album',
        q, q + ' songs', q + ' hits',
        q + ' audio', q + ' jukebox', q + ' 2024',
        q + ' 2025', q + ' full', q + ' soundtrack',
        q + ' all songs', q + ' ost',
      ];
    } else if (type === 'film') {
      queries = [
        q + ' movie songs', q + ' film songs', q + ' audio jukebox',
        q + ' songs', q + ' bgm', q + ' theme',
        q + ' full audio', q + ' ost', q + ' music',
        q + ' soundtrack', q + ' all songs', q + ' hits',
        q + ' hd audio', q + ' video songs',
      ];
    } else {
      // default: song search — many diverse queries to beat the per-query API cap
      queries = [
        q, q + ' songs', q + ' hits',
        q + ' latest', q + ' 2025', q + ' best',
        q + ' audio', q + ' official', q + ' full song',
        q + ' hd', q + ' lyrics', q + ' mix',
        q + ' 2024', q + ' playlist',
      ];
    }
    try {
      const tracks = await fetchAll(queries, limit || 120);
      return tracks || [];
    } catch (e) {
      return [];
    }
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

  // ---- Smart Radio: fetch tracks similar to a given track (same language + artist) ----
  async function getSimilarTracks(track, limit) {
    const lang = track.lang || 'ta';
    const langName = (LANGUAGES[lang] || 'Tamil').toLowerCase();
    // Use first artist only (avoid long "feat." chains)
    const artist = (track.artist || '').split(/[,&]/)[0].trim();

    const base = [
      `${artist} songs`,
      `${artist} hits`,
      `${artist} best songs`,
      `${artist} 2024`,
      `${artist} 2025`,
      `best ${langName} songs`,
      `${langName} hits`,
      `${langName} trending 2025`,
      `popular ${langName} music`,
      `${langName} melody songs`,
      `${langName} superhit songs`,
      `${langName} love songs`,
      `${langName} blockbuster songs`,
      `top ${langName} 2025`,
    ];
    if (track.genre) base.push(`${langName} ${track.genre}`);

    // Pick 6 random queries so each call returns a different set
    const queries = pickRandom(base, 6);
    const tracks = await fetchAll(queries, limit || 80);
    // Filter out the source track itself and shuffle
    return tracks
      ? tracks.filter(t => t.id !== track.id).sort(() => Math.random() - 0.5)
      : getDemoTracks().filter(t => t.lang === lang);
  }

  return {
    LANGUAGES,
    getFeatured, getTrending, getNewReleases, searchTracks,
    getByGenre, getByLanguage, getByMood, getMoreTracks,
    getDemoTracks, getSimilarTracks
  };
})();
