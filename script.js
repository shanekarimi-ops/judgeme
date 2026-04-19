// ── CONFIG ────────────────────────────────────────────────────────
const SUPABASE_URL = "https://rucvgrduvidsiaxwebwe.supabase.co";
const SUPABASE_KEY = "sb_publishable_HurXhQFxfzMTGBgm07hNVQ_JqVzEE3o";
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ── STATE ─────────────────────────────────────────────────────────
let currentUser = null;
let currentPost = null;
let currentVote = null;
let starRating = 0;
let uploadCat = "Profile Pic";
let feedTab = "discover";
let filterCat = "All";
let filterMinRating = 0;
let filterPanelOpen = false;
let viewingUserId = null;
let isFollowingUser = false;
let editingPostId = null;
let followListProfileId = null;
let activeProfileTab = "posts";
let unreadNotifCount = 0;
const postsCache = {};
const commentsCache = {};
const revealedPosts = new Set();
// Text overlay state
let textOverlay = null; // { text, font, color, xPct, yPct }
let overlayDragging = false;
let overlayDragOffX = 0, overlayDragOffY = 0;

// ── COOKIE HELPERS ───────────────────────────────────────────────
function setCookie(name, value, days) {
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  document.cookie = name + "=" + encodeURIComponent(value) + ";expires=" + expires + ";path=/;SameSite=Lax";
}
function getCookie(name) {
  const match = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
  return match ? decodeURIComponent(match[1]) : null;
}
function deleteCookie(name) {
  document.cookie = name + "=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/";
}

// ── INIT ──────────────────────────────────────────────────────────
window.addEventListener("DOMContentLoaded", async () => {
  let saved = localStorage.getItem("jm_user");

  // Fallback: if localStorage is empty, try cookie-stored user ID
  if (!saved) {
    const cookieId = getCookie("jm_uid");
    if (cookieId) {
      // Fetch full profile from Supabase using stored ID
      const { data: profile } = await sb.from("profiles").select("*").eq("id", cookieId).maybeSingle();
      if (profile) {
        saved = JSON.stringify(profile);
        localStorage.setItem("jm_user", saved);
      }
    }
  }

  if (saved) {
    currentUser = JSON.parse(saved);
    // Always refresh profile from Supabase to get latest data
    const { data: freshProfile } = await sb.from("profiles").select("*").eq("id", currentUser.id).maybeSingle();
    if (freshProfile) {
      currentUser = freshProfile;
      localStorage.setItem("jm_user", JSON.stringify(currentUser));
    }
    setCookie("jm_uid", currentUser.id, 365);
    launchApp();
    // Handle deep link: ?post=ID opens that post's jury panel
    const urlParams = new URLSearchParams(window.location.search);
    const deepPostId = urlParams.get("post");
    if (deepPostId) {
      // Strip the ?post= param from URL immediately so refresh doesn't re-trigger
      const cleanUrl = window.location.origin + window.location.pathname;
      window.history.replaceState({}, document.title, cleanUrl);
      setTimeout(async () => {
        const { data: post } = await sb.from("posts").select("*").eq("id", deepPostId).single();
        if (post) {
          postsCache[deepPostId] = post;
          // Also fetch badge for post author
          const { data: bp } = await sb.from("profiles").select("badge_tier").eq("id", post.user_id).maybeSingle();
          post.badge_tier = bp?.badge_tier || null;
          postsCache[deepPostId] = post;
          openJury(deepPostId);
        }
      }, 800);
    }
  } else {
    document.getElementById("age-gate").style.display = "flex";
  }

  document.getElementById("upload-cat-row").addEventListener("click", (e) => {
    const p = e.target.closest(".cat-pill");
    if (!p) return;
    document.querySelectorAll("#upload-cat-row .cat-pill").forEach((x) => x.classList.remove("active"));
    p.classList.add("active");
    uploadCat = p.dataset.cat;
  });

  document.getElementById("category-filter").addEventListener("click", (e) => {
    const p = e.target.closest(".cat-pill");
    if (!p) return;
    document.querySelectorAll("#category-filter .cat-pill").forEach((x) => x.classList.remove("active"));
    p.classList.add("active");
    filterCat = p.dataset.cat;
  });

  document.getElementById("star-filter-row").addEventListener("click", (e) => {
    const p = e.target.closest(".star-filter-pill");
    if (!p) return;
    document.querySelectorAll(".star-filter-pill").forEach((x) => x.classList.remove("active"));
    p.classList.add("active");
    filterMinRating = parseInt(p.dataset.min);
  });

  // Use event delegation for interest pills so modal pills always work
  document.addEventListener("click", (e) => {
    const pill = e.target.closest(".interest-pill");
    if (pill) pill.classList.toggle("active");
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".post-menu-wrap")) {
      document.querySelectorAll(".post-menu-dropdown.open").forEach((m) => m.classList.remove("open"));
    }
  });
});

function launchApp() {
  document.getElementById("age-gate").style.display = "none";
  document.getElementById("onboarding").style.display = "none";
  document.getElementById("app").style.display = "block";
  updateTopbarAvatar();
  if (currentUser.is_adult) {
    document.getElementById("nsfw-pill").style.display = "inline-block";
    document.getElementById("nsfw-upload-pill").style.display = "inline-block";
  }
  showScreen("screen-feed");
  loadFeed();
  setTimeout(() => { refreshNotifBadge(); refreshDMBadge(); }, 500);
  // Poll every 15 seconds for new notifications and DMs
  setInterval(() => { refreshNotifBadge(); refreshDMBadge(); }, 15000);
}

// ── AGE GATE ──────────────────────────────────────────────────────
function showReturningUser() {
  document.getElementById("age-gate").style.display = "none";
  document.getElementById("returning-gate").style.display = "flex";
  setTimeout(() => document.getElementById("returning-username")?.focus(), 100);
}

async function returningLogin() {
  const username = document.getElementById("returning-username").value.trim().replace(/^@/, "");
  if (!username) return;
  const errEl = document.getElementById("returning-error");
  errEl.style.display = "none";
  const btn = document.querySelector("#returning-gate .primary-btn");
  if (btn) btn.textContent = "Signing in...";
  const { data: profile } = await sb.from("profiles").select("*").eq("username", username).maybeSingle();
  if (!profile) {
    errEl.style.display = "block";
    if (btn) btn.textContent = "Sign in →";
    return;
  }
  currentUser = profile;
  localStorage.setItem("jm_user", JSON.stringify(currentUser));
  setCookie("jm_uid", currentUser.id, 365);
  document.getElementById("returning-gate").style.display = "none";
  launchApp();
}

function checkAge() {
  // Set max dynamically to today so future dates are blocked
  const todayStr = new Date().toISOString().split("T")[0];
  document.getElementById("age-input").setAttribute("max", todayStr);
  const val = document.getElementById("age-input").value;
  if (!val) { showAgeError("Please enter your birthday"); return; }
  const birth = new Date(val);
  const age = Math.floor((Date.now() - birth) / (365.25 * 24 * 3600 * 1000));
  if (age < 13) { showAgeError("You must be 13 or older to use Judge Me"); return; }
  const isAdult = age >= 18;
  localStorage.setItem("jm_birth", val);
  localStorage.setItem("jm_is_adult", isAdult);
  document.getElementById("age-gate").style.display = "none";
  document.getElementById("onboarding").style.display = "flex";
  window._pendingIsAdult = isAdult;
}

function showAgeError(msg) {
  const el = document.getElementById("age-error");
  el.textContent = msg;
  el.style.display = "block";
}

// ── ONBOARDING ────────────────────────────────────────────────────
let avatarFile = null;
function previewAvatar(input) {
  avatarFile = input.files[0];
  if (!avatarFile) return;
  const url = URL.createObjectURL(avatarFile);
  document.getElementById("avatar-preview-wrap").innerHTML = `<img src="${url}" style="width:90px;height:90px;object-fit:cover;border-radius:50%"/>`;
}

async function saveProfile() {
  const username = document.getElementById("ob-username").value.trim().replace(/^@/, "");
  if (!username) { document.getElementById("ob-error").style.display = "block"; return; }
  document.getElementById("ob-error").style.display = "none";
  const bio = document.getElementById("ob-bio").value.trim();
  const location = document.getElementById("ob-location").value.trim();
  const website = document.getElementById("ob-website").value.trim();
  const interests = [...document.querySelectorAll(".onboard-form .interest-pill.active")].map((p) => p.dataset.val);
  const isAdult = window._pendingIsAdult || false;
  const id = "u_" + Date.now() + "_" + Math.random().toString(36).substr(2, 8);

  let avatarUrl = null;
  if (avatarFile) {
    const fname = id + "_avatar." + avatarFile.name.split(".").pop();
    const { error } = await sb.storage.from("judge-me-uploads").upload(fname, avatarFile, { upsert: true });
    if (!error) {
      const { data: ud } = sb.storage.from("judge-me-uploads").getPublicUrl(fname);
      avatarUrl = ud.publicUrl;
    }
  }

  const profile = { id, username, bio, location, website, interests, avatar_url: avatarUrl, is_adult: isAdult, nsfw_enabled: isAdult, follower_count: 0, following_count: 0, birth_date: localStorage.getItem("jm_birth") };
  const { data: existing } = await sb.from("profiles").select("*").eq("username", username).maybeSingle();
  if (existing) {
    currentUser = existing;
    localStorage.setItem("jm_user", JSON.stringify(currentUser));
    launchApp();
    return;
  }
  await sb.from("profiles").insert(profile);
  // Assign badge tier based on signup order
  const tier = await assignBadgeTier(id);
  profile.badge_tier = tier;
  currentUser = profile;
  localStorage.setItem("jm_user", JSON.stringify(currentUser));
  setCookie("jm_uid", currentUser.id, 365);
  launchApp();
}

// ── SCREENS ───────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
  document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
  const tabMap = { "screen-feed": 0, "screen-upload": 1, "screen-search": 2, "screen-analytics": 3, "screen-messages": 4, "screen-profile": 5 };
  const ti = tabMap[id];
  if (ti !== undefined) document.querySelectorAll(".tab")[ti]?.classList.add("active");
  window.scrollTo(0, 0);
  // Stop DM polling when leaving convo
  if (id !== "screen-dm-convo" && dmPollInterval) { clearInterval(dmPollInterval); dmPollInterval = null; }
  if (id === "screen-feed") loadFeed();
  if (id === "screen-profile") { viewingUserId = null; loadMyProfile(); }
  if (id === "screen-analytics") loadAnalytics();
  if (id === "screen-notifications") loadNotifications();
  if (id === "screen-messages") loadDMInbox();
  if (id === "screen-search") setTimeout(() => document.getElementById("search-input")?.focus(), 100);
}

// ── FILTER PANEL ──────────────────────────────────────────────────
function toggleFilterPanel() {
  filterPanelOpen = !filterPanelOpen;
  const body = document.getElementById("filter-panel-body");
  const label = document.getElementById("filter-toggle-label");
  body.style.display = filterPanelOpen ? "block" : "none";
  label.textContent = filterPanelOpen ? "🔼 Filter" : "🔽 Filter";
}

function applyFilters() {
  const activeCat = document.querySelector("#category-filter .cat-pill.active");
  if (activeCat) filterCat = activeCat.dataset.cat;
  const activeStar = document.querySelector(".star-filter-pill.active");
  if (activeStar) filterMinRating = parseInt(activeStar.dataset.min);
  // Close filter modal (TikTok mode)
  const m = document.getElementById("filter-modal");
  if (m) m.style.display = "none";
  loadFeed();
}

function resetFilters() {
  filterCat = "All";
  filterMinRating = 0;
  document.querySelectorAll("#category-filter .cat-pill").forEach((p) => p.classList.remove("active"));
  document.querySelector("#category-filter [data-cat='All']")?.classList.add("active");
  document.querySelectorAll(".star-filter-pill").forEach((p) => p.classList.remove("active"));
  document.querySelector(".star-filter-pill[data-min='0']")?.classList.add("active");
  updateFilterSummary();
  loadFeed();
}

function updateFilterSummary() {
  const summary = document.getElementById("active-filters-summary");
  const resetBtn = document.getElementById("filter-reset-btn");
  const parts = [];
  if (filterCat !== "All") parts.push(filterCat);
  if (filterMinRating > 0) parts.push(`⭐ ${filterMinRating}+`);
  if (parts.length > 0) {
    summary.textContent = parts.join(" · ");
    resetBtn.style.display = "inline-block";
  } else {
    summary.textContent = "";
    resetBtn.style.display = "none";
  }
}

// ── FEED ──────────────────────────────────────────────────────────
async function switchFeedTab(tab) {
  feedTab = tab;
  const discoverBtn = document.getElementById("tab-discover");
  const followingBtn = document.getElementById("tab-following");
  if (discoverBtn) { discoverBtn.classList.toggle("active", tab === "discover"); }
  if (followingBtn) { followingBtn.classList.toggle("active", tab === "following"); }
  loadFeed();
}

async function loadFeed() {
  const container = document.getElementById("tiktok-feed");
  if (!container) return;
  container.innerHTML = '<div style="height:100%;display:flex;align-items:center;justify-content:center;color:#fff;font-size:16px">Loading...</div>';
  // Clear post cache so badge updates are always fresh
  Object.keys(postsCache).forEach(k => delete postsCache[k]);

  let query = sb.from("posts").select("*").order("created_at", { ascending: false });
  const isAdult = currentUser && currentUser.is_adult;
  if (filterCat === "NSFW") {
    if (!isAdult) {
      container.innerHTML = '<div style="height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;gap:12px"><div style="font-size:48px">🔞</div><div style="font-size:18px;font-weight:700">18+ only</div></div>';
      return;
    }
    query = query.eq("category", "NSFW");
  } else if (filterCat !== "All") {
    query = query.eq("category", filterCat).neq("category", "NSFW");
  } else {
    query = query.neq("category", "NSFW");
  }

  const { data, error } = await query.limit(200);
  if (error || !data || data.length === 0) {
    container.innerHTML = '<div style="height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;gap:12px;scroll-snap-align:start"><div style="font-size:56px">🔥</div><div style="font-size:18px;font-weight:700">No posts yet!</div><div style="font-size:14px;color:#888">Be the first to get judged</div></div>';
    return;
  }

  let posts = data;

  if (filterMinRating > 0) {
    posts = posts.filter((p) => {
      if (!p.total_ratings || p.total_ratings === 0) return false;
      const avg = p.rating_sum / p.total_ratings;
      return Math.floor(avg) === filterMinRating;
    });
  }

  if (feedTab === "following" && currentUser) {
    const { data: follows } = await sb.from("follows").select("following_id").eq("follower_id", currentUser.id);
    const ids = (follows || []).map((f) => f.following_id);
    posts = posts.filter((p) => ids.includes(p.user_id));
    if (posts.length === 0) {
      container.innerHTML = '<div style="height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;gap:12px;scroll-snap-align:start"><div style="font-size:56px">👥</div><div style="font-size:18px;font-weight:700">Follow people to see their posts</div></div>';
      return;
    }
  }

  if (posts.length === 0) {
    container.innerHTML = '<div style="height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;gap:12px;scroll-snap-align:start"><div style="font-size:56px">🔍</div><div style="font-size:18px;font-weight:700">No posts match your filters</div><button onclick="resetFilters();closeFilterModal()" style="background:#ff6b35;border:none;color:#fff;padding:10px 20px;border-radius:20px;font-size:14px;cursor:pointer;margin-top:8px">Clear filters</button></div>';
    return;
  }

  // Fetch badge tiers for all post authors from profiles
  const uniqueUserIds = [...new Set(posts.map(p => p.user_id).filter(Boolean))];
  let badgeMap = {};
  if (uniqueUserIds.length > 0) {
    const { data: badgeProfiles } = await sb.from("profiles").select("id,badge_tier").in("id", uniqueUserIds);
    (badgeProfiles || []).forEach(bp => {
      if (bp.badge_tier) badgeMap[bp.id] = bp.badge_tier;
    });
  }
  // Attach badge_tier to each post
  posts = posts.map(p => ({ ...p, badge_tier: badgeMap[p.user_id] || null }));

  container.innerHTML = posts.map((p) => renderTikTokPost(p)).join("");
  posts.forEach(p => { postsCache[p.id] = p; });

  // Auto-play first video
  const firstVid = container.querySelector("video");
  if (firstVid) firstVid.play().catch(() => {});

  // Pause/play videos on scroll
  setupTikTokScroll(container);
}

function setupTikTokScroll(container) {
  let lastIdx = 0;
  container.addEventListener("scroll", () => {
    const posts = container.querySelectorAll(".tiktok-post");
    const idx = Math.round(container.scrollTop / container.clientHeight);
    if (idx !== lastIdx) {
      lastIdx = idx;
      posts.forEach((post, i) => {
        const vid = post.querySelector("video");
        if (!vid) return;
        if (i === idx) {
          vid.play().catch(() => {});
        } else {
          vid.pause();
          vid.currentTime = 0;
        }
      });
    }
  }, { passive: true });
}

function renderTikTokPost(p) {
  if ((p.is_nsfw || p.category === "NSFW") && !(currentUser && currentUser.is_adult)) return "";
  postsCache[p.id] = p;

  const avg = p.total_ratings > 0 ? (p.rating_sum / p.total_ratings).toFixed(1) : "–";
  const isOwn = currentUser && p.user_id === currentUser.id;
  const alreadyVoted = localStorage.getItem("voted_" + p.id);
  const isFavorited = localStorage.getItem("fav_" + p.id) === "1";
  const avatarHtml = p.avatar_url
    ? `<img src="${esc(p.avatar_url)}" />`
    : `<span style="font-size:16px;font-weight:700;color:#fff">${initials(p.username)}</span>`;

  const isSensitive = p.is_nsfw || p.category === "NSFW";
  const isVideo = p.image_url && /\.(mp4|mov|webm|avi)$/i.test(p.image_url);

  let mediaHtml = "";
  if (p.image_url) {
    if (isSensitive && !revealedPosts.has(p.id)) {
      mediaHtml = `<div style="position:absolute;inset:0;overflow:hidden">${isVideo
        ? `<video src="${esc(p.image_url)}" style="width:100%;height:100%;object-fit:contain;filter:blur(30px);transform:scale(1.1);background:#000" muted></video>`
        : `<img src="${esc(p.image_url)}" style="width:100%;height:100%;object-fit:contain;filter:blur(30px);transform:scale(1.1);background:#000"/>`}
        <div class="tiktok-sensitive-overlay" onclick="revealTikTokPost('${p.id}')">
          <div style="font-size:40px">⚠️</div>
          <div style="font-size:17px;font-weight:700;color:#fff">Sensitive Content</div>
          <div style="font-size:14px;color:rgba(255,255,255,0.7)">Tap to view</div>
        </div>
      </div>`;
    } else if (isVideo) {
      mediaHtml = `
        <video src="${esc(p.image_url)}" autoplay muted loop playsinline style="position:absolute;top:50%;left:50%;width:200%;height:200%;transform:translate(-50%,-50%);object-fit:cover;filter:blur(30px);z-index:1"></video>
        <video id="vid-${p.id}" src="${esc(p.image_url)}" autoplay muted loop playsinline style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;z-index:2"></video>`;
    } else {
      mediaHtml = `
        <img src="${esc(p.image_url)}" style="position:absolute;top:50%;left:50%;width:200%;height:200%;transform:translate(-50%,-50%);object-fit:cover;display:block;filter:blur(30px);z-index:1"/>
        <img src="${esc(p.image_url)}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;display:block;z-index:2"/>`;
    }
  } else {
    mediaHtml = `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:80px;background:#111">${catEmoji(p.category)}</div>`;
  }

  // Vote state for fire/ice
  const fireActive = alreadyVoted ? "opacity:1" : "opacity:0.85";
  const iceActive = alreadyVoted ? "opacity:1" : "opacity:0.85";

  const muteBtn = isVideo ? `
    <button class="tiktok-action-btn" onclick="toggleVideoMute('${p.id}',event)">
      <div class="tiktok-action-icon" id="mute-btn-${p.id}">🔇</div>
      <span class="tiktok-action-label">Sound</span>
    </button>` : '';

  const ownMenu = isOwn ? `
    <button class="tiktok-action-btn" onclick="showTikTokPostMenu('${p.id}')">
      <div class="tiktok-action-icon">···</div>
      <span class="tiktok-action-label">More</span>
    </button>` : '';

  // Parse text overlay if present
  let overlayHtml = "";
  if (p.text_overlay) {
    try {
      const ov = typeof p.text_overlay === "string" ? JSON.parse(p.text_overlay) : p.text_overlay;
      if (ov && ov.text) {
        const fs = FONT_STYLES[ov.font] || FONT_STYLES.bold;
        overlayHtml = `<div class="post-text-overlay" style="left:${ov.xPct}%;top:${ov.yPct}%;transform:translate(-50%,-50%);color:${esc(ov.color)};font-family:${esc(fs.fontFamily)};font-weight:${esc(fs.fontWeight)};font-style:${esc(fs.fontStyle)};text-shadow:${esc(fs.textShadow)};letter-spacing:${esc(fs.letterSpacing)};font-size:22px">${esc(ov.text)}</div>`;
      }
    } catch(e) {}
  }

  return `<div class="tiktok-post" id="feed-item-${p.id}">
    ${mediaHtml}
    ${overlayHtml}
    <div class="tiktok-overlay-gradient" style="z-index:3"></div>

    <!-- Bottom-left info -->
    <div class="tiktok-info">
      <div class="tiktok-category-tag">${catEmoji(p.category)} ${esc(p.category)}</div>
      <div onclick="openUserProfile('${p.user_id}')" style="display:inline-flex;align-items:center;flex-wrap:wrap;gap:4px;cursor:pointer;margin-bottom:2px">
        <span style="font-size:15px;font-weight:700;color:#fff;text-shadow:0 1px 4px rgba(0,0,0,0.6)">@${esc(p.username)}</span>${getBadgeHtml(p.badge_tier)}
      </div>
      ${p.caption ? `<div class="tiktok-caption">${esc(p.caption)}</div>` : ""}
      <div style="display:flex;gap:8px;margin-top:6px">
        <span style="font-size:12px;color:rgba(255,255,255,0.7)">🔥 ${p.fire_votes}</span>
        <span style="font-size:12px;color:rgba(255,255,255,0.7)">🧊 ${p.ice_votes}</span>
        <span style="font-size:12px;color:rgba(255,255,255,0.7)">⭐ ${avg}</span>
      </div>
    </div>

    <!-- Right-side action buttons -->
    <div class="tiktok-actions">
      <!-- Avatar -->
      <div>
        <div class="tiktok-avatar-btn" onclick="openUserProfile('${p.user_id}')">${avatarHtml}</div>
      </div>

      <!-- Fire/Ice vote -->
      ${isOwn ? `
      <button class="tiktok-action-btn" onclick="editCaption('${p.id}')">
        <div class="tiktok-action-icon">✏️</div>
        <span class="tiktok-action-label">Edit</span>
      </button>` : alreadyVoted ? `
      <button class="tiktok-action-btn">
        <div class="tiktok-action-icon" style="background:rgba(255,107,53,0.4)">✅</div>
        <span class="tiktok-action-label">Judged</span>
      </button>` : `
      <button class="tiktok-action-btn" onclick="openTikTokVote('${p.id}')">
        <div class="tiktok-action-icon">🔥</div>
        <span class="tiktok-action-label" id="vote-label-${p.id}">Judge</span>
      </button>`}

      <!-- Jury/Comments -->
      <button class="tiktok-action-btn" onclick="openJury('${p.id}')">
        <div class="tiktok-action-icon" id="jury-icon-${p.id}">⚖️</div>
        <span class="tiktok-action-label" id="jury-label-${p.id}">Jury</span>
      </button>

      <!-- Favorite -->
      <button class="tiktok-action-btn" onclick="toggleFavorite('${p.id}')">
        <div class="tiktok-action-icon" id="fav-btn-${p.id}" style="${isFavorited ? 'background:rgba(255,107,53,0.4)' : ''}">😍</div>
        <span class="tiktok-action-label">Fave</span>
      </button>

      <!-- Share -->
      <button class="tiktok-action-btn" onclick="sharePost('${p.id}',event)">
        <div class="tiktok-action-icon">↗</div>
        <span class="tiktok-action-label">Share</span>
      </button>

      ${muteBtn}
      ${ownMenu}
    </div>
  </div>`;
}

function renderFeedItem(p) {
  // Extra safety: never render NSFW posts for non-adults
  if ((p.is_nsfw || p.category === "NSFW") && !(currentUser && currentUser.is_adult)) return "";
  postsCache[p.id] = p;
  const avg = p.total_ratings > 0 ? (p.rating_sum / p.total_ratings).toFixed(1) : "–";
  const ago = timeAgo(p.created_at);
  const isOwn = currentUser && p.user_id === currentUser.id;
  const alreadyVoted = localStorage.getItem("voted_" + p.id);
  const isFavorited = localStorage.getItem("fav_" + p.id) === "1";
  const avatarHtml = p.avatar_url ? `<img src="${esc(p.avatar_url)}" />` : initials(p.username);
  const isSensitive = p.is_nsfw || p.category === "NSFW";
  const isRevealed = revealedPosts.has(p.id);

  let mediaHtml = "";
  if (p.image_url) {
    const isVideo = /\.(mp4|mov|webm|avi)$/i.test(p.image_url);
    if (isSensitive && !isRevealed) {
      mediaHtml = `<div class="sensitive-wrap" id="wrap-${p.id}">${isVideo ? `<video class="feed-image sensitive-blur" src="${esc(p.image_url)}" style="width:100%;max-height:400px"></video>` : `<img class="feed-image sensitive-blur" src="${esc(p.image_url)}" />`}<div class="sensitive-overlay" onclick="revealPost('${p.id}')"><div class="sensitive-icon">⚠️</div><div class="sensitive-text">Sensitive content</div><div class="sensitive-sub">Tap to view</div></div></div>`;
    } else if (isVideo) {
      mediaHtml = `<div style="position:relative">
        <video class="feed-image" id="vid-${p.id}" src="${esc(p.image_url)}" autoplay muted loop playsinline style="width:100%;max-height:400px;display:block" onclick="openLightbox('${p.id}')"></video>
        <button onclick="toggleVideoMute('${p.id}',event)" id="mute-btn-${p.id}" style="position:absolute;bottom:10px;left:10px;background:rgba(0,0,0,0.55);border:none;color:#fff;width:34px;height:34px;border-radius:50%;font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px)" title="Tap to unmute">🔇</button>
        <button onclick="sharePost('${p.id}',event)" style="position:absolute;top:10px;right:10px;background:rgba(0,0,0,0.55);border:none;color:#fff;width:34px;height:34px;border-radius:50%;font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px)">↗</button>
      </div>`;
    } else {
      mediaHtml = `<div style="position:relative">
        <img class="feed-image" src="${esc(p.image_url)}" onclick="openLightbox('${p.id}')" style="cursor:pointer"/>
        <button onclick="sharePost('${p.id}',event)" style="position:absolute;top:10px;right:10px;background:rgba(0,0,0,0.55);border:none;color:#fff;width:34px;height:34px;border-radius:50%;font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px)">↗</button>
      </div>`;
    }
  } else {
    mediaHtml = `<div class="feed-image-placeholder">${catEmoji(p.category)}</div>`;
  }

  const menuHtml = isOwn ? `
    <div class="post-menu-wrap">
      <button class="post-menu-btn" onclick="togglePostMenu(event,'${p.id}')">•••</button>
      <div class="post-menu-dropdown" id="menu-${p.id}">
        <button class="post-menu-item" onclick="editCaption('${p.id}')">✏️ Edit caption</button>
        <button class="post-menu-item post-menu-danger" onclick="deletePost('${p.id}',false)">🗑️ Delete post</button>
      </div>
    </div>` : "";

  const inlineVoting = isOwn
    ? `<div class="inline-voted-own">✏️ Tap ••• to edit caption</div>`
    : alreadyVoted
      ? `<div class="inline-voted-done">✅ You judged this! <span class="inline-voted-score">🔥 ${p.fire_votes} · 🧊 ${p.ice_votes} · ⭐ ${avg}</span></div>`
      : `<div class="inline-vote-section" id="vote-section-${p.id}">
        <div class="inline-vote-row">
          <button class="inline-fire-btn" id="inline-fire-${p.id}" onclick="inlineCastVote('${p.id}','fire')">🔥 <span class="inline-vote-label">Fire</span></button>
          <button class="inline-ice-btn" id="inline-ice-${p.id}" onclick="inlineCastVote('${p.id}','ice')">🧊 <span class="inline-vote-label">Ice</span></button>
        </div>
        <div class="inline-stars-row" id="inline-stars-${p.id}">
          ${[1,2,3,4,5,6,7,8,9,10].map((i) => `<span class="inline-star" data-post="${p.id}" data-val="${i}" onclick="inlineSetStar('${p.id}',${i})">★</span>`).join("")}
        </div>
        <button class="inline-submit-btn" id="inline-submit-${p.id}" onclick="inlineSubmitVote('${p.id}')">Submit Verdict 🔥</button>
      </div>`;

  return `<div class="feed-item" id="feed-item-${p.id}">
    <div class="feed-item-header">
      <div class="feed-avatar" onclick="openUserProfile('${p.user_id}')">${avatarHtml}</div>
      <div class="feed-user-info">
        <div class="feed-username" onclick="openUserProfile('${p.user_id}')">@${esc(p.username)}</div>
        <div class="feed-meta">${esc(p.category)} · ${ago}</div>
      </div>
      ${menuHtml}
    </div>
    ${mediaHtml}
    ${p.caption ? `<div class="feed-caption">${esc(p.caption)}</div>` : ""}
    <div class="feed-vote-counts">
      <span class="vote-pill">🔥 ${p.fire_votes}</span>
      <span class="vote-pill">🧊 ${p.ice_votes}</span>
      <span class="vote-pill">⭐ ${avg}</span>
      <button class="starstruck-btn ${isFavorited ? 'saved' : ''}" id="fav-btn-${p.id}" onclick="toggleFavorite('${p.id}')" title="${isFavorited ? 'Remove from favorites' : 'Save to favorites'}">😍</button>
    </div>
    ${inlineVoting}
    <div class="jury-section" id="jury-${p.id}">
      <div class="jury-preview" onclick="openJury('${p.id}')">
        <span class="jury-icon">⚖️</span>
        <span class="jury-label" id="jury-label-${p.id}">The Jury — tap to weigh in</span>
        <span class="jury-arrow">›</span>
      </div>
    </div>
  </div>`;
}


// ── TIKTOK FEED HELPERS ───────────────────────────────────────────

function showFilterModal() {
  const m = document.getElementById("filter-modal");
  if (m) m.style.display = "flex";
}

function closeFilterModal(e) {
  const m = document.getElementById("filter-modal");
  if (!m) return;
  if (!e || e.target === m) m.style.display = "none";
}

function revealTikTokPost(postId) {
  revealedPosts.add(postId);
  const post = postsCache[postId];
  if (!post) return;
  const el = document.getElementById("feed-item-" + postId);
  if (!el) return;
  // Re-render the media section
  const isVideo = /\.(mp4|mov|webm|avi)$/i.test(post.image_url || "");
  const newMedia = isVideo
    ? `<video id="vid-${postId}" class="tiktok-media" src="${esc(post.image_url)}" autoplay muted loop playsinline></video>`
    : `<img class="tiktok-media" src="${esc(post.image_url)}" />`;
  // Remove old sensitive overlay
  const sensitiveDiv = el.querySelector(".tiktok-sensitive-overlay");
  if (sensitiveDiv) sensitiveDiv.closest("div").outerHTML = newMedia;
}

async function loadJuryPreview(postId) {
  const { count } = await sb.from("comments").select("*", { count: "exact", head: true }).eq("post_id", postId).is("parent_id", null);
  const label = document.getElementById("jury-label-" + postId);
  if (label) label.textContent = count > 0 ? count : "Jury";
}

function openTikTokVote(postId) {
  const p = postsCache[postId];
  if (!p) return;
  const existing = document.getElementById("tiktok-vote-panel");
  if (existing) existing.remove();

  const panel = document.createElement("div");
  panel.id = "tiktok-vote-panel";
  panel.className = "tiktok-vote-panel";
  panel.innerHTML = `
    <div class="tiktok-vote-inner" onclick="event.stopPropagation()">
      <div style="width:40px;height:4px;background:#333;border-radius:2px;margin:0 auto 16px"></div>
      <div style="font-size:16px;font-weight:700;color:#fff;text-align:center;margin-bottom:16px">⚖️ Cast Your Verdict</div>

      <div style="display:flex;gap:12px;margin-bottom:16px">
        <button id="tv-fire" onclick="tikTokCastVote('${postId}','fire')"
          style="flex:1;padding:16px;border-radius:14px;border:1px solid #222;background:#111;cursor:pointer;font-size:28px;color:#fff;transition:all 0.15s">
          🔥<div style="font-size:13px;margin-top:4px;color:#888">Fire</div>
        </button>
        <button id="tv-ice" onclick="tikTokCastVote('${postId}','ice')"
          style="flex:1;padding:16px;border-radius:14px;border:1px solid #222;background:#111;cursor:pointer;font-size:28px;color:#fff;transition:all 0.15s">
          🧊<div style="font-size:13px;margin-top:4px;color:#888">Ice</div>
        </button>
      </div>

      <div style="font-size:13px;color:#666;margin-bottom:8px;text-align:center">Rate 1–10</div>
      <div style="display:flex;gap:4px;justify-content:center;margin-bottom:16px" id="tv-stars">
        ${[1,2,3,4,5,6,7,8,9,10].map(i => `<span onclick="tikTokSetStar('${postId}',${i})" data-val="${i}" style="font-size:22px;cursor:pointer;opacity:0.3;transition:opacity 0.1s">★</span>`).join("")}
      </div>

      <button onclick="tikTokSubmitVote('${postId}')"
        style="width:100%;padding:15px;border-radius:14px;background:#ff6b35;color:#fff;font-size:16px;font-weight:700;cursor:pointer;border:none">
        Submit Verdict 🔥
      </button>
      <button onclick="document.getElementById('tiktok-vote-panel').remove()"
        style="width:100%;padding:12px;border-radius:14px;background:transparent;border:0.5px solid #333;color:#666;font-size:14px;cursor:pointer;margin-top:8px">
        Cancel
      </button>
    </div>`;
  panel.addEventListener("click", (e) => { if (e.target === panel) panel.remove(); });
  document.body.appendChild(panel);
  // Init vote state
  if (!inlineVoteState[postId]) inlineVoteState[postId] = { vote: null, stars: 0 };
}

function tikTokCastVote(postId, type) {
  if (!inlineVoteState[postId]) inlineVoteState[postId] = { vote: null, stars: 0 };
  inlineVoteState[postId].vote = type;
  const fireBtn = document.getElementById("tv-fire");
  const iceBtn = document.getElementById("tv-ice");
  if (fireBtn) fireBtn.style.background = type === "fire" ? "#1a0e00" : "#111";
  if (fireBtn) fireBtn.style.border = type === "fire" ? "2px solid #ff6b35" : "1px solid #222";
  if (iceBtn) iceBtn.style.background = type === "ice" ? "#001525" : "#111";
  if (iceBtn) iceBtn.style.border = type === "ice" ? "2px solid #42a5f5" : "1px solid #222";
}

function tikTokSetStar(postId, val) {
  if (!inlineVoteState[postId]) inlineVoteState[postId] = { vote: null, stars: 0 };
  inlineVoteState[postId].stars = val;
  document.querySelectorAll("#tv-stars span").forEach(s => {
    s.style.opacity = parseInt(s.dataset.val) <= val ? "1" : "0.3";
  });
}

async function tikTokSubmitVote(postId) {
  const state = inlineVoteState[postId];
  if (!state || (!state.vote && state.stars === 0)) { showToast("Pick 🔥 or 🧊, or give a star rating!"); return; }
  const voterKey = "voted_" + postId;
  if (localStorage.getItem(voterKey)) { showToast("You already judged this one!"); return; }

  document.getElementById("tiktok-vote-panel")?.remove();

  const { data } = await sb.from("posts").select("*").eq("id", postId).single();
  if (!data) return;
  await sb.from("votes").insert({ id: uid(), post_id: postId, voter_id: currentUser?.id || "anon", vote_type: state.vote, star_rating: state.stars || null });
  const updates = {};
  if (state.vote === "fire") updates.fire_votes = data.fire_votes + 1;
  if (state.vote === "ice") updates.ice_votes = data.ice_votes + 1;
  if (state.stars > 0) { updates.total_ratings = data.total_ratings + 1; updates.rating_sum = data.rating_sum + state.stars; }
  await sb.from("posts").update(updates).eq("id", postId);
  localStorage.setItem(voterKey, "1");

  const updated = { ...data, ...updates };
  postsCache[postId] = updated;

  // Update vote button to show ✅ judged
  const voteBtn = document.querySelector(`#feed-item-${postId} .tiktok-action-btn .tiktok-action-icon`);
  if (voteBtn && voteBtn.textContent === "🔥") {
    voteBtn.textContent = "✅";
    voteBtn.style.background = "rgba(255,107,53,0.4)";
  }

  // Update stats display
  const infoEl = document.querySelector(`#feed-item-${postId} .tiktok-info`);
  if (infoEl) {
    const newAvg = updated.total_ratings > 0 ? (updated.rating_sum / updated.total_ratings).toFixed(1) : "–";
    const statsRow = infoEl.querySelector("div:last-child");
    if (statsRow) statsRow.innerHTML = `<span style="font-size:12px;color:rgba(255,255,255,0.7)">🔥 ${updated.fire_votes}</span><span style="font-size:12px;color:rgba(255,255,255,0.7)">🧊 ${updated.ice_votes}</span><span style="font-size:12px;color:rgba(255,255,255,0.7)">⭐ ${newAvg}</span>`;
  }
  showToast("Verdict submitted! 🔥");
}


function showTikTokPostMenu(postId) {
  const existing = document.getElementById("tiktok-post-menu");
  if (existing) existing.remove();
  const sheet = document.createElement("div");
  sheet.id = "tiktok-post-menu";
  sheet.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:99999;display:flex;align-items:flex-end;justify-content:center";
  sheet.innerHTML = `
    <div style="background:#111;border-radius:20px 20px 0 0;border:0.5px solid #2a2a2a;padding:20px;width:100%;max-width:430px" onclick="event.stopPropagation()">
      <div style="width:40px;height:4px;background:#333;border-radius:2px;margin:0 auto 16px"></div>
      <button onclick="editCaption('${postId}');document.getElementById('tiktok-post-menu').remove()" style="width:100%;padding:14px;border-radius:12px;border:1px solid #222;background:#1a1a1a;color:#fff;font-size:15px;cursor:pointer;margin-bottom:10px;text-align:left">✏️ Edit caption</button>
      <button onclick="document.getElementById('tiktok-post-menu').remove();deletePost('${postId}',false)" style="width:100%;padding:14px;border-radius:12px;border:1px solid #cc2222;background:transparent;color:#ff4444;font-size:15px;cursor:pointer;margin-bottom:10px;text-align:left">🗑️ Delete post</button>
      <button onclick="document.getElementById('tiktok-post-menu').remove()" style="width:100%;padding:12px;border-radius:12px;border:1px solid #333;background:transparent;color:#888;font-size:14px;cursor:pointer">Cancel</button>
    </div>`;
  sheet.addEventListener("click", e => { if (e.target === sheet) sheet.remove(); });
  document.body.appendChild(sheet);
}

// ── INLINE VOTING ─────────────────────────────────────────────────
const inlineVoteState = {};

function inlineCastVote(postId, type) {
  if (!inlineVoteState[postId]) inlineVoteState[postId] = { vote: null, stars: 0 };
  inlineVoteState[postId].vote = type;
  const fireBtn = document.getElementById("inline-fire-" + postId);
  const iceBtn = document.getElementById("inline-ice-" + postId);
  if (fireBtn) fireBtn.className = type === "fire" ? "inline-fire-btn selected" : "inline-fire-btn";
  if (iceBtn) iceBtn.className = type === "ice" ? "inline-ice-btn selected" : "inline-ice-btn";
}

function inlineSetStar(postId, val) {
  if (!inlineVoteState[postId]) inlineVoteState[postId] = { vote: null, stars: 0 };
  inlineVoteState[postId].stars = val;
  document.querySelectorAll(`[data-post="${postId}"].inline-star`).forEach((s) => {
    s.classList.toggle("lit", parseInt(s.dataset.val) <= val);
  });
}

async function inlineSubmitVote(postId) {
  const state = inlineVoteState[postId];
  if (!state || (!state.vote && state.stars === 0)) { showToast("Pick 🔥 or 🧊, or give a star rating!"); return; }
  const voterKey = "voted_" + postId;
  if (localStorage.getItem(voterKey)) { showToast("You already judged this one!"); return; }
  const btn = document.getElementById("inline-submit-" + postId);
  if (btn) { btn.textContent = "Submitting..."; btn.disabled = true; }
  const { data } = await sb.from("posts").select("*").eq("id", postId).single();
  if (!data) { showToast("Could not load post"); return; }
  await sb.from("votes").insert({ id: uid(), post_id: postId, voter_id: currentUser?.id || "anon", vote_type: state.vote, star_rating: state.stars || null });
  const updates = {};
  if (state.vote === "fire") updates.fire_votes = data.fire_votes + 1;
  if (state.vote === "ice") updates.ice_votes = data.ice_votes + 1;
  if (state.stars > 0) { updates.total_ratings = data.total_ratings + 1; updates.rating_sum = data.rating_sum + state.stars; }
  await sb.from("posts").update(updates).eq("id", postId);
  localStorage.setItem(voterKey, "1");
  const updatedPost = { ...data, ...updates };
  postsCache[postId] = updatedPost;
  const section = document.getElementById("vote-section-" + postId);
  if (section) {
    const newAvg2 = updatedPost.total_ratings > 0 ? (updatedPost.rating_sum / updatedPost.total_ratings).toFixed(1) : "–";
    section.innerHTML = `<div class="inline-voted-done inline-vote-pop">
      <div>✅ Verdict submitted!</div>
      <div class="inline-voted-score">🔥 ${updatedPost.fire_votes} · 🧊 ${updatedPost.ice_votes} · ⭐ ${newAvg2}</div>
      <button class="inline-share-btn" onclick="showShareSheet('${postId}')">📤 Share result</button>
    </div>`;
  }
  const countsEl = document.querySelector(`#feed-item-${postId} .feed-vote-counts`);
  if (countsEl) {
    const newAvg = updatedPost.total_ratings > 0 ? (updatedPost.rating_sum / updatedPost.total_ratings).toFixed(1) : "–";
    const isFav = localStorage.getItem("fav_" + postId) === "1";
    countsEl.innerHTML = `<span class="vote-pill">🔥 ${updatedPost.fire_votes}</span><span class="vote-pill">🧊 ${updatedPost.ice_votes}</span><span class="vote-pill">⭐ ${newAvg}</span><button class="starstruck-btn ${isFav ? 'saved' : ''}" id="fav-btn-${postId}" onclick="toggleFavorite('${postId}')" title="Save to favorites">😍</button>`;
  }
}

// ── FAVORITES ─────────────────────────────────────────────────────
async function toggleFavorite(postId) {
  const key = "fav_" + postId;
  const btn = document.getElementById("fav-btn-" + postId);
  const isSaved = localStorage.getItem(key) === "1";

  if (isSaved) {
    localStorage.removeItem(key);
    if (currentUser) {
      await sb.from("favorites").delete().eq("user_id", currentUser.id).eq("post_id", postId);
    }
    if (btn) { btn.classList.remove("saved"); }
    showToast("Removed from favorites");
  } else {
    localStorage.setItem(key, "1");
    if (currentUser) {
      await sb.from("favorites").upsert({ id: uid(), user_id: currentUser.id, post_id: postId }, { onConflict: "user_id,post_id" });
    }
    if (btn) { btn.classList.add("saved"); }
    showToast("Saved to favorites 😍");
  }
}

async function loadFavorites() {
  const grid = document.getElementById("my-favorites-grid");
  if (!grid || !currentUser) return;
  grid.innerHTML = '<div class="loading">Loading favorites...</div>';

  // Try DB first, fall back to localStorage
  const { data: favData } = await sb.from("favorites").select("post_id").eq("user_id", currentUser.id);
  let postIds = (favData || []).map((f) => f.post_id);

  // Merge with localStorage favorites in case of any gaps
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith("fav_") && localStorage.getItem(key) === "1") {
      const pid = key.replace("fav_", "");
      if (!postIds.includes(pid)) postIds.push(pid);
    }
  }

  if (postIds.length === 0) {
    grid.innerHTML = '<div class="loading" style="padding:40px 0;color:#555">No favorites yet — tap 😍 on any post to save it</div>';
    return;
  }

  const { data: posts } = await sb.from("posts").select("*").in("id", postIds);
  if (!posts || posts.length === 0) {
    grid.innerHTML = '<div class="loading" style="padding:40px 0;color:#555">No favorites yet</div>';
    return;
  }

  posts.forEach((p) => { postsCache[p.id] = p; });
  grid.innerHTML = posts.map((p) => `
    <div class="post-thumb-wrap" style="position:relative">
      <div class="post-thumb" onclick="openLightbox('${p.id}')">${p.image_url ? `<img src="${esc(p.image_url)}"/>` : catEmoji(p.category)}</div>
      <button onclick="unfavoriteFromGrid('${p.id}',this)" title="Remove from favorites" style="position:absolute;top:4px;right:4px;background:rgba(180,0,0,0.85);border:none;color:#fff;width:24px;height:24px;border-radius:50%;font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;line-height:1">✕</button>
    </div>`).join("");
}

// ── PROFILE TAB SWITCHING ─────────────────────────────────────────
function switchProfileTab(tab) {
  activeProfileTab = tab;
  document.getElementById("ptab-posts").classList.toggle("active", tab === "posts");
  document.getElementById("ptab-favorites").classList.toggle("active", tab === "favorites");
  document.getElementById("my-posts-grid").style.display = tab === "posts" ? "grid" : "none";
  document.getElementById("my-favorites-grid").style.display = tab === "favorites" ? "grid" : "none";
  if (tab === "favorites") loadFavorites();
}

// ── UNFAVORITE FROM GRID ─────────────────────────────────────────
async function unfavoriteFromGrid(postId, btn) {
  const key = "fav_" + postId;
  localStorage.removeItem(key);
  if (currentUser) {
    await sb.from("favorites").delete().eq("user_id", currentUser.id).eq("post_id", postId);
  }
  // Remove the whole tile from the grid
  const tile = btn.closest(".post-thumb-wrap");
  if (tile) tile.remove();
  // Also update the feed button if visible
  const feedBtn = document.getElementById("fav-btn-" + postId);
  if (feedBtn) feedBtn.classList.remove("saved");
  showToast("Removed from favorites");
  // If grid is now empty, show message
  const grid = document.getElementById("my-favorites-grid");
  if (grid && grid.querySelectorAll(".post-thumb-wrap").length === 0) {
    grid.innerHTML = '<div class="loading" style="padding:40px 0;color:#555">No favorites yet — tap 😍 on any post to save it</div>';
  }
}

// ── LIGHTBOX ──────────────────────────────────────────────────────
async function openLightbox(postId) {
  let p = postsCache[postId];
  // If not in cache (e.g. loaded from favorites DB), fetch it
  if (!p) {
    const { data } = await sb.from("posts").select("*").eq("id", postId).single();
    if (!data) { showToast("Could not load post"); return; }
    p = data;
    postsCache[postId] = p;
  }
  const lb = document.getElementById("lightbox");
  const media = document.getElementById("lightbox-media");
  const caption = document.getElementById("lightbox-caption");

  if (p.image_url) {
    const isVideo = /\.(mp4|mov|webm|avi)$/i.test(p.image_url);
    if (isVideo) {
      media.innerHTML = `<video src="${esc(p.image_url)}" controls playsinline autoplay style="max-width:100%;max-height:80vh;border-radius:8px"></video>`;
    } else {
      media.innerHTML = `<img src="${esc(p.image_url)}" style="max-width:100%;max-height:80vh;object-fit:contain;border-radius:8px" onclick="event.stopPropagation()"/>`;
    }
  } else {
    media.innerHTML = `<div style="font-size:80px">${catEmoji(p.category)}</div>`;
  }

  caption.textContent = p.caption || "";
  lb.style.display = "flex";
  document.body.style.overflow = "hidden";
}

function closeLightbox() {
  const lb = document.getElementById("lightbox");
  lb.style.display = "none";
  document.getElementById("lightbox-media").innerHTML = "";
  document.body.style.overflow = "";
}

// ── REVEAL SENSITIVE ──────────────────────────────────────────────
function revealPost(postId) {
  revealedPosts.add(postId);
  const wrap = document.getElementById("wrap-" + postId);
  if (!wrap) return;
  const p = postsCache[postId];
  if (!p) return;
  const isVideo = p.image_url && /\.(mp4|mov|webm|avi)$/i.test(p.image_url);
  wrap.outerHTML = isVideo
    ? `<video class="feed-image" src="${esc(p.image_url)}" controls playsinline style="width:100%;max-height:400px;display:block"></video>`
    : `<img class="feed-image" src="${esc(p.image_url)}" />`;
}

// ── VOTE (full screen) ────────────────────────────────────────────
async function openVote(id) {
  const cached = postsCache[id];
  if (currentUser && cached && cached.user_id === currentUser.id) { editCaption(id); return; }
  if (localStorage.getItem("voted_" + id)) { showToast("You already judged this one!"); return; }
  const { data, error } = await sb.from("posts").select("*").eq("id", id).single();
  if (error || !data) { showToast("Could not load post"); return; }
  currentPost = data;
  currentVote = null;
  starRating = 0;
  await sb.from("posts").update({ view_count: (data.view_count || 0) + 1 }).eq("id", id);
  if (postsCache[id]) postsCache[id].view_count = (data.view_count || 0) + 1;
  const avatarHtml = data.avatar_url ? `<img src="${esc(data.avatar_url)}" />` : initials(data.username);
  const isVideo = data.image_url && /\.(mp4|mov|webm|avi)$/i.test(data.image_url);
  const imgHtml = data.image_url
    ? isVideo ? `<video src="${esc(data.image_url)}" controls playsinline style="width:100%;height:100%;object-fit:cover"></video>` : `<img src="${esc(data.image_url)}" style="width:100%;height:100%;object-fit:cover"/>`
    : `<div class="vote-placeholder">${catEmoji(data.category)}</div>`;
  document.getElementById("vote-content").innerHTML = `
    <div class="vote-image-wrap">${imgHtml}</div>
    <div class="vote-info">
      <div class="vote-poster" onclick="openUserProfile('${data.user_id}')">
        <div class="vote-poster-avatar">${avatarHtml}</div>
        <div class="vote-poster-name">@${esc(data.username)}</div>
      </div>
      <div class="vote-title">${esc(data.username)}'s ${esc(data.category)}</div>
      ${data.caption ? `<div class="vote-caption">${esc(data.caption)}</div>` : ""}
    </div>
    <div class="vote-section">
      <div class="vote-label-text2">Fire or Ice?</div>
      <div class="vote-row">
        <div class="vote-btn" id="fire-btn" onclick="castVote('fire')"><div class="vote-icon">🔥</div><div class="vote-count" id="fire-count">${data.fire_votes}</div><div class="vote-label-small">Fire</div></div>
        <div class="vote-btn" id="ice-btn" onclick="castVote('ice')"><div class="vote-icon">🧊</div><div class="vote-count" id="ice-count">${data.ice_votes}</div><div class="vote-label-small">Ice</div></div>
      </div>
    </div>
    <div class="stars-section">
      <div class="stars-label">Rate 1–10</div>
      <div class="stars-row" id="stars-row"></div>
    </div>
    <button class="submit-vote-btn" onclick="submitVote()">Submit My Verdict 🔥</button>`;
  buildStars();
  showScreen("screen-vote");
}

function castVote(type) {
  currentVote = type;
  document.getElementById("fire-btn").className = type === "fire" ? "vote-btn selected-fire" : "vote-btn";
  document.getElementById("ice-btn").className = type === "ice" ? "vote-btn selected-ice" : "vote-btn";
}

function buildStars() {
  const row = document.getElementById("stars-row");
  if (!row) return;
  row.innerHTML = "";
  for (let i = 1; i <= 10; i++) {
    const s = document.createElement("span");
    s.className = "star";
    s.textContent = "★";
    s.dataset.val = i;
    s.onclick = function () {
      starRating = parseInt(this.dataset.val);
      document.querySelectorAll(".star").forEach((st) => st.classList.toggle("lit", parseInt(st.dataset.val) <= starRating));
    };
    row.appendChild(s);
  }
}

async function submitVote() {
  if (!currentPost) return;
  if (!currentVote && starRating === 0) { showToast("Pick 🔥 or 🧊, or give a star rating!"); return; }
  const voterKey = "voted_" + currentPost.id;
  if (localStorage.getItem(voterKey)) { showToast("You already judged this one!"); return; }
  await sb.from("votes").insert({ id: uid(), post_id: currentPost.id, voter_id: currentUser?.id || "anon", vote_type: currentVote, star_rating: starRating || null });
  const updates = {};
  if (currentVote === "fire") updates.fire_votes = currentPost.fire_votes + 1;
  if (currentVote === "ice") updates.ice_votes = currentPost.ice_votes + 1;
  if (starRating > 0) { updates.total_ratings = currentPost.total_ratings + 1; updates.rating_sum = currentPost.rating_sum + starRating; }
  await sb.from("posts").update(updates).eq("id", currentPost.id);
  localStorage.setItem(voterKey, "1");
  showResult({ ...currentPost, ...updates });
}

// ── RESULT ────────────────────────────────────────────────────────
function showResult(data) {
  const avg = data.total_ratings > 0 ? (data.rating_sum / data.total_ratings).toFixed(1) : "–";
  document.getElementById("rc-avatar").innerHTML = data.avatar_url ? `<img src="${esc(data.avatar_url)}" style="width:52px;height:52px;object-fit:cover;border-radius:50%"/>` : initials(data.username);
  document.getElementById("rc-name").textContent = data.username + "'s " + data.category;
  document.getElementById("rc-cat").textContent = data.category + " · Judge Me";
  document.getElementById("rc-fire").textContent = "🔥 " + data.fire_votes;
  document.getElementById("rc-ice").textContent = "🧊 " + data.ice_votes;
  document.getElementById("rc-rating").textContent = avg !== "–" ? avg + "/10" : "–";
  document.getElementById("rc-verdict").textContent = verdict(data.fire_votes, data.ice_votes, avg);
  showScreen("screen-result");
}

function verdict(fire, ice, rating) {
  const total = fire + ice, r = parseFloat(rating);
  const fr = total > 0 ? fire / total : 0.5;
  if (fr > 0.8 && r >= 8) return "🔥 LEGENDARY! Absolutely on fire!";
  if (fr > 0.75) return "🔥 The people have spoken — FIRE!";
  if (fr < 0.2 && r < 4) return "🧊 Ice cold, no cap";
  if (fr < 0.25) return "🧊 That's giving ice";
  if (r >= 9) return "⭐ Almost perfect!";
  if (r >= 7) return "👍 Solid rating!";
  if (r > 0 && r < 5) return "😬 The ratings don't lie...";
  return "🤔 The jury is divided!";
}

// ── SHARE ─────────────────────────────────────────────────────────
async function saveResultImage() {
  showToast("Generating image...");
  try {
    const card = document.getElementById("result-card");
    const canvas = await html2canvas(card, { backgroundColor: "#1a0800", scale: 2 });
    const link = document.createElement("a");
    link.download = "judge-me-result.png";
    link.href = canvas.toDataURL("image/png");
    link.click();
    showToast("Image saved! Post it to Instagram or TikTok 🔥");
  } catch (e) {
    showToast("Screenshot your screen to save the card!");
  }
}

async function nativeShare() {
  const text = `I just got judged on Judge Me! Come vote on me 🔥🧊`;
  const url = window.location.href;
  if (navigator.share) {
    try {
      const card = document.getElementById("result-card");
      const canvas = await html2canvas(card, { backgroundColor: "#1a0800", scale: 2 });
      canvas.toBlob(async (blob) => {
        const file = new File([blob], "judge-me-result.png", { type: "image/png" });
        await navigator.share({ title: "Judge Me Results", text, files: [file], url });
      });
    } catch { navigator.share({ title: "Judge Me", text, url }); }
  } else { copyLink(); }
}

function shareToTwitter() {
  const text = encodeURIComponent("I just got judged on Judge Me 🔥 Come vote on me!");
  const url = encodeURIComponent(window.location.href);
  window.open(`https://twitter.com/intent/tweet?text=${text}&url=${url}`, "_blank");
}

function copyLink() {
  navigator.clipboard.writeText(window.location.href).then(() => showToast("Link copied!")).catch(() => showToast("Copy: " + window.location.href));
}

// ── UPLOAD ────────────────────────────────────────────────────────
function previewPost(input) {
  const file = input.files[0];
  if (!file) return;
  const url = URL.createObjectURL(file);
  document.getElementById("post-preview").innerHTML = file.type.startsWith("video")
    ? `<video src="${url}" style="max-width:100%;max-height:200px;border-radius:10px" controls></video>`
    : `<img src="${url}" style="max-width:100%;max-height:200px;border-radius:10px"/>`;
  // Show text overlay button
  document.getElementById("text-overlay-btn-wrap").style.display = "block";
  // Reset overlay
  textOverlay = null;
  document.getElementById("overlay-preview-indicator").style.display = "none";
}

async function submitPost() {
  if (!currentUser) { showToast("Set up your profile first!"); return; }
  const caption = document.getElementById("post-caption").value.trim();
  const fileInput = document.getElementById("post-file");
  const status = document.getElementById("post-status");
  const isSensitive = document.getElementById("sensitive-toggle")?.checked || false;
  status.textContent = "Posting...";
  let imageUrl = null;
  if (fileInput.files[0]) {
    const file = fileInput.files[0];
    const ext = file.name.split(".").pop().toLowerCase();
    const fname = uid() + "." + ext;
    const { error: uploadError } = await sb.storage.from("judge-me-uploads").upload(fname, file, { upsert: true, contentType: file.type });
    if (!uploadError) {
      const { data: ud } = sb.storage.from("judge-me-uploads").getPublicUrl(fname);
      imageUrl = ud.publicUrl;
    } else {
      status.textContent = "Upload failed: " + uploadError.message;
      return;
    }
  }
  const { error } = await sb.from("posts").insert({ id: uid(), user_id: currentUser.id, username: currentUser.username, avatar_url: currentUser.avatar_url || null, category: uploadCat, caption: caption || null, image_url: imageUrl, is_nsfw: uploadCat === "NSFW" || isSensitive, fire_votes: 0, ice_votes: 0, total_ratings: 0, rating_sum: 0, view_count: 0, text_overlay: textOverlay ? JSON.stringify(textOverlay) : null });
  if (error) { status.textContent = "Error posting. Try again!"; return; }
  status.textContent = "";
  document.getElementById("post-caption").value = "";
  document.getElementById("post-preview").innerHTML = `<div class="upload-icon">📷</div><div class="upload-label">Tap to upload</div><div class="upload-sub">Photo or video from your camera roll</div>`;
  fileInput.value = "";
  textOverlay = null;
  document.getElementById("text-overlay-btn-wrap").style.display = "none";
  document.getElementById("overlay-preview-indicator").style.display = "none";
  if (document.getElementById("sensitive-toggle")) document.getElementById("sensitive-toggle").checked = false;
  showToast("Posted! Watch the votes roll in 🔥");
  showScreen("screen-feed");
}

// ── SEARCH ────────────────────────────────────────────────────────
let searchTimeout = null;

function onSearchInput() {
  clearTimeout(searchTimeout);
  const q = document.getElementById("search-input").value.trim();
  if (!q) {
    document.getElementById("search-results").innerHTML = '<div class="loading" style="padding:20px">Type a username to search</div>';
    return;
  }
  document.getElementById("search-results").innerHTML = '<div class="loading">Searching...</div>';
  searchTimeout = setTimeout(() => searchUsers(q), 400);
}

async function searchUsers(q) {
  const { data, error } = await sb.from("profiles").select("*").ilike("username", `%${q}%`).limit(20);
  if (error || !data || data.length === 0) {
    document.getElementById("search-results").innerHTML = `<div class="empty-state"><div class="empty-icon">🔍</div><div class="empty-text">No users found for "${esc(q)}"</div></div>`;
    return;
  }
  document.getElementById("search-results").innerHTML = data.map((u) => {
    const isMe = currentUser && u.id === currentUser.id;
    const avatarHtml = u.avatar_url ? `<img src="${esc(u.avatar_url)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/>` : initials(u.username);
    return `<div class="search-result-item" onclick="openUserProfile('${u.id}')">
      <div class="search-avatar">${avatarHtml}</div>
      <div class="search-info">
        <div class="search-username" style="display:flex;align-items:center;gap:2px">@${esc(u.username)}${getBadgeHtml(u.badge_tier)}${isMe ? ' <span style="color:#ff6b35;font-size:11px">(you)</span>' : ""}</div>
        <div class="search-bio">${esc(u.bio || "No bio yet")}</div>
      </div>
      <div class="search-arrow" style="color:#ff6b35;font-size:22px;font-weight:700">›</div>
    </div>`;
  }).join("");
}

function clearSearch() {
  document.getElementById("search-input").value = "";
  document.getElementById("search-results").innerHTML = '<div class="loading" style="padding:20px">Type a username to search</div>';
}

// ── ANALYTICS ─────────────────────────────────────────────────────
async function loadAnalytics() {
  if (!currentUser) return;
  const { data: posts } = await sb.from("posts").select("*").eq("user_id", currentUser.id).order("view_count", { ascending: false });
  if (!posts || posts.length === 0) {
    document.getElementById("analytics-posts-list").innerHTML = '<div class="loading">No posts yet</div>';
    document.getElementById("an-total-views").textContent = "0";
    document.getElementById("an-total-votes").textContent = "0";
    document.getElementById("an-avg-rating").textContent = "–";
    document.getElementById("an-fire-ratio").textContent = "–";
    return;
  }
  const totalViews = posts.reduce((s, p) => s + (p.view_count || 0), 0);
  const totalFire = posts.reduce((s, p) => s + p.fire_votes, 0);
  const totalIce = posts.reduce((s, p) => s + p.ice_votes, 0);
  const totalVotes = totalFire + totalIce;
  const totalRatingSum = posts.reduce((s, p) => s + p.rating_sum, 0);
  const totalRatingCount = posts.reduce((s, p) => s + p.total_ratings, 0);
  const avgRating = totalRatingCount > 0 ? (totalRatingSum / totalRatingCount).toFixed(1) : "–";
  const fireRatio = totalVotes > 0 ? Math.round((totalFire / totalVotes) * 100) + "%" : "–";
  document.getElementById("an-total-views").textContent = totalViews.toLocaleString();
  document.getElementById("an-total-votes").textContent = totalVotes.toLocaleString();
  document.getElementById("an-avg-rating").textContent = avgRating;
  document.getElementById("an-fire-ratio").textContent = fireRatio;
  // Fetch comment counts for all posts
  const postIds = posts.map(p => p.id);
  const commentCounts = {};
  for (const pid of postIds) {
    const { count } = await sb.from("comments").select("*", { count: "exact", head: true }).eq("post_id", pid).is("parent_id", null);
    commentCounts[pid] = count || 0;
  }

  document.getElementById("analytics-posts-list").innerHTML = posts.map((p) => {
    const avg = p.total_ratings > 0 ? (p.rating_sum / p.total_ratings).toFixed(1) : "–";
    const total = p.fire_votes + p.ice_votes;
    const firePercent = total > 0 ? Math.round((p.fire_votes / total) * 100) : 0;
    const commentCount = commentCounts[p.id] || 0;
    const thumb = p.image_url ? `<img src="${esc(p.image_url)}" style="width:100%;height:100%;object-fit:cover;border-radius:10px"/>` : catEmoji(p.category);
    postsCache[p.id] = p;
    const isVid = p.image_url && /\.(mp4|mov|webm|avi)$/i.test(p.image_url);
    const mediaHtml = p.image_url
      ? (isVid
          ? `<video src="${esc(p.image_url)}" controls playsinline style="width:100%;height:100%;object-fit:cover;border-radius:12px;display:block"></video>`
          : `<img src="${esc(p.image_url)}" style="width:100%;height:100%;object-fit:cover;border-radius:12px;display:block"/>`)
      : `<div style="width:100%;height:100%;background:#1a1a1a;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:48px">${catEmoji(p.category)}</div>`;

    return `<div class="analytics-post-item" id="stats-card-${p.id}" style="padding:0;overflow:hidden">

      <!-- COLLAPSED VIEW -->
      <div id="stats-collapsed-${p.id}" style="display:flex;gap:12px;align-items:center;cursor:pointer;padding:14px" onclick="toggleStatsCard('${p.id}')">
        <div class="analytics-post-thumb" style="flex-shrink:0">${thumb}</div>
        <div class="analytics-post-info" style="flex:1;min-width:0">
          <div class="analytics-post-name">${esc(p.username)}'s ${esc(p.category)}</div>
          <div class="analytics-post-stats">
            <span class="analytics-stat-pill">👁 ${(p.view_count || 0).toLocaleString()}</span>
            <span class="analytics-stat-pill">🔥 ${p.fire_votes}</span>
            <span class="analytics-stat-pill">🧊 ${p.ice_votes}</span>
            <span class="analytics-stat-pill">⭐ ${avg}</span>
            <span class="analytics-stat-pill" style="color:#ff6b35;border-color:#ff6b35">⚖️ ${commentCount}</span>
          </div>
          <div class="fire-bar-wrap"><div class="fire-bar" style="width:${firePercent}%"></div></div>
        </div>
        <div style="color:#ff6b35;font-size:16px;font-weight:700;flex-shrink:0">▼</div>
      </div>

      <!-- EXPANDED VIEW (replaces collapsed row entirely) -->
      <div id="stats-expand-${p.id}" style="display:none;padding:16px">

        <!-- Header: title + collapse -->
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px">
          <div>
            <div style="font-size:15px;font-weight:700;color:#fff">${esc(p.username)}'s ${esc(p.category)}</div>
            ${p.caption ? `<div style="font-size:12px;color:#888;margin-top:3px;font-style:italic">"${esc(p.caption)}"</div>` : ''}
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
              <span style="font-size:11px;padding:3px 8px;border-radius:10px;background:#1a1a1a;border:0.5px solid #2a2a2a;color:#888">👁 ${(p.view_count||0).toLocaleString()}</span>
              <span style="font-size:11px;padding:3px 8px;border-radius:10px;background:#1a1a1a;border:0.5px solid #2a2a2a;color:#888">🔥 ${p.fire_votes}</span>
              <span style="font-size:11px;padding:3px 8px;border-radius:10px;background:#1a1a1a;border:0.5px solid #2a2a2a;color:#888">🧊 ${p.ice_votes}</span>
              <span style="font-size:11px;padding:3px 8px;border-radius:10px;background:#1a1a1a;border:0.5px solid #2a2a2a;color:#888">⭐ ${avg}</span>
            </div>
          </div>
          <button onclick="toggleStatsCard('${p.id}')" style="background:#1a1a1a;border:0.5px solid #333;color:#888;font-size:12px;padding:6px 12px;border-radius:20px;cursor:pointer;white-space:nowrap;margin-left:10px;flex-shrink:0">▲ Close</button>
        </div>

        <!-- Two columns: LEFT comments, RIGHT photo -->
        <div style="display:flex;gap:12px;align-items:stretch">

          <!-- LEFT: comments + button -->
          <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:10px">
            <div style="font-size:13px;font-weight:700;color:#fff">⚖️ The Jury (${commentCount})</div>
            <div id="stats-comments-preview-${p.id}" style="flex:1;min-height:100px;font-size:13px;color:#555">Loading...</div>
            <button onclick="openJury('${p.id}')" style="width:100%;padding:12px 0;border-radius:20px;background:#ff6b35;border:none;color:#fff;font-size:14px;font-weight:700;cursor:pointer">View &amp; Reply</button>
          </div>

          <!-- RIGHT: photo -->
          <div style="width:45%;flex-shrink:0;border-radius:12px;overflow:hidden;background:#1a1a1a;min-height:220px;max-height:320px">
            ${mediaHtml}
          </div>
        </div>

      </div>

    </div>`;
  }).join("");
}

async function toggleStatsCard(postId) {
  const expand = document.getElementById("stats-expand-" + postId);
  const collapsed = document.getElementById("stats-collapsed-" + postId);
  if (!expand) return;
  const isOpen = expand.style.display !== "none";
  // Toggle: hide collapsed row when expanded, show it when collapsed
  expand.style.display = isOpen ? "none" : "block";
  if (collapsed) collapsed.style.display = isOpen ? "flex" : "none";
  if (!isOpen) {
    await loadStatsCommentsPreview(postId);
    setTimeout(() => {
      document.getElementById("stats-card-" + postId)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
  }
}

async function loadStatsCommentsPreview(postId) {
  const el = document.getElementById("stats-comments-preview-" + postId);
  if (!el) return;
  const { data: comments } = await sb.from("comments").select("*").eq("post_id", postId).is("parent_id", null).order("created_at", { ascending: false }).limit(3);
  if (!comments || comments.length === 0) {
    el.innerHTML = '<div style="color:#555;font-size:13px;padding:8px 0">No comments yet — be the first to weigh in!</div>';
    return;
  }
  el.innerHTML = comments.map(c => {
    const avatarHtml = c.avatar_url
      ? `<img src="${esc(c.avatar_url)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/>`
      : `<span style="font-size:11px;font-weight:700;color:#fff">${initials(c.username)}</span>`;
    return `<div style="display:flex;gap:8px;align-items:flex-start;padding:8px 0;border-bottom:0.5px solid #1a1a1a">
      <div style="width:26px;height:26px;border-radius:50%;background:linear-gradient(135deg,#ff6b35,#c62a85);display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden">${avatarHtml}</div>
      <div style="flex:1;min-width:0">
        <span style="font-size:12px;font-weight:700;color:#fff">@${esc(c.username)}</span>
        <span style="font-size:11px;color:#444;margin-left:6px">${timeAgo(c.created_at)}</span>
        <div style="font-size:13px;color:#ccc;margin-top:2px;word-break:break-word">${esc(c.body)}</div>
      </div>
    </div>`;
  }).join("") + (comments.length === 3 ? `<div style="font-size:12px;color:#ff6b35;padding:8px 0;cursor:pointer" onclick="openJury('${postId}')">See all comments →</div>` : '');
}

// ── MY PROFILE ────────────────────────────────────────────────────
async function loadMyProfile() {
  if (!currentUser) return;
  setProfileDisplay(currentUser, "profile");
  // Fetch posts by user_id, also try username as fallback in case of ID mismatch
  let { data: posts } = await sb.from("posts").select("*").eq("user_id", currentUser.id).order("created_at", { ascending: false });
  if (!posts || posts.length === 0) {
    const { data: postsByUsername } = await sb.from("posts").select("*").eq("username", currentUser.username).order("created_at", { ascending: false });
    if (postsByUsername && postsByUsername.length > 0) {
      posts = postsByUsername;
      // Fix the user_id on these posts so future loads work correctly
      await sb.from("posts").update({ user_id: currentUser.id }).eq("username", currentUser.username).neq("user_id", currentUser.id);
    }
  }
  document.getElementById("stat-posts").textContent = posts?.length || 0;
  const { count: fc } = await sb.from("follows").select("*", { count: "exact", head: true }).eq("following_id", currentUser.id);
  const { count: fwc } = await sb.from("follows").select("*", { count: "exact", head: true }).eq("follower_id", currentUser.id);
  document.getElementById("stat-followers").textContent = fc || 0;
  document.getElementById("stat-following").textContent = fwc || 0;
  const grid = document.getElementById("my-posts-grid");
  if (!posts || posts.length === 0) {
    grid.innerHTML = '<div class="loading">No posts yet</div>';
  } else {
    posts.forEach((p) => { postsCache[p.id] = p; });
    grid.innerHTML = posts.map((p) => `
      <div class="post-thumb-wrap">
        <div class="post-thumb" onclick="openLightbox('${p.id}')">${p.image_url ? `<img src="${esc(p.image_url)}"/>` : catEmoji(p.category)}</div>
        <button class="post-delete-btn" onclick="deletePost('${p.id}',true)" title="Delete post" style="background:rgba(180,0,0,0.8)">✕</button>
      </div>`).join("");
  }
  const interests = currentUser.interests || [];
  document.getElementById("profile-interests-display").innerHTML = interests.map((i) => `<span class="interest-tag">${i}</span>`).join("");

  // Reset to posts tab
  switchProfileTab("posts");
}

function setProfileDisplay(user, prefix) {
  const avatarEl = document.getElementById(`${prefix}-avatar-display`);
  if (avatarEl) avatarEl.innerHTML = user.avatar_url ? `<img src="${esc(user.avatar_url)}"/>` : initials(user.username);
  const un = document.getElementById(`${prefix}-username-display`);
  if (un) un.innerHTML = "@" + esc(user.username) + getBadgeHtml(user.badge_tier);
  const bio = document.getElementById(`${prefix}-bio-display`);
  if (bio) bio.textContent = user.bio || "";
  const loc = document.getElementById(`${prefix}-location-display`);
  if (loc) loc.textContent = user.location || "";
  const web = document.getElementById(`${prefix}-website-display`);
  if (web) { web.textContent = user.website || ""; web.style.display = user.website ? "block" : "none"; }
  const topAvatar = document.getElementById("topbar-avatar");
  if (topAvatar) topAvatar.innerHTML = user.avatar_url ? `<img src="${esc(user.avatar_url)}"/>` : initials(user.username);
}

function updateTopbarAvatar() {
  if (!currentUser) return;
  const el = document.getElementById("topbar-avatar");
  if (el) el.innerHTML = currentUser.avatar_url ? `<img src="${esc(currentUser.avatar_url)}"/>` : initials(currentUser.username);
}

async function updateProfileAvatar(input) {
  const file = input.files[0];
  if (!file || !currentUser) return;
  showToast("Uploading photo...");
  const ext = file.name.split(".").pop().toLowerCase();
  const fname = currentUser.id + "_avatar." + ext;
  const { error } = await sb.storage.from("judge-me-uploads").upload(fname, file, { upsert: true, contentType: file.type });
  if (error) { showToast("Upload failed"); return; }
  const { data: ud } = sb.storage.from("judge-me-uploads").getPublicUrl(fname);
  const avatarUrl = ud.publicUrl;
  await sb.from("profiles").update({ avatar_url: avatarUrl }).eq("id", currentUser.id);
  // Also update all posts by this user
  await sb.from("posts").update({ avatar_url: avatarUrl }).eq("user_id", currentUser.id);
  currentUser.avatar_url = avatarUrl;
  localStorage.setItem("jm_user", JSON.stringify(currentUser));
  setProfileDisplay(currentUser, "profile");
  updateTopbarAvatar();
  showToast("Profile photo updated! ✓");
}

// ── OTHER USER PROFILE ────────────────────────────────────────────
async function openUserProfile(userId) {
  if (!userId || userId === currentUser?.id) { viewingUserId = null; showScreen("screen-profile"); return; }
  viewingUserId = userId;
  const { data: user } = await sb.from("profiles").select("*").eq("id", userId).single();
  if (!user) { showToast("Could not load profile"); return; }
  document.getElementById("user-screen-title").textContent = "@" + user.username;
  const avatarEl = document.getElementById("user-avatar-display");
  if (avatarEl) avatarEl.innerHTML = user.avatar_url ? `<img src="${esc(user.avatar_url)}"/>` : initials(user.username);
  const unEl = document.getElementById("user-username-display");
  if (unEl) unEl.innerHTML = "@" + esc(user.username) + getBadgeHtml(user.badge_tier);
  const bioEl = document.getElementById("user-bio-display");
  if (bioEl) bioEl.textContent = user.bio || "";
  const locEl = document.getElementById("user-location-display");
  if (locEl) locEl.textContent = user.location || "";
  const { count: fc } = await sb.from("follows").select("*", { count: "exact", head: true }).eq("following_id", userId);
  const { count: fwc } = await sb.from("follows").select("*", { count: "exact", head: true }).eq("follower_id", userId);
  const { data: posts } = await sb.from("posts").select("*").eq("user_id", userId).order("created_at", { ascending: false });
  const postsEl = document.getElementById("user-stat-posts");
  if (postsEl) postsEl.textContent = posts?.length || 0;
  const fcEl = document.getElementById("user-stat-followers");
  if (fcEl) fcEl.textContent = fc || 0;
  const fwcEl = document.getElementById("user-stat-following");
  if (fwcEl) fwcEl.textContent = fwc || 0;
  const grid = document.getElementById("user-posts-grid");
  if (grid) {
    (posts || []).forEach((p) => { postsCache[p.id] = p; });
    grid.innerHTML = (posts || []).map((p) => `<div class="post-thumb" onclick="openLightbox('${p.id}')">${p.image_url ? `<img src="${esc(p.image_url)}"/>` : catEmoji(p.category)}</div>`).join("");
  }
  const btn = document.getElementById("follow-btn");
  if (btn && currentUser) {
    const { data: existing } = await sb.from("follows").select("id").eq("follower_id", currentUser.id).eq("following_id", userId).maybeSingle();
    isFollowingUser = !!existing;
    btn.textContent = isFollowingUser ? "Following" : "Follow";
    btn.className = isFollowingUser ? "follow-btn following" : "follow-btn";
    btn.style.display = "block";
  }
  // Add DM button
  const dmBtnExisting = document.getElementById("dm-user-btn");
  if (dmBtnExisting) dmBtnExisting.remove();
  if (currentUser && user) {
    const dmBtn = document.createElement("button");
    dmBtn.id = "dm-user-btn";
    dmBtn.textContent = "💬 Message";
    dmBtn.className = "follow-btn";
    dmBtn.style.cssText = "background:transparent;border:1px solid #ff6b35;color:#ff6b35;margin-top:0";
    dmBtn.onclick = () => openDMConvo(userId, user.username, user.avatar_url || '');
    document.getElementById("follow-btn")?.insertAdjacentElement("afterend", dmBtn);
  }
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  document.getElementById("screen-user").classList.add("active");
  window.scrollTo(0, 0);
}

async function toggleFollow() {
  if (!currentUser || !viewingUserId) return;
  const btn = document.getElementById("follow-btn");
  if (isFollowingUser) {
    await sb.from("follows").delete().eq("follower_id", currentUser.id).eq("following_id", viewingUserId);
    isFollowingUser = false;
    btn.textContent = "Follow";
    btn.className = "follow-btn";
    showToast("Unfollowed");
  } else {
    await sb.from("follows").insert({ id: uid(), follower_id: currentUser.id, following_id: viewingUserId });
    isFollowingUser = true;
    btn.textContent = "Following";
    btn.className = "follow-btn following";
    showToast("Following! 🔥");
  }
  const { count } = await sb.from("follows").select("*", { count: "exact", head: true }).eq("following_id", viewingUserId);
  const fcEl = document.getElementById("user-stat-followers");
  if (fcEl) fcEl.textContent = count || 0;
}

// ── FOLLOW LIST ───────────────────────────────────────────────────
async function showFollowList(type) {
  followListProfileId = viewingUserId || currentUser?.id;
  if (!followListProfileId) return;
  const existing = document.getElementById("follow-list-modal");
  if (existing) existing.remove();
  const modal = document.createElement("div");
  modal.id = "follow-list-modal";
  modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box";
  modal.innerHTML = `
    <div style="background:#111;border-radius:20px;border:0.5px solid #2a2a2a;padding:20px;width:100%;max-width:400px;max-height:88vh;overflow-y:auto;box-sizing:border-box">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h2 style="font-size:18px;font-weight:700;color:#fff;margin:0">${type === "followers" ? "Followers" : "Following"}</h2>
        <button onclick="document.getElementById('follow-list-modal').remove()" style="background:none;border:none;color:#666;font-size:22px;cursor:pointer">✕</button>
      </div>
      <div id="follow-list-content"><div style="text-align:center;padding:40px;color:#555">Loading...</div></div>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });

  let userIds = [];
  if (type === "followers") {
    const { data } = await sb.from("follows").select("follower_id").eq("following_id", followListProfileId);
    userIds = (data || []).map((f) => f.follower_id);
  } else {
    const { data } = await sb.from("follows").select("following_id").eq("follower_id", followListProfileId);
    userIds = (data || []).map((f) => f.following_id);
  }

  const content = document.getElementById("follow-list-content");
  if (!content) return;
  if (userIds.length === 0) {
    content.innerHTML = `<div style="text-align:center;padding:40px;color:#555">${type === "followers" ? "No followers yet" : "Not following anyone yet"}</div>`;
    return;
  }

  const { data: profiles } = await sb.from("profiles").select("*").in("id", userIds);
  if (!profiles || profiles.length === 0) {
    content.innerHTML = '<div style="text-align:center;padding:40px;color:#555">Could not load users</div>';
    return;
  }

  const { data: myFollows } = await sb.from("follows").select("following_id").eq("follower_id", currentUser.id);
  const followingIds = new Set((myFollows || []).map((f) => f.following_id));

  content.innerHTML = profiles.map((u) => {
    const isMe = u.id === currentUser.id;
    const isFollowing = followingIds.has(u.id);
    const avatarHtml = u.avatar_url ? `<img src="${esc(u.avatar_url)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/>` : `<span style="font-size:18px;font-weight:700;color:#fff">${initials(u.username)}</span>`;
    return `<div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:0.5px solid #1a1a1a">
      <div onclick="document.getElementById('follow-list-modal').remove();openUserProfile('${u.id}')" style="width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,#ff6b35,#c62a85);display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden;cursor:pointer">${avatarHtml}</div>
      <div onclick="document.getElementById('follow-list-modal').remove();openUserProfile('${u.id}')" style="flex:1;cursor:pointer">
        <div style="font-size:15px;font-weight:600;color:#fff;display:flex;align-items:center;gap:2px">@${esc(u.username)}${getBadgeHtml(u.badge_tier)}</div>
        <div style="font-size:12px;color:#666;margin-top:2px">${esc(u.bio || "")}</div>
      </div>
      ${!isMe ? `<button onclick="toggleFollowFromList('${u.id}',this)" style="padding:6px 14px;border-radius:20px;font-size:13px;font-weight:600;cursor:pointer;border:1px solid ${isFollowing ? "#444" : "#ff6b35"};background:${isFollowing ? "transparent" : "#ff6b35"};color:${isFollowing ? "#aaa" : "#fff"}">${isFollowing ? "Following" : "Follow"}</button>` : '<span style="font-size:12px;color:#555">You</span>'}
    </div>`;
  }).join("");
}

// Fixed: was referenced but never defined
async function toggleFollowFromList(userId, btn) {
  if (!currentUser) return;
  const isCurrentlyFollowing = btn.textContent.trim() === "Following";
  if (isCurrentlyFollowing) {
    await sb.from("follows").delete().eq("follower_id", currentUser.id).eq("following_id", userId);
    btn.textContent = "Follow";
    btn.style.background = "#ff6b35";
    btn.style.borderColor = "#ff6b35";
    btn.style.color = "#fff";
    showToast("Unfollowed");
  } else {
    await sb.from("follows").insert({ id: uid(), follower_id: currentUser.id, following_id: userId });
    btn.textContent = "Following";
    btn.style.background = "transparent";
    btn.style.borderColor = "#444";
    btn.style.color = "#aaa";
    showToast("Following! 🔥");
  }
}

// ── EDIT PROFILE ──────────────────────────────────────────────────
function showEditProfile() {
  if (!currentUser) return;
  document.getElementById("ep-username").value = currentUser.username || "";
  document.getElementById("ep-bio").value = currentUser.bio || "";
  document.getElementById("ep-location").value = currentUser.location || "";
  document.getElementById("ep-website").value = currentUser.website || "";
  document.getElementById("ep-error").style.display = "none";
  const userInterests = currentUser.interests || [];
  document.querySelectorAll("#ep-interests-grid .interest-pill").forEach((p) => {
    p.classList.toggle("active", userInterests.includes(p.dataset.val));
  });
  document.getElementById("edit-profile-modal").style.display = "flex";
}

function closeEditProfile(e) {
  if (e && e.target !== document.getElementById("edit-profile-modal")) return;
  document.getElementById("edit-profile-modal").style.display = "none";
}

async function saveEditProfile() {
  const username = document.getElementById("ep-username").value.trim().replace(/^@/, "");
  if (!username) { document.getElementById("ep-error").style.display = "block"; return; }
  document.getElementById("ep-error").style.display = "none";
  const bio = document.getElementById("ep-bio").value.trim();
  const location = document.getElementById("ep-location").value.trim();
  const website = document.getElementById("ep-website").value.trim();
  const interests = [...document.querySelectorAll("#ep-interests-grid .interest-pill.active")].map((p) => p.dataset.val);
  const updates = { username, bio: bio || null, location: location || null, website: website || null, interests };
  const { error } = await sb.from("profiles").update(updates).eq("id", currentUser.id);
  if (error) { showToast("Could not save profile"); return; }
  Object.assign(currentUser, updates);
  localStorage.setItem("jm_user", JSON.stringify(currentUser));
  document.getElementById("edit-profile-modal").style.display = "none";
  setProfileDisplay(currentUser, "profile");
  document.getElementById("profile-interests-display").innerHTML = interests.map((i) => `<span class="interest-tag">${i}</span>`).join("");
  showToast("Profile updated ✓");
}

// ── POST MENU ─────────────────────────────────────────────────────
function togglePostMenu(e, postId) {
  e.stopPropagation();
  const menu = document.getElementById("menu-" + postId);
  const isOpen = menu.classList.contains("open");
  document.querySelectorAll(".post-menu-dropdown.open").forEach((m) => m.classList.remove("open"));
  if (!isOpen) menu.classList.add("open");
}

function editCaption(postId) {
  document.querySelectorAll(".post-menu-dropdown.open").forEach((m) => m.classList.remove("open"));
  editingPostId = postId;
  const p = postsCache[postId];
  document.getElementById("edit-caption-input").value = p?.caption || "";
  document.getElementById("edit-caption-modal").style.display = "flex";
  setTimeout(() => document.getElementById("edit-caption-input").focus(), 50);
}

function closeEditCaption(e) {
  if (e && e.target !== document.getElementById("edit-caption-modal")) return;
  document.getElementById("edit-caption-modal").style.display = "none";
  editingPostId = null;
}

async function saveEditCaption() {
  if (!editingPostId) return;
  const caption = document.getElementById("edit-caption-input").value.trim();
  const { error } = await sb.from("posts").update({ caption: caption || null }).eq("id", editingPostId);
  if (error) { showToast("Could not save caption"); return; }
  if (postsCache[editingPostId]) postsCache[editingPostId].caption = caption;
  document.getElementById("edit-caption-modal").style.display = "none";
  editingPostId = null;
  showToast("Caption updated ✓");
}

let _deletingPostId = null;
let _deletingFromProfile = false;

function deletePost(postId, fromProfile) {
  document.querySelectorAll(".post-menu-dropdown.open").forEach((m) => m.classList.remove("open"));
  _deletingPostId = postId;
  _deletingFromProfile = fromProfile;
  document.getElementById("delete-confirm-modal").style.display = "flex";
}

function cancelDeletePost() {
  document.getElementById("delete-confirm-modal").style.display = "none";
  _deletingPostId = null;
}

async function confirmDeletePost() {
  if (!_deletingPostId) return;
  const postId = _deletingPostId;
  const fromProfile = _deletingFromProfile;
  document.getElementById("delete-confirm-modal").style.display = "none";
  _deletingPostId = null;
  const { error } = await sb.from("posts").delete().eq("id", postId);
  if (error) { showToast("Could not delete post"); return; }
  delete postsCache[postId];
  showToast("Post deleted");
  if (fromProfile) { loadMyProfile(); } else { loadFeed(); }
}

// ── SHARE SHEET ───────────────────────────────────────────────────
function showShareSheet(postId) {
  const existing = document.getElementById("share-sheet-modal");
  if (existing) existing.remove();
  const p = postsCache[postId];
  if (!p) return;
  const avg = p.total_ratings > 0 ? (p.rating_sum / p.total_ratings).toFixed(1) : "–";
  const text = encodeURIComponent(`I just judged @${p.username}'s ${p.category} on Judge Me! 🔥 ${p.fire_votes} Fire · 🧊 ${p.ice_votes} Ice · ⭐ ${avg} rating`);
  const url = encodeURIComponent(window.location.href);
  const modal = document.createElement("div");
  modal.id = "share-sheet-modal";
  modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:99999;display:flex;align-items:flex-end;justify-content:center";
  modal.innerHTML = `
    <div style="background:#111;border-radius:20px 20px 0 0;border:0.5px solid #2a2a2a;padding:20px;width:100%;max-width:430px">
      <div style="width:40px;height:4px;background:#333;border-radius:2px;margin:0 auto 16px"></div>
      <div style="font-size:16px;font-weight:700;color:#fff;margin-bottom:16px;text-align:center">Share your verdict</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px">
        <button onclick="window.open('https://www.instagram.com/','_blank');showToast('Screenshot your result and post to Instagram!')" style="padding:14px;border-radius:12px;border:1px solid #222;background:#1a1a1a;color:#fff;font-size:14px;cursor:pointer">📸 Instagram</button>
        <button onclick="window.open('https://www.tiktok.com/','_blank');showToast('Screenshot your result and post to TikTok!')" style="padding:14px;border-radius:12px;border:1px solid #222;background:#1a1a1a;color:#fff;font-size:14px;cursor:pointer">🎵 TikTok</button>
        <button onclick="window.open('https://www.facebook.com/sharer/sharer.php?u=${url}&quote=${text}','_blank')" style="padding:14px;border-radius:12px;border:1px solid #222;background:#1a1a1a;color:#fff;font-size:14px;cursor:pointer">👥 Facebook</button>
        <button onclick="window.open('https://twitter.com/intent/tweet?text=${text}&url=${url}','_blank')" style="padding:14px;border-radius:12px;border:1px solid #222;background:#1a1a1a;color:#fff;font-size:14px;cursor:pointer">𝕏 Twitter/X</button>
      </div>
      <button onclick="navigator.clipboard.writeText(window.location.href).then(()=>showToast('Link copied!')).catch(()=>showToast('Copy: '+window.location.href))" style="width:100%;padding:14px;border-radius:12px;border:1px solid #222;background:#1a1a1a;color:#fff;font-size:14px;cursor:pointer;margin-bottom:10px">🔗 Copy link</button>
      <button onclick="nativeShareFromFeed('${postId}')" style="width:100%;padding:14px;border-radius:12px;background:#ff6b35;color:#fff;font-size:15px;font-weight:700;cursor:pointer;border:none;margin-bottom:10px">📤 Share with image</button>
      <button onclick="document.getElementById('share-sheet-modal').remove()" style="width:100%;padding:12px;border-radius:12px;border:1px solid #333;background:transparent;color:#888;font-size:14px;cursor:pointer">Cancel</button>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });
}

async function nativeShareFromFeed(postId) {
  const p = postsCache[postId];
  if (!p) return;
  const avg = p.total_ratings > 0 ? (p.rating_sum / p.total_ratings).toFixed(1) : "–";
  const text = `I just judged @${p.username}'s ${p.category} on Judge Me! 🔥 ${p.fire_votes} Fire · 🧊 ${p.ice_votes} Ice · ⭐ ${avg} — come judge too!`;
  document.getElementById("share-sheet-modal")?.remove();
  if (navigator.share) {
    try { await navigator.share({ title: "Judge Me", text, url: window.location.href }); }
    catch { showToast("Share cancelled"); }
  } else {
    navigator.clipboard.writeText(text + " " + window.location.href).then(() => showToast("Copied to clipboard!")).catch(() => showToast("Copy: " + window.location.href));
  }
}


// ── JURY (COMMENTS) ───────────────────────────────────────────────



async function openJury(postId) {
  let post = postsCache[postId];
  if (!post) return;
  // Ensure badge_tier is loaded for the post author
  if (post.badge_tier === undefined) {
    const { data: bp } = await sb.from("profiles").select("badge_tier").eq("id", post.user_id).maybeSingle();
    post.badge_tier = bp?.badge_tier || null;
    postsCache[postId] = post;
  }

  document.getElementById("jury-modal")?.remove();

  const isVideo = post.image_url && /\.(mp4|mov|webm|avi)$/i.test(post.image_url);
  const thumbHtml = post.image_url
    ? isVideo
      ? `<video src="${esc(post.image_url)}" style="width:100%;height:100%;object-fit:cover" muted playsinline></video>`
      : `<img src="${esc(post.image_url)}" style="width:100%;height:100%;object-fit:cover"/>`
    : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:32px;background:#1a1a1a">${catEmoji(post.category)}</div>`;
  const postAvg = post.total_ratings > 0 ? (post.rating_sum / post.total_ratings).toFixed(1) : null;
  const posterAvatarHtml = post.avatar_url
    ? `<img src="${esc(post.avatar_url)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/>`
    : initials(post.username);

  const modal = document.createElement("div");
  modal.id = "jury-modal";
  modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:99999;display:flex;flex-direction:column;justify-content:flex-end";
  modal.innerHTML = `
    <div style="background:#111;border-radius:20px 20px 0 0;border-top:0.5px solid #2a2a2a;display:flex;flex-direction:column;max-height:90vh" onclick="event.stopPropagation()">
      <div style="display:flex;justify-content:space-between;align-items:center;padding:14px 20px 10px;flex-shrink:0">
        <h2 style="font-size:17px;font-weight:700;color:#fff;margin:0">&#9878;&#65039; The Jury</h2>
        <button onclick="document.getElementById('jury-modal').remove()" style="background:none;border:none;color:#666;font-size:22px;cursor:pointer">&#x2715;</button>
      </div>
      <div style="display:flex;gap:12px;align-items:center;padding:0 16px 12px;border-bottom:0.5px solid #1a1a1a;flex-shrink:0">
        <div style="width:72px;height:72px;border-radius:10px;overflow:hidden;flex-shrink:0;background:#1a1a1a">${thumbHtml}</div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
            <div style="width:22px;height:22px;border-radius:50%;background:linear-gradient(135deg,#ff6b35,#c62a85);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#fff;flex-shrink:0;overflow:hidden">${posterAvatarHtml}</div>
            <span style="font-size:13px;font-weight:700;color:#fff;display:inline-flex;align-items:center;gap:2px">@${esc(post.username)}${getBadgeHtml(post.badge_tier)}</span>
            <span style="font-size:11px;color:#555">${esc(post.category)}</span>
          </div>
          ${post.caption ? `<div style="font-size:13px;color:#aaa;margin-bottom:5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(post.caption)}</div>` : ""}
          <div style="display:flex;gap:8px">
            <span style="font-size:12px;color:#666;background:#1a1a1a;padding:2px 8px;border-radius:10px">&#128293; ${post.fire_votes}</span>
            <span style="font-size:12px;color:#666;background:#1a1a1a;padding:2px 8px;border-radius:10px">&#129306; ${post.ice_votes}</span>
            ${postAvg ? `<span style="font-size:12px;color:#666;background:#1a1a1a;padding:2px 8px;border-radius:10px">&#11088; ${postAvg}</span>` : ""}
          </div>
        </div>
      </div>
      <div id="jury-comments-list" style="overflow-y:auto;flex:1;padding:0 0 8px"></div>
      <div style="padding:12px 16px;border-top:0.5px solid #1a1a1a;background:#111;flex-shrink:0" id="jury-input-area">
        <div style="display:flex;gap:10px;align-items:center">
          <div style="width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,#ff6b35,#c62a85);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#fff;flex-shrink:0;overflow:hidden">
            ${currentUser?.avatar_url ? `<img src="${esc(currentUser.avatar_url)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/>` : initials(currentUser?.username || "?")}
          </div>
          <input type="text" id="jury-comment-input" placeholder="Add your verdict..." maxlength="200"
            style="flex:1;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:20px;padding:10px 16px;color:#fff;font-size:14px;outline:none"
            onkeydown="if(event.key==='Enter')submitJuryComment('${postId}',null)"
          />
          <button onclick="submitJuryComment('${postId}',null)" style="background:#ff6b35;border:none;color:#fff;font-size:13px;font-weight:700;padding:8px 14px;border-radius:20px;cursor:pointer;white-space:nowrap">Post</button>
        </div>
      </div>
    </div>`;
  modal.addEventListener("click", e => { if (e.target === modal) modal.remove(); });
  document.body.appendChild(modal);
  await renderJuryComments(postId, null);
}

async function renderJuryComments(postId, highlightId) {
  const list = document.getElementById("jury-comments-list");
  if (!list) return;
  list.innerHTML = '<div style="text-align:center;padding:32px;color:#555;font-size:14px">Loading jury...</div>';

  const { data: comments } = await sb.from("comments").select("*").eq("post_id", postId).order("created_at", { ascending: true });
  if (!comments || comments.length === 0) {
    list.innerHTML = '<div style="text-align:center;padding:40px;color:#555;font-size:14px">No verdicts yet — be the first!</div>';
    return;
  }

  // Fetch badge tiers for comment authors
  const commentUserIds = [...new Set(comments.map(c => c.user_id).filter(Boolean))];
  let commentBadgeMap = {};
  if (commentUserIds.length > 0) {
    const { data: commentBadgeProfiles } = await sb.from("profiles").select("id,badge_tier").in("id", commentUserIds);
    (commentBadgeProfiles || []).forEach(bp => {
      if (bp.badge_tier) commentBadgeMap[bp.id] = bp.badge_tier;
    });
  }
  // Attach badge_tier to each comment
  comments.forEach(c => { c.badge_tier = commentBadgeMap[c.user_id] || null; });

  // Get reactions for all comments
  const commentIds = comments.map(c => c.id);
  const { data: reactions } = await sb.from("comment_reactions").select("*").in("comment_id", commentIds);
  const reactionMap = {};
  (reactions || []).forEach(r => {
    if (!reactionMap[r.comment_id]) reactionMap[r.comment_id] = [];
    reactionMap[r.comment_id].push(r);
  });

  // Build tree
  const topLevel = comments.filter(c => !c.parent_id);
  const byParent = {};
  comments.filter(c => c.parent_id).forEach(c => {
    if (!byParent[c.parent_id]) byParent[c.parent_id] = [];
    byParent[c.parent_id].push(c);
  });

  function renderComment(c, depth) {
    const myReaction = (reactionMap[c.id] || []).find(r => r.user_id === currentUser?.id);
    const counts = { heart: 0, laugh: 0, cry: 0 };
    (reactionMap[c.id] || []).forEach(r => { if (counts[r.reaction_type] !== undefined) counts[r.reaction_type]++; });
    const avatarHtml = c.avatar_url ? `<img src="${esc(c.avatar_url)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/>` : `<span style="font-size:12px;font-weight:700;color:#fff">${initials(c.username)}</span>`;
    const isHighlighted = c.id === highlightId ? 'background:#1a0800;' : '';
    const replies = byParent[c.id] || [];
    const marginLeft = Math.min(depth * 20, 60);

    return `<div style="margin-left:${marginLeft}px;padding:10px 16px 4px ${depth > 0 ? '0' : '16px'};${isHighlighted}border-bottom:0.5px solid #111" id="comment-${c.id}">
      <div style="display:flex;gap:10px;align-items:flex-start">
        <div onclick="openUserProfile('${c.user_id}')" style="width:30px;height:30px;border-radius:50%;background:linear-gradient(135deg,#ff6b35,#c62a85);display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden;cursor:pointer">${avatarHtml}</div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap">
            <span onclick="openUserProfile('${c.user_id}')" style="font-size:13px;font-weight:700;color:#fff;cursor:pointer;display:inline-flex;align-items:center;flex-wrap:wrap;gap:3px">@${esc(c.username)}${getBadgeHtml(c.badge_tier)}</span>
            <span style="font-size:11px;color:#444">${timeAgo(c.created_at)}</span>
          </div>
          <div style="font-size:14px;color:#ddd;margin-top:3px;line-height:1.4;word-break:break-word">${esc(c.body)}</div>
          <div style="display:flex;gap:12px;margin-top:8px;align-items:center;flex-wrap:wrap">
            <button onclick="reactToComment('${c.id}','heart','${c.post_id}')" style="background:none;border:none;cursor:pointer;font-size:13px;color:${myReaction?.reaction_type==='heart'?'#ff4466':'#666'};padding:0;display:flex;align-items:center;gap:3px">❤️${counts.heart > 0 ? ' ' + counts.heart : ''}</button>
            <button onclick="reactToComment('${c.id}','laugh','${c.post_id}')" style="background:none;border:none;cursor:pointer;font-size:13px;color:${myReaction?.reaction_type==='laugh'?'#ffcc00':'#666'};padding:0;display:flex;align-items:center;gap:3px">😂${counts.laugh > 0 ? ' ' + counts.laugh : ''}</button>
            <button onclick="reactToComment('${c.id}','cry','${c.post_id}')" style="background:none;border:none;cursor:pointer;font-size:13px;color:${myReaction?.reaction_type==='cry'?'#42a5f5':'#666'};padding:0;display:flex;align-items:center;gap:3px">😢${counts.cry > 0 ? ' ' + counts.cry : ''}</button>
            <button onclick="startReply('${c.id}','${c.post_id}','${esc(c.username)}')" style="background:none;border:none;cursor:pointer;font-size:12px;color:#666;padding:0">↩ Reply</button>
            ${c.user_id === currentUser?.id ? `<button onclick="deleteComment('${c.id}','${c.post_id}')" style="background:none;border:none;cursor:pointer;font-size:12px;color:#cc2222;padding:0">Delete</button>` : ''}
          </div>
          ${replies.length > 0 ? `<button onclick="toggleReplies('${c.id}')" style="background:none;border:none;cursor:pointer;font-size:12px;color:#ff6b35;padding:4px 0;margin-top:4px" id="toggle-${c.id}">▼ ${replies.length} ${replies.length===1?'reply':'replies'}</button>` : ''}
        </div>
      </div>
      <div id="replies-${c.id}" style="display:block">
        ${replies.map(r => renderComment(r, depth + 1)).join("")}
      </div>
    </div>`;
  }

  list.innerHTML = topLevel.map(c => renderComment(c, 0)).join("");

  // Update preview count in feed
  const label = document.getElementById("jury-label-" + postId);
  if (label) {
    const topCount = topLevel.length;
    label.textContent = topCount === 0 ? "The Jury — be the first to weigh in" : topCount === 1 ? "The Jury — 1 comment" : `The Jury — ${topCount} comments`;
  }
}

function toggleReplies(commentId) {
  const el = document.getElementById("replies-" + commentId);
  const btn = document.getElementById("toggle-" + commentId);
  if (!el) return;
  const isOpen = el.style.display !== "none";
  el.style.display = isOpen ? "none" : "block";
  if (btn) btn.textContent = btn.textContent.replace(isOpen ? "▼" : "▶", isOpen ? "▶" : "▼");
}

function startReply(parentCommentId, postId, replyingToUsername) {
  const inputArea = document.getElementById("jury-input-area");
  if (!inputArea) return;
  inputArea.innerHTML = `
    <div style="font-size:12px;color:#ff6b35;padding:6px 16px 0;display:flex;justify-content:space-between">
      <span>Replying to @${esc(replyingToUsername)}</span>
      <button onclick="cancelReply('${postId}')" style="background:none;border:none;color:#666;cursor:pointer;font-size:13px">✕ Cancel</button>
    </div>
    <div style="display:flex;gap:10px;align-items:center;padding:10px 16px 12px">
      <div style="width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,#ff6b35,#c62a85);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#fff;flex-shrink:0;overflow:hidden">
        ${currentUser?.avatar_url ? `<img src="${esc(currentUser.avatar_url)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/>` : initials(currentUser?.username || "?")}
      </div>
      <input type="text" id="jury-comment-input" placeholder="Your reply..." maxlength="200" autofocus
        style="flex:1;background:#1a1a1a;border:1px solid #ff6b35;border-radius:20px;padding:10px 16px;color:#fff;font-size:14px;outline:none"
        onkeydown="if(event.key==='Enter')submitJuryComment('${postId}','${parentCommentId}')"
      />
      <button onclick="submitJuryComment('${postId}','${parentCommentId}')" style="background:#ff6b35;border:none;color:#fff;font-size:13px;font-weight:700;padding:8px 14px;border-radius:20px;cursor:pointer">Reply</button>
    </div>`;
  setTimeout(() => document.getElementById("jury-comment-input")?.focus(), 50);
  // Scroll to the comment being replied to
  document.getElementById("comment-" + parentCommentId)?.scrollIntoView({ behavior: "smooth", block: "center" });
}

function cancelReply(postId) {
  const inputArea = document.getElementById("jury-input-area");
  if (!inputArea) return;
  inputArea.innerHTML = `
    <div style="display:flex;gap:10px;align-items:center">
      <div style="width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,#ff6b35,#c62a85);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#fff;flex-shrink:0;overflow:hidden">
        ${currentUser?.avatar_url ? `<img src="${esc(currentUser.avatar_url)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/>` : initials(currentUser?.username || "?")}
      </div>
      <input type="text" id="jury-comment-input" placeholder="Add your verdict..." maxlength="200"
        style="flex:1;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:20px;padding:10px 16px;color:#fff;font-size:14px;outline:none"
        onkeydown="if(event.key==='Enter')submitJuryComment('${postId}',null)"
      />
      <button onclick="submitJuryComment('${postId}',null)" style="background:#ff6b35;border:none;color:#fff;font-size:13px;font-weight:700;padding:8px 14px;border-radius:20px;cursor:pointer;white-space:nowrap">Post</button>
    </div>`;
}

async function submitJuryComment(postId, parentId) {
  if (!currentUser) { showToast("Set up your profile to comment!"); return; }
  const input = document.getElementById("jury-comment-input");
  if (!input) return;
  const body = input.value.trim();
  if (!body) { showToast("Write something first!"); return; }
  input.value = "";
  input.disabled = true;

  const commentId = uid();
  const comment = {
    id: commentId,
    post_id: postId,
    user_id: currentUser.id,
    username: currentUser.username,
    avatar_url: currentUser.avatar_url || null,
    body,
    parent_id: parentId || null,
  };

  const { error } = await sb.from("comments").insert(comment);
  if (error) { showToast("Could not post comment"); input.disabled = false; return; }
  input.disabled = false;

  // Send notification
  const post = postsCache[postId];
  if (post && parentId) {
    // Reply notification — find parent comment author
    const { data: parentComment } = await sb.from("comments").select("user_id,username").eq("id", parentId).single();
    if (parentComment && parentComment.user_id !== currentUser.id) {
      await sendNotification({
        recipient_id: parentComment.user_id,
        type: "reply",
        post_id: postId,
        comment_id: commentId,
        body_preview: body.substring(0, 60),
      });
    }
  } else if (post && post.user_id !== currentUser.id) {
    // Comment notification to post owner
    await sendNotification({
      recipient_id: post.user_id,
      type: "comment",
      post_id: postId,
      comment_id: commentId,
      body_preview: body.substring(0, 60),
    });
  }

  if (parentId) cancelReply(postId);
  await renderJuryComments(postId, commentId);
}

async function reactToComment(commentId, reactionType, postId) {
  if (!currentUser) { showToast("Set up your profile to react!"); return; }
  // Check existing reaction
  const { data: existing } = await sb.from("comment_reactions").select("*").eq("comment_id", commentId).eq("user_id", currentUser.id).maybeSingle();
  if (existing) {
    if (existing.reaction_type === reactionType) {
      // Toggle off
      await sb.from("comment_reactions").delete().eq("id", existing.id);
    } else {
      // Change reaction
      await sb.from("comment_reactions").update({ reaction_type: reactionType }).eq("id", existing.id);
    }
  } else {
    await sb.from("comment_reactions").insert({ id: uid(), comment_id: commentId, user_id: currentUser.id, reaction_type: reactionType });
    // Notify comment author
    const { data: comment } = await sb.from("comments").select("user_id").eq("id", commentId).single();
    if (comment && comment.user_id !== currentUser.id) {
      await sendNotification({ recipient_id: comment.user_id, type: "reaction", post_id: postId, comment_id: commentId, body_preview: reactionType === "heart" ? "❤️" : reactionType === "laugh" ? "😂" : "😢" });
    }
  }
  await renderJuryComments(postId, null);
}

async function deleteComment(commentId, postId) {
  if (!confirm("Delete this comment?")) return;
  await sb.from("comments").delete().eq("id", commentId);
  await sb.from("comment_reactions").delete().eq("comment_id", commentId);
  await renderJuryComments(postId, null);
  showToast("Comment deleted");
}

// ── NOTIFICATIONS ─────────────────────────────────────────────────

async function sendNotification({ recipient_id, type, post_id, comment_id, body_preview }) {
  if (!currentUser) return;
  if (type === "dm") {
    // For DMs: update existing unread notification from this sender, or insert if none exists
    // This keeps just ONE DM notification per sender instead of one per message
    const { data: existing } = await sb.from("notifications")
      .select("id")
      .eq("recipient_id", recipient_id)
      .eq("sender_id", currentUser.id)
      .eq("type", "dm")
      .eq("is_read", false)
      .maybeSingle();
    if (existing) {
      // Update the existing notification with the latest message preview + mark unread
      await sb.from("notifications").update({
        body_preview: body_preview || null,
        is_read: false,
        created_at: new Date().toISOString(),
      }).eq("id", existing.id);
    } else {
      await sb.from("notifications").insert({
        id: uid(),
        recipient_id,
        sender_id: currentUser.id,
        sender_username: currentUser.username,
        sender_avatar: currentUser.avatar_url || null,
        type: "dm",
        post_id: null,
        comment_id: null,
        body_preview: body_preview || null,
        is_read: false,
      });
    }
  } else {
    await sb.from("notifications").insert({
      id: uid(),
      recipient_id,
      sender_id: currentUser.id,
      sender_username: currentUser.username,
      sender_avatar: currentUser.avatar_url || null,
      sender_badge: currentUser.badge_tier || null,
      type,
      post_id: post_id || null,
      comment_id: comment_id || null,
      body_preview: body_preview || null,
      is_read: false,
    });
  }
  refreshNotifBadge();
}

async function refreshNotifBadge() {
  if (!currentUser) return;
  const { count } = await sb.from("notifications").select("*", { count: "exact", head: true }).eq("recipient_id", currentUser.id).eq("is_read", false);
  unreadNotifCount = count || 0;
  const badge = document.getElementById("notif-badge");
  const tabBadge = document.getElementById("notif-tab-badge");
  if (badge) { badge.textContent = unreadNotifCount > 0 ? (unreadNotifCount > 9 ? "9+" : unreadNotifCount) : ""; badge.style.display = unreadNotifCount > 0 ? "flex" : "none"; }
  if (tabBadge) { tabBadge.textContent = unreadNotifCount > 0 ? (unreadNotifCount > 9 ? "9+" : unreadNotifCount) : ""; tabBadge.style.display = unreadNotifCount > 0 ? "flex" : "none"; }
}

async function refreshDMBadge() {
  if (!currentUser) return;
  const { count } = await sb.from("messages").select("*", { count: "exact", head: true }).eq("recipient_id", currentUser.id).eq("is_read", false);
  const total = count || 0;
  const badge = document.getElementById("dm-tab-badge");
  if (badge) { badge.textContent = total > 9 ? "9+" : (total > 0 ? total : ""); badge.style.display = total > 0 ? "flex" : "none"; }
  // If user is on the messages screen, refresh inbox automatically
  const msgScreen = document.getElementById("screen-messages");
  if (msgScreen && msgScreen.classList.contains("active") && total > 0) {
    loadDMInbox();
  }
  // If user is in a DM convo, auto-refresh messages
  const convoScreen = document.getElementById("screen-dm-convo");
  if (convoScreen && convoScreen.classList.contains("active") && dmOtherUserId) {
    loadDMMessages();
  }
}

async function loadNotifications() {
  if (!currentUser) return;
  const list = document.getElementById("notif-list");
  if (!list) return;
  list.innerHTML = '<div class="loading">Loading...</div>';

  const { data: allNotifs } = await sb.from("notifications").select("*").eq("recipient_id", currentUser.id).order("created_at", { ascending: false }).limit(100);

  // Deduplicate: keep only the latest DM notification per sender
  const seenDMSenders = new Set();
  const notifs = (allNotifs || []).filter(n => {
    if (n.type === "dm") {
      if (seenDMSenders.has(n.sender_id)) return false;
      seenDMSenders.add(n.sender_id);
    }
    return true;
  }).slice(0, 50);

  // Mark all as read
  await sb.from("notifications").update({ is_read: true }).eq("recipient_id", currentUser.id).eq("is_read", false);
  unreadNotifCount = 0;
  refreshNotifBadge();

  if (!notifs || notifs.length === 0) {
    list.innerHTML = '<div class="empty-state"><div class="empty-icon">🔔</div><div class="empty-text">No notifications yet</div><div style="color:#555;font-size:13px">When people comment or react, you will see it here</div></div>';
    return;
  }

  list.innerHTML = notifs.map(n => {
    const avatarHtml = n.sender_avatar ? `<img src="${esc(n.sender_avatar)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/>` : `<span style="font-size:16px;font-weight:700;color:#fff">${initials(n.sender_username)}</span>`;
    const typeLabel = n.type === "comment" ? "commented on your post"
      : n.type === "reply" ? "replied to your comment"
      : n.type === "dm" ? "sent you a message"
      : "reacted to your comment";
    const typeIcon = n.type === "comment" ? "⚖️" : n.type === "reply" ? "↩️" : n.type === "dm" ? "💬" : "❤️";
    const unreadDot = !n.is_read ? '<div style="width:8px;height:8px;border-radius:50%;background:#ff6b35;flex-shrink:0"></div>' : '';
    const senderAvatar = n.sender_avatar ? esc(n.sender_avatar) : '';
    const notifAction = n.type === "dm"
      ? `openDMConvo('${n.sender_id}','${esc(n.sender_username)}','${senderAvatar}')`
      : `openNotif('${n.post_id}','${n.comment_id}')`;
    return `<div style="display:flex;align-items:flex-start;gap:12px;padding:14px 16px;border-bottom:0.5px solid #1a1a1a;cursor:pointer;${!n.is_read?'background:#0f0a06':''}" onclick="${notifAction}">
      <div style="width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,#ff6b35,#c62a85);display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden;position:relative">
        ${avatarHtml}
        <div style="position:absolute;bottom:-2px;right:-2px;font-size:14px">${typeIcon}</div>
      </div>
      <div style="flex:1;min-width:0">
        <div style="font-size:14px;color:#fff;display:flex;align-items:center;flex-wrap:wrap;gap:2px"><span style="font-weight:700">@${esc(n.sender_username)}</span>${getBadgeHtml(n.sender_badge)} ${typeLabel}</div>
        ${n.body_preview ? `<div style="font-size:13px;color:#666;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">"${esc(n.body_preview)}"</div>` : ''}
        <div style="font-size:11px;color:#444;margin-top:4px">${timeAgo(n.created_at)}</div>
      </div>
      ${unreadDot}
    </div>`;
  }).join("");
}

async function openNotif(postId, commentId) {
  if (!postId || postId === "null") return;
  // Fetch post into cache if needed
  if (!postsCache[postId]) {
    const { data } = await sb.from("posts").select("*").eq("id", postId).single();
    if (data) postsCache[postId] = data;
  }
  document.getElementById("jury-modal")?.remove();
  showScreen("screen-feed");
  setTimeout(async () => {
    await openJury(postId);
    // Scroll to specific comment if provided
    if (commentId && commentId !== "null") {
      setTimeout(() => {
        document.getElementById("comment-" + commentId)?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 400);
    }
  }, 300);
}



// ── SHARE POST ────────────────────────────────────────────────────
function sharePost(postId, e) {
  if (e) e.stopPropagation();
  const p = postsCache[postId];
  if (!p) return;
  const avg = p.total_ratings > 0 ? (p.rating_sum / p.total_ratings).toFixed(1) : "–";
  const shareText = `Check out @${p.username}'s ${p.category} on Judge Me! 🔥 ${p.fire_votes} Fire · 🧊 ${p.ice_votes} Ice · ⭐ ${avg}`;
  const shareUrl = window.location.origin + window.location.pathname + "?post=" + postId;
  const encodedText = encodeURIComponent(shareText);
  const encodedUrl = encodeURIComponent(shareUrl);

  const sheet = document.createElement("div");
  sheet.id = "share-post-sheet";
  sheet.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:99999;display:flex;align-items:flex-end;justify-content:center";
  sheet.innerHTML = `
    <div style="background:#111;border-radius:20px 20px 0 0;border:0.5px solid #2a2a2a;padding:20px;width:100%;max-width:430px" onclick="event.stopPropagation()">
      <div style="width:40px;height:4px;background:#333;border-radius:2px;margin:0 auto 16px"></div>
      <div style="font-size:16px;font-weight:700;color:#fff;margin-bottom:4px;text-align:center">Share this post</div>
      <div style="font-size:13px;color:#666;text-align:center;margin-bottom:16px">@${esc(p.username)}'s ${esc(p.category)}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
        <button id="shr-native" style="padding:14px;border-radius:12px;border:1px solid #222;background:#1a1a1a;color:#fff;font-size:14px;cursor:pointer">📤 Share</button>
        <button id="shr-twitter" style="padding:14px;border-radius:12px;border:1px solid #222;background:#1a1a1a;color:#fff;font-size:14px;cursor:pointer">𝕏 Twitter/X</button>
        <button id="shr-facebook" style="padding:14px;border-radius:12px;border:1px solid #222;background:#1a1a1a;color:#fff;font-size:14px;cursor:pointer">👥 Facebook</button>
        <button id="shr-text" style="padding:14px;border-radius:12px;border:1px solid #222;background:#1a1a1a;color:#fff;font-size:14px;cursor:pointer">💬 Text</button>
        <button id="shr-instagram" style="padding:14px;border-radius:12px;border:1px solid #222;background:#1a1a1a;color:#fff;font-size:14px;cursor:pointer">📸 Stories</button>
        <button id="shr-tiktok" style="padding:14px;border-radius:12px;border:1px solid #222;background:#1a1a1a;color:#fff;font-size:14px;cursor:pointer">🎵 Reels</button>
      </div>
      <button id="shr-copy" style="width:100%;padding:14px;border-radius:12px;border:1px solid #222;background:#1a1a1a;color:#fff;font-size:14px;cursor:pointer;margin-bottom:10px">🔗 Copy link</button>
      <button id="shr-cancel" style="width:100%;padding:12px;border-radius:12px;border:1px solid #333;background:transparent;color:#888;font-size:14px;cursor:pointer">Cancel</button>
    </div>`;
  sheet.addEventListener("click", (e) => { if (e.target === sheet) sheet.remove(); });
  document.body.appendChild(sheet);

  // Wire up share buttons after DOM insertion
  const close = () => sheet.remove();
  document.getElementById("shr-native").onclick = () => {
    if (navigator.share) {
      navigator.share({ title: "Judge Me 🔥", text: shareText, url: shareUrl }).catch(() => {});
    } else {
      navigator.clipboard.writeText(shareText + " " + shareUrl).then(() => showToast("Copied to clipboard!"));
    }
    close();
  };
  document.getElementById("shr-twitter").onclick = () => { window.open("https://twitter.com/intent/tweet?text=" + encodedText + "&url=" + encodedUrl, "_blank"); close(); };
  document.getElementById("shr-facebook").onclick = () => { window.open("https://www.facebook.com/sharer/sharer.php?u=" + encodedUrl, "_blank"); close(); };
  document.getElementById("shr-text").onclick = () => { window.open("sms:?&body=" + encodedText + "%20" + encodedUrl); close(); };
  document.getElementById("shr-instagram").onclick = () => {
    navigator.clipboard.writeText(shareUrl).then(() => showToast("Link copied! Open your favorite app and paste to share 📸"));
    close();
  };
  document.getElementById("shr-tiktok").onclick = () => {
    navigator.clipboard.writeText(shareUrl).then(() => showToast("Link copied! Open your favorite app and paste to share 🎵"));
    close();
  };
  document.getElementById("shr-copy").onclick = () => { navigator.clipboard.writeText(shareUrl).then(() => showToast("Link copied! ✓")); close(); };
  document.getElementById("shr-cancel").onclick = close;
}

// ── DIRECT MESSAGES ───────────────────────────────────────────────
let dmOtherUserId = null;
let dmOtherUsername = null;
let dmPollInterval = null;

async function loadDMInbox() {
  if (!currentUser) return;
  const list = document.getElementById("dm-inbox-list");
  if (!list) return;
  list.innerHTML = '<div class="loading">Loading messages...</div>';

  // Get all messages involving current user
  const { data: msgs } = await sb.from("messages").select("*")
    .or(`sender_id.eq.${currentUser.id},recipient_id.eq.${currentUser.id}`)
    .order("created_at", { ascending: false });

  if (!msgs || msgs.length === 0) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">💬</div><div class="empty-text">No messages yet</div><div style="color:#555;font-size:13px;margin-top:6px">Tap + New to start a conversation</div></div>`;
    return;
  }

  // Group by conversation partner
  const threads = {};
  msgs.forEach(m => {
    const otherId = m.sender_id === currentUser.id ? m.recipient_id : m.sender_id;
    if (!threads[otherId] || new Date(m.created_at) > new Date(threads[otherId].created_at)) {
      threads[otherId] = m;
    }
  });

  // Get profiles for all partners
  const partnerIds = Object.keys(threads);
  const { data: profiles } = await sb.from("profiles").select("id,username,avatar_url").in("id", partnerIds);
  const profileMap = {};
  (profiles || []).forEach(p => { profileMap[p.id] = p; });

  // Count unread per thread
  const { data: unreadMsgs } = await sb.from("messages").select("sender_id")
    .eq("recipient_id", currentUser.id).eq("is_read", false);
  const unreadByUser = {};
  (unreadMsgs || []).forEach(m => { unreadByUser[m.sender_id] = (unreadByUser[m.sender_id] || 0) + 1; });

  list.innerHTML = partnerIds.map(pid => {
    const lastMsg = threads[pid];
    const isMe = lastMsg.sender_id === currentUser.id;
    // Use profile from DB, fall back to username stored in the message itself
    const fallbackUsername = isMe
      ? (lastMsg.sender_username || pid.substring(0,8))
      : (lastMsg.sender_username || pid.substring(0,8));
    const partner = profileMap[pid] || {
      username: (!isMe && lastMsg.sender_username) ? lastMsg.sender_username : fallbackUsername,
      avatar_url: (!isMe && lastMsg.sender_avatar) ? lastMsg.sender_avatar : null
    };
    const unread = unreadByUser[pid] || 0;
    const avatarHtml = partner.avatar_url
      ? `<img src="${esc(partner.avatar_url)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/>`
      : `<span style="font-size:18px;font-weight:700;color:#fff">${initials(partner.username)}</span>`;
    return `<div style="display:flex;align-items:stretch;border-bottom:0.5px solid #1a1a1a;${unread>0?'background:#0f0a06':''}">
      <div onclick="openDMConvo('${pid}','${esc(partner.username)}','${esc(partner.avatar_url||'')}')"
        style="display:flex;align-items:center;gap:12px;padding:14px 16px;flex:1;cursor:pointer;min-width:0">
        <div style="width:48px;height:48px;border-radius:50%;background:linear-gradient(135deg,#ff6b35,#c62a85);display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden">${avatarHtml}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:15px;font-weight:${unread>0?'700':'600'};color:#fff;display:flex;align-items:center;gap:2px">@${esc(partner.username)}${getBadgeHtml(partner.badge_tier)}</div>
          <div style="font-size:13px;color:#555;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${isMe ? 'You: ' : ''}${esc(lastMsg.body)}</div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0">
          <div style="font-size:11px;color:#444">${timeAgo(lastMsg.created_at)}</div>
          ${unread > 0 ? `<div style="background:#ff6b35;color:#fff;font-size:10px;font-weight:700;min-width:18px;height:18px;border-radius:9px;display:flex;align-items:center;justify-content:center;padding:0 4px">${unread}</div>` : ''}
        </div>
      </div>
      <button onclick="deleteDMConversation('${pid}','${esc(partner.username)}')"
        style="background:#cc2222;border:none;color:#fff;font-size:12px;font-weight:700;padding:0 16px;cursor:pointer;flex-shrink:0">
        🗑️<br/>Delete
      </button>
    </div>`;
  }).join("");

  // Update DM tab badge
  const totalUnread = Object.values(unreadByUser).reduce((a,b) => a+b, 0);
  const badge = document.getElementById("dm-tab-badge");
  if (badge) { badge.textContent = totalUnread > 0 ? (totalUnread > 9 ? "9+" : totalUnread) : ""; badge.style.display = totalUnread > 0 ? "flex" : "none"; }
}

async function openDMConvo(userId, username, avatarUrl) {
  dmOtherUserId = userId;
  dmOtherUsername = username;
  // Set header
  const avatarEl = document.getElementById("dm-convo-avatar");
  if (avatarEl) avatarEl.innerHTML = avatarUrl ? `<img src="${esc(avatarUrl)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/>` : initials(username);
  const nameEl = document.getElementById("dm-convo-name");
  if (nameEl) nameEl.textContent = "@" + username;
  // Switch screen
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById("screen-dm-convo").classList.add("active");
  window.scrollTo(0, 0);
  await loadDMMessages();
  // Mark messages as read
  await sb.from("messages").update({ is_read: true }).eq("sender_id", userId).eq("recipient_id", currentUser.id).eq("is_read", false);
  // Also mark DM notifications from this user as read
  await sb.from("notifications").update({ is_read: true }).eq("recipient_id", currentUser.id).eq("sender_id", userId).eq("type", "dm");
  refreshNotifBadge();
  // Focus input
  setTimeout(() => document.getElementById("dm-input")?.focus(), 200);
  // Poll for new messages every 5 seconds
  if (dmPollInterval) clearInterval(dmPollInterval);
  dmPollInterval = setInterval(loadDMMessages, 5000);
}

async function loadDMMessages() {
  if (!currentUser || !dmOtherUserId) return;
  const list = document.getElementById("dm-messages-list");
  if (!list) return;
  const { data: msgs } = await sb.from("messages").select("*")
    .or(`and(sender_id.eq.${currentUser.id},recipient_id.eq.${dmOtherUserId}),and(sender_id.eq.${dmOtherUserId},recipient_id.eq.${currentUser.id})`)
    .order("created_at", { ascending: true });
  if (!msgs || msgs.length === 0) {
    list.innerHTML = `<div style="text-align:center;padding:40px 20px;color:#555;font-size:14px">No messages yet.<br/>Say hello! 👋</div>`;
    return;
  }
  const wasAtBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 60;
  list.innerHTML = msgs.map(m => {
    const isMe = m.sender_id === currentUser.id;
    return `<div style="display:flex;justify-content:${isMe?'flex-end':'flex-start'};gap:8px;align-items:flex-end">
      <div style="max-width:75%;padding:10px 14px;border-radius:${isMe?'18px 18px 4px 18px':'18px 18px 18px 4px'};background:${isMe?'#ff6b35':'#1a1a1a'};color:#fff;font-size:14px;line-height:1.4;word-break:break-word;cursor:pointer" onclick="showDMOptions('${m.id}','${isMe}')">
        ${esc(m.body)}
        <div style="font-size:10px;color:${isMe?'rgba(255,255,255,0.6)':'#444'};margin-top:4px;text-align:right">${timeAgo(m.created_at)}</div>
      </div>
    </div>`;
  }).join("");
  if (wasAtBottom || list.scrollTop === 0) list.scrollTop = list.scrollHeight;
}

async function sendDM() {
  if (!currentUser || !dmOtherUserId) return;
  const input = document.getElementById("dm-input");
  if (!input) return;
  const body = input.value.trim();
  if (!body) return;
  input.value = "";
  await sb.from("messages").insert({
    id: uid(),
    sender_id: currentUser.id,
    recipient_id: dmOtherUserId,
    body,
    is_read: false,
    sender_username: currentUser.username,
    sender_avatar: currentUser.avatar_url || null
  });
  await loadDMMessages();
  // Notify recipient
  await sendNotification({ recipient_id: dmOtherUserId, type: "dm", body_preview: body.substring(0, 60) });
}

function showNewDM() {
  // Reuse search to find user to DM
  const modal = document.createElement("div");
  modal.id = "new-dm-modal";
  modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:99999;display:flex;flex-direction:column;padding:20px";
  modal.innerHTML = `
    <div style="background:#111;border-radius:20px;padding:20px;flex:1;display:flex;flex-direction:column;max-height:90vh">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h2 style="font-size:18px;font-weight:700;color:#fff;margin:0">New Message</h2>
        <button onclick="document.getElementById('new-dm-modal').remove()" style="background:none;border:none;color:#666;font-size:22px;cursor:pointer">✕</button>
      </div>
      <input type="text" id="new-dm-search" placeholder="Search username..." autocomplete="off"
        style="width:100%;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:20px;padding:12px 16px;color:#fff;font-size:14px;outline:none;margin-bottom:12px"
        oninput="searchDMUsers(this.value)"/>
      <div id="new-dm-results" style="flex:1;overflow-y:auto">
        <div style="color:#555;font-size:14px;text-align:center;padding:20px">Type a username to search</div>
      </div>
    </div>`;
  document.body.appendChild(modal);
  setTimeout(() => document.getElementById("new-dm-search")?.focus(), 100);
}

async function searchDMUsers(q) {
  const results = document.getElementById("new-dm-results");
  if (!results) return;
  if (!q || q.length < 1) { results.innerHTML = '<div style="color:#555;font-size:14px;text-align:center;padding:20px">Type a username to search</div>'; return; }
  const { data } = await sb.from("profiles").select("id,username,avatar_url,bio").ilike("username", `%${q}%`).neq("id", currentUser.id).limit(15);
  if (!data || data.length === 0) { results.innerHTML = `<div style="color:#555;font-size:14px;text-align:center;padding:20px">No users found</div>`; return; }
  results.innerHTML = data.map(u => {
    const avatarHtml = u.avatar_url ? `<img src="${esc(u.avatar_url)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/>` : initials(u.username);
    return `<div onclick="document.getElementById('new-dm-modal').remove();openDMConvo('${u.id}','${esc(u.username)}','${esc(u.avatar_url||'')}')"
      style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:0.5px solid #1a1a1a;cursor:pointer">
      <div style="width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,#ff6b35,#c62a85);display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden">${avatarHtml}</div>
      <div style="flex:1">
        <div style="font-size:15px;font-weight:600;color:#fff;display:flex;align-items:center;gap:2px">@${esc(u.username)}${getBadgeHtml(u.badge_tier)}</div>
        <div style="font-size:12px;color:#666;margin-top:2px">${esc(u.bio||'')}</div>
      </div>
      <div style="color:#ff6b35;font-size:20px;font-weight:700">›</div>
    </div>`;
  }).join("");
}

// Allow DMing from user profiles
function dmUser(userId, username, avatarUrl) {
  openDMConvo(userId, username, avatarUrl || '');
}


// ── VIDEO MUTE TOGGLE ────────────────────────────────────────────
function toggleVideoMute(postId, e) {
  if (e) e.stopPropagation();
  const vid = document.getElementById("vid-" + postId);
  const btn = document.getElementById("mute-btn-" + postId);
  if (!vid) return;
  const willUnmute = vid.muted;
  // If unmuting this one, mute all other videos first
  if (willUnmute) {
    document.querySelectorAll("video.feed-image").forEach(v => {
      v.muted = true;
      const otherId = v.id.replace("vid-", "");
      const otherBtn = document.getElementById("mute-btn-" + otherId);
      if (otherBtn) otherBtn.textContent = "🔇";
    });
  }
  vid.muted = !willUnmute;
  if (btn) btn.textContent = vid.muted ? "🔇" : "🔊";
}

// ── DM MESSAGE OPTIONS ────────────────────────────────────────────
function showDMOptions(messageId, isMe) {
  const existing = document.getElementById("dm-options-sheet");
  if (existing) existing.remove();
  const sheet = document.createElement("div");
  sheet.id = "dm-options-sheet";
  sheet.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:99999;display:flex;align-items:flex-end;justify-content:center";
  sheet.innerHTML = `
    <div style="background:#111;border-radius:20px 20px 0 0;border:0.5px solid #2a2a2a;padding:20px;width:100%;max-width:430px" onclick="event.stopPropagation()">
      <div style="width:40px;height:4px;background:#333;border-radius:2px;margin:0 auto 16px"></div>
      ${isMe === 'true' || isMe === true ? `<button onclick="deleteDMMessage('${messageId}')" style="width:100%;padding:14px;border-radius:12px;border:1px solid #cc2222;background:transparent;color:#ff4444;font-size:15px;font-weight:600;cursor:pointer;margin-bottom:10px">🗑️ Delete message</button>` : ''}
      <button onclick="copyDMMessage('${messageId}')" style="width:100%;padding:14px;border-radius:12px;border:1px solid #222;background:#1a1a1a;color:#fff;font-size:15px;cursor:pointer;margin-bottom:10px">📋 Copy message</button>
      <button onclick="document.getElementById('dm-options-sheet').remove()" style="width:100%;padding:12px;border-radius:12px;border:1px solid #333;background:transparent;color:#888;font-size:14px;cursor:pointer">Cancel</button>
    </div>`;
  sheet.addEventListener("click", (e) => { if (e.target === sheet) sheet.remove(); });
  document.body.appendChild(sheet);
  // Store message body for copy
  sheet._messageId = messageId;
}

async function deleteDMConversation(partnerId, partnerUsername) {
  if (!confirm("Delete your entire conversation with @" + partnerUsername + "? This cannot be undone.")) return;
  // Delete all messages between current user and partner in both directions
  await sb.from("messages").delete()
    .eq("sender_id", currentUser.id).eq("recipient_id", partnerId);
  await sb.from("messages").delete()
    .eq("sender_id", partnerId).eq("recipient_id", currentUser.id);
  showToast("Conversation deleted");
  loadDMInbox();
}

async function deleteDMMessage(messageId) {
  document.getElementById("dm-options-sheet")?.remove();
  if (!confirm("Delete this message?")) return;
  await sb.from("messages").delete().eq("id", messageId);
  await loadDMMessages();
  showToast("Message deleted");
}

async function copyDMMessage(messageId) {
  document.getElementById("dm-options-sheet")?.remove();
  // Find message body from rendered list
  const { data } = await sb.from("messages").select("body").eq("id", messageId).single();
  if (data) {
    navigator.clipboard.writeText(data.body).then(() => showToast("Copied!"));
  }
}


// ── TEXT OVERLAY EDITOR ───────────────────────────────────────────

const FONT_STYLES = {
  bold:        { fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif", fontWeight: "900", fontStyle: "normal", textShadow: "none", letterSpacing: "0px" },
  italic:      { fontFamily: "Georgia, serif", fontWeight: "400", fontStyle: "italic", textShadow: "none", letterSpacing: "0px" },
  handwriting: { fontFamily: "'Segoe Script', 'Bradley Hand', cursive", fontWeight: "600", fontStyle: "normal", textShadow: "none", letterSpacing: "0px" },
  neon:        { fontFamily: "monospace", fontWeight: "700", fontStyle: "normal", textShadow: "0 0 8px currentColor, 0 0 20px currentColor", letterSpacing: "3px" },
  classic:     { fontFamily: "Georgia, 'Times New Roman', serif", fontWeight: "400", fontStyle: "normal", textShadow: "2px 2px 4px rgba(0,0,0,0.8)", letterSpacing: "1px" },
  shadow:      { fontFamily: "Impact, 'Arial Black', sans-serif", fontWeight: "900", fontStyle: "normal", textShadow: "3px 3px 0px rgba(0,0,0,0.9)", letterSpacing: "1px" },
};

let currentOverlayFont = "bold";
let currentOverlayColor = "#ffffff";

function openTextEditor() {
  const fileInput = document.getElementById("post-file");
  if (!fileInput.files[0]) return;
  const file = fileInput.files[0];
  const url = URL.createObjectURL(file);
  const isVideo = file.type.startsWith("video");

  const editor = document.getElementById("text-overlay-editor");
  editor.style.display = "flex";

  // Inject media into preview
  const container = document.getElementById("toe-media-container");
  const existingMedia = container.querySelector("img,video");
  if (existingMedia) existingMedia.remove();

  const media = isVideo
    ? Object.assign(document.createElement("video"), { src: url, muted: true, loop: true, autoplay: true, playsInline: true })
    : Object.assign(document.createElement("img"), { src: url });
  media.style.cssText = "position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block";
  container.insertBefore(media, container.firstChild);

  // Set up text element
  const textEl = document.getElementById("toe-text-el");
  const savedText = textOverlay?.text || "";
  const input = document.getElementById("toe-text-input");
  input.value = savedText;
  textEl.textContent = savedText || "Your text here";
  currentOverlayFont = textOverlay?.font || "bold";
  currentOverlayColor = textOverlay?.color || "#ffffff";
  document.getElementById("toe-color-picker").value = currentOverlayColor;

  // Apply starting position
  if (textOverlay) {
    textEl.style.left = textOverlay.xPct + "%";
    textEl.style.top = textOverlay.yPct + "%";
    textEl.style.transform = "translate(-50%,-50%)";
  } else {
    textEl.style.left = "50%";
    textEl.style.top = "50%";
    textEl.style.transform = "translate(-50%,-50%)";
  }

  applyFontToEl(textEl, currentOverlayFont, currentOverlayColor);

  // Mark active font btn
  document.querySelectorAll(".toe-font-btn").forEach(b => b.classList.toggle("active", b.dataset.font === currentOverlayFont));

  // Set up drag
  setupOverlayDrag(textEl);
}

function applyFontToEl(el, font, color) {
  const s = FONT_STYLES[font] || FONT_STYLES.bold;
  el.style.fontFamily = s.fontFamily;
  el.style.fontWeight = s.fontWeight;
  el.style.fontStyle = s.fontStyle;
  el.style.textShadow = s.textShadow;
  el.style.letterSpacing = s.letterSpacing;
  el.style.color = color;
  el.style.fontSize = "22px";
}

function updateOverlayText() {
  const val = document.getElementById("toe-text-input").value;
  const el = document.getElementById("toe-text-el");
  el.textContent = val || "Your text here";
}

function setOverlayFont(font, btn) {
  currentOverlayFont = font;
  document.querySelectorAll(".toe-font-btn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  applyFontToEl(document.getElementById("toe-text-el"), font, currentOverlayColor);
}

function updateOverlayColor(color) {
  currentOverlayColor = color;
  applyFontToEl(document.getElementById("toe-text-el"), currentOverlayFont, color);
}

function setupOverlayDrag(el) {
  const wrap = document.getElementById("toe-media-container");

  function getPos(e) {
    const touch = e.touches ? e.touches[0] : e;
    return { x: touch.clientX, y: touch.clientY };
  }

  function onStart(e) {
    e.preventDefault();
    overlayDragging = true;
    const pos = getPos(e);
    const rect = el.getBoundingClientRect();
    overlayDragOffX = pos.x - (rect.left + rect.width / 2);
    overlayDragOffY = pos.y - (rect.top + rect.height / 2);
    el.style.cursor = "grabbing";
  }

  function onMove(e) {
    if (!overlayDragging) return;
    e.preventDefault();
    const pos = getPos(e);
    const wrapRect = wrap.getBoundingClientRect();
    const newX = pos.x - overlayDragOffX - wrapRect.left;
    const newY = pos.y - overlayDragOffY - wrapRect.top;
    const xPct = Math.max(5, Math.min(95, (newX / wrapRect.width) * 100));
    const yPct = Math.max(5, Math.min(95, (newY / wrapRect.height) * 100));
    el.style.left = xPct + "%";
    el.style.top = yPct + "%";
    el.style.transform = "translate(-50%,-50%)";
  }

  function onEnd() {
    overlayDragging = false;
    el.style.cursor = "grab";
  }

  el.removeEventListener("mousedown", el._dragStart);
  el.removeEventListener("touchstart", el._dragStart);
  el._dragStart = onStart;
  el.addEventListener("mousedown", onStart, { passive: false });
  el.addEventListener("touchstart", onStart, { passive: false });
  document.addEventListener("mousemove", onMove, { passive: false });
  document.addEventListener("touchmove", onMove, { passive: false });
  document.addEventListener("mouseup", onEnd);
  document.addEventListener("touchend", onEnd);
}

function applyTextOverlay() {
  const text = document.getElementById("toe-text-input").value.trim();
  const editor = document.getElementById("text-overlay-editor");
  const el = document.getElementById("toe-text-el");
  const wrap = document.getElementById("toe-media-container");
  const wrapRect = wrap.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  const xPct = ((elRect.left + elRect.width / 2) - wrapRect.left) / wrapRect.width * 100;
  const yPct = ((elRect.top + elRect.height / 2) - wrapRect.top) / wrapRect.height * 100;

  if (text) {
    textOverlay = { text, font: currentOverlayFont, color: currentOverlayColor, xPct: Math.round(xPct), yPct: Math.round(yPct) };
    document.getElementById("overlay-preview-indicator").style.display = "block";
  } else {
    textOverlay = null;
    document.getElementById("overlay-preview-indicator").style.display = "none";
  }

  editor.style.display = "none";
}

function closeTextEditor() {
  document.getElementById("text-overlay-editor").style.display = "none";
}



// ── BADGE SYSTEM ──────────────────────────────────────────────────
function getBadgeHtml(tier) {
  if (!tier) return "";
  // Use pill-style badges with text for reliable rendering on all mobile browsers
  const badges = {
    platinum: '<span title="Platinum Founder" style="display:inline-flex;align-items:center;gap:2px;padding:1px 6px;border-radius:10px;background:linear-gradient(135deg,#b0c4de,#6fa3ef,#b0c4de);border:1px solid #90caf9;font-size:10px;font-weight:800;color:#fff;margin-left:5px;flex-shrink:0;white-space:nowrap;box-shadow:0 0 8px rgba(111,163,239,0.7);text-shadow:0 1px 2px rgba(0,0,0,0.4)">💎 PLATINUM</span>',
    gold:     '<span title="Gold Member" style="display:inline-flex;align-items:center;gap:2px;padding:1px 6px;border-radius:10px;background:linear-gradient(135deg,#ffd700,#ffb300,#ffd700);border:1px solid #ffb300;font-size:10px;font-weight:800;color:#7a4f00;margin-left:5px;flex-shrink:0;white-space:nowrap;box-shadow:0 0 6px rgba(255,193,7,0.6)">👑 GOLD</span>',
    silver:   '<span title="Silver Member" style="display:inline-flex;align-items:center;gap:2px;padding:1px 6px;border-radius:10px;background:linear-gradient(135deg,#e8e8e8,#c0c0c0,#e8e8e8);border:1px solid #aaa;font-size:10px;font-weight:800;color:#444;margin-left:5px;flex-shrink:0;white-space:nowrap;box-shadow:0 0 4px rgba(180,180,180,0.5)">🥈 SILVER</span>',
    bronze:   '<span title="Bronze Member" style="display:inline-flex;align-items:center;gap:2px;padding:1px 6px;border-radius:10px;background:linear-gradient(135deg,#cd7f32,#a0522d,#cd7f32);border:1px solid #a0522d;font-size:10px;font-weight:800;color:#fff;margin-left:5px;flex-shrink:0;white-space:nowrap;box-shadow:0 0 4px rgba(160,82,45,0.5)">🥉 BRONZE</span>',
  };
  return badges[tier] || "";
}

// Assign badge tier to newly registered users
async function assignBadgeTier(userId) {
  // Count existing users with badges (excluding platinum)
  const { count } = await sb.from("profiles")
    .select("*", { count: "exact", head: true })
    .not("badge_tier", "is", null)
    .neq("badge_tier", "platinum");
  const position = (count || 0) + 1;
  let tier = null;
  if (position <= 20) tier = "gold";
  else if (position <= 50) tier = "silver";
  else if (position <= 100) tier = "bronze";
  if (tier) {
    await sb.from("profiles").update({ badge_tier: tier }).eq("id", userId);
  }
  return tier;
}


// ── HELPERS ───────────────────────────────────────────────────────
function showToast(msg) {
  document.querySelector(".toast")?.remove();
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

function catEmoji(cat) {
  return { "Profile Pic": "📸", People: "🧑", Places: "📍", Animals: "🐾", Cars: "🚗", Food: "🍕", Fashion: "👗", Other: "⭐", NSFW: "🔞", Outfit: "👗", Pets: "🐾", Locations: "📍", Haircut: "✂️", "Pick-up Line": "💬" }[cat] || "⭐";
}

function timeAgo(ts) {
  const d = Math.floor((Date.now() - new Date(ts)) / 1000);
  if (d < 60) return "just now";
  if (d < 3600) return Math.floor(d / 60) + "m ago";
  if (d < 86400) return Math.floor(d / 3600) + "h ago";
  return Math.floor(d / 86400) + "d ago";
}

function initials(name) { return (name || "?").charAt(0).toUpperCase(); }

function esc(str) {
  return String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function uid() { return Date.now().toString(36) + Math.random().toString(36).substr(2, 8); }
