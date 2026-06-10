// ---------- helpers ----------
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

// build an inline <svg> that references a sprite symbol
function svgIcon(id, className) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", className || "icon");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", "#" + id);
  svg.append(use);
  return svg;
}

function formatCount(n) {
  return n.toLocaleString();
}

// "m:ss" -> seconds
function parseDuration(str) {
  const parts = String(str || "0:00")
    .split(":")
    .map(Number);
  return parts.length === 2 ? parts[0] * 60 + parts[1] : parts[0] || 0;
}

// seconds -> "m:ss"
function formatTime(sec) {
  const s = Math.max(0, Math.floor(sec));
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
}

// Fisher–Yates shuffle on a copy.
function shuffled(array) {
  const a = array.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// playback runs faster than real time so progress + auto-advance are visible
const PLAYBACK_SPEED = 8;

// ---------- app state ----------
const state = {
  playlists: [],
  songs: [],
  songsById: new Map(),
  playlistsById: new Map(),
  carousel: [], // up to 10 song objects
  carouselIndex: 0,
  autoTimer: null,
  isPlaying: false,
  currentSongId: null,
  liked: { songs: new Set(), playlists: new Set() },
  // playlist grid filter + sort
  playlistQuery: "", // active search term (name/author)
  playlistSort: "name", // "name" | "likes" | "date"
  // playback queue + simulated progress
  queue: [], // array of song ids
  queueIndex: 0,
  elapsed: 0, // seconds into current song
  duration: 0, // seconds total for current song
  ticker: null,
};

// ============================================================
//  LIKES — shared engine
// ============================================================

// Is this entity currently liked?
function isLiked(type, id) {
  return state.liked[type === "song" ? "songs" : "playlists"].has(id);
}

// Return the data object (song or playlist) for an id.
function getEntity(type, id) {
  return type === "song"
    ? state.songsById.get(id)
    : state.playlistsById.get(id);
}

// Toggle like for an entity, adjust its likeCount, animate + sync all hearts.
function toggleLike(type, id) {
  const set = state.liked[type === "song" ? "songs" : "playlists"];
  const entity = getEntity(type, id);
  const nowLiked = !set.has(id);

  if (nowLiked) set.add(id);
  else set.delete(id);

  if (entity) {
    // keep the data object's `liked` boolean in sync with the user's choice
    entity.liked = nowLiked;
    if (typeof entity.likeCount === "number") {
      entity.likeCount += nowLiked ? 1 : -1;
    }
  }
  saveLikes(); // persist so the liked state survives a reload
  syncLikeUI(type, id, nowLiked);
}

// ----- persistence -----
// The browser can't write back to data/data.json (no backend), so the user's
// liked booleans are saved to localStorage and restored on the next visit.
// data.json holds the seed (default) `liked` values.
const LIKES_KEY = "waver:likes";

function saveLikes() {
  try {
    localStorage.setItem(
      LIKES_KEY,
      JSON.stringify({
        songs: [...state.liked.songs],
        playlists: [...state.liked.playlists],
      }),
    );
  } catch (e) {
    /* storage unavailable (private mode / quota) — likes stay in-memory only */
  }
}

function loadSavedLikes() {
  try {
    const raw = localStorage.getItem(LIKES_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    return {
      songs: Array.isArray(saved.songs) ? saved.songs : [],
      playlists: Array.isArray(saved.playlists) ? saved.playlists : [],
    };
  } catch (e) {
    return null;
  }
}

/**
 * initLikes()
 *  - Seeds the liked sets from each entity's `liked` field in data.json, then
 *    overlays the user's saved choices from a previous session (localStorage).
 *  - Reconciles each entity's `liked` boolean + likeCount with the final state.
 */
function initLikes() {
  // 1. defaults straight from data.json
  state.songs.forEach((s) => {
    if (s.liked) state.liked.songs.add(s.id);
  });
  state.playlists.forEach((p) => {
    if (p.liked) state.liked.playlists.add(p.id);
  });

  // 2. a saved session, if any, takes over as the source of truth
  const saved = loadSavedLikes();
  if (saved) {
    state.liked.songs = new Set(saved.songs);
    state.liked.playlists = new Set(saved.playlists);
  }

  // 3. make each entity's `liked` flag + count match the final liked sets
  const reconcile = (type, entities) => {
    entities.forEach((entity) => {
      const seedLiked = !!entity.liked;
      const nowLiked = isLiked(type, entity.id);
      if (nowLiked !== seedLiked && typeof entity.likeCount === "number") {
        entity.likeCount += nowLiked ? 1 : -1;
      }
      entity.liked = nowLiked;
    });
  };
  reconcile("song", state.songs);
  reconcile("playlist", state.playlists);
}

// Build a clickable playlist "likes" pill (heart + count), kept in sync with
// every other heart via its data-like key. Shared by the grid cards and the
// featured playlist. `stopPropagation` keeps a card click from opening the modal.
function buildPlaylistLikes(playlist, { extraClass, stopPropagation } = {}) {
  const likes = el(
    "div",
    "playlist-card__likes" + (extraClass ? " " + extraClass : ""),
  );
  likes.dataset.like = "playlist:" + playlist.id;
  likes.setAttribute("role", "button");
  likes.setAttribute("aria-label", "Like " + playlist.name);
  likes.append(
    svgIcon("icon-heart"),
    el("span", "like-count", formatCount(playlist.likeCount)),
  );
  if (isLiked("playlist", playlist.id)) likes.classList.add("is-liked");
  likes.addEventListener("click", (e) => {
    if (stopPropagation) e.stopPropagation();
    toggleLike("playlist", playlist.id);
  });
  return likes;
}

// Update every heart control (and any visible count) for one entity.
function syncLikeUI(type, id, animate) {
  const key = type + ":" + id;
  const entity = getEntity(type, id);
  const liked = isLiked(type, id);

  document.querySelectorAll('[data-like="' + key + '"]').forEach((node) => {
    node.classList.toggle("is-liked", liked);

    if (animate !== undefined) {
      // replay the correct animation by re-adding the transient class
      node.classList.remove("is-liking", "is-unliking");
      void node.offsetWidth; // force reflow so the animation restarts
      node.classList.add(liked ? "is-liking" : "is-unliking");
    }

    // refresh a count label if this control shows one
    const count = node.querySelector(".like-count");
    if (count && entity && typeof entity.likeCount === "number") {
      count.textContent = formatCount(entity.likeCount);
    }
  });
}

// ============================================================
//  PLAYLIST GRID
// ============================================================

/**
 * createPlaylistCards(playlists)
 *  - Takes an array of Playlist objects, produces .playlist-card elements,
 *    appends them to .playlist-cards, and wires click -> modal, heart -> like.
 */
function createPlaylistCards(playlists) {
  const container = document.querySelector(".playlist-cards");
  if (!container) return;
  container.replaceChildren();

  playlists.forEach((playlist) => {
    const card = el("article", "playlist-card");
    card.dataset.id = playlist.id;

    const thumb = el("div", "playlist-card__thumb");
    const img = el("img");
    img.src = playlist.coverImage;
    img.alt = playlist.name;
    img.loading = "lazy";
    thumb.append(img);

    const title = el("h3", "playlist-card__title", playlist.name);
    const author = el("p", "playlist-card__author", playlist.author);

    // clickable likes row (its own heart, kept in sync via data-like).
    // stopPropagation so liking doesn't also open the modal.
    const likes = buildPlaylistLikes(playlist, { stopPropagation: true });

    card.append(thumb, title, author, likes);
    card.addEventListener("click", () => openPlaylistModal(playlist));
    container.append(card);
  });
}

/**
 * getVisiblePlaylists()
 *  - Applies the active search filter (name OR author, case-insensitive) and
 *    the active sort to state.playlists, returning a new array.
 *  - Sorts: "name" (A–Z), "likes" (descending), "date" (most recent first).
 */
function getVisiblePlaylists() {
  const query = state.playlistQuery.trim().toLowerCase();

  let list = state.playlists.filter((p) => {
    if (!query) return true;
    return (
      p.name.toLowerCase().includes(query) ||
      p.author.toLowerCase().includes(query)
    );
  });

  list = list.slice();
  if (state.playlistSort === "likes") {
    list.sort((a, b) => b.likeCount - a.likeCount);
  } else if (state.playlistSort === "date") {
    // most recent first; missing dates sort last
    list.sort(
      (a, b) =>
        new Date(b.dateAdded || 0).getTime() -
        new Date(a.dateAdded || 0).getTime(),
    );
  } else {
    list.sort((a, b) => a.name.localeCompare(b.name));
  }
  return list;
}

/**
 * renderPlaylistGrid()
 *  - Renders the filtered + sorted playlists into .playlist-cards, or an
 *    empty-state message when the search matches nothing.
 */
function renderPlaylistGrid() {
  const visible = getVisiblePlaylists();
  const container = document.querySelector(".playlist-cards");
  if (!container) return;

  if (!visible.length) {
    container.replaceChildren(
      el(
        "p",
        "cards-empty",
        'No playlists match "' + state.playlistQuery.trim() + '".',
      ),
    );
    return;
  }
  createPlaylistCards(visible);
}

/**
 * initPlaylistControls()
 *  - Wires the search form (submit on Enter / Search button), the clear
 *    button (resets input + filter), and the sort dropdown.
 */
function initPlaylistControls() {
  const form = document.querySelector(".playlist-search");
  const input = document.querySelector(".playlist-search__input");
  const clearBtn = document.querySelector(".playlist-search__clear");
  const sortSelect = document.querySelector(".playlist-sort__select");

  if (form && input) {
    // submit (Enter or the Search button) applies the current input as filter
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      state.playlistQuery = input.value;
      renderPlaylistGrid();
    });
    // show/hide the clear button as the user types (doesn't filter yet)
    input.addEventListener("input", () => {
      if (clearBtn) clearBtn.hidden = input.value === "";
    });
  }

  if (clearBtn && input) {
    clearBtn.addEventListener("click", () => {
      input.value = "";
      clearBtn.hidden = true;
      state.playlistQuery = "";
      renderPlaylistGrid();
      input.focus();
    });
  }

  if (sortSelect) {
    state.playlistSort = sortSelect.value; // honor the default <option>
    sortSelect.addEventListener("change", () => {
      state.playlistSort = sortSelect.value;
      renderPlaylistGrid();
    });
  }
}

// ============================================================
//  SIDEBAR PLAYLIST DROPDOWN
// ============================================================

function renderPlaylistNav() {
  const nav = document.querySelector(".playlist-nav");
  if (!nav) return;
  nav.replaceChildren();

  state.playlists.forEach((playlist) => {
    const li = el("li");
    const link = el("a", "playlist-nav__item");
    link.href = "#";
    const img = el("img", "thumb thumb--sm");
    img.src = playlist.coverImage;
    img.alt = "";
    link.append(img, el("span", null, playlist.name));
    link.addEventListener("click", (e) => {
      e.preventDefault();
      openPlaylistModal(playlist);
    });
    li.append(link);
    nav.append(li);
  });
}

function initPlaylistDropdown() {
  const header = document.querySelector(".playlists__header");
  const nav = document.querySelector(".playlist-nav");
  if (!header || !nav) return;

  header.addEventListener("click", () => {
    const expanded = header.getAttribute("aria-expanded") === "true";
    header.setAttribute("aria-expanded", String(!expanded));
    nav.hidden = expanded; // collapse hides the list
  });
}

// Mobile: hamburger toggles the sidebar drawer; backdrop / nav tap / Esc closes.
function initSidebarToggle() {
  const sidebar = document.querySelector(".sidebar");
  const menuBtn = document.querySelector(".topnav__menu");
  const backdrop = document.querySelector(".sidebar-backdrop");
  if (!sidebar || !menuBtn) return;

  const open = () => {
    sidebar.classList.add("is-open");
    if (backdrop) backdrop.hidden = false;
  };
  const close = () => {
    sidebar.classList.remove("is-open");
    if (backdrop) backdrop.hidden = true;
  };

  menuBtn.addEventListener("click", () => {
    sidebar.classList.contains("is-open") ? close() : open();
  });
  if (backdrop) backdrop.addEventListener("click", close);
  sidebar.addEventListener("click", (e) => {
    if (e.target.closest(".nav-item, .playlist-nav__item, .logout-btn"))
      close();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && sidebar.classList.contains("is-open")) close();
  });
}

// ============================================================
//  FEATURED PLAYLIST (cover-left + song list)
// ============================================================

function renderFeaturedPlaylist(playlist) {
  const container = document.querySelector(".feat-pl");
  if (!container || !playlist) return;
  container.replaceChildren();

  // left column: large cover (opens modal) + AI "Get Description" + generated text
  const left = el("div", "feat-pl__left");

  const coverWrap = el("div", "feat-pl__cover");
  const cover = el("img");
  cover.src = playlist.coverImage;
  cover.alt = playlist.name;
  coverWrap.append(cover);
  coverWrap.addEventListener("click", () => openPlaylistModal(playlist));

  const aiBtn = el("button", "ai-btn");
  aiBtn.append(svgIcon("icon-sparkle"), el("span", null, "Get Description"));
  // scroll wrapper takes the leftover flex height; .ai-desc scrolls inside it
  // (keeps the tall, wrapped text from growing the grid row past the song list)
  const aiDescWrap = el("div", "feat-pl__desc-wrap");
  const aiDesc = el("div", "ai-desc");
  aiDesc.setAttribute("aria-live", "polite");
  aiDescWrap.append(aiDesc);
  aiBtn.addEventListener("click", () =>
    handleGetDescription(playlist, aiBtn, aiDesc),
  );

  left.append(coverWrap, aiBtn, aiDescWrap);

  // right: header (title / meta / likes + shuffle) over the song list
  const body = el("div", "feat-pl__body");

  const head = el("div", "feat-pl__head");
  const headText = el("div", "feat-pl__headtext");
  headText.append(
    el("h3", "feat-pl__title", playlist.name),
    el(
      "p",
      "feat-pl__meta",
      playlist.author + " · " + playlist.songs.length + " songs",
    ),
  );

  const actions = el("div", "feat-pl__actions");
  // like control reuses the shared like engine (synced via data-like)
  const likes = buildPlaylistLikes(playlist);

  const shuffleBtn = el("button", "modal__shuffle feat-pl__shuffle");
  shuffleBtn.append(svgIcon("icon-shuffle"), el("span", null, "Shuffle"));

  actions.append(likes, shuffleBtn);
  head.append(headText, actions);

  const songList = el("ul", "song-list feat-pl__songs");
  const queueIds = playlist.songs.slice();
  renderSongList(songList, queueIds);
  shuffleBtn.addEventListener("click", () =>
    shuffleSongList(songList, queueIds),
  );

  body.append(head, songList);
  container.append(left, body);
}

// ============================================================
//  AI "GET DESCRIPTION" (OpenRouter)
// ============================================================

const AI_FALLBACK = "System Error: Failed to generate description.";
const AI_SYSTEM_PROMPT =
  "You are an expert music curator. Your task is to write a short, engaging 2 sentence description summarizing the vibe of a playlist based on its contents. Do not use any markdown formatting. Focus on the mood, genre, and aesthetic. Do not mention the author name.";

// Skip the typing animation for users who prefer reduced motion.
const prefersReducedMotion =
  window.matchMedia &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * fetchPlaylistDescription(playlist)
 *  - Calls the OpenRouter chat-completions API with the playlist's title,
 *    author, and tracklist, and returns a short generated description.
 *  - Throws on a missing key, network/HTTP error, or empty response so the
 *    caller can show the fallback text.
 */
async function fetchPlaylistDescription(playlist) {
  if (typeof OPENAI_KEY === "undefined" || !OPENAI_KEY) {
    throw new Error("OPENAI_KEY is not defined — is secrets.js loaded?");
  }

  const tracks = playlist.songs
    .map((id) => state.songsById.get(id))
    .filter(Boolean)
    .map((song) => song.title + " by " + song.artist)
    .join(", ");

  const userPrompt =
    "Playlist Name: " +
    playlist.name +
    "\n" +
    "Curator: " +
    playlist.author +
    "\n" +
    "Tracks: " +
    tracks +
    "\n" +
    "Write the description.";

  const response = await fetch(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + OPENAI_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "openrouter/free",
        messages: [
          { role: "system", content: AI_SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
      }),
    },
  );

  if (!response.ok) throw new Error("HTTP " + response.status);

  const data = await response.json();
  const text =
    data.choices && data.choices[0] && data.choices[0].message
      ? (data.choices[0].message.content || "").trim()
      : "";
  if (!text) throw new Error("Empty description from API");
  return text;
}

// Render the animated in-flight loading state into a .ai-desc container.
function showLoading(descEl) {
  stopTyping(descEl);
  descEl.classList.remove("is-typing");
  descEl.classList.add("is-loading");
  descEl.replaceChildren();

  const wrap = el("div", "ai-loading");
  wrap.append(el("span", "ai-loading__label", "Generating description"));
  const dots = el("span", "ai-loading__dots");
  for (let i = 0; i < 3; i++) dots.append(el("span", "ai-loading__dot"));
  wrap.append(dots);
  descEl.append(wrap);
}

// Stop any in-progress typing timer stored on a container.
function stopTyping(descEl) {
  if (descEl._typeTimer) {
    clearInterval(descEl._typeTimer);
    descEl._typeTimer = null;
  }
}

/**
 * typeText(descEl, text, speed)
 *  - Clears the loading state and reveals `text` one character at a time.
 *  - Reduced-motion users get the full text instantly.
 */
function typeText(descEl, text, speed) {
  stopTyping(descEl);
  descEl.classList.remove("is-loading");

  if (prefersReducedMotion) {
    descEl.textContent = text;
    return;
  }

  descEl.textContent = "";
  descEl.classList.add("is-typing");
  let i = 0;
  descEl._typeTimer = setInterval(() => {
    descEl.textContent = text.slice(0, ++i);
    descEl.scrollTop = descEl.scrollHeight;
    if (i >= text.length) {
      stopTyping(descEl);
      descEl.classList.remove("is-typing");
    }
  }, speed || 18);
}

/**
 * handleGetDescription(playlist, button, descEl)
 *  - Shared click handler: shows the loading animation, fetches a fresh
 *    description (always regenerates), then types it out. On any failure it
 *    shows the fallback text without the typing animation.
 */
async function handleGetDescription(playlist, button, descEl) {
  button.disabled = true;
  button.classList.add("is-loading");
  showLoading(descEl);

  try {
    const text = await fetchPlaylistDescription(playlist);
    typeText(descEl, text);
  } catch (error) {
    console.error("AI description failed:", error);
    stopTyping(descEl);
    descEl.classList.remove("is-loading", "is-typing");
    descEl.textContent = AI_FALLBACK;
  } finally {
    button.disabled = false;
    button.classList.remove("is-loading");
  }
}

// ============================================================
//  MODAL
// ============================================================

/**
 * buildSongRow(song, displayIndex, queueIds)
 *  - Reusable song-row <li> shared by the modal and the Featured Playlist.
 *  - Leading index cell swaps number/play/pause/wave by CSS state.
 *  - Play loads the song with `queueIds` as the playback queue.
 */
function buildSongRow(song, displayIndex, queueIds) {
  const row = el("li", "song-row");
  row.dataset.songId = song.id;

  // leading index cell: number / play / pause / sound-wave (CSS swaps them)
  const index = el("div", "song-row__index");
  index.append(el("span", "song-row__num", String(displayIndex + 1)));

  const play = el("button", "song-row__play");
  play.setAttribute("aria-label", "Play " + song.title);
  play.append(svgIcon("icon-play"));
  play.addEventListener("click", (e) => {
    e.stopPropagation();
    loadSong(song.id, queueIds, queueIds.indexOf(song.id));
  });

  const pause = el("button", "song-row__pause");
  pause.setAttribute("aria-label", "Pause");
  pause.append(svgIcon("icon-pause"));
  pause.addEventListener("click", (e) => {
    e.stopPropagation();
    setPlaying(false);
  });

  const wave = el("span", "song-row__wave");
  wave.setAttribute("aria-hidden", "true");
  for (let b = 0; b < 4; b++) wave.append(el("span", "wave__bar"));

  index.append(play, pause, wave);

  const img = el("img", "thumb thumb--sm");
  img.src = song.coverImage;
  img.alt = "";

  const meta = el("div", "song-row__meta");
  meta.append(
    el("span", "song-row__title", song.title),
    el("span", "song-row__artist", song.artist),
  );

  const dur = el("span", "song-row__dur", song.duration);

  // per-row like heart, synced with all other hearts for this song
  const like = el("button", "icon-btn song-row__like");
  like.dataset.like = "song:" + song.id;
  like.setAttribute("aria-label", "Like " + song.title);
  like.append(svgIcon("icon-heart"));
  if (isLiked("song", song.id)) like.classList.add("is-liked");
  like.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleLike("song", song.id);
  });

  row.append(index, img, meta, dur, like);
  return row;
}

// Render a list of song ids into a .song-list container.
function renderSongList(listEl, queueIds) {
  listEl.replaceChildren();
  queueIds.forEach((songId, i) => {
    const song = state.songsById.get(songId);
    if (song) listEl.append(buildSongRow(song, i, queueIds));
  });
  updatePlayingRows();
}

/**
 * shuffleSongList(listEl, queueIds)
 *  - Shuffles queueIds in place, re-renders the rows in the new order,
 *    so subsequent playback follows the visible order.
 */
function shuffleSongList(listEl, queueIds) {
  const order = shuffled(queueIds);
  queueIds.length = 0;
  queueIds.push(...order);
  renderSongList(listEl, queueIds);
}

function openPlaylistModal(playlist) {
  const overlay = document.getElementById("playlistModal");
  if (!overlay) return;

  overlay.querySelector(".modal__cover").src = playlist.coverImage;
  overlay.querySelector(".modal__title").textContent = playlist.name;
  overlay.querySelector(".modal__subtitle").textContent =
    playlist.author + " · " + playlist.songs.length + " songs";

  // queue ids for this modal (mutated in place by shuffle)
  const queueIds = playlist.songs.slice();
  const list = overlay.querySelector(".song-list");
  renderSongList(list, queueIds);

  const shuffleBtn = overlay.querySelector(".modal__shuffle");
  if (shuffleBtn) {
    shuffleBtn.classList.remove("is-active");
    shuffleBtn.onclick = () => {
      shuffleBtn.classList.toggle("is-active");
      shuffleSongList(list, queueIds);
    };
  }

  // AI "Get Description" — reset the text area, rebind to this playlist
  const aiBtn = overlay.querySelector(".modal__ai-btn");
  const aiDesc = overlay.querySelector(".modal__ai .ai-desc");
  if (aiBtn && aiDesc) {
    stopTyping(aiDesc);
    aiDesc.classList.remove("is-loading", "is-typing");
    aiDesc.textContent = "";
    aiBtn.disabled = false;
    aiBtn.classList.remove("is-loading");
    aiBtn.onclick = () => handleGetDescription(playlist, aiBtn, aiDesc);
  }

  overlay.hidden = false;
  updatePlayingRows();
}

// Reflect global playback across every song row (modal + featured playlist):
// mark the current song's row as playing so its index cell shows the wave.
function updatePlayingRows() {
  document.querySelectorAll(".song-row").forEach((row) => {
    const playing =
      row.dataset.songId === state.currentSongId && state.isPlaying;
    row.classList.toggle("is-playing", playing);
  });
}

function closeModal() {
  const overlay = document.getElementById("playlistModal");
  if (overlay) overlay.hidden = true;
}

function initModal() {
  const overlay = document.getElementById("playlistModal");
  if (!overlay) return;

  // click on the backdrop (but not the panel) closes
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal();
  });
  overlay.querySelector(".modal__close").addEventListener("click", closeModal);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !overlay.hidden) closeModal();
  });
}

// ============================================================
//  HERO CAROUSEL (cover-flow)
// ============================================================

function buildHeroCard(song, variant) {
  const card = el("article", "hero-card " + variant);
  card.dataset.id = song.id;

  const img = el("img", "hero-card__img");
  img.src = song.coverImage;
  img.alt = "";
  card.append(img);

  if (variant === "hero-card--center") {
    const meta = el("div", "hero-card__meta");
    meta.append(
      el("span", "hero-card__title", song.title),
      el("span", "hero-card__artist", song.artist),
    );
    const play = el("button", "hero-card__play");
    play.setAttribute("aria-label", "Play " + song.title);
    play.append(svgIcon("icon-play", "icon icon--lg"));
    play.addEventListener("click", (e) => {
      e.stopPropagation();
      playFromCarousel(song.id);
    });
    card.append(meta, play);
  }

  // clicking any card loads that song into the player
  card.addEventListener("click", () => playFromCarousel(song.id));
  return card;
}

// Play a carousel song with the whole carousel as the queue.
function playFromCarousel(songId) {
  const queueIds = state.carousel.map((s) => s.id);
  loadSong(songId, queueIds, queueIds.indexOf(songId));
}

function renderCarousel() {
  const carousel = document.querySelector(".carousel");
  if (!carousel || state.carousel.length === 0) return;

  const n = state.carousel.length;
  const i = state.carouselIndex;
  const prev = state.carousel[(i - 1 + n) % n];
  const center = state.carousel[i];
  const next = state.carousel[(i + 1) % n];

  carousel.replaceChildren(
    buildHeroCard(prev, "hero-card--side hero-card--prev"),
    buildHeroCard(center, "hero-card--center"),
    buildHeroCard(next, "hero-card--side hero-card--next"),
  );
}

function moveCarousel(delta) {
  const n = state.carousel.length;
  if (n === 0) return;
  state.carouselIndex = (state.carouselIndex + delta + n) % n;
  renderCarousel();
}

function startAutoRotate() {
  stopAutoRotate();
  state.autoTimer = setInterval(() => moveCarousel(1), 3000);
}
function stopAutoRotate() {
  if (state.autoTimer) clearInterval(state.autoTimer);
  state.autoTimer = null;
}

function initCarousel() {
  state.carousel = shuffled(state.songs).slice(0, 10);
  state.carouselIndex = 0;
  renderCarousel();

  // arrows in the "Featured"/hero section step the cover-flow
  const arrows = document.querySelectorAll(".hero .arrow-btn");
  if (arrows.length === 2) {
    arrows[0].addEventListener("click", () => moveCarousel(-1));
    arrows[1].addEventListener("click", () => moveCarousel(1));
  }

  // pause auto-rotate while hovering the carousel
  const carousel = document.querySelector(".carousel");
  if (carousel) {
    carousel.addEventListener("mouseenter", stopAutoRotate);
    carousel.addEventListener("mouseleave", startAutoRotate);
  }
  startAutoRotate();
}

// ============================================================
//  PLAYER
// ============================================================

/**
 * loadSong(id, queueIds?, index?)
 *  - Loads a song into the bottom player and starts (simulated) playback.
 *  - queueIds sets the playback queue used for auto-advance / next / prev;
 *    defaults to a single-song queue.
 */
function loadSong(id, queueIds, index) {
  const song = state.songsById.get(id);
  if (!song) return;
  state.currentSongId = id;
  state.queue = Array.isArray(queueIds) && queueIds.length ? queueIds : [id];
  state.queueIndex =
    typeof index === "number" && index >= 0 ? index : state.queue.indexOf(id);
  if (state.queueIndex < 0) state.queueIndex = 0;

  const now = document.querySelector(".player__now");
  now.dataset.songId = id;
  now.querySelector(".player__art").src = song.coverImage;
  now.querySelector(".player__title").textContent = song.title;
  now.querySelector(".player__artist").textContent = song.artist;

  // total time + reset progress
  state.duration = parseDuration(song.duration);
  state.elapsed = 0;
  progressEls.total.textContent = song.duration;
  renderProgress();

  // wire the player heart to this song and reflect its liked state
  const likeBtn = document.querySelector(".player__like");
  likeBtn.dataset.like = "song:" + id;
  likeBtn.classList.toggle("is-liked", isLiked("song", id));

  setPlaying(true);
}

// Progress-bar nodes are queried once and reused — renderProgress runs 5×/sec
// while playing, so re-walking the DOM each tick is needless work.
const progressEls = {};
function cacheProgressEls() {
  progressEls.current = document.querySelector(".progress__current");
  progressEls.fill = document.querySelector(".progress__fill");
  progressEls.handle = document.querySelector(".progress__handle");
  progressEls.total = document.querySelector(".progress__total");
}

// Paint the current elapsed/duration onto the progress bar.
function renderProgress() {
  const pct = state.duration
    ? Math.min(100, (state.elapsed / state.duration) * 100)
    : 0;
  progressEls.current.textContent = formatTime(state.elapsed);
  progressEls.fill.style.width = pct + "%";
  progressEls.handle.style.left = pct + "%";
}

// Simulated playback clock — advances faster than real time so progress
// and auto-advance to the next track are easy to observe.
function tick() {
  state.elapsed += 0.2 * PLAYBACK_SPEED;
  if (state.elapsed >= state.duration) {
    state.elapsed = state.duration;
    renderProgress();
    playNext();
    return;
  }
  renderProgress();
}

function startTicker() {
  stopTicker();
  state.ticker = setInterval(tick, 200);
}
function stopTicker() {
  if (state.ticker) clearInterval(state.ticker);
  state.ticker = null;
}

// Advance to the next song in the queue, looping to the first at the end.
function playNext() {
  if (!state.queue.length) return;
  const next = (state.queueIndex + 1) % state.queue.length;
  loadSong(state.queue[next], state.queue, next);
}

// Go to the previous song (wraps to the last).
function playPrev() {
  if (!state.queue.length) return;
  const prev = (state.queueIndex - 1 + state.queue.length) % state.queue.length;
  loadSong(state.queue[prev], state.queue, prev);
}

function setPlaying(playing) {
  state.isPlaying = playing;
  const use = document.querySelector(".play-btn use");
  if (use) use.setAttribute("href", playing ? "#icon-pause" : "#icon-play");
  document
    .querySelector(".play-btn")
    .setAttribute("aria-label", playing ? "Pause" : "Play");
  if (playing) startTicker();
  else stopTicker();
  updatePlayingRows();
}

function initPlayer() {
  cacheProgressEls();

  // play / pause
  document
    .querySelector(".play-btn")
    .addEventListener("click", () => setPlaying(!state.isPlaying));

  // previous / next within the queue
  const prevBtn = document.querySelector(
    '.player__controls [aria-label="Previous"]',
  );
  const nextBtn = document.querySelector(
    '.player__controls [aria-label="Next"]',
  );
  if (prevBtn) prevBtn.addEventListener("click", playPrev);
  if (nextBtn) nextBtn.addEventListener("click", playNext);

  // shuffle / repeat toggle their active state
  const shuffle = document.querySelector(".player__shuffle");
  const repeat = document.querySelector(".player__repeat");
  if (shuffle)
    shuffle.addEventListener("click", () =>
      shuffle.classList.toggle("is-active"),
    );
  if (repeat)
    repeat.addEventListener("click", () =>
      repeat.classList.toggle("is-active"),
    );

  // player heart likes the current song
  const likeBtn = document.querySelector(".player__like");
  likeBtn.addEventListener("click", () => {
    if (state.currentSongId) toggleLike("song", state.currentSongId);
  });
}

// ============================================================
//  BOOT
// ============================================================

function renderLoadError() {
  const container = document.querySelector(".playlist-cards");
  if (!container) return;
  container.replaceChildren(
    el(
      "p",
      "cards-empty",
      "Couldn’t load playlists. Serve the project root over HTTP (e.g. python3 -m http.server from the repo root) and open /music-playlist-creator/.",
    ),
  );
}

document.addEventListener("DOMContentLoaded", () => {
  initModal();
  initPlaylistDropdown();
  initPlaylistControls();
  initSidebarToggle();
  initPlayer();

  fetch("data/data.json")
    .then((response) => {
      if (!response.ok) throw new Error("HTTP " + response.status);
      return response.json();
    })
    .then((data) => {
      state.playlists = data.playlists || [];
      state.songs = data.songs || [];
      state.songs.forEach((s) => state.songsById.set(s.id, s));
      state.playlists.forEach((p) => state.playlistsById.set(p.id, p));

      // seed liked state from data.json + restore any saved user choices
      initLikes();

      renderPlaylistGrid();
      renderPlaylistNav();
      initCarousel();
      renderFeaturedPlaylist(shuffled(state.playlists)[0]);

      // default Now Playing = first carousel song (don't auto-"play")
      if (state.carousel.length) {
        const ids = state.carousel.map((s) => s.id);
        loadSong(ids[0], ids, 0);
        setPlaying(false);
      }
    })
    .catch((error) => {
      console.error("Failed to load data/data.json:", error);
      renderLoadError();
    });
});
