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
//  SHARED PALETTE HELPERS
// =============================================

const _ORB_PALETTES = [
  [0.76, 0.54, 0.88],
  [0.54, 0.76, 0.35],
  [0.88, 0.96, 0.76],
  [0.35, 0.54, 0.76],
  [0.05, 0.88, 0.54],
];
const _PALETTE_DUR = 8;
function _lerpHue(a, b, t) {
  let d = b - a;
  if (d >  0.5) d -= 1;
  if (d < -0.5) d += 1;
  return (a + d * t + 1) % 1;
}
function _getPalette(t) {
  const mix     = (t % (_PALETTE_DUR * _ORB_PALETTES.length)) / _PALETTE_DUR;
  const ci      = Math.floor(mix) % _ORB_PALETTES.length;
  const ni      = (ci + 1) % _ORB_PALETTES.length;
  const bl      = mix - Math.floor(mix);
  const c = _ORB_PALETTES[ci], n = _ORB_PALETTES[ni];
  return [_lerpHue(c[0],n[0],bl), _lerpHue(c[1],n[1],bl), _lerpHue(c[2],n[2],bl)];
}

// =============================================
//  THREE.JS SPHERE ORB (nppSphereCanvas — 300×300)
// =============================================

(function initSphereOrb() {
  const canvas = document.getElementById('nppSphereCanvas');
  if (!canvas) return;
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(300, 300, false);

  const scene  = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
  camera.position.z = 3.2;

  const geo     = new THREE.IcosahedronGeometry(1.0, 5);
  const origPos = geo.attributes.position.array.slice();
  const mat = new THREE.MeshPhongMaterial({
    color: new THREE.Color(0x0d0626),
    emissive: new THREE.Color(0x6b21a8), emissiveIntensity: 0.85,
    specular: new THREE.Color(0xffffff), shininess: 90,
    transparent: true, opacity: 0.92,
  });
  const sphere = new THREE.Mesh(geo, mat);
  scene.add(sphere);

  const wireMat   = new THREE.MeshBasicMaterial({ color: 0xa78bfa, wireframe: true, transparent: true, opacity: 0.10 });
  const wireframe = new THREE.Mesh(new THREE.IcosahedronGeometry(1.05, 3), wireMat);
  scene.add(wireframe);

  scene.add(new THREE.AmbientLight(0x0d0026, 4));
  const pL1 = new THREE.PointLight(0xa78bfa, 6, 14); scene.add(pL1);
  const pL2 = new THREE.PointLight(0x67e8f9, 4, 12); scene.add(pL2);
  const pL3 = new THREE.PointLight(0xf472b6, 3, 10); scene.add(pL3);

  let lBass = 0, lMid = 0, lTreble = 0;

  (function animateSphere() {
    requestAnimationFrame(animateSphere);
    if (!State.nowPlayingOpen) return;
    const t = performance.now() / 1000;
    const freq = _getFreq();
    let bass, mid, treble;
    if (freq) { bass = freq.bass; mid = freq.mid; treble = freq.treble; }
    else { bass = 0.07+Math.sin(t*.75)*.04; mid = 0.05+Math.sin(t*1.1)*.03; treble = 0.03+Math.sin(t*1.8)*.02; }
    lBass   += (bass   - lBass)   * 0.08;
    lMid    += (mid    - lMid)    * 0.08;
    lTreble += (treble - lTreble) * 0.08;

    const [hS, hP, hG] = _getPalette(t);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const ox=origPos[i*3], oy=origPos[i*3+1], oz=origPos[i*3+2];
      const len=Math.sqrt(ox*ox+oy*oy+oz*oz);
      const nx=ox/len, ny=oy/len, nz=oz/len;
      const n1=Math.sin(nx*3+t*.9)*Math.cos(ny*3+t*1.1);
      const n2=Math.sin(nx*5+t*1.4)*Math.cos(nz*5+t*1.2)*.5;
      const d=lBass*.12*((n1+1)*.5)+lMid*.07*((n2+1)*.5);
      pos.setXYZ(i, ox+nx*d, oy+ny*d, oz+nz*d);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();

    sphere.rotation.y    = t*.18;
    sphere.rotation.x    = Math.sin(t*.22)*.14;
    wireframe.rotation.y = sphere.rotation.y*1.15;
    wireframe.rotation.x = -sphere.rotation.x*.8;
    const sc = 1+lBass*.05;
    sphere.scale.setScalar(sc);
    wireframe.scale.setScalar(sc+.02);

    mat.emissive.setHSL(hS, .80, .30+lBass*.12);
    mat.emissiveIntensity = .80+lBass*1.0;
    mat.specular.setHSL((hS+.10)%1, .9, .80);
    wireMat.color.setHSL(hP, .85, .70);

    const lr=3;
    pL1.position.set(Math.sin(t*.45)*lr, Math.cos(t*.32)*lr, Math.sin(t*.67)*lr);
    pL2.position.set(Math.cos(t*.38)*lr, Math.sin(t*.55)*lr, Math.cos(t*.58)*lr);
    pL3.position.set(Math.cos(t*.28)*lr, Math.sin(t*.20)*lr, Math.sin(t*.48)*lr);
    pL1.color.setHSL(hS,.85,.65); pL2.color.setHSL(hP,.85,.65); pL3.color.setHSL(hG,.85,.65);
    pL1.intensity=5+lBass*6; pL2.intensity=3+lTreble*4; pL3.intensity=2+lMid*3;

    renderer.render(scene, camera);
  })();
})();

// =============================================
//  THREE.JS PARTICLE FIELD (mainOrbCanvas — fullscreen)
// =============================================

(function initParticleField() {
  const canvas = document.getElementById('mainOrbCanvas');
  if (!canvas) return;
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene  = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 200);
  camera.position.z = 18;

  const PC = 600;
  const pGeo    = new THREE.BufferGeometry();
  const pPos    = new Float32Array(PC * 3);
  const pPhase  = new Float32Array(PC);
  const pRadius = new Float32Array(PC);
  const pSpeed  = new Float32Array(PC);
  const pTheta  = new Float32Array(PC);
  const pPhi    = new Float32Array(PC);
  for (let i = 0; i < PC; i++) {
    pPhase[i]  = Math.random() * Math.PI * 2;
    pRadius[i] = 3 + Math.random() * 28;
    pSpeed[i]  = 0.015 + Math.random() * 0.06;
    pTheta[i]  = Math.random() * Math.PI * 2;
    pPhi[i]    = Math.acos(2 * Math.random() - 1);
  }
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));

  // ShaderMaterial — each particle rendered as a tiny glowing orb (lit sphere illusion)
  const pMat = new THREE.ShaderMaterial({
    uniforms: {
      uColor:   { value: new THREE.Color(0xa78bfa) },
      uSize:    { value: 120.0 },
      uOpacity: { value: 0.85 },
    },
    vertexShader: `
      uniform float uSize;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = uSize / -mv.z;
        gl_Position  = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform vec3  uColor;
      uniform float uOpacity;
      void main() {
        vec2  uv   = gl_PointCoord - 0.5;
        float dist = length(uv);
        if (dist > 0.5) discard;

        // Sphere body — darken toward edges like a real lit sphere
        float body = 1.0 - smoothstep(0.0, 0.5, dist);
        body = pow(body, 1.6);

        // Specular highlight — offset from center to simulate top-left light
        vec2  specUV   = gl_PointCoord - vec2(0.35, 0.30);
        float specDist = length(specUV);
        float spec     = 1.0 - smoothstep(0.0, 0.13, specDist);
        spec = pow(spec, 2.0);

        // Outer glow halo
        float halo = 1.0 - smoothstep(0.35, 0.50, dist);
        halo = pow(halo, 3.0) * 0.4;

        vec3  col = uColor * body + vec3(1.0) * spec * 0.9 + uColor * halo;
        float a   = clamp(body + halo, 0.0, 1.0) * uOpacity;
        gl_FragColor = vec4(col, a);
      }
    `,
    transparent: true,
    depthWrite:  false,
    blending:    THREE.AdditiveBlending,
  });
  scene.add(new THREE.Points(pGeo, pMat));

  function resize() {
    const panel = document.getElementById('nowPlayingPanel');
    const W = panel ? panel.offsetWidth  || window.innerWidth  : window.innerWidth;
    const H = panel ? panel.offsetHeight || window.innerHeight : window.innerHeight;
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    renderer.setSize(W, H, false);
  }
  resize();
  window.addEventListener('resize', resize);

  let lAvg = 0, lBass = 0;

  (function animateParticles() {
    requestAnimationFrame(animateParticles);
    if (!State.nowPlayingOpen) return;
    const t = performance.now() / 1000;
    const freq = _getFreq();
    let avg, bass;
    if (freq) { avg = freq.avg; bass = freq.bass; }
    else { avg = 0.05+Math.sin(t*.9)*.03; bass = 0.07+Math.sin(t*.75)*.04; }
    lAvg  += (avg  - lAvg)  * 0.08;
    lBass += (bass - lBass) * 0.08;

    const [hS, hP] = _getPalette(t);
    const beatMult = 1 + lAvg * 1.5;
    const ppa = pGeo.attributes.position;
    for (let i = 0; i < PC; i++) {
      pPhase[i] += pSpeed[i] * 0.006 * beatMult;
      const r     = pRadius[i] * (1 + lBass * 0.3 * Math.sin(pPhase[i] * 2));
      const theta = pTheta[i] + pPhase[i];
      const phi   = pPhi[i]   + Math.sin(t * 0.2 + i * 0.01) * 0.12;
      ppa.setXYZ(i,
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.sin(phi) * Math.sin(theta),
        r * Math.cos(phi)
      );
    }
    ppa.needsUpdate = true;
    pMat.uniforms.uColor.value.setHSL(hS, 0.90, 0.70);
    pMat.uniforms.uSize.value  = 120 + lAvg * 60;
    renderer.render(scene, camera);
  })();
})();

// =============================================
//  USER / SESSION SETUP
// =============================================

function initUser() {
  const { name, avatar, username, color } = State.session;
  const orbColor = color || '#7c3aed';
  const orbColor2 = orbColor + 'bb';

  const setAvatar = (letterId, innerId) => {
    const l = document.getElementById(letterId);
    const i = document.getElementById(innerId);
    if (l) l.textContent = avatar || '?';
    if (i) i.style.background = `linear-gradient(135deg, ${orbColor}, ${orbColor2})`;
  };
  setAvatar('sidebarAvatarLetter', 'sidebarAvatarInner');
  setAvatar('topbarAvatarLetter',  'topbarAvatarInner');

  const nameEl = document.getElementById('sidebarName');
  if (nameEl) nameEl.textContent = name || 'User';

  document.getElementById('ddName').textContent = name || '—';
  document.getElementById('ddUser').textContent = username || '—';

  // Ensure user entry exists in storage without overwriting existing favorites
  if (username) {
    try {
      const stored = JSON.parse(localStorage.getItem('musify_users') || '{}');
      if (!stored[username]) {
        stored[username] = { favorites: [] };
        localStorage.setItem('musify_users', JSON.stringify(stored));
      }
      State.users = stored;
    } catch (e) { /* silent */ }
  }
}

function getFavorites() {
  const { username } = State.session;
  if (!username) return [];
  // Always read from localStorage so we never return a stale in-memory copy
  try {
    const stored = JSON.parse(localStorage.getItem('musify_users') || '{}');
    // Keep in-memory State.users in sync
    State.users = stored;
    return (stored[username] && Array.isArray(stored[username].favorites))
      ? stored[username].favorites
      : [];
  } catch { return []; }
}

function saveFavorites(favs) {
  const { username } = State.session;
  if (!username) return;
  // Always read fresh from localStorage before writing to avoid clobbering
  // another tab's changes or a stale in-memory copy
  try {
    const stored = JSON.parse(localStorage.getItem('musify_users') || '{}');
    if (!stored[username]) stored[username] = {};
    stored[username].favorites = favs;
    localStorage.setItem('musify_users', JSON.stringify(stored));
    // Keep in-memory copy in sync
    State.users = stored;
  } catch (e) {
    console.error('[MusiFy] Could not save favorites:', e);
  }
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
  closeAlbumModal();
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

// =============================================
//  ARTIST BROWSE
// =============================================

const LANG_ARTISTS = {
  ta: [
    'A.R. Rahman', 'Anirudh Ravichander', 'Harris Jayaraj',
    'Yuvan Shankar Raja', 'Ilaiyaraaja', 'Sid Sriram',
    'D. Imman', 'G.V. Prakash Kumar', 'Vijay Antony',
    'Haricharan', 'Karthik', 'Anthony Daasan',
    'Shankar Mahadevan', 'Hariharan', 'S.P. Balasubrahmanyam',
    'Unni Krishnan', 'Vijay Yesudas', 'Shreya Ghoshal',
    'Chinmayi', 'Benny Dayal', 'Naresh Iyer',
    'Tippu', 'Divya Menon', 'Vandana Srinivasan',
    'Devan Ekambaram', 'Arjun Janya', 'Deva',
    'Joshua Sridhar', 'Anand Aravindakshan', 'Sathyaprakash',
    'Rita', 'Nithyashree Mahadevan', 'Kalpana',
    'Mano', 'P. Unnikrishnan', 'Mahalakshmi Iyer',
    'K.S. Chitra', 'Sadhana Sargam', 'Srinivas',
    'Kalyani Menon', 'Pradeep', 'Mahathi',
    'Velmurugan', 'Gana Balachandar', 'Sajesh Warrier',
  ],
  ml: [
    'K.J. Yesudas', 'K.S. Chithra', 'Vineeth Sreenivasan',
    'Gopi Sundar', 'Bijibal', 'Shaan Rahman',
    'Alphons Joseph', 'Ouseppachan', 'B. Unnikrishnan',
    'M.G. Sreekumar', 'Sujatha Mohan', 'Rimi Tomy',
    'Manjari', 'Haricharan', 'Jassie Gift',
    'Rex Vijayan', 'Mejo Joseph', 'Vijay Yesudas',
    'Sithara Krishnakumar', 'Kester', 'Najim Arshad',
    'Afsal', 'M. Jayachandran', 'Vidyasagar',
    'Raveendran', 'Johnson', 'Berny Ignatius',
    'Shreya Ghoshal', 'Swetha Mohan', 'Rahul Raj',
    'Shankar Mahadevan', 'Madhu Balakrishnan', 'G. Venugopal',
    'Kavya Ajit', 'Aparna Rajeev', 'Meera Nair',
    'Sujith Karamana', 'Sithara', 'Smitha',
    'Chandrika', 'Padmalatha', 'Satheesh Babu',
    'Mithun Jayaraj', 'Ranjin Raj', 'Shyam Dhar',
  ],
  hi: [
    'Arijit Singh', 'Atif Aslam', 'Shreya Ghoshal',
    'Sonu Nigam', 'Neha Kakkar', 'Kumar Sanu',
    'Alka Yagnik', 'Mohd Rafi', 'Lata Mangeshkar',
    'Kishore Kumar', 'Badshah', 'Pritam',
    'Udit Narayan', 'Vishal Shekhar', 'Jubin Nautiyal',
    'Shankar Mahadevan', 'Hariharan', 'Sunidhi Chauhan',
    'KK', 'Shaan', 'Abhijeet',
    'Kavita Krishnamurthy', 'Asha Bhosle', 'Armaan Malik',
    'Darshan Raval', 'Benny Dayal', 'Monali Thakur',
    'Javed Ali', 'Rahat Fateh Ali Khan', 'Mohit Chauhan',
    'Tulsi Kumar', 'Palak Muchhal', 'Aakanksha Sharma',
    'Amit Trivedi', 'Mika Singh', 'Yo Yo Honey Singh',
    'Guru Randhawa', 'Harrdy Sandhu', 'Dhvani Bhanushali',
    'Papon', 'Rekha Bhardwaj', 'Richa Sharma',
    'Sukhwinder Singh', 'Nakash Aziz', 'Shekhar Ravjiani',
  ],
  en: [
    'Ed Sheeran', 'The Weeknd', 'Taylor Swift',
    'Billie Eilish', 'Adele', 'Dua Lipa',
    'Harry Styles', 'Post Malone', 'Coldplay',
    'Imagine Dragons', 'Charlie Puth', 'Olivia Rodrigo',
    'Bruno Mars', 'Ariana Grande', 'Justin Bieber',
    'Shawn Mendes', 'Sam Smith', 'Lewis Capaldi',
    'Halsey', 'Twenty One Pilots', 'Maroon 5',
    'Justin Timberlake', 'Beyoncé', 'Rihanna',
    'Eminem', 'Drake', 'Selena Gomez',
    'Lady Gaga', 'Katy Perry', 'Pink',
    'John Legend', 'Ellie Goulding', 'Sia',
    'The Chainsmokers', 'Marshmello', 'Calvin Harris',
    'Camila Cabello', 'Lizzo', 'Doja Cat',
    'Khalid', 'H.E.R.', 'Daniel Caesar',
    'Glass Animals', 'Hozier', 'James Arthur',
  ],
};

const LANG_COLORS = {
  ta: [['#7c3aed','#2563eb'], ['#6d28d9','#1d4ed8'], ['#5b21b6','#3b82f6']],
  ml: [['#0891b2','#6d28d9'], ['#0e7490','#7c3aed'], ['#164e63','#5b21b6']],
  hi: [['#d97706','#dc2626'], ['#b45309','#b91c1c'], ['#f59e0b','#ef4444']],
  en: [['#059669','#1d4ed8'], ['#047857','#2563eb'], ['#065f46','#1e40af']],
};

function artistSvgAvatar(name, lang) {
  const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  const colorPairs = LANG_COLORS[lang] || LANG_COLORS.ta;
  const pair = colorPairs[Math.abs(name.charCodeAt(0) + name.charCodeAt(1 % name.length)) % colorPairs.length];
  const [c1, c2] = pair;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">`
    + `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">`
    + `<stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/>`
    + `</linearGradient></defs>`
    + `<rect width="200" height="200" fill="url(#g)"/>`
    + `<text x="100" y="116" text-anchor="middle" font-family="'Space Grotesk',sans-serif" font-size="72" font-weight="700" fill="white" opacity="0.95">${initials}</text>`
    + `</svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

// Fetch real artist photo — tries Wikipedia with multiple fallback terms
async function loadWikiImage(artistName, imgEl) {
  const tries = [
    artistName,
    artistName + ' singer',
    artistName + ' musician',
    artistName + ' actor',
  ];
  for (const term of tries) {
    try {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch(
        'https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(term),
        { signal: ctrl.signal }
      );
      clearTimeout(tid);
      if (!res.ok) continue;
      const data = await res.json();
      const url = data.thumbnail?.source;
      if (url && imgEl && imgEl.isConnected) { imgEl.src = url; return; }
    } catch { /* try next */ }
  }
}

let _currentArtistLang = null;

async function browseLanguage(lang) {
  _currentArtistLang = lang;
  const langName = JamendoAPI.LANGUAGES[lang] || lang.toUpperCase();

  // Switch to artists view
  State.currentView = 'artists';
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-artists').classList.add('active');
  document.querySelectorAll('.nav-item[data-view]').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.mobile-nav-item').forEach(el => el.classList.remove('active'));
  closeMobileSidebar();

  const titleEl = document.getElementById('artistsViewTitle');
  if (titleEl) titleEl.textContent = langName + ' Artists';

  const grid = document.getElementById('artistGrid');
  if (!grid) return;

  const artists = LANG_ARTISTS[lang] || [];
  grid.innerHTML = artists.map((name, idx) => `
    <div class="artist-card" data-artist="${escHtml(name)}" data-lang="${lang}"
         onclick="browseArtist(this.dataset.artist, this.dataset.lang)">
      <div class="artist-cover-wrap">
        <img class="artist-avatar" id="artist-img-${idx}"
             src="${artistSvgAvatar(name, lang)}"
             alt="${escHtml(name)}" />
      </div>
      <div class="artist-card-bottom">
        <div class="artist-name">${escHtml(name)}</div>
      </div>
    </div>
  `).join('');

  // Async load real Wikipedia photos — SVG shown immediately as placeholder
  artists.forEach((name, idx) => {
    const imgEl = document.getElementById('artist-img-' + idx);
    if (imgEl) loadWikiImage(name, imgEl);
  });
}

async function browseArtist(name, lang) {
  _currentArtistLang = lang;

  // Switch to artist detail view
  State.currentView = 'artist-detail';
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-artist-detail').classList.add('active');
  closeMobileSidebar();

  const avatarEl = document.getElementById('artistDetailAvatar');
  const nameEl   = document.getElementById('artistDetailName');
  const metaEl   = document.getElementById('artistDetailMeta');
  const songsEl  = document.getElementById('artistSongsList');
  const albumsEl = document.getElementById('artistAlbumsGrid');

  if (avatarEl) { avatarEl.src = artistSvgAvatar(name, lang || _currentArtistLang || 'ta'); loadWikiImage(name, avatarEl); }
  if (nameEl)   nameEl.textContent = name;
  if (metaEl)   metaEl.textContent = 'Loading songs…';
  if (songsEl)  songsEl.innerHTML  = skeletonRows(6);
  if (albumsEl) albumsEl.innerHTML = '';

  // Helper: filter tracks to ones that genuinely match the artist name
  function _filterByArtist(tracks, name) {
    const nameLower = name.toLowerCase().trim();
    const nameWords = nameLower.split(/\s+/).filter(Boolean);
    function artistMatches(artistField) {
      if (!artistField) return false;
      const af = artistField.toLowerCase();
      return nameWords.every(w => af.includes(w));
    }
    let filtered = tracks.filter(t => artistMatches(t.artist));
    if (filtered.length < 3) {
      const mainWord = nameWords.reduce((a, b) => a.length >= b.length ? a : b, '');
      if (mainWord) filtered = tracks.filter(t => (t.artist || '').toLowerCase().includes(mainWord));
    }
    return filtered;
  }

  // Deduplicate by title+artist fingerprint (catches same song with different IDs)
  function _dedupTracks(tracks) {
    const seen = new Set();
    return tracks.filter(t => {
      const fp = (t.title || '').toLowerCase().replace(/[^a-z0-9]/g, '') +
                 '|' + (t.artist || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      if (seen.has(fp)) return false;
      seen.add(fp);
      return true;
    });
  }

  function _renderArtistView(all, lang) {
    const unique = _dedupTracks(all);
    const songsElR  = document.getElementById('artistSongsList');
    const albumsElR = document.getElementById('artistAlbumsGrid');
    const metaElR   = document.getElementById('artistDetailMeta');
    if (metaElR) metaElR.textContent = unique.length
      ? `${unique.length} song${unique.length !== 1 ? 's' : ''} · ${(JamendoAPI.LANGUAGES[lang] || '')}`.trim()
      : 'No songs found';
    if (songsElR) {
      songsElR.innerHTML = unique.length
        ? renderTracksAsList(unique)
        : '<div style="color:var(--text-2);padding:24px;">No songs found for this artist.</div>';
    }
    if (albumsElR) {
      const albumMap = {};
      unique.forEach(t => {
        const key = t.album || 'Singles';
        if (!albumMap[key]) albumMap[key] = { name: key, cover: t.cover, tracks: [] };
        albumMap[key].tracks.push(t);
      });
      const albums = Object.values(albumMap).sort((a, b) => b.tracks.length - a.tracks.length);
      albumsElR.innerHTML = albums.length ? albums.map(al => `
        <div class="album-card" data-album="${escHtml(al.name)}" onclick="openAlbumView(this.dataset.album)">
          <div class="album-card-cover-wrap">
            <img class="album-card-cover" src="${escHtml(al.cover || '')}" alt="${escHtml(al.name)}"
                 loading="lazy" onerror="this.style.display='none'" />
            <div class="album-card-play"><i class="fas fa-list"></i></div>
          </div>
          <div class="album-card-info">
            <div class="album-card-name">${escHtml(al.name)}</div>
            <div class="album-card-count">${al.tracks.length} song${al.tracks.length !== 1 ? 's' : ''}</div>
          </div>
        </div>
      `).join('') : '<div style="color:var(--text-2);padding:12px 0;">No albums found.</div>';
    }
  }

  try {
    const rawTracks = await JamendoAPI.searchTracks(name, 200, 'artist');
    const all = _filterByArtist(rawTracks, name);
    mergeIntoAll(all);
    State.queue = [...all];
    _renderArtistView(all, lang);
    if (all.length) showToast(`${all.length} songs by ${name}`, 'success');

    // Background top-up: fetch more via getSimilarTracks and append unique results
    if (all.length > 0) {
      JamendoAPI.getSimilarTracks(all[0], 120).then(extra => {
        if (!extra || !extra.length) return;
        // Keep only tracks by this artist from the extra batch
        const artistExtra = _filterByArtist(extra, name);
        if (!artistExtra.length) return;
        const existing = new Set(State.queue.map(t => t.id));
        const fresh = artistExtra.filter(t => !existing.has(t.id));
        if (!fresh.length) return;
        mergeIntoAll(fresh);
        State.queue = [...State.queue, ...fresh];
        _renderArtistView(State.queue.filter(t => {
          const af = (t.artist || '').toLowerCase();
          return name.toLowerCase().split(/\s+/).every(w => af.includes(w));
        }), lang);
        showToast(`+${fresh.length} more songs added`, 'info');
      }).catch(() => {});
    }
  } catch(e) {
    if (songsEl)  songsEl.innerHTML  = '<div style="color:var(--text-2);padding:24px;">Could not load songs.</div>';
    if (metaEl)   metaEl.textContent = 'Error loading';
  }
}

function goBackToArtists() {
  if (_currentArtistLang) browseLanguage(_currentArtistLang);
  else switchView('home', document.querySelector('[data-view=home]'));
}

let _currentAlbumName = '';

function openAlbumView(albumName) {
  const fromQueue = State.queue.filter(t => t.album === albumName);
  const tracks = fromQueue.length
    ? fromQueue
    : State.allTracks.filter(t => t.album === albumName);
  if (!tracks.length) { showToast('No tracks loaded for this album', 'info'); return; }

  _currentAlbumName = albumName;
  const first = tracks[0];

  const coverEl   = document.getElementById('albumModalCover');
  const nameEl    = document.getElementById('albumModalName');
  const artistEl  = document.getElementById('albumModalArtist');
  const countEl   = document.getElementById('albumModalCount');
  const tracksEl  = document.getElementById('albumModalTracks');
  const playAllBtn = document.getElementById('albumModalPlayAll');
  const shuffleBtn = document.getElementById('albumModalShuffle');

  if (coverEl)  { coverEl.src = first.cover || ''; coverEl.alt = escHtml(albumName); }
  if (nameEl)   nameEl.textContent   = albumName;
  if (artistEl) artistEl.textContent = first.artist || '';
  if (countEl)  countEl.textContent  = `${tracks.length} song${tracks.length !== 1 ? 's' : ''} in this album`;
  if (tracksEl) tracksEl.innerHTML   = renderTracksAsList(tracks);

  if (playAllBtn) playAllBtn.onclick = function() { playAlbum(albumName); };
  if (shuffleBtn) shuffleBtn.onclick = function() {
    const shuffled = [...tracks].sort(() => Math.random() - 0.5);
    closeAlbumModal();
    deactivateSmartRadio();
    State.queue = shuffled;
    State.queueIndex = 0;
    playTrack(State.queue[0]);
    showToast(`Shuffling "${albumName}"`, 'success');
  };

  const modal = document.getElementById('albumModal');
  if (modal) modal.classList.add('open');
}

function closeAlbumModal() {
  const modal = document.getElementById('albumModal');
  if (modal) modal.classList.remove('open');
}

function playAlbum(albumName) {
  closeAlbumModal();
  // Prefer tracks already in the current queue (filtered to the right artist/context)
  // so album playback doesn't pull in unrelated songs from allTracks
  const fromQueue = State.queue.filter(t => t.album === albumName);
  const tracks = fromQueue.length
    ? fromQueue
    : State.allTracks.filter(t => t.album === albumName);
  if (!tracks.length) { showToast('No tracks loaded for this album', 'info'); return; }
  deactivateSmartRadio();
  State.queue = [...tracks];
  State.queueIndex = 0;
  playTrack(State.queue[0]);
  showToast(`Playing "${albumName}"`, 'success');
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

  const rawTracks = await JamendoAPI.searchTracks(query, 120, _searchFilter);

  // ---- Relevance filter: only keep tracks that actually match the query ----
  const qLow = query.toLowerCase();
  const qWords = qLow.split(/\s+/).filter(Boolean);
  function wordMatch(str) {
    if (!str) return false;
    const s = str.toLowerCase();
    return qWords.some(w => s.includes(w));
  }
  let tracks;
  if (_searchFilter === 'artist') {
    // Must match artist name
    tracks = rawTracks.filter(t => wordMatch(t.artist));
    // Fallback: if too few, relax to any that partially match the first word
    if (tracks.length < 3) tracks = rawTracks.filter(t => (t.artist||'').toLowerCase().includes(qWords[0]||''));
  } else if (_searchFilter === 'album' || _searchFilter === 'film') {
    // Must match album name
    tracks = rawTracks.filter(t => wordMatch(t.album));
    if (tracks.length < 3) tracks = rawTracks.filter(t => (t.album||'').toLowerCase().includes(qWords[0]||''));
  } else {
    // Song search: match title or artist
    tracks = rawTracks.filter(t => wordMatch(t.title) || wordMatch(t.artist));
    if (tracks.length < 3) tracks = rawTracks; // fallback: show all
  }

  if (tracks.length === 0) {
    results.innerHTML = '';
    noResult.style.display = 'block';
    return;
  }

  mergeIntoAll(tracks);
  const searchIds = new Set(tracks.map(t => t.id));
  const rest = State.allTracks.filter(t => !searchIds.has(t.id));
  State.queue = [...tracks, ...rest];

  if (_searchFilter === 'artist') {
    // Group by artist name → show artist cards
    const artistMap = {};
    tracks.forEach(t => {
      const names = (t.artist || 'Unknown').split(/[,&\/]+/).map(n => n.trim()).filter(Boolean);
      names.forEach(n => {
        if (!artistMap[n]) artistMap[n] = { name: n, cover: t.cover, count: 0 };
        artistMap[n].count++;
      });
    });
    const artists = Object.values(artistMap).sort((a, b) => b.count - a.count);
    results.innerHTML = `<div class="artist-grid" style="padding-top:12px;">` +
      artists.map((a, idx) => `
        <div class="artist-card" data-artist="${escHtml(a.name)}" data-lang=""
             onclick="browseArtist(this.dataset.artist, this.dataset.lang)">
          <div class="artist-cover-wrap">
            <img class="artist-avatar" id="srch-artist-${idx}"
                 src="${artistSvgAvatar(a.name, '')}"
                 alt="${escHtml(a.name)}" />
          </div>
          <div class="artist-card-bottom">
            <div class="artist-name">${escHtml(a.name)}</div>
          </div>
        </div>`).join('') + `</div>`;
    artists.forEach((a, idx) => {
      const imgEl = document.getElementById('srch-artist-' + idx);
      if (imgEl) loadWikiImage(a.name, imgEl);
    });

  } else if (_searchFilter === 'album' || _searchFilter === 'film') {
    // Group by album name → show album/film cards
    const albumMap = {};
    tracks.forEach(t => {
      const key = t.album || 'Unknown Album';
      if (!albumMap[key]) albumMap[key] = { name: key, cover: t.cover, artist: t.artist, tracks: [] };
      albumMap[key].tracks.push(t);
    });
    const albums = Object.values(albumMap).sort((a, b) => b.tracks.length - a.tracks.length);
    results.innerHTML = `<div class="artist-albums-grid" style="padding-top:12px;">` +
      albums.map(al => `
        <div class="album-card" data-album="${escHtml(al.name)}" onclick="openAlbumView(this.dataset.album)">
          <div class="album-card-cover-wrap">
            <img class="album-card-cover" src="${escHtml(al.cover || '')}" alt="${escHtml(al.name)}"
                 loading="lazy" onerror="this.style.display='none'" />
            <div class="album-card-play"><i class="fas fa-list"></i></div>
          </div>
          <div class="album-card-info">
            <div class="album-card-name">${escHtml(al.name)}</div>
            <div class="album-card-count">${escHtml(al.artist)} · ${al.tracks.length} song${al.tracks.length !== 1 ? 's' : ''}</div>
          </div>
        </div>`).join('') + `</div>`;

  } else {
    // Song filter — list view
    results.innerHTML = renderTracksAsList(tracks);
  }

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

// Per-track retry counter — reset every time we start a new track
let _audioRetryCount = 0;

function playTrack(track) {
  if (!track) return;

  _audioRetryCount = 0; // reset retry state for the new track
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

  // Update lock-screen / notification media metadata
  updateMediaSession(track);
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
  console.warn('[Audio error] code:', code, e);

  if (!State.currentTrack) return;

  const trackId = State.currentTrack.id;

  // Build an ordered list of fallback URLs to try before giving up
  const fallbackUrls = [
    `https://mp3l.jamendo.com/?trackid=${encodeURIComponent(trackId)}&format=mp31`,
    `https://mp3l.jamendo.com/?trackid=${encodeURIComponent(trackId)}&format=mp32`,
  ];

  // Find the next URL we haven't tried yet (skip any that match current src)
  const nextUrl = fallbackUrls[_audioRetryCount];

  if (nextUrl && audio.src !== nextUrl) {
    _audioRetryCount++;
    console.info(`[Audio retry ${_audioRetryCount}] Trying: ${nextUrl}`);
    audio.src = nextUrl;
    audio.load();
    audio.play().then(() => {
      State.isPlaying = true;
      updatePlayButtons(true);
    }).catch(() => {
      // play() rejection will cause another error event which retries or skips
    });
  } else if (_audioRetryCount < fallbackUrls.length) {
    // Already on this URL but count not exhausted — advance manually
    _audioRetryCount++;
    const altUrl = fallbackUrls[_audioRetryCount - 1];
    if (altUrl && audio.src !== altUrl) {
      audio.src = altUrl;
      audio.load();
      audio.play().catch(() => {});
    } else {
      // All fallbacks exhausted — skip to next track
      _audioRetryCount = 0;
      showToast('Cannot play this track — trying next', 'warning', 'fa-triangle-exclamation');
      setTimeout(nextTrack, 3000);
    }
  } else {
    // All fallbacks exhausted
    _audioRetryCount = 0;
    showToast('Cannot play this track — trying next', 'warning', 'fa-triangle-exclamation');
    setTimeout(nextTrack, 3000);
  }
});
audio.addEventListener('canplay', () => {
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
});

// =============================================
//  MEDIA SESSION API (lock-screen / notification controls)
// =============================================

function updateMediaSession(track) {
  if (!('mediaSession' in navigator) || !track) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title:  track.title  || 'Unknown Title',
      artist: track.artist || 'Unknown Artist',
      album:  track.album  || 'MusiFy',
      artwork: track.cover
        ? [{ src: track.cover, sizes: '300x300', type: 'image/jpeg' }]
        : [],
    });
    navigator.mediaSession.playbackState = 'playing';
  } catch (_) { /* Media Session not fully supported */ }
}

function setupMediaSession() {
  if (!('mediaSession' in navigator)) return;
  const safe = fn => (...args) => { try { fn(...args); } catch(e) { console.warn('MediaSession handler error', e); } };
  navigator.mediaSession.setActionHandler('play', safe(() => {
    audio.play().then(() => { State.isPlaying = true; updatePlayButtons(true); }).catch(() => {});
    if (navigator.mediaSession) navigator.mediaSession.playbackState = 'playing';
  }));
  navigator.mediaSession.setActionHandler('pause', safe(() => {
    audio.pause();
    State.isPlaying = false;
    updatePlayButtons(false);
    if (navigator.mediaSession) navigator.mediaSession.playbackState = 'paused';
  }));
  navigator.mediaSession.setActionHandler('nexttrack',     safe(() => nextTrack()));
  navigator.mediaSession.setActionHandler('previoustrack', safe(() => prevTrack()));
  try {
    navigator.mediaSession.setActionHandler('seekbackward', safe((d) => {
      audio.currentTime = Math.max(0, audio.currentTime - (d.seekOffset || 10));
    }));
    navigator.mediaSession.setActionHandler('seekforward', safe((d) => {
      audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + (d.seekOffset || 10));
    }));
    navigator.mediaSession.setActionHandler('seekto', safe((d) => {
      if (d.seekTime !== undefined) audio.currentTime = d.seekTime;
    }));
  } catch(_) { /* older browsers don't support seek handlers */ }
}

// =============================================
//  BACKGROUND PLAYBACK WATCHDOG
//  Mobile browsers often swallow audio.ended events when the tab
//  is backgrounded, causing playback to silently stall after a song.
//  This 1-second heartbeat catches that and advances to the next track.
// =============================================

let _bgWatchdog = null;
let _lastAudioTime = 0;
let _stalledTicks  = 0;

function startBgWatchdog() {
  if (_bgWatchdog) return;
  _bgWatchdog = setInterval(() => {
    // 1) If audio reports ended but ended-event wasn't fired (background tab bug)
    if (State.isPlaying && audio.ended) {
      console.info('[Watchdog] audio.ended detected in background — advancing track');
      if (State.repeatMode === 'one') {
        audio.currentTime = 0;
        audio.play().catch(() => {});
      } else {
        nextTrack();
      }
      return;
    }

    // 2) Detect truly stalled audio (currentTime frozen for >12 s while browser says it's playing)
    //    readyState < 2 (HAVE_CURRENT_DATA) means the browser is still buffering — not a real stall.
    //    Only count frozen ticks when we actually have data to play.
    const isActivelyPlaying = State.isPlaying && !audio.paused && !audio.ended
                              && audio.readyState >= 2; // HAVE_CURRENT_DATA or higher
    if (isActivelyPlaying) {
      if (audio.currentTime === _lastAudioTime) {
        _stalledTicks++;
        if (_stalledTicks >= 12) { // 12 seconds of genuine freeze before acting
          console.info('[Watchdog] Genuinely stalled audio — recovering');
          _stalledTicks = 0;
          if (audioCtx && audioCtx.state === 'suspended') {
            audioCtx.resume().then(() => {
              audio.play().catch(() => nextTrack());
            }).catch(() => nextTrack());
          } else {
            audio.play().catch(() => nextTrack());
          }
        }
      } else {
        _stalledTicks = 0;
      }
      _lastAudioTime = audio.currentTime;
    } else if (!State.isPlaying || audio.paused) {
      // Reset stall counter whenever audio legitimately stops / pauses
      _stalledTicks = 0;
      _lastAudioTime = audio.currentTime;
    }

    // 3) Resume a suspended AudioContext while music should be playing
    if (audioCtx && audioCtx.state === 'suspended' && State.isPlaying) {
      audioCtx.resume().catch(() => {});
    }

    // 4) Keep Media Session playback state in sync
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = State.isPlaying ? 'playing' : 'paused';
      // Update position state for seekbar on lock screen
      try {
        if (audio.duration && !isNaN(audio.duration)) {
          navigator.mediaSession.setPositionState({
            duration:     audio.duration,
            playbackRate: audio.playbackRate,
            position:     Math.min(audio.currentTime, audio.duration),
          });
        }
      } catch (_) {}
    }
  }, 1000);
}

// =============================================
//  VISIBILITY CHANGE — resume when tab comes back
// =============================================

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    // Resume AudioContext if it was suspended while backgrounded
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    // If audio should be playing but paused (some mobile browsers pause on background)
    if (State.isPlaying && audio.paused && !audio.ended) {
      audio.play().catch(() => {});
    }
    // If audio has already ended and we haven't advanced (missed the event)
    if (State.isPlaying && audio.ended) {
      if (State.repeatMode === 'one') {
        audio.currentTime = 0;
        audio.play().catch(() => {});
      } else {
        nextTrack();
      }
    }
  }
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
  const overlay = document.getElementById('signoutModal');
  if (overlay) {
    overlay.classList.add('open');
    closeProfileDropdown();
  } else {
    sessionStorage.removeItem('musify_session');
    window.location.href = 'index.html';
  }
}

function closeSignoutModal() {
  const overlay = document.getElementById('signoutModal');
  if (overlay) overlay.classList.remove('open');
}

function confirmLogout() {
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
  // Set up OS media controls (lock screen, notification shade) and background watchdog
  setupMediaSession();
  startBgWatchdog();
  // Load all home sections in parallel
  await loadHomeSections();
}

document.addEventListener('DOMContentLoaded', init);
