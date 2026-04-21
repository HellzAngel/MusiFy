/* =============================================
   MusiFy - Main Player + Three.js Visualizer
   ============================================= */

// ---- Auth Guard ----
(function() {
  const session = sessionStorage.getItem('musify_session');
  if (!session) { window.location.replace('index.html'); return; }
  try { JSON.parse(session); } catch { window.location.replace('index.html'); }
})();

// ---- Back-button trap: keep player in history so back doesn't log out ----
(function() {
  // Push an extra state so there's always something to pop back to within this page
  history.pushState({ musify: true }, '');
  window.addEventListener('popstate', function(e) {
    // Re-push so the back button never actually leaves the player
    history.pushState({ musify: true }, '');
  });
})();

// =============================================
//  STATE
// =============================================

const State = {
  session: JSON.parse(sessionStorage.getItem('musify_session') || '{}'),
  users: JSON.parse(localStorage.getItem('musify_users') || '{}'),
  currentTrack: null,
  queue: [],
  queueIndex: -1,
  isPlaying: false,
  isMuted: false,
  volume: 0.8,
  isShuffled: false,
  repeatMode: 'none', // 'none' | 'one' | 'all'
  nowPlayingOpen: false,
  allTracks: [],
  allFeatured: null,
  featuredShown: 0,
  featuredOffset: 0,
  trendingTracks: [],
  newTracks: null,
  currentView: 'home',
  // Smart Radio: Spotify-like — tracks fetched based on the song played from search
  smartRadio: { active: false, lang: null, tracks: [], index: 0, fetching: false },
  // Playback history stack — stores actual played tracks in order so prev always works
  playHistory: [],
};

// =============================================
//  AUDIO ENGINE
// =============================================

const audio = document.getElementById('audioElement');
let audioCtx = null;
let analyser = null;
let audioSource = null;
let audioConnected = false;

function ensureAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;
  }
  if (!audioConnected && audioCtx) {
    try {
      audioSource = audioCtx.createMediaElementSource(audio);
      audioSource.connect(analyser);
      analyser.connect(audioCtx.destination);
      audioConnected = true;
    } catch(e) {
      // CORS or already-connected — visualizer uses idle animation, audio still plays
      console.info('Visualizer CORS fallback active:', e.message);
    }
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

// =============================================
//  SHARED FREQUENCY ANALYSIS
// =============================================

const _freqBuf = new Uint8Array(128);
function _getFreq() {
  if (!analyser || !State.isPlaying) return null;
  analyser.getByteFrequencyData(_freqBuf);
  let bass = 0, mid = 0, treble = 0;
  for (let i = 0; i < 8; i++) bass += _freqBuf[i];
  bass /= (8 * 255);
  for (let i = 8; i < 48; i++) mid += _freqBuf[i];
  mid /= (40 * 255);
  for (let i = 48; i < 128; i++) treble += _freqBuf[i];
  treble /= (80 * 255);
  return { bass, mid, treble, avg: (bass * 2 + mid + treble) / 4 };
}

// =============================================
//  THREE.JS MINI ORB (Player Bar)
// =============================================

(function initMiniOrb() {
  const canvas = document.getElementById('miniOrbCanvas');
  if (!canvas) return;
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(56, 56);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10);
  camera.position.z = 2.8;

  const geo = new THREE.IcosahedronGeometry(1.0, 3);
  const origPos = geo.attributes.position.array.slice();
  const mat = new THREE.MeshStandardMaterial({
    color: 0x1a0a3a, emissive: new THREE.Color(0xa78bfa),
    emissiveIntensity: 0.5, roughness: 0.3, metalness: 0.8,
    transparent: true, opacity: 0.95,
  });
  const mesh = new THREE.Mesh(geo, mat);
  scene.add(mesh);
  const wireMat = new THREE.MeshBasicMaterial({ color: 0xa78bfa, wireframe: true, transparent: true, opacity: 0.25 });
  const wire = new THREE.Mesh(new THREE.IcosahedronGeometry(1.04, 2), wireMat);
  scene.add(wire);
  const pLight = new THREE.PointLight(0xa78bfa, 5, 8);
  scene.add(pLight);
  scene.add(new THREE.AmbientLight(0x200040, 3));

  function animateMini() {
    requestAnimationFrame(animateMini);
    const t = performance.now() / 1000;
    const freq = _getFreq();
    const bass = freq ? freq.bass : 0.08 + Math.sin(t * 0.8) * 0.04;
    const avg  = freq ? freq.avg  : bass * 0.7;
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const ox = origPos[i*3], oy = origPos[i*3+1], oz = origPos[i*3+2];
      const noise = (Math.sin(ox*4 + t*2.5) * Math.cos(oy*4 + t*2) + Math.sin(oz*4 + t*1.8)) * 0.5;
      const d = 1 + bass * 0.32 * Math.max(0, noise);
      pos.setXYZ(i, ox * d, oy * d, oz * d);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    mesh.rotation.y = t * (0.35 + avg * 1.2);
    mesh.rotation.x = Math.sin(t * 0.45) * 0.3;
    wire.rotation.y = mesh.rotation.y + t * 0.1;
    wire.rotation.x = mesh.rotation.x;
    mat.emissiveIntensity = 0.4 + bass * 2.8;
    pLight.intensity = 4 + bass * 9;
    pLight.position.set(Math.sin(t * 0.9) * 2, Math.cos(t * 0.6) * 2, 1.5);
    renderer.render(scene, camera);
  }
  animateMini();
})();

// =============================================
//  THREE.JS MAIN ORB (Now Playing — Morphing Sphere + Particles)
// =============================================

(function initMainOrb() {
  const canvas = document.getElementById('mainOrbCanvas');
  if (!canvas) return;
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
  camera.position.z = 3.2;

  // ---- Morphing sphere ----
  const geo = new THREE.IcosahedronGeometry(1.0, 5);
  const origPos = geo.attributes.position.array.slice();
  const mat = new THREE.MeshPhongMaterial({
    color: new THREE.Color(0x0d0626),
    emissive: new THREE.Color(0x6b21a8), emissiveIntensity: 0.85,
    specular: new THREE.Color(0xffffff), shininess: 90,
    transparent: true, opacity: 0.92,
  });
  const sphere = new THREE.Mesh(geo, mat);
  scene.add(sphere);

  // ---- Wireframe overlay ----
  const wireMat = new THREE.MeshBasicMaterial({ color: 0xa78bfa, wireframe: true, transparent: true, opacity: 0.10 });
  const wireframe = new THREE.Mesh(new THREE.IcosahedronGeometry(1.05, 3), wireMat);
  scene.add(wireframe);

  // ---- Particle cloud ----
  const PC = 1400;
  const pGeo = new THREE.BufferGeometry();
  const pPos = new Float32Array(PC * 3);
  const pPhase = new Float32Array(PC), pRadius = new Float32Array(PC);
  const pSpeed = new Float32Array(PC), pTheta = new Float32Array(PC), pPhi = new Float32Array(PC);
  for (let i = 0; i < PC; i++) {
    pPhase[i]  = Math.random() * Math.PI * 2;
    pRadius[i] = 1.8 + Math.random() * 5.5;
    pSpeed[i]  = 0.04 + Math.random() * 0.14;
    pTheta[i]  = Math.random() * Math.PI * 2;
    pPhi[i]    = Math.acos(2 * Math.random() - 1);
  }
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  const pMat = new THREE.PointsMaterial({ color: 0xa78bfa, size: 0.030, transparent: true, opacity: 0.70, sizeAttenuation: true });
  scene.add(new THREE.Points(pGeo, pMat));

  // ---- Lights ----
  scene.add(new THREE.AmbientLight(0x0d0026, 4));
  const pLight1 = new THREE.PointLight(0xa78bfa, 6, 14);
  scene.add(pLight1);
  const pLight2 = new THREE.PointLight(0x67e8f9, 4, 12);
  scene.add(pLight2);
  const pLight3 = new THREE.PointLight(0xf472b6, 3, 10);
  scene.add(pLight3);
  // no glow sphere — removed

  function resize() {
    const s = Math.min(canvas.offsetWidth || 300, 420);
    renderer.setSize(s, s, false);
  }
  resize();
  window.addEventListener('resize', resize);

  // ---- Auto color palette — cycle smoothly through hues ----
  // Each palette is [sphereHue, particleHue, glowHue]
  const PALETTES = [
    [0.76, 0.54, 0.88],  // violet → cyan → pink
    [0.54, 0.76, 0.35],  // cyan → violet → green
    [0.88, 0.96, 0.76],  // pink → red-pink → cyan
    [0.35, 0.54, 0.76],  // green → cyan → violet
    [0.05, 0.88, 0.54],  // orange → pink → cyan
  ];
  let paletteIdx = 0, paletteMix = 0;
  const PALETTE_DURATION = 8; // seconds per palette

  let lastBass = 0, lastMid = 0, lastTreble = 0, lastAvg = 0;

  function lerpHue(a, b, t) {
    // shortest-path hue interpolation
    let d = b - a;
    if (d >  0.5) d -= 1;
    if (d < -0.5) d += 1;
    return (a + d * t + 1) % 1;
  }

  function animateMain() {
    requestAnimationFrame(animateMain);
    if (!State.nowPlayingOpen) return;
    const t = performance.now() / 1000;

    // ---- Freq analysis ----
    const freq = _getFreq();
    let bass, mid, treble, avg;
    if (freq) { bass = freq.bass; mid = freq.mid; treble = freq.treble; avg = freq.avg; }
    else {
      bass   = 0.07 + Math.sin(t * 0.75) * 0.04;
      mid    = 0.05 + Math.sin(t * 1.10) * 0.03;
      treble = 0.03 + Math.sin(t * 1.80) * 0.02;
      avg    = (bass + mid + treble) / 3;
    }
    lastBass   += (bass   - lastBass)   * 0.08;
    lastMid    += (mid    - lastMid)    * 0.08;
    lastTreble += (treble - lastTreble) * 0.08;
    lastAvg    += (avg    - lastAvg)    * 0.08;

    // ---- Auto palette cycling ----
    paletteMix = (t % (PALETTE_DURATION * PALETTES.length)) / PALETTE_DURATION;
    const curIdx  = Math.floor(paletteMix) % PALETTES.length;
    const nextIdx = (curIdx + 1) % PALETTES.length;
    const blend   = paletteMix - Math.floor(paletteMix);
    const curP  = PALETTES[curIdx];
    const nextP = PALETTES[nextIdx];
    const hSphere = lerpHue(curP[0], nextP[0], blend);
    const hPart   = lerpHue(curP[1], nextP[1], blend);
    const hGlow   = lerpHue(curP[2], nextP[2], blend);

    // ---- Soft vertex morphing (reduced, dreamy) ----
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const ox = origPos[i*3], oy = origPos[i*3+1], oz = origPos[i*3+2];
      const len = Math.sqrt(ox*ox + oy*oy + oz*oz);
      const nx = ox/len, ny = oy/len, nz = oz/len;
      const n1 = Math.sin(nx*3 + t*0.9) * Math.cos(ny*3 + t*1.1);
      const n2 = Math.sin(nx*5 + t*1.4) * Math.cos(nz*5 + t*1.2) * 0.5;
      // much softer deformation — max 0.12 vs old 0.28
      const d = lastBass * 0.12 * ((n1+1)*0.5) + lastMid * 0.07 * ((n2+1)*0.5);
      pos.setXYZ(i, ox + nx * d, oy + ny * d, oz + nz * d);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();

    // ---- Smooth rotation ----
    sphere.rotation.y = t * 0.18;
    sphere.rotation.x = Math.sin(t * 0.22) * 0.14;
    wireframe.rotation.y = sphere.rotation.y * 1.15;
    wireframe.rotation.x = -sphere.rotation.x * 0.8;

    // ---- Gentle bass pulse ----
    const sc = 1 + lastBass * 0.05;
    sphere.scale.setScalar(sc);
    wireframe.scale.setScalar(sc + 0.02);

    // ---- Auto color — sphere ----
    mat.emissive.setHSL(hSphere, 0.80, 0.30 + lastBass * 0.12);
    mat.emissiveIntensity = 0.80 + lastBass * 1.0;
    mat.specular.setHSL((hSphere + 0.10) % 1, 0.9, 0.80);

    // ---- Auto color — wireframe ----
    wireMat.color.setHSL(hPart, 0.85, 0.70);

    // ---- Orbiting lights with matching hues ----
    const lr = 3;
    pLight1.position.set(Math.sin(t * 0.45) * lr, Math.cos(t * 0.32) * lr, Math.sin(t * 0.67) * lr);
    pLight2.position.set(Math.cos(t * 0.38) * lr, Math.sin(t * 0.55) * lr, Math.cos(t * 0.58) * lr);
    pLight3.position.set(Math.cos(t * 0.28) * lr, Math.sin(t * 0.20) * lr, Math.sin(t * 0.48) * lr);
    pLight1.color.setHSL(hSphere, 0.85, 0.65);
    pLight2.color.setHSL(hPart,   0.85, 0.65);
    pLight3.color.setHSL(hGlow,   0.85, 0.65);
    pLight1.intensity = 5 + lastBass * 6;
    pLight2.intensity = 3 + lastTreble * 4;
    pLight3.intensity = 2 + lastMid * 3;

    // ---- Particles ----
    const beatMult = 1 + lastAvg * 1.5;
    const ppa = pGeo.attributes.position;
    for (let i = 0; i < PC; i++) {
      pPhase[i] += pSpeed[i] * 0.006 * beatMult;
      const r = pRadius[i] * (1 + lastBass * 0.28 * Math.sin(pPhase[i] * 2));
      const theta = pTheta[i] + pPhase[i];
      const phi   = pPhi[i] + Math.sin(t * 0.22 + i * 0.01) * 0.14;
      ppa.setXYZ(i,
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.sin(phi) * Math.sin(theta),
        r * Math.cos(phi)
      );
    }
    ppa.needsUpdate = true;
    pMat.color.setHSL(hPart, 0.85, 0.72);
    pMat.size = 0.022 + lastAvg * 0.024;

    renderer.render(scene, camera);
  }
  animateMain();
})();

// =============================================
//  USER / SESSION SETUP
// =============================================

function initUser() {
  const { name, avatar, username, color } = State.session;
  const avatarEl = document.getElementById('sidebarAvatar');
  const nameEl   = document.getElementById('sidebarName');
  const topAvatar = document.getElementById('topbarAvatar');

  if (avatarEl) { avatarEl.textContent = avatar || '?'; avatarEl.style.background = `linear-gradient(135deg, ${color || '#8b5cf6'}, ${color ? color + '88' : '#6d28d9'})`; }
  if (nameEl)   nameEl.textContent = name || 'User';
  if (topAvatar){ topAvatar.textContent = avatar || '?'; topAvatar.style.background = `linear-gradient(135deg, ${color || '#8b5cf6'}, ${color ? color + '88' : '#6d28d9'})`; }

  document.getElementById('ddName').textContent = name || '—';
  document.getElementById('ddUser').textContent = username || '—';

  // Ensure user entry in storage
  if (username && !State.users[username]) {
    State.users[username] = { favorites: [] };
    localStorage.setItem('musify_users', JSON.stringify(State.users));
  }
}

function getFavorites() {
  const { username } = State.session;
  return (State.users[username] && State.users[username].favorites) || [];
}

function saveFavorites(favs) {
  const { username } = State.session;
  if (!State.users[username]) State.users[username] = {};
  State.users[username].favorites = favs;
  localStorage.setItem('musify_users', JSON.stringify(State.users));
}

function isFavorited(trackId) {
  return getFavorites().some(t => t.id === trackId);
}

function toggleFavorite(track) {
  const favs = getFavorites();
  const idx = favs.findIndex(t => t.id === track.id);
  if (idx >= 0) {
    favs.splice(idx, 1);
    showToast(`Removed from Favorites`, 'info', 'fa-heart-crack');
  } else {
    favs.push(track);
    showToast(`Added to Favorites`, 'success', 'fa-heart');
  }
  saveFavorites(favs);
  updateFavButtons(track.id);
  if (State.currentView === 'favorites') renderFavorites();
}

function toggleCurrentFavorite() {
  if (!State.currentTrack) return;
  toggleFavorite(State.currentTrack);
  updatePlayerFavBtn();
}

function updatePlayerFavBtn() {
  if (!State.currentTrack) return;
  const active = isFavorited(State.currentTrack.id);
  ['playerFavBtn', 'nppFavBtn'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('active', active);
  });
}

function updateFavButtons(trackId) {
  document.querySelectorAll(`.fav-btn-overlay[data-id="${trackId}"]`).forEach(btn => {
    btn.classList.toggle('favorited', isFavorited(trackId));
    btn.title = isFavorited(trackId) ? 'Remove from Favorites' : 'Add to Favorites';
  });
  document.querySelectorAll(`.track-list-fav[data-id="${trackId}"]`).forEach(btn => {
    btn.classList.toggle('favorited', isFavorited(trackId));
  });
  updatePlayerFavBtn();
}

// =============================================
//  TRACK RENDERING
// =============================================

function formatDuration(seconds) {
  if (!seconds || isNaN(seconds)) return '—';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function createTrackCard(track, index = 0) {
  const fav = isFavorited(track.id);
  const isPlaying = State.currentTrack && State.currentTrack.id === track.id && State.isPlaying;
  const cover = track.cover || `https://picsum.photos/seed/${encodeURIComponent(track.id)}/300/300`;
  const safeId = escHtml(String(track.id));

  return `
    <div class="track-card" data-id="${safeId}" data-index="${index}" onclick="playTrackFromList(${index})">
      <div class="track-card-cover">
        <img src="${escHtml(cover)}" alt="${escHtml(track.title)}" loading="lazy" onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22300%22 height=%22300%22 viewBox=%220 0 300 300%22%3E%3Crect width=%22300%22 height=%22300%22 fill=%22%230d0c1e%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 text-anchor=%22middle%22 dy=%22.3em%22 font-size=%22100%22 fill=%22%23a78bfa%22%3E%E2%99%AB%3C/text%3E%3C/svg%3E'" />
        <div class="track-card-overlay">
          <button class="play-btn-overlay" onclick="event.stopPropagation();playTrackFromList(${index})">
            <i class="fas fa-${isPlaying ? 'pause' : 'play'}"></i>
          </button>
        </div>
        <button class="fav-btn-overlay ${fav ? 'favorited' : ''}" data-id="${safeId}" title="${fav ? 'Remove from Favorites' : 'Add to Favorites'}"
          onclick="event.stopPropagation();toggleFavoriteById(this.dataset.id)">
          <i class="fas fa-heart"></i>
        </button>
      </div>
      <div class="track-card-info">
        <div class="track-card-title" title="${escHtml(track.title)}">${escHtml(track.title)}</div>
        <div class="track-card-artist">${escHtml(track.artist)}</div>
      </div>
    </div>`;
}

// Map of list-context to track arrays, keyed by a list ID
const _listQueues = {};
let _listQueueCounter = 0;

function createTrackListItem(track, index, queueList = null) {
  const fav = isFavorited(track.id);
  const isPlaying = State.currentTrack && State.currentTrack.id === track.id;
  const cover = track.cover || `https://picsum.photos/seed/${escHtml(track.id)}/300/300`;

  // All items rendered in one call share the same listId — caller must pass it via track._listCtx
  // We use a data attribute approach: listId is set externally via wrapListRender
  const listId = track._renderListId || 'default';

  return `
    <div class="track-list-item ${isPlaying ? 'playing' : ''}" data-id="${escHtml(String(track.id))}" data-list="${escHtml(listId)}" data-index="${index}" onclick="handleListItemClick(this)">
      <div class="track-list-num">${isPlaying ? '<i class="fas fa-volume-high" style="font-size:11px;"></i>' : index + 1}</div>
      <img class="track-list-thumb" src="${escHtml(cover)}" alt="${escHtml(track.title)}" loading="lazy" onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2240%22 height=%2240%22 viewBox=%220 0 40 40%22%3E%3Crect width=%2240%22 height=%2240%22 fill=%22%231e1b4b%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 text-anchor=%22middle%22 dy=%22.3em%22 font-size=%2216%22 fill=%22%238b5cf6%22%3E%E2%99%AB%3C/text%3E%3C/svg%3E'" />
      <div class="track-list-info">
        <div class="track-list-title truncate">${escHtml(track.title)}</div>
        <div class="track-list-artist truncate">${escHtml(track.artist)}</div>
      </div>
      <button class="track-list-fav ${fav ? 'favorited' : ''}" data-id="${escHtml(String(track.id))}" onclick="event.stopPropagation();toggleFavoriteById(this.dataset.id)" title="Favorite">
        <i class="fas fa-heart"></i>
      </button>
      <div class="track-list-duration">${formatDuration(track.duration)}</div>
    </div>`;
}

// Tag tracks with a list ID before rendering, return the HTML
function renderTracksAsList(tracks) {
  if (!tracks || !tracks.length) return '';
  const listId = `q${_listQueueCounter++}`;
  _listQueues[listId] = tracks;
  // Temporarily tag each track for this render
  tracks.forEach(t => { t._renderListId = listId; });
  const html = tracks.map((t, i) => createTrackListItem(t, i)).join('');
  // Remove tags after rendering
  tracks.forEach(t => { delete t._renderListId; });
  return html;
}

// =============================================
//  SMART RADIO (Spotify-like auto queue)
// =============================================

function activateSmartRadio(track) {
  const sr = State.smartRadio;
  sr.active = true;
  sr.lang = track.lang;
  sr.tracks = [];
  sr.index = 0;
  sr.fetching = true;

  JamendoAPI.getSimilarTracks(track, 40).then(similar => {
    sr.tracks = similar.filter(t => t.id !== track.id);
    sr.index = 0;
    mergeIntoAll(sr.tracks);
    sr.fetching = false;
    showToast('Smart Radio ready — similar songs queued', 'info', 'fa-radio');
  }).catch(() => {
    // Fallback: pick from already-loaded tracks of same language
    sr.tracks = State.allTracks
      .filter(t => t.lang === track.lang && t.id !== track.id)
      .sort(() => Math.random() - 0.5);
    sr.fetching = false;
  });
}

function deactivateSmartRadio() {
  State.smartRadio.active = false;
  State.smartRadio.tracks = [];
}

function handleListItemClick(el) {
  const listId = el.dataset.list;
  const index = parseInt(el.dataset.index, 10);
  const queue = _listQueues[listId] || State.queue;
  State.queue = queue;
  State.queueIndex = index;
  const track = queue[index];

  // Activate Spotify-like smart radio when playing from search results
  if (State.currentView === 'search' && track) {
    activateSmartRadio(track);
  } else {
    deactivateSmartRadio();
  }

  playTrack(track);
}

function toggleFavoriteById(trackId) {
  // Look in allTracks, trending, favorites, listQueues, and currentTrack
  let track = State.allTracks.find(t => t.id === trackId)
    || State.trendingTracks.find(t => t.id === trackId)
    || getFavorites().find(t => t.id === trackId)
    || (State.currentTrack && State.currentTrack.id === trackId ? State.currentTrack : null);

  // Also search stored list queues
  if (!track) {
    for (const list of Object.values(_listQueues)) {
      const found = list.find(t => t.id === trackId);
      if (found) { track = found; break; }
    }
  }
  if (track) toggleFavorite(track);
}

function escHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// =============================================
//  VIEWS
// =============================================

function switchView(viewName, triggerEl) {
  State.currentView = viewName;

  // Desktop nav
  document.querySelectorAll('.nav-item[data-view]').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('[data-view="' + viewName + '"]').forEach(el => el.classList.add('active'));

  // Mobile nav
  document.querySelectorAll('.mobile-nav-item').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.mobile-nav-item[data-view="' + viewName + '"]').forEach(el => el.classList.add('active'));

  // Views
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const viewEl = document.getElementById('view-' + viewName);
  if (viewEl) viewEl.classList.add('active');

  // Close mobile sidebar
  closeMobileSidebar();

  // Lazy load
  if (viewName === 'favorites') renderFavorites();
  if (viewName === 'library') renderLibrary();
  if (viewName === 'new' && !State.newTracks) loadNewReleasesView();
  if (viewName === 'search') {
    setTimeout(() => {
      const si = document.getElementById('searchInput');
      if (si) si.focus();
    }, 100);
  }
}

// =============================================
//  LOADING HOME DATA — PARALLEL MULTI-SECTION
// =============================================

// Merge tracks into allTracks without duplicates
function mergeIntoAll(tracks) {
  tracks.forEach(t => {
    if (!State.allTracks.find(a => a.id === t.id)) State.allTracks.push(t);
  });
}

function skeletonCards(n) {
  return Array(n).fill(`
    <div class="skeleton-card">
      <div class="skeleton skeleton-cover"></div>
      <div style="padding:10px 12px 12px;display:flex;flex-direction:column;gap:6px;">
        <div class="skeleton skeleton-title"></div>
        <div class="skeleton skeleton-artist"></div>
      </div>
    </div>`).join('');
}
function skeletonRows(n) {
  return Array(n).fill(`
    <div class="skeleton-row">
      <div class="skeleton skeleton-num"></div>
      <div class="skeleton skeleton-thumb"></div>
      <div style="flex:1;min-width:0;display:flex;flex-direction:column;">
        <div class="skeleton skeleton-row-title"></div>
        <div class="skeleton skeleton-row-artist"></div>
      </div>
      <div class="skeleton skeleton-dur"></div>
    </div>`).join('');
}

async function loadHomeSections() {
  // Show skeletons immediately
  const fg = document.getElementById('featuredGrid');
  const tl = document.getElementById('trendingList');
  const nl = document.getElementById('newReleasesList');
  if (fg) fg.innerHTML = skeletonCards(6);
  if (tl) tl.innerHTML = skeletonRows(5);
  if (nl) nl.innerHTML = skeletonRows(5);

  try {
    // Fetch ALL sections in parallel
    const [featured, trending, newTracks] = await Promise.allSettled([
      JamendoAPI.getFeatured(50),
      JamendoAPI.getTrending(20),
      JamendoAPI.getNewReleases(20),
    ]);

    const get = r => r.status === 'fulfilled' ? r.value : [];

    const featuredTracks  = get(featured);
    const trendingTracks  = get(trending);
    const newTracks_      = get(newTracks);

    // Merge everything into allTracks library
    [featuredTracks, trendingTracks, newTracks_]
      .forEach(mergeIntoAll);

    State.trendingTracks = trendingTracks;
    State.allFeatured = featuredTracks;
    State.featuredShown = 0;

    // Render featured cards
    renderFeaturedPage();

    // Render list sections
    if (tl) tl.innerHTML = trendingTracks.length ? renderTracksAsList(trendingTracks.slice(0, 10)) : '<div style="color:var(--text-secondary);padding:20px;">Nothing trending right now.</div>';
    if (nl) nl.innerHTML = newTracks_.length ? renderTracksAsList(newTracks_.slice(0, 10)) : '<div style="color:var(--text-secondary);padding:20px;">No new releases found.</div>';

    // Set initial queue to featured
    State.queue = [...featuredTracks];
    State.featuredOffset = 50;

    showToast(`Loaded ${State.allTracks.length} tracks`, 'success', 'fa-check-circle');
  } catch(e) {
    console.error('loadHomeSections error:', e);
    if (fg) fg.innerHTML = '<div style="color:var(--text-secondary);grid-column:1/-1;padding:20px;">Could not load tracks. Check your connection.</div>';
  }
}

function renderFeaturedPage() {
  const grid = document.getElementById('featuredGrid');
  if (!grid || !State.allFeatured) return;
  const end = Math.min(State.featuredShown + 24, State.allFeatured.length);
  const slice = State.allFeatured.slice(0, end);
  grid.innerHTML = slice.map((t, i) => createTrackCard(t, i)).join('');
  State.featuredShown = end;
  const btn = document.getElementById('featuredMoreBtn');
  if (btn) btn.textContent = end >= State.allFeatured.length ? 'Reload' : 'Load More';
}

async function loadMoreFeatured() {
  if (!State.allFeatured || State.featuredShown >= State.allFeatured.length) {
    // Fetch more from API
    const more = await JamendoAPI.getMoreTracks('featured', State.featuredOffset, 50);
    if (!more.length) { showToast('No more tracks', 'info'); return; }
    State.allFeatured = [...(State.allFeatured || []), ...more];
    mergeIntoAll(more);
    State.featuredOffset += more.length;
  }
  renderFeaturedPage();
  showToast(`Showing ${State.featuredShown} featured tracks`, 'info');
}

function playAllFeatured() {
  deactivateSmartRadio();
  if (State.allFeatured && State.allFeatured.length) {
    State.queue = [...State.allFeatured];
    State.queueIndex = 0;
    playTrack(State.queue[0]);
  } else {
    loadHomeSections().then(() => {
      if (State.queue.length) { State.queueIndex = 0; playTrack(State.queue[0]); }
    });
  }
}

// Alias for hero button
function loadFeaturedTracks() { return loadHomeSections(); }

// NEW RELEASES view
let newOffset = 0;
async function loadNewReleasesView() {
  const el = document.getElementById('newReleasesFull');
  if (!el) return;
  el.innerHTML = skeletonRows(8);
  newOffset = 0;
  try {
    const tracks = await JamendoAPI.getNewReleases(50);
    mergeIntoAll(tracks);
    State.newTracks = tracks;
    newOffset = tracks.length;
    el.innerHTML = tracks.length ? renderTracksAsList(tracks) : '<div style="color:var(--text-secondary);padding:20px;">No new releases found.</div>';
    State.queue = [...tracks];
  } catch(e) {
    el.innerHTML = '<div style="color:var(--text-secondary);padding:20px;">Could not load new releases.</div>';
  }
}

async function loadMoreNew() {
  const more = await JamendoAPI.getMoreTracks('new', newOffset, 50);
  if (!more.length) { showToast('No more new releases', 'info'); return; }
  mergeIntoAll(more);
  newOffset += more.length;
  State.newTracks = [...(State.newTracks || []), ...more];
  const el = document.getElementById('newReleasesFull');
  if (el) el.innerHTML = renderTracksAsList(State.newTracks);
  State.queue = [...(State.newTracks || [])];
  showToast(`Loaded ${more.length} more`, 'success');
}

// Helper to load any list into library view
async function loadIntoLibrary(type) {
  const list = document.getElementById('libraryList');
  if (!list) return;
  list.innerHTML = skeletonRows(6);
  const header = document.querySelector('#view-library .section-header h2');
  if (header) header.textContent = type.charAt(0).toUpperCase() + type.slice(1);
  try {
    let tracks = [];
    if (type === 'trending') tracks = await JamendoAPI.getTrending(50);
    else if (type === 'new') tracks = await JamendoAPI.getNewReleases(50);
    mergeIntoAll(tracks);
    State.queue = [...tracks];
    renderList('libraryList', tracks);
  } catch(e) {
    list.innerHTML = '<div style="color:var(--text-secondary);padding:20px;">Could not load.</div>';
  }
}

async function browseGenre(genre) {
  switchView('library', null);
  const list = document.getElementById('libraryList');
  if (list) list.innerHTML = skeletonRows(8);
  const header = document.querySelector('#view-library .section-header h2');
  const label = genre.charAt(0).toUpperCase() + genre.slice(1);
  if (header) header.innerHTML = `<i class="fas fa-music" style="margin-right:8px;color:var(--accent-purple);"></i>${label} Music`;

  try {
    const tracks = await JamendoAPI.getByGenre(genre, 50);
    mergeIntoAll(tracks);
    State.queue = [...tracks];
    renderList('libraryList', tracks);
    showToast(`${tracks.length} ${label} tracks loaded`, 'success');
  } catch(e) {
    if (list) list.innerHTML = '<div style="color:var(--text-secondary);padding:20px;">Could not load genre tracks.</div>';
  }
}

async function browseLanguage(lang) {
  switchView('library', null);
  const list = document.getElementById('libraryList');
  if (list) list.innerHTML = skeletonRows(8);
  const header = document.querySelector('#view-library .section-header h2');
  const sortBtns = document.querySelector('#view-library .section-header div');
  const langName = JamendoAPI.LANGUAGES[lang] || lang.toUpperCase();
  if (header) header.innerHTML = `<i class="fas fa-globe" style="margin-right:8px;color:var(--accent-cyan);"></i>${langName} Music`;

  // Add a "Load More" button next to sort controls
  if (sortBtns) {
    // Remove any previous load-more for language
    const prev = document.getElementById('langLoadMoreBtn');
    if (prev) prev.remove();
    const btn = document.createElement('button');
    btn.id = 'langLoadMoreBtn';
    btn.className = 'btn btn-ghost';
    btn.style.cssText = 'padding:6px 14px;font-size:12px;';
    btn.textContent = 'Load More';
    btn.onclick = () => browseLanguage(lang);
    sortBtns.prepend(btn);
  }

  try {
    const tracks = await JamendoAPI.getByLanguage(lang, 80);
    mergeIntoAll(tracks);
    State.queue = [...tracks];
    renderList('libraryList', tracks);
    showToast(`${tracks.length} ${langName} tracks loaded`, 'success');
  } catch(e) {
    if (list) list.innerHTML = '<div style="color:var(--text-secondary);padding:20px;">Could not load language tracks.</div>';
  }
}

async function browseMood(mood) {
  switchView('library', null);
  const list = document.getElementById('libraryList');
  if (list) list.innerHTML = skeletonRows(8);
  const header = document.querySelector('#view-library .section-header h2');
  const label = mood.charAt(0).toUpperCase() + mood.slice(1);
  if (header) header.innerHTML = `<i class="fas fa-face-smile" style="margin-right:8px;color:var(--accent-pink);"></i>${label} Vibes`;

  try {
    const tracks = await JamendoAPI.getByMood(mood, 50);
    mergeIntoAll(tracks);
    State.queue = [...tracks];
    renderList('libraryList', tracks);
    showToast(`${tracks.length} ${label} tracks loaded`, 'success');
  } catch(e) {
    if (list) list.innerHTML = '<div style="color:var(--text-secondary);padding:20px;">Could not load mood tracks.</div>';
  }
}

// =============================================
//  SEARCH
// =============================================

let _searchFilter = 'song';

function setSearchFilter(type, btn) {
  _searchFilter = type;
  document.querySelectorAll('.sft').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  // Re-run search with new filter if there's a query
  const q = document.getElementById('searchInput').value.trim();
  if (q) performSearch(q);
}

let searchDebounce = null;
document.getElementById('globalSearch').addEventListener('input', function() {
  const q = this.value.trim();
  if (q.length > 1) {
    switchView('search', null);
    document.getElementById('searchInput').value = q;
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => performSearch(q), 500);
  }
});

document.getElementById('searchInput').addEventListener('input', function() {
  clearTimeout(searchDebounce);
  const q = this.value.trim();
  if (!q) {
    document.getElementById('searchResults').innerHTML = '';
    document.getElementById('searchEmpty').style.display = 'block';
    document.getElementById('searchNoResult').style.display = 'none';
    return;
  }
  searchDebounce = setTimeout(() => performSearch(q), 500);
});

document.getElementById('searchInput').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') { clearTimeout(searchDebounce); performSearch(this.value.trim()); }
});

function doSearch() {
  const q = document.getElementById('searchInput').value.trim();
  if (q) performSearch(q);
}

async function performSearch(query) {
  if (!query) return;
  const results = document.getElementById('searchResults');
  const empty = document.getElementById('searchEmpty');
  const noResult = document.getElementById('searchNoResult');

  empty.style.display = 'none';
  noResult.style.display = 'none';
  results.innerHTML = skeletonRows(8);

  const tracks = await JamendoAPI.searchTracks(query, 120, _searchFilter);

  if (tracks.length === 0) {
    results.innerHTML = '';
    noResult.style.display = 'block';
    return;
  }

  mergeIntoAll(tracks);

  // Queue = search results first, then all other loaded tracks
  const searchIds = new Set(tracks.map(t => t.id));
  const rest = State.allTracks.filter(t => !searchIds.has(t.id));
  State.queue = [...tracks, ...rest];

  results.innerHTML = renderTracksAsList(tracks);

  // Background: pad the queue with 100+ related tracks so playback never stops
  _padQueueInBackground(tracks[0], searchIds);
}

// Silently fetch more tracks and append to State.queue so playback has infinite fuel
async function _padQueueInBackground(seedTrack, existingIds) {
  if (!seedTrack) return;
  try {
    const lang = seedTrack.lang || 'ta';
    const [byLang, bySimilar] = await Promise.allSettled([
      JamendoAPI.getByLanguage(lang, 80),
      JamendoAPI.getSimilarTracks(seedTrack, 60),
    ]);
    const get = r => (r.status === 'fulfilled' ? r.value : []);
    const extra = [...get(byLang), ...get(bySimilar)];
    mergeIntoAll(extra);
    const qIds = new Set(State.queue.map(t => t.id));
    const toAdd = extra.filter(t => !qIds.has(t.id));
    if (toAdd.length) State.queue.push(...toAdd);
  } catch (_) { /* silent */ }
}

// Fetch fresh tracks when queue is nearly exhausted and append/play
async function _autoRefillQueue() {
  if (State._refilling) return; // debounce
  State._refilling = true;
  showToast('Loading more tracks…', 'info', 'fa-spinner');
  try {
    const seed = State.currentTrack;
    const tracks = await JamendoAPI.getSimilarTracks(seed || { lang: 'ta', artist: '' }, 60);
    const qIds = new Set(State.queue.map(t => t.id));
    const fresh = tracks.filter(t => !qIds.has(t.id));
    if (fresh.length) {
      mergeIntoAll(fresh);
      const insertAt = State.queue.length;
      State.queue.push(...fresh);
      State.queueIndex = insertAt;
      playTrack(State.queue[State.queueIndex]);
    } else {
      // Absolute fallback: wrap to start
      State.queueIndex = 0;
      playTrack(State.queue[0]);
    }
  } catch (_) {
    State.queueIndex = 0;
    playTrack(State.queue[0]);
  } finally {
    State._refilling = false;
  }
}

// =============================================
//  FAVORITES
// =============================================

function renderFavorites() {
  const grid = document.getElementById('favoritesGrid');
  const empty = document.getElementById('favoritesEmpty');
  const favs = getFavorites();

  if (!favs.length) {
    grid.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';
  grid.innerHTML = renderTracksAsList(favs);
}

// =============================================
//  LIBRARY
// =============================================

let librarySortKey = 'title';

function renderLibrary() {
  const list = document.getElementById('libraryList');
  if (!list) return;

  let tracks = [...State.allTracks];
  tracks.sort((a, b) => {
    if (librarySortKey === 'title') return a.title.localeCompare(b.title);
    if (librarySortKey === 'artist') return a.artist.localeCompare(b.artist);
    if (librarySortKey === 'duration') return b.duration - a.duration;
    return 0;
  });

  list.innerHTML = tracks.length
    ? renderTracksAsList(tracks)
    : '<div style="color:var(--text-secondary);padding:20px;">No tracks in library yet. Browse and play some music!</div>';
}

function renderList(containerId, tracks) {
  const el = document.getElementById(containerId);
  if (el) el.innerHTML = renderTracksAsList(tracks);
}

function sortLibrary(key) {
  librarySortKey = key;
  renderLibrary();
}

// =============================================
//  PLAYBACK
// =============================================

function playTrackFromList(index) {
  deactivateSmartRadio(); // explicit play from grid — leave smart radio mode
  State.queueIndex = index;
  playTrack(State.queue[index] || State.allTracks[index]);
}

function playTrack(track) {
  if (!track) return;

  ensureAudioContext();

  // Push the current track to history before switching (max 200 entries)
  if (State.currentTrack && (!State.playHistory.length || State.playHistory[State.playHistory.length - 1].id !== State.currentTrack.id)) {
    State.playHistory.push(State.currentTrack);
    if (State.playHistory.length > 200) State.playHistory.shift();
  }

  State.currentTrack = track;

  const artDefault = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300' viewBox='0 0 300 300'%3E%3Crect width='300' height='300' fill='%231e1b4b'/%3E%3Ctext x='50%25' y='50%25' text-anchor='middle' dy='.3em' font-size='100' fill='%238b5cf6'%3E%E2%99%AB%3C/text%3E%3C/svg%3E`;
  const cover = track.cover || artDefault;
  const audioSrc = track.audio || '';

  // Update player bar
  document.getElementById('playerTitle').textContent = track.title;
  document.getElementById('playerArtist').textContent = track.artist;
  document.getElementById('playerArt').src = cover;
  document.getElementById('playerArt').onerror = function() { this.src = artDefault; };

  // Update now playing panel
  document.getElementById('nppTitle').textContent = track.title;
  document.getElementById('nppArtist').textContent = track.artist;

  updatePlayerFavBtn();

  // Always construct a fallback Jamendo CDN stream URL from the track ID
  const jamendoCDN = `https://mp3l.jamendo.com/?trackid=${encodeURIComponent(track.id)}&format=mp31`;
  const finalAudio = audioSrc || jamendoCDN;

  if (finalAudio) {
    audio.src = finalAudio;
    audio.volume = State.volume;
    audio.muted = State.isMuted;
    audio.load(); // force load new src
    const playPromise = audio.play();
    if (playPromise) {
      playPromise.then(() => {
        State.isPlaying = true;
        updatePlayButtons(true);
        document.getElementById('playerArt').classList.add('spinning');
        const _miniOrb = document.getElementById('miniOrbCanvas');
        if (_miniOrb) _miniOrb.classList.add('active');
      }).catch(err => {
        console.warn('Autoplay blocked or failed:', err.message);
        // Try CDN fallback if primary URL failed
        if (finalAudio !== jamendoCDN) {
          audio.src = jamendoCDN;
          audio.load();
          audio.play().then(() => {
            State.isPlaying = true;
            updatePlayButtons(true);
            document.getElementById('playerArt').classList.add('spinning');
          }).catch(() => {
            showToast('Tap play to start (autoplay blocked)', 'info', 'fa-info-circle');
          });
        } else {
          showToast('Tap play to start (autoplay blocked)', 'info', 'fa-info-circle');
        }
      });
    }
  } else {
    showToast('No audio stream for this track', 'info', 'fa-circle-info');
    State.isPlaying = false;
    updatePlayButtons(false);
  }

  document.title = `${track.title} — MusiFy`;
}

function togglePlay() {
  if (!State.currentTrack) {
    if (State.queue.length) { playTrack(State.queue[0]); State.queueIndex = 0; }
    return;
  }
  ensureAudioContext();
  if (audio.paused) {
    audio.play().then(() => {
      State.isPlaying = true;
      updatePlayButtons(true);
      document.getElementById('playerArt').classList.add('spinning');
    }).catch(() => {});
  } else {
    audio.pause();
    State.isPlaying = false;
    updatePlayButtons(false);
    document.getElementById('playerArt').classList.remove('spinning');
  }
}

function updatePlayButtons(playing) {
  const icon = playing ? 'fa-pause' : 'fa-play';
  ['playPauseBtn', 'mobilePlayBtn', 'nppPlayBtn'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) { const i = btn.querySelector('i'); if (i) { i.className = `fas ${icon}`; } }
  });
  if (!playing) document.getElementById('visualizerCanvas') && document.getElementById('visualizerCanvas').classList.remove('visible');
  else document.getElementById('visualizerCanvas') && document.getElementById('visualizerCanvas').classList.add('visible');
  const _miniOrb = document.getElementById('miniOrbCanvas');
  if (_miniOrb) _miniOrb.classList.toggle('active', playing);
}

function nextTrack() {
  if (!State.queue.length) return;

  // ---- Smart Radio mode (Spotify-like) ----
  if (State.smartRadio.active) {
    const sr = State.smartRadio;

    if (sr.tracks.length > 0) {
      let nextT;
      if (State.isShuffled) {
        const idx = Math.floor(Math.random() * sr.tracks.length);
        nextT = sr.tracks[idx];
      } else {
        nextT = sr.tracks[sr.index % sr.tracks.length];
        sr.index++;
        // When 80% through, silently fetch more so we never run dry
        if (!sr.fetching && sr.index >= Math.floor(sr.tracks.length * 0.8)) {
          sr.fetching = true;
          JamendoAPI.getSimilarTracks(State.currentTrack || nextT, 60).then(more => {
            const seen = new Set(sr.tracks.map(t => t.id));
            const fresh = more.filter(t => !seen.has(t.id));
            if (fresh.length) {
              sr.tracks = sr.tracks.concat(fresh);
              mergeIntoAll(fresh);
            }
            sr.fetching = false;
          }).catch(() => { sr.fetching = false; });
        }
      }
      // Append to main queue so prevTrack works
      let qIdx = State.queue.findIndex(t => t.id === nextT.id);
      if (qIdx < 0) { State.queue.push(nextT); qIdx = State.queue.length - 1; }
      State.queueIndex = qIdx;
      playTrack(nextT);
      return;
    }

    // sr.tracks still loading — pick a same-lang track from what's already loaded
    if (sr.fetching) {
      const lang = sr.lang || (State.currentTrack && State.currentTrack.lang);
      const fallbacks = State.allTracks.filter(t =>
        t.lang === lang && t.id !== (State.currentTrack && State.currentTrack.id)
      );
      if (fallbacks.length) {
        const picked = fallbacks[Math.floor(Math.random() * fallbacks.length)];
        let qIdx = State.queue.findIndex(t => t.id === picked.id);
        if (qIdx < 0) { State.queue.push(picked); qIdx = State.queue.length - 1; }
        State.queueIndex = qIdx;
        playTrack(picked);
        return;
      }
      // No fallbacks yet — fall through to normal queue
    }
  }

  // ---- Normal queue logic ----
  if (State.isShuffled) {
    let idx;
    do { idx = Math.floor(Math.random() * State.queue.length); }
    while (State.queue.length > 1 && idx === State.queueIndex);
    State.queueIndex = idx;
    playTrack(State.queue[State.queueIndex]);
    return;
  }

  const next = State.queueIndex + 1;
  if (next >= State.queue.length) {
    // Try extending from allTracks first
    const qIds = new Set(State.queue.map(t => t.id));
    const extras = State.allTracks.filter(t => !qIds.has(t.id));
    if (extras.length) {
      State.queue.push(...extras);
      State.queueIndex = next;
      playTrack(State.queue[State.queueIndex]);
    } else {
      // Fetch a fresh batch from the API — no wrapping, always new music
      _autoRefillQueue();
    }
    return;
  }

  // Proactively pad when < 5 tracks remain so next skips never stall
  if (State.queue.length - next <= 5 && State.currentTrack && !State._refilling) {
    _padQueueInBackground(State.currentTrack, new Set(State.queue.map(t => t.id)));
  }

  State.queueIndex = next;
  playTrack(State.queue[State.queueIndex]);
}

function prevTrack() {
  // If more than 3 seconds in, restart current track
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }

  // Pop the last track from history and play it
  if (State.playHistory.length > 0) {
    const prev = State.playHistory.pop(); // pop so repeated prev keeps going back
    // Find it in the queue to keep queueIndex in sync
    const idx = State.queue.findIndex(t => t.id === prev.id);
    if (idx >= 0) State.queueIndex = idx;
    // Play without pushing to history (we're going backwards)
    ensureAudioContext();
    State.currentTrack = prev;
    const artDefault = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300' viewBox='0 0 300 300'%3E%3Crect width='300' height='300' fill='%231e1b4b'/%3E%3Ctext x='50%25' y='50%25' text-anchor='middle' dy='.3em' font-size='100' fill='%238b5cf6'%3E%E2%99%AB%3C/text%3E%3C/svg%3E`;
    document.getElementById('playerTitle').textContent = prev.title;
    document.getElementById('playerArtist').textContent = prev.artist;
    document.getElementById('playerArt').src = prev.cover || artDefault;
    document.getElementById('nppTitle').textContent = prev.title;
    document.getElementById('nppArtist').textContent = prev.artist;
    updatePlayerFavBtn();
    const finalAudio = prev.audio || `https://mp3l.jamendo.com/?trackid=${encodeURIComponent(prev.id)}&format=mp31`;
    audio.src = finalAudio;
    audio.volume = State.volume;
    audio.muted = State.isMuted;
    audio.load();
    audio.play().then(() => {
      State.isPlaying = true;
      updatePlayButtons(true);
      document.getElementById('playerArt').classList.add('spinning');
    }).catch(() => {});
    document.title = `${prev.title} — MusiFy`;
    return;
  }

  // No history yet — restart current track
  audio.currentTime = 0;
}

function toggleShuffle() {
  State.isShuffled = !State.isShuffled;
  ['shuffleBtn', 'nppShuffleBtn'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.classList.toggle('active', State.isShuffled);
  });
  showToast(State.isShuffled ? 'Shuffle On' : 'Shuffle Off', 'info');
}

function toggleRepeat() {
  const modes = ['none', 'all', 'one'];
  const idx = modes.indexOf(State.repeatMode);
  State.repeatMode = modes[(idx + 1) % modes.length];

  const icons = { none: 'fa-repeat', all: 'fa-repeat', one: 'fa-repeat-1' };
  const active = State.repeatMode !== 'none';
  ['repeatBtn', 'nppRepeatBtn'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) {
      btn.classList.toggle('active', active);
      const i = btn.querySelector('i');
      if (i) i.className = `fas ${icons[State.repeatMode]}`;
    }
  });
  showToast({ none: 'Repeat Off', all: 'Repeat All', one: 'Repeat One' }[State.repeatMode], 'info');
}

function setVolume(val) {
  State.volume = val / 100;
  audio.volume = State.volume;
  audio.muted = State.volume === 0;
  State.isMuted = audio.muted;
  updateVolumeIcon();
  // Sync both sliders
  ['volumeSlider', 'nppVolumeSlider'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = val;
  });
}

function toggleMute() {
  State.isMuted = !State.isMuted;
  audio.muted = State.isMuted;
  updateVolumeIcon();
}

function updateVolumeIcon() {
  const muted = State.isMuted || State.volume === 0;
  const icon = muted ? 'fa-volume-xmark' : (State.volume < 0.4 ? 'fa-volume-low' : 'fa-volume-high');
  ['muteBtn', 'nppVolIcon'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const i = el.tagName === 'BUTTON' ? el.querySelector('i') : el;
    if (i) i.className = `fas ${icon}`;
  });
}

// =============================================
//  PROGRESS BAR
// =============================================

function updateProgress() {
  const { currentTime, duration } = audio;
  const pct = duration ? (currentTime / duration) * 100 : 0;
  const ct = formatDuration(currentTime);
  const dt = formatDuration(duration);

  // Desktop bar
  const pf = document.getElementById('progressFill');
  if (pf) pf.style.width = pct + '%';
  const ctel = document.getElementById('currentTime');
  if (ctel) ctel.textContent = ct;
  const ttel = document.getElementById('totalTime');
  if (ttel) ttel.textContent = dt;

  // NPP
  const nppPf = document.getElementById('nppProgressFill');
  if (nppPf) nppPf.style.width = pct + '%';
  const nppCt = document.getElementById('nppCurrentTime');
  if (nppCt) nppCt.textContent = ct;
  const nppTt = document.getElementById('nppTotalTime');
  if (nppTt) nppTt.textContent = dt;
}

// Click to seek on progress bar
function setupProgressBar(wrapId, fillId) {
  const wrap = document.getElementById(wrapId);
  if (!wrap) return;
  let seeking = false;

  function seek(e) {
    if (!audio.duration) return;
    const rect = wrap.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    audio.currentTime = pct * audio.duration;
  }

  wrap.addEventListener('mousedown', (e) => { seeking = true; seek(e); });
  wrap.addEventListener('touchstart', (e) => { seeking = true; seek(e); }, { passive: true });
  document.addEventListener('mousemove', (e) => { if (seeking) seek(e); });
  document.addEventListener('touchmove', (e) => { if (seeking) seek(e); }, { passive: true });
  document.addEventListener('mouseup', () => { seeking = false; });
  document.addEventListener('touchend', () => { seeking = false; });
}

setupProgressBar('progressBarWrap', 'progressFill');
setupProgressBar('nppProgressWrap', 'nppProgressFill');

// =============================================
//  AUDIO EVENTS
// =============================================

audio.addEventListener('timeupdate', updateProgress);
audio.addEventListener('ended', () => {
  if (State.repeatMode === 'one') {
    audio.currentTime = 0;
    audio.play();
  } else {
    nextTrack();
  }
});
audio.addEventListener('error', (e) => {
  const err = audio.error;
  const code = err ? err.code : 0;
  console.warn('Audio error code:', code, e);

  if (!State.currentTrack) return;

  // MEDIA_ERR_SRC_NOT_SUPPORTED (4) or MEDIA_ERR_NETWORK (2) — try CDN fallback
  const trackId = State.currentTrack.id;
  const cdnUrl = `https://mp3l.jamendo.com/?trackid=${encodeURIComponent(trackId)}&format=mp31`;
  const currentSrc = audio.src;

  if (currentSrc !== cdnUrl) {
    console.info('Retrying with Jamendo CDN URL...');
    audio.src = cdnUrl;
    audio.load();
    audio.play().then(() => {
      State.isPlaying = true;
      updatePlayButtons(true);
    }).catch(() => {
      showToast('Cannot play this track — trying next', 'warning', 'fa-triangle-exclamation');
      setTimeout(nextTrack, 1200);
    });
  } else {
    showToast('Cannot play this track — trying next', 'warning', 'fa-triangle-exclamation');
    setTimeout(nextTrack, 1200);
  }
});
audio.addEventListener('canplay', () => {
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
  if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
  if (e.code === 'ArrowRight') { audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 10); }
  if (e.code === 'ArrowLeft') { audio.currentTime = Math.max(0, audio.currentTime - 10); }
  if (e.code === 'ArrowUp') { setVolume(Math.min(100, State.volume * 100 + 10)); }
  if (e.code === 'ArrowDown') { setVolume(Math.max(0, State.volume * 100 - 10)); }
  if (e.code === 'KeyM') { toggleMute(); }
  if (e.code === 'KeyN') { nextTrack(); }
  if (e.code === 'KeyP') { prevTrack(); }
});

// =============================================
//  NOW PLAYING PANEL
// =============================================

function toggleNowPlaying() {
  State.nowPlayingOpen = !State.nowPlayingOpen;
  const panel = document.getElementById('nowPlayingPanel');
  panel.classList.toggle('open', State.nowPlayingOpen);
}

// =============================================
//  PROFILE DROPDOWN
// =============================================

function toggleProfileDropdown() {
  const dd = document.getElementById('profileDropdown');
  const isOpen = dd.classList.toggle('open');
  if (isOpen) {
    // Close when tapping outside the dropdown or its two triggers
    setTimeout(() => {
      document.addEventListener('click', closeDropdownOnOutside, { once: true });
    }, 50);
  }
}

function closeProfileDropdown() {
  document.getElementById('profileDropdown').classList.remove('open');
}

function closeDropdownOnOutside(e) {
  const dd = document.getElementById('profileDropdown');
  const user = document.getElementById('sidebarUser');
  const topAvatar = document.getElementById('topbarAvatar');
  if (!dd.contains(e.target) && !user.contains(e.target) && !(topAvatar && topAvatar.contains(e.target))) {
    dd.classList.remove('open');
  }
}

function toggleTheme() {
  const isLight = document.body.classList.toggle('light-theme');
  localStorage.setItem('musify_theme', isLight ? 'light' : 'dark');
  const label = document.getElementById('themeLabel');
  if (label) label.textContent = isLight ? 'Dark Theme' : 'Light Theme';
  closeProfileDropdown();
}

function logout() {
  if (!confirm('Sign out of MusiFy?')) return;
  sessionStorage.removeItem('musify_session');
  window.location.href = 'index.html';
}

// =============================================
//  MOBILE SIDEBAR
// =============================================

function toggleMobileSidebar() {
  const sidebar = document.getElementById('sidebar');
  const isOpen = sidebar.classList.toggle('mobile-open');
  // Toggle hamburger → X icon
  const menuBtn = document.getElementById('menuBtn');
  if (menuBtn) {
    const icon = menuBtn.querySelector('i');
    if (icon) icon.className = isOpen ? 'fas fa-xmark' : 'fas fa-bars';
  }
  // Create backdrop once, then show/hide
  let backdrop = document.getElementById('sidebarBackdrop');
  if (!backdrop) {
    backdrop = document.createElement('div');
    backdrop.id = 'sidebarBackdrop';
    backdrop.className = 'sidebar-backdrop';
    backdrop.addEventListener('click', closeMobileSidebar);
    document.body.appendChild(backdrop);
  }
  backdrop.classList.toggle('active', isOpen);
}

function closeMobileSidebar() {
  document.getElementById('sidebar').classList.remove('mobile-open');
  const menuBtn = document.getElementById('menuBtn');
  if (menuBtn) {
    const icon = menuBtn.querySelector('i');
    if (icon) icon.className = 'fas fa-bars';
  }
  const backdrop = document.getElementById('sidebarBackdrop');
  if (backdrop) backdrop.classList.remove('active');
}

// Show hamburger on mobile
function checkMobile() {
  const mobile = window.innerWidth <= 768;
  const menuBtn = document.getElementById('menuBtn');
  const desktopControls = document.getElementById('desktopControls');
  const desktopVolume = document.getElementById('desktopVolume');
  const mobileControls = document.getElementById('mobilePlayerControls');
  if (menuBtn) menuBtn.style.display = mobile ? 'flex' : 'none';
  if (desktopControls) desktopControls.style.display = mobile ? 'none' : 'flex';
  if (desktopVolume) desktopVolume.style.display = mobile ? 'none' : 'flex';
  if (mobileControls) mobileControls.style.display = mobile ? 'flex' : 'none';
}
window.addEventListener('resize', checkMobile);

// =============================================
//  TOAST NOTIFICATIONS
// =============================================

function showToast(msg, type = 'info', icon = null) {
  const icons = { success: 'fa-check-circle', error: 'fa-circle-exclamation', info: 'fa-circle-info', warning: 'fa-triangle-exclamation' };
  const ic = icon || icons[type] || icons.info;
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<i class="fas ${ic}"></i><span>${escHtml(msg)}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(20px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 2800);
}

// =============================================
//  INIT
// =============================================

async function init() {
  // Restore saved theme before anything renders
  if (localStorage.getItem('musify_theme') === 'light') {
    document.body.classList.add('light-theme');
    const label = document.getElementById('themeLabel');
    if (label) label.textContent = 'Dark Theme';
  }
  initUser();
  checkMobile();
  switchView('home', document.querySelector('[data-view="home"]'));
  // Load all home sections in parallel
  await loadHomeSections();
}

document.addEventListener('DOMContentLoaded', init);
