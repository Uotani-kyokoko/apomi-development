/**
 * apomi マッチングアプリ - フロントエンド
 */
(() => {
  "use strict";

  /** 最終ログインからこの分数以内ならオンライン表示 */
  const ONLINE_WITHIN_MINUTES = 30;
  /** 最新ページ：掲載日から何日以内 */
  const LATEST_WITHIN_DAYS = 7;
  /** 検索結果の初回表示件数・追加読み込み単位 */
  const SEARCH_RESULT_PAGE_SIZE = 50;
  /** 初回ログイン時のウェルカム文言（新規会員のみ） */
  const WELCOME_MESSAGES = [
    "アポイントメイトへようこそ！",
    "あなたのこと教えてください"
  ];
  const SPLASH_FADE_MS = 220;
  const SPLASH_HOLD_MS = 900;

  /** このセッションでウェルカムを出したら再表示しない */
  let welcomeSplashShown = false;

  const CONNECT_MENU = [
    { id: "latest", label: "最新ユーザー", type: "latest" },
    { id: "no-1", label: "No.1～No.100", type: "range", from: 1, to: 100 },
    { id: "no-2", label: "No.101～No.200", type: "range", from: 101, to: 200 },
    { id: "no-3", label: "No.201～No.300", type: "range", from: 201, to: 300 },
    { id: "pres-1", label: "社長 No.1～No.100", type: "president", from: 1, to: 100 },
    { id: "pres-2", label: "社長 No.101～No.200", type: "president", from: 101, to: 200 },
    { id: "pres-3", label: "社長 No.201～No.300", type: "president", from: 201, to: 300 },
    { id: "salon", label: "井口オンラインサロン", type: "salon" }
  ];

  const state = {
    isLoggedIn: false,
    activeTab: "home",
    users: [],
    allUsers: [],
    banners: [],
    masters: {},
    settings: {},
    regionLinkUrl: "https://www.google.com",
    salonUrl: "https://example.com/salon",
    salonLabel: "井口オンラインサロン",
    currentUser: null,
    identity: null,
    /** 未掲載時の必須プロフィール入力（初回 / 掲載停止） */
    editRequired: false,
    /** 繋がるページ（CONNECT_MENU の id。salon 以外） */
    connectPageId: "latest",
    filters: {
      industry: "all",
      gender: "all",
      jobTitle: "all",
      ageGroup: "all"
    },
    /** 検索結果の表示件数（もっと見る用） */
    searchVisibleCount: SEARCH_RESULT_PAGE_SIZE
  };

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  function normalizeGender(gender) {
    const g = (gender || "").trim();
    if (g === "男性" || g === "男" || g.toLowerCase() === "male" || g === "M") return "male";
    if (g === "女性" || g === "女" || g.toLowerCase() === "female" || g === "F") return "female";
    return "unknown";
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str ?? "";
    return div.innerHTML;
  }

  function formatMemberNo(id) {
    const digits = String(id || "").replace(/\D/g, "");
    if (!digits) return "No.00000";
    return `No.${digits.padStart(5, "0")}`;
  }

  function memberNoNum(id) {
    const n = parseInt(String(id || "").replace(/\D/g, ""), 10);
    return Number.isFinite(n) ? n : 0;
  }

  /** 会員No.の昇順（00001 → 00002 → …） */
  function sortUsersByMemberNo(users) {
    return (users || []).slice().sort((a, b) => memberNoNum(a.id) - memberNoNum(b.id));
  }

  function getConnectPage(pageId = state.connectPageId) {
    return CONNECT_MENU.find((p) => p.id === pageId) || CONNECT_MENU[0];
  }

  /** Driveの画像URLを img で表示できる形式に変換 */
  function normalizeAvatarUrl(url, name) {
    const raw = String(url || "").trim();
    const fallback = `https://ui-avatars.com/api/?name=${encodeURIComponent(name || "User")}&background=93c5fd&color=1e3a8a`;
    if (!raw) return fallback;

    const idMatch =
      raw.match(/[?&]id=([a-zA-Z0-9_-]+)/) ||
      raw.match(/\/d\/([a-zA-Z0-9_-]+)/) ||
      raw.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (idMatch) {
      return `https://drive.google.com/thumbnail?id=${idMatch[1]}&sz=w400`;
    }
    return raw;
  }

  function renderSns(user) {
    const snsItems = [
      { key: "line", icon: "fa-brands fa-line", cls: "sns-line", label: "LINE" },
      { key: "instagram", icon: "fa-brands fa-instagram", cls: "sns-instagram", label: "Instagram" },
      { key: "x", icon: "fa-brands fa-x-twitter", cls: "sns-x", label: "X" },
      { key: "youtube", icon: "fa-brands fa-youtube", cls: "sns-youtube", label: "YouTube" }
    ];

    return snsItems
      .map(({ key, icon, cls, label }) => {
        const url = user.sns?.[key];
        if (url) {
          return `<a href="${escapeHtml(url)}" class="sns-link ${cls}" target="_blank" rel="noopener noreferrer" aria-label="${label}"><i class="${icon}"></i></a>`;
        }
        return `<span class="sns-link ${cls} disabled" aria-hidden="true"><i class="${icon}"></i></span>`;
      })
      .join("");
  }

  function renderTags(tags) {
    if (!tags || !tags.length) return "";
    return `<div class="profile-tags">${tags
      .map((t) => `<span class="profile-tag">${escapeHtml(t)}</span>`)
      .join("")}</div>`;
  }

  function parseSheetDate(value) {
    const raw = String(value || "").trim();
    if (!raw) return null;
    // yyyy-MM-dd HH:mm:ss / yyyy/MM/dd HH:mm:ss（JST文字列をローカル解釈）
    const m = raw.match(
      /^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/
    );
    if (m) {
      const d = new Date(
        Number(m[1]),
        Number(m[2]) - 1,
        Number(m[3]),
        Number(m[4] || 0),
        Number(m[5] || 0),
        Number(m[6] || 0)
      );
      return Number.isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function formatLocalDateTime(d = new Date()) {
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  function isUserOnline(user) {
    const last = parseSheetDate(user?.lastLoginAt);
    if (!last) return false;
    const diffMs = Date.now() - last.getTime();
    return diffMs >= 0 && diffMs <= ONLINE_WITHIN_MINUTES * 60 * 1000;
  }

  /** 自分の最終ログインを画面上ですぐオンラインに反映 */
  function applyMyActivity(lastLoginAt) {
    const stamp = lastLoginAt || formatLocalDateTime();
    if (!state.currentUser) return;
    state.currentUser.lastLoginAt = stamp;
    state.currentUser.status = "オンライン";
    const idx = state.allUsers.findIndex((u) => u.id === state.currentUser.id);
    if (idx >= 0) {
      state.allUsers[idx] = {
        ...state.allUsers[idx],
        lastLoginAt: stamp,
        status: "オンライン"
      };
    }
    if (state.activeTab === "mypage") renderMyPage(state.currentUser);
    if (state.activeTab === "connect") refreshConnectList();
  }

  let touchTimer = null;
  let lastTouchAt = 0;
  const TOUCH_MIN_INTERVAL_MS = 60 * 1000; // 連打でGASを叩かない

  function scheduleTouchActivity(force = false) {
    if (!state.isLoggedIn || !state.identity) return;
    const now = Date.now();
    if (!force && now - lastTouchAt < TOUCH_MIN_INTERVAL_MS) {
      applyMyActivity(); // 画面上はオンライン維持
      return;
    }
    clearTimeout(touchTimer);
    touchTimer = setTimeout(async () => {
      try {
        const res = await GasAPI.touchActivity(state.identity);
        lastTouchAt = Date.now();
        applyMyActivity(res.data?.lastLoginAt);
      } catch (err) {
        console.warn("touchActivity failed", err);
        applyMyActivity();
      }
    }, force ? 0 : 300);
  }

  /* ---------- Profile Card（繋がる / マイページ共通） ---------- */
  function renderProfileCard(user) {
    const genderKey = normalizeGender(user.gender);
    const genderClass = genderKey === "female" ? "gender-female" : "gender-male";
    const online = isUserOnline(user);
    const statusClass = online ? "" : "offline";
    const statusText = online ? "オンライン" : "オフライン";
    const avatar = normalizeAvatarUrl(user.avatarUrl, user.name);

    return `
      <article class="profile-card ${genderClass}" data-user-id="${escapeHtml(user.id)}" data-gender="${genderKey}">
        <div class="profile-card-band">
          <span class="profile-card-no">${escapeHtml(formatMemberNo(user.id))}</span>
        </div>
        <div class="profile-card-body">
          <div class="profile-top-row">
            <img class="profile-avatar" src="${escapeHtml(avatar)}" alt="${escapeHtml(user.name)}" loading="lazy" onerror="this.onerror=null;this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(user.name || "User")}&background=93c5fd&color=1e3a8a';">
            <div class="profile-sns">${renderSns(user)}</div>
          </div>
          <h2 class="profile-name">${escapeHtml(user.name || "（名前未設定）")}</h2>
          <p class="profile-job-line">業種：${escapeHtml(user.industry || "-")}　職種：${escapeHtml(user.jobTitle || "-")}</p>
          <div class="profile-meta-row">
            <span><i class="fa-solid fa-location-dot"></i>${escapeHtml(user.location || "-")}</span>
            <span><i class="fa-solid fa-rotate"></i>${escapeHtml(user.ageGroup || "-")}</span>
            <span><span class="status-dot ${statusClass}"></span>${escapeHtml(statusText)}</span>
          </div>
          <div class="profile-section">
            <p class="profile-section-label">自己紹介</p>
            <div class="profile-section-box">${escapeHtml(user.bio || "未入力")}</div>
          </div>
          <div class="profile-section">
            <p class="profile-section-label">こんな人と繋がりたい</p>
            <div class="profile-section-box">${escapeHtml(user.wantMeet || "未入力")}</div>
          </div>
          <div class="profile-section">
            <p class="profile-section-label">こんな人とは繋がりたくない</p>
            <div class="profile-section-box">${escapeHtml(user.avoidMeet || "未入力")}</div>
          </div>
        </div>
      </article>
    `;
  }

  function renderBanners(banners) {
    const container = $("#banner-list");
    if (!banners.length) {
      container.innerHTML = `<div class="empty-state"><i class="fa-solid fa-image"></i><p>バナーがありません</p></div>`;
      return;
    }
    container.innerHTML = banners
      .map(
        (b) => `
        <a href="${escapeHtml(b.linkUrl)}" class="banner-card" target="_blank" rel="noopener noreferrer">
          <div class="banner-inner">
            <div class="banner-text">
              <h3>${escapeHtml(b.title)}</h3>
              <p>${escapeHtml(b.description)}</p>
            </div>
            <img class="banner-thumb" src="${escapeHtml(b.imageUrl)}" alt="">
          </div>
        </a>
      `
      )
      .join("");
  }

  function renderUserList(users) {
    const container = $("#user-list");
    const isSearch = hasActiveFilters();
    const totalMatched = (users || []).length;
    const displayUsers = isSearch ? users.slice(0, state.searchVisibleCount) : users;
    const remaining = totalMatched - displayUsers.length;

    if (!totalMatched) {
      const total = (state.allUsers || []).length;
      if (total > 0 && isSearch) {
        container.innerHTML = `
          <div class="empty-state">
            <i class="fa-solid fa-filter"></i>
            <p>条件に一致する人がいません</p>
            <p style="font-size:0.8rem;margin-top:6px;">登録 ${total} 人中 0 件</p>
            <button type="button" id="btn-clear-filters" class="btn-clear-filters">条件を解除して全員表示</button>
          </div>`;
        $("#btn-clear-filters")?.addEventListener("click", () => {
          resetFiltersUI();
          refreshConnectList();
          showToast("条件を解除しました");
        });
      } else {
        container.innerHTML = `<div class="empty-state"><i class="fa-solid fa-users"></i><p>該当するユーザーがいません</p></div>`;
      }
      updateConnectRangeLabel();
      return;
    }

    let html = displayUsers.map((u) => renderProfileCard(u)).join("");
    if (isSearch && remaining > 0) {
      html += `
        <div class="load-more-wrap">
          <p class="load-more-note">${displayUsers.length} / ${totalMatched} 件を表示中</p>
          <button type="button" id="btn-load-more" class="btn-load-more">
            さらに ${Math.min(SEARCH_RESULT_PAGE_SIZE, remaining)} 件表示（残り ${remaining} 件）
          </button>
        </div>`;
    }
    container.innerHTML = html;

    $("#btn-load-more")?.addEventListener("click", () => {
      state.searchVisibleCount += SEARCH_RESULT_PAGE_SIZE;
      renderUserList(state.users);
    });

    updateConnectRangeLabel();
  }

  function updateConnectRangeLabel() {
    const el = $("#header-range");
    if (!el) return;
    if (hasActiveFilters()) {
      const total = state.users.length;
      const shown = Math.min(state.searchVisibleCount, total);
      el.textContent = total > shown ? `検索結果 ${shown}/${total}件（No.順）` : `検索結果 ${total}件（No.順）`;
      return;
    }
    const page = getConnectPage();
    if (page.type === "latest") {
      el.textContent = `最新（${LATEST_WITHIN_DAYS}日以内）`;
      return;
    }
    if (page.type === "range" || page.type === "president") {
      const prefix = page.type === "president" ? "社長 " : "";
      el.textContent = `${prefix}${formatMemberNo(page.from)} ~ ${formatMemberNo(page.to)}`;
      return;
    }
    el.textContent = page.label;
  }

  function filterByConnectPage(users, page = getConnectPage()) {
    const list = users || [];
    if (page.type === "latest") {
      const cutoff = Date.now() - LATEST_WITHIN_DAYS * 24 * 60 * 60 * 1000;
      return list
        .filter((u) => {
          const d = parseSheetDate(u.publishedAt || u.createdAt);
          return d && d.getTime() >= cutoff;
        })
        .sort((a, b) => {
          const da = parseSheetDate(a.publishedAt || a.createdAt)?.getTime() || 0;
          const db = parseSheetDate(b.publishedAt || b.createdAt)?.getTime() || 0;
          return db - da;
        });
    }
    if (page.type === "range") {
      return list
        .filter((u) => {
          const n = memberNoNum(u.id);
          return n >= page.from && n <= page.to;
        })
        .sort((a, b) => memberNoNum(a.id) - memberNoNum(b.id));
    }
    if (page.type === "president") {
      // 会員番号帯のうち社長マークあり（番号の繰り上がりなし）
      return list
        .filter((u) => {
          if (!u.presidentMark) return false;
          const n = memberNoNum(u.id);
          return n >= page.from && n <= page.to;
        })
        .sort((a, b) => memberNoNum(a.id) - memberNoNum(b.id));
    }
    return list;
  }

  function refreshConnectList() {
    if (hasActiveFilters()) {
      // 検索時は No. 帯を無視し、全会員から条件一致 → No. 昇順で表示
      const matched = filterUsersLocal(state.allUsers, state.filters);
      state.users = sortUsersByMemberNo(matched);
    } else {
      state.searchVisibleCount = SEARCH_RESULT_PAGE_SIZE;
      state.users = filterUsersLocal(
        filterByConnectPage(state.allUsers, getConnectPage()),
        state.filters
      );
    }
    renderUserList(state.users);
    updateConnectFilterBanner();
    renderConnectMenu();
  }

  function openConnectMenu() {
    renderConnectMenu();
    $("#connect-menu")?.classList.remove("hidden");
    $("#connect-menu-overlay")?.classList.remove("hidden");
    $("#connect-menu-overlay")?.setAttribute("aria-hidden", "false");
  }

  function closeConnectMenu() {
    $("#connect-menu")?.classList.add("hidden");
    $("#connect-menu-overlay")?.classList.add("hidden");
    $("#connect-menu-overlay")?.setAttribute("aria-hidden", "true");
  }

  function renderConnectMenu() {
    const list = $("#connect-menu-list");
    if (!list) return;
    const salonLabel = state.salonLabel || "井口オンラインサロン";
    list.innerHTML = CONNECT_MENU.map((item) => {
      const label = item.type === "salon" ? salonLabel : item.label;
      const active = item.id === state.connectPageId && item.type !== "salon";
      const salonCls = item.type === "salon" ? " is-salon" : "";
      const activeCls = active ? " is-active" : "";
      return `<li><button type="button" class="connect-menu-item${activeCls}${salonCls}" data-page-id="${escapeHtml(item.id)}">${escapeHtml(label)}</button></li>`;
    }).join("");
  }

  function openSalonFromMenu() {
    const url = state.salonUrl || "https://example.com/salon";
    window.open(url, "_blank", "noopener,noreferrer");
    scheduleTouchActivity();
  }

  function selectConnectPage(pageId) {
    const page = getConnectPage(pageId);
    if (!page) return;
    if (page.type === "salon") {
      closeConnectMenu();
      openSalonFromMenu();
      return;
    }
    state.connectPageId = page.id;
    closeConnectMenu();
    refreshConnectList();
    showToast(page.label);
  }

  function renderMyPage(user) {
    const container = $("#mypage-profile");
    if (!user) {
      container.innerHTML = `<div class="empty-state"><p>プロフィールを読み込めませんでした</p></div>`;
      return;
    }
    container.innerHTML = renderProfileCard(user);
  }

  function updateHeader(tabId) {
    const header = $("#app-header");
    const title = $("#header-title");
    const range = $("#header-range");
    const menuBtn = $("#header-menu-btn");

    header.classList.toggle("is-connect", tabId === "connect");
    menuBtn.classList.toggle("hidden", tabId !== "connect");
    range.classList.toggle("hidden", tabId !== "connect");

    if (tabId === "home") {
      title.textContent = "apomi HOME";
      title.classList.remove("hidden");
    } else if (tabId === "mypage") {
      title.textContent = "マイページ";
      title.classList.remove("hidden");
    } else {
      title.classList.add("hidden");
    }
  }

  function switchTab(tabId) {
    state.activeTab = tabId;
    $$(".tab-panel").forEach((p) => p.classList.remove("active"));
    $(`#tab-${tabId}`)?.classList.add("active");
    $$(".nav-item").forEach((n) => n.classList.remove("active"));
    $(`.nav-item[data-tab="${tabId}"]`)?.classList.add("active");
    updateHeader(tabId);
    scheduleTouchActivity();

    // データが空ならタブ切替時に再取得
    if (
      (tabId === "connect" || tabId === "mypage" || tabId === "home") &&
      (!state.allUsers || state.allUsers.length === 0)
    ) {
      loadAllData();
    } else if (tabId === "connect") {
      refreshConnectList();
    } else if (tabId === "mypage") {
      renderMyPage(state.currentUser);
    } else if (tabId === "home") {
      renderBanners(state.banners);
    }
  }

  function showLoading(show) {
    const el = $("#loading-overlay");
    if (!el) return;
    el.classList.toggle("hidden", !show);
  }

  function showToast(message) {
    const toast = $("#toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 2500);
  }

  function openFilterScreen() {
    $("#filter-screen").classList.remove("hidden");
  }

  function closeFilterScreen() {
    $("#filter-screen").classList.add("hidden");
  }

  function uniqueOptions(options) {
    const seen = new Set();
    const out = [];
    (options || []).forEach((o) => {
      const value = String(o.value || "").trim();
      if (!value || seen.has(value)) return;
      seen.add(value);
      out.push({ value, label: o.label || value });
    });
    return out;
  }

  function fillSelect(selectId, options, selectedValue) {
    const el = $(selectId);
    if (!el) return;
    const current = selectedValue || el.value || "all";
    const opts = [{ value: "all", label: "すべて" }, ...uniqueOptions(options)];
    el.innerHTML = opts
      .map(
        (o) =>
          `<option value="${escapeHtml(o.value)}"${o.value === current ? " selected" : ""}>${escapeHtml(o.label || o.value)}</option>`
      )
      .join("");
  }

  function fillChips(containerId, options, selectedValue) {
    const el = $(containerId);
    if (!el) return;
    const current = selectedValue || "all";
    const opts = [{ value: "all", label: "すべて" }, ...uniqueOptions(options)];
    el.innerHTML = opts
      .map(
        (o) =>
          `<button type="button" class="chip${o.value === current ? " selected" : ""}" data-value="${escapeHtml(o.value)}">${escapeHtml(o.label || o.value)}</button>`
      )
      .join("");
  }

  function getSelectedChipValue(containerId) {
    const selected = $(`${containerId} .chip.selected`);
    return selected ? selected.dataset.value : "all";
  }

  function applyMastersToFilterUI() {
    const m = state.masters || {};
    fillChips("#filter-gender-chips", m["性別"], state.filters.gender);
    fillChips("#filter-age-chips", m["年代"], state.filters.ageGroup);
    fillSelect("#filter-industry", m["業種"], state.filters.industry);
    fillChips("#filter-job-chips", m["職種"], state.filters.jobTitle);

    const region = (m["地域リンク"] || [])[0];
    if (region) {
      state.regionLinkUrl = region.value || "https://www.google.com";
      const label = $("#region-link-label");
      if (label) label.textContent = region.label || "地域を絞る";
    }
  }

  function resetFiltersUI() {
    state.filters = {
      industry: "all",
      gender: "all",
      jobTitle: "all",
      ageGroup: "all"
    };
    const industry = $("#filter-industry");
    if (industry) industry.value = "all";
    applyMastersToFilterUI();
    $$(".filter-card").forEach((c) => c.classList.remove("open"));
  }

  function filterUsersLocal(users, filters = {}) {
    const gender = filters.gender || "all";
    const ageGroup = filters.ageGroup || "all";
    const industry = filters.industry || "all";
    const jobTitle = filters.jobTitle || "all";

    return (users || []).filter((u) => {
      if (gender !== "all" && String(u.gender || "").trim() !== gender) return false;
      if (ageGroup !== "all" && String(u.ageGroup || "").trim() !== ageGroup) return false;
      if (industry !== "all" && String(u.industry || "").trim() !== industry) return false;
      if (jobTitle !== "all" && String(u.jobTitle || "").trim() !== jobTitle) return false;
      return true;
    });
  }

  function hasActiveFilters(filters = state.filters) {
    return ["gender", "ageGroup", "industry", "jobTitle"].some(
      (k) => filters[k] && filters[k] !== "all"
    );
  }

  function updateConnectFilterBanner() {
    const el = $("#connect-filter-banner");
    if (!el) return;
    if (!hasActiveFilters()) {
      el.classList.add("hidden");
      el.textContent = "";
      return;
    }
    const parts = [];
    if (state.filters.gender !== "all") parts.push(state.filters.gender);
    if (state.filters.ageGroup !== "all") parts.push(state.filters.ageGroup);
    if (state.filters.industry !== "all") parts.push(state.filters.industry);
    if (state.filters.jobTitle !== "all") parts.push(state.filters.jobTitle);
    el.textContent = `絞り込み: ${parts.join(" / ")}（全 ${state.users.length} 件・No.順）`;
    el.classList.remove("hidden");
  }

  async function loadAllData() {
    showLoading(true);
    try {
      const identity = state.identity || {};
      const results = await Promise.allSettled([
        GasAPI.fetchBanners(),
        GasAPI.fetchUsers({}),
        identity.email || identity.memberNo
          ? GasAPI.fetchCurrentUser(identity)
          : Promise.reject(new Error('ログイン情報がありません')),
        GasAPI.fetchMasters(),
        GasAPI.fetchSettings()
      ]);

      const bannersRes = results[0].status === "fulfilled" ? results[0].value : null;
      const usersRes = results[1].status === "fulfilled" ? results[1].value : null;
      const meRes = results[2].status === "fulfilled" ? results[2].value : null;
      const mastersRes = results[3].status === "fulfilled" ? results[3].value : null;
      const settingsRes = results[4].status === "fulfilled" ? results[4].value : null;

      // GAS失敗時はモックにフォールバック（画面が空にならないようにする）
      if (!usersRes) {
        console.error("users failed", results[1].reason);
        const mockUsers = await MockAPI.fetchUsers({});
        state.allUsers = mockUsers.data || [];
        showToast("会員データの取得に失敗したため、一時データを表示しています");
      } else {
        state.allUsers = usersRes.data || [];
      }

      if (!bannersRes) {
        const mockBanners = await MockAPI.fetchBanners();
        state.banners = mockBanners.data || [];
      } else {
        state.banners = bannersRes.data || [];
      }

      if (!mastersRes) {
        const mockMasters = await MockAPI.fetchMasters();
        state.masters = mockMasters.data || {};
      } else {
        state.masters = mastersRes.data || {};
      }

      if (settingsRes?.data) {
        state.settings = settingsRes.data || {};
      } else {
        try {
          const mockSettings = await MockAPI.fetchSettings();
          state.settings = mockSettings.data || {};
        } catch {
          state.settings = {};
        }
      }
      state.salonUrl = String(state.settings["サロンURL"] || state.salonUrl || "").trim() || state.salonUrl;
      state.salonLabel =
        String(state.settings["サロンボタン名"] || state.salonLabel || "").trim() || state.salonLabel;
      const salonBtn = $("#btn-salon");
      if (salonBtn) salonBtn.textContent = state.salonLabel;

      if (meRes?.data) {
        const wasNew = Boolean(state.currentUser?.isNew);
        state.currentUser = meRes.data;
        // me API は isNew を返さないため、ログイン時の新規フラグを保持
        if (wasNew) state.currentUser.isNew = true;
        lastTouchAt = Date.now();
        applyMyActivity(meRes.data.lastLoginAt);
      } else if (!state.currentUser) {
        // 自分の取得に失敗しても、一覧からメール一致を探す
        const email = (identity.email || "").toLowerCase();
        const found = state.allUsers.find(
          (u) =>
            (email && String(u.email || "").toLowerCase() === email) ||
            (identity.memberNo && String(u.id) === String(identity.memberNo))
        );
        state.currentUser = found || null;
        if (!state.currentUser) {
          showToast("マイページ用プロフィールを取得できませんでした");
        }
      }

      applyMastersToFilterUI();
      renderBanners(state.banners);
      refreshConnectList();
      renderMyPage(state.currentUser);

      maybeOpenRequiredEdit();

      if (state.allUsers.length > 0) {
        console.log("[apomi] users loaded:", state.allUsers.length);
      }
    } catch (err) {
      console.error(err);
      showToast("データの読み込みに失敗しました: " + (err.message || ""));
      // 最後の手段: モック全表示
      try {
        const mockUsers = await MockAPI.fetchUsers({});
        const mockBanners = await MockAPI.fetchBanners();
        const mockMasters = await MockAPI.fetchMasters();
        state.allUsers = mockUsers.data || [];
        state.banners = mockBanners.data || [];
        state.masters = mockMasters.data || {};
        applyMastersToFilterUI();
        renderBanners(state.banners);
        refreshConnectList();
        renderMyPage(state.currentUser);
      } catch (e2) {
        console.error(e2);
      }
    } finally {
      showLoading(false);
    }
  }

  async function applyFilters() {
    showLoading(true);
    scheduleTouchActivity();
    state.searchVisibleCount = SEARCH_RESULT_PAGE_SIZE;
    try {
      // 最新の会員一覧を取得し、フロントでページ＋絞り込み
      const res = await GasAPI.fetchUsers({});
      state.allUsers = res.data || [];
      refreshConnectList();
      closeFilterScreen();
      switchTab("connect");
      if (state.users.length === 0) {
        showToast("条件に一致する人がいません");
      } else {
        showToast(`${state.users.length}件のユーザーが見つかりました`);
      }
    } catch (err) {
      console.error(err);
      showToast("検索に失敗しました");
    } finally {
      showLoading(false);
    }
  }

  const PREFECTURES = [
    "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県",
    "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県",
    "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県", "岐阜県",
    "静岡県", "愛知県", "三重県", "滋賀県", "京都府", "大阪府", "兵庫県",
    "奈良県", "和歌山県", "鳥取県", "島根県", "岡山県", "広島県", "山口県",
    "徳島県", "香川県", "愛媛県", "高知県", "福岡県", "佐賀県", "長崎県",
    "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県"
  ];

  function getPrefectureOptions() {
    const m = state.masters || {};
    const fromMaster = uniqueOptions(m["都道府県"] || m["現在地"] || []);
    if (fromMaster.length) return fromMaster;
    return PREFECTURES.map((p) => ({ value: p, label: p }));
  }

  function fillPrefectureSelect(selectId, selectedValue) {
    const el = $(selectId);
    if (!el) return;
    const opts = [{ value: "", label: "選択してください" }, ...getPrefectureOptions()];
    const current = selectedValue || "";
    el.innerHTML = opts
      .map(
        (o) =>
          `<option value="${escapeHtml(o.value)}"${o.value === current ? " selected" : ""}>${escapeHtml(o.label || o.value)}</option>`
      )
      .join("");
    if (current && !opts.some((o) => o.value === current)) {
      el.insertAdjacentHTML(
        "beforeend",
        `<option value="${escapeHtml(current)}" selected>${escapeHtml(current)}</option>`
      );
    }
  }

  function needsProfileSetup(user) {
    if (!user) return false;
    if (user.isNew) return true;
    if (user.isPublished === false) return true;
    return false;
  }

  function waitMs(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** テスト用: URL に ?splash=1 があれば強制表示 */
  function shouldForceSplash() {
    try {
      return new URLSearchParams(window.location.search).get("splash") === "1";
    } catch {
      return false;
    }
  }

  function shouldShowWelcomeSplash() {
    return shouldForceSplash() || Boolean(state.currentUser?.isNew);
  }

  /**
   * 初回ログイン直後のみウェルカムを表示。
   * 既存連携済み会員（isNew=false）は対象外。
   * 例外: ?splash=1 でテスト強制表示。
   */
  function playWelcomeSplash() {
    return new Promise((resolve) => {
      const screen = $("#splash-screen");
      const msgEl = $("#splash-message");
      if (!screen || !msgEl) {
        resolve();
        return;
      }

      let finished = false;
      let cancelWait = null;

      const finish = () => {
        if (finished) return;
        finished = true;
        if (typeof cancelWait === "function") cancelWait();
        screen.removeEventListener("click", onSkip);
        screen.removeEventListener("keydown", onKey);
        msgEl.classList.remove("is-visible");
        msgEl.textContent = "";
        screen.classList.add("hidden");
        screen.setAttribute("aria-hidden", "true");
        screen.removeAttribute("tabindex");
        resolve();
      };

      const onSkip = () => finish();
      const onKey = (e) => {
        if (e.key === "Enter" || e.key === " " || e.key === "Escape") {
          e.preventDefault();
          finish();
        }
      };

      const wait = (ms) =>
        new Promise((res) => {
          const t = setTimeout(res, ms);
          cancelWait = () => {
            clearTimeout(t);
            res();
          };
        });

      const run = async () => {
        welcomeSplashShown = true;
        screen.classList.remove("hidden");
        screen.setAttribute("aria-hidden", "false");
        screen.setAttribute("tabindex", "0");
        screen.addEventListener("click", onSkip);
        screen.addEventListener("keydown", onKey);
        try {
          screen.focus({ preventScroll: true });
        } catch {
          /* ignore */
        }

        for (const text of WELCOME_MESSAGES) {
          if (finished) return;
          msgEl.textContent = text;
          // 次フレームでフェード開始（空白待ちをほぼゼロに）
          await wait(16);
          if (finished) return;
          msgEl.classList.add("is-visible");
          await wait(SPLASH_FADE_MS + SPLASH_HOLD_MS);
          if (finished) return;
          msgEl.classList.remove("is-visible");
          await wait(SPLASH_FADE_MS);
        }
        finish();
      };

      run();
    });
  }

  async function showWelcomeSplashIfNeeded() {
    if (welcomeSplashShown) return;
    if (!shouldShowWelcomeSplash()) return;
    showLoading(false);
    await playWelcomeSplash();
  }

  async function maybeOpenRequiredEdit() {
    await showWelcomeSplashIfNeeded();
    if (!needsProfileSetup(state.currentUser)) return;
    openEditScreen({ required: true });
  }

  function openEditScreen(options = {}) {
    const user = state.currentUser;
    if (!user) {
      showToast("プロフィールを読み込めませんでした");
      return;
    }

    const required = Boolean(options.required) || needsProfileSetup(user);
    state.editRequired = required;

    const m = state.masters || {};
    fillChips("#edit-gender-chips", m["性別"], user.gender || "all");
    stripAllChip("#edit-gender-chips", user.gender);
    fillChips("#edit-age-chips", m["年代"], user.ageGroup || "all");
    stripAllChip("#edit-age-chips", user.ageGroup);
    fillChips("#edit-job-chips", m["職種"], user.jobTitle || "all");
    stripAllChip("#edit-job-chips", user.jobTitle);
    fillSelect("#edit-industry", m["業種"], user.industry || "all");
    const industryEl = $("#edit-industry");
    if (industryEl && industryEl.querySelector('option[value="all"]')) {
      industryEl.querySelector('option[value="all"]').remove();
      if (!user.industry) industryEl.selectedIndex = 0;
    }

    fillPrefectureSelect("#edit-location", user.location || "");
    fillPrefectureSelect("#edit-hometown", user.hometown || "");

    $("#edit-name").value = user.name || "";
    $("#edit-avatar").value = user.avatarUrl || "";
    $("#edit-bio").value = user.bio || "";
    $("#edit-want").value = user.wantMeet || "";
    $("#edit-avoid").value = user.avoidMeet || "";
    $("#edit-line").value = user.sns?.line || "";
    $("#edit-instagram").value = user.sns?.instagram || "";
    $("#edit-x").value = user.sns?.x || "";
    $("#edit-youtube").value = user.sns?.youtube || "";
    const status = $("#edit-avatar-status");
    if (status) status.textContent = "JPEG / PNG（自動で縮小して保存します）";
    updateEditAvatarPreview();

    const title = $(".edit-title");
    const saveBtn = $("#btn-save-profile");
    const backBtn = $("#edit-back");
    if (required) {
      if (title) title.textContent = user.isNew ? "プロフィール登録" : "掲載情報の確認・更新";
      if (saveBtn) {
        saveBtn.innerHTML = `<i class="fa-solid fa-check"></i> 保存して掲載する`;
      }
      if (backBtn) backBtn.setAttribute("aria-label", "あとで");
      showToast(user.isNew ? "初回登録です。プロフィールを入力してください" : "掲載停止中です。内容を確認して掲載してください");
    } else {
      if (title) title.textContent = "プロフィール変更";
      if (saveBtn) {
        saveBtn.innerHTML = `<i class="fa-solid fa-check"></i> 保存する`;
      }
      if (backBtn) backBtn.setAttribute("aria-label", "戻る");
    }

    $("#edit-screen").classList.remove("hidden");
  }

  function stripAllChip(containerId, selectedValue) {
    const el = $(containerId);
    if (!el) return;
    const allBtn = el.querySelector('.chip[data-value="all"]');
    if (allBtn) allBtn.remove();
    if (selectedValue) {
      const match = el.querySelector(`.chip[data-value="${CSS.escape(selectedValue)}"]`);
      if (match) {
        el.querySelectorAll(".chip").forEach((c) => c.classList.remove("selected"));
        match.classList.add("selected");
      } else if (el.querySelector(".chip")) {
        el.querySelectorAll(".chip").forEach((c) => c.classList.remove("selected"));
        el.querySelector(".chip").classList.add("selected");
      }
    } else if (el.querySelector(".chip") && !el.querySelector(".chip.selected")) {
      el.querySelector(".chip").classList.add("selected");
    }
  }

  function closeEditScreen(force = false) {
    if (!force && state.editRequired) {
      if (
        !confirm(
          "プロフィールを保存するまで掲載されません。あとで入力しますか？"
        )
      ) {
        return;
      }
      showToast("掲載は停止のままです。マイページからいつでも入力できます");
    }
    state.editRequired = false;
    $("#edit-screen").classList.add("hidden");
  }

  function updateEditAvatarPreview() {
    const url = ($("#edit-avatar").value || "").trim();
    const img = $("#edit-avatar-preview");
    if (!img) return;
    img.onerror = () => {
      img.onerror = null;
      img.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(state.currentUser?.name || "User")}&background=93c5fd&color=1e3a8a`;
    };
    img.src = normalizeAvatarUrl(url, state.currentUser?.name || "User");
  }

  function collectEditForm() {
    return {
      name: ($("#edit-name").value || "").trim(),
      gender: getSelectedChipValue("#edit-gender-chips"),
      ageGroup: getSelectedChipValue("#edit-age-chips"),
      industry: $("#edit-industry").value || "",
      jobTitle: getSelectedChipValue("#edit-job-chips"),
      location: ($("#edit-location").value || "").trim(),
      hometown: ($("#edit-hometown").value || "").trim(),
      avatarUrl: ($("#edit-avatar").value || "").trim(),
      bio: ($("#edit-bio").value || "").trim(),
      wantMeet: ($("#edit-want").value || "").trim(),
      avoidMeet: ($("#edit-avoid").value || "").trim(),
      sns: {
        line: ($("#edit-line").value || "").trim(),
        instagram: ($("#edit-instagram").value || "").trim(),
        x: ($("#edit-x").value || "").trim(),
        youtube: ($("#edit-youtube").value || "").trim()
      }
    };
  }

  function compressImageFile(file, maxSize = 240, quality = 0.55) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("画像の読み込みに失敗しました"));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error("画像形式を読み取れませんでした"));
        img.onload = () => {
          const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);

          // 目標 約25KB以下になるまで品質を下げる
          let q = quality;
          let dataUrl = canvas.toDataURL("image/jpeg", q);
          let base64 = dataUrl.split(",")[1] || "";
          while (base64.length > 35000 && q > 0.35) {
            q -= 0.08;
            dataUrl = canvas.toDataURL("image/jpeg", q);
            base64 = dataUrl.split(",")[1] || "";
          }
          resolve({ dataUrl, base64, mimeType: "image/jpeg" });
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  async function handleAvatarFileChange(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      showToast("画像ファイルを選んでください");
      return;
    }
    const status = $("#edit-avatar-status");
    try {
      showLoading(true);
      if (status) status.textContent = "画像を処理中…";
      const compressed = await compressImageFile(file);
      if (status) status.textContent = "アップロード中…";

      const res = await GasAPI.uploadAvatar({
        memberNo: state.identity?.memberNo || state.currentUser?.id || "",
        email: state.identity?.email || state.currentUser?.email || "",
        imageBase64: compressed.base64,
        mimeType: compressed.mimeType
      });

      const url = res.data?.avatarUrl || compressed.dataUrl;
      $("#edit-avatar").value = url;
      updateEditAvatarPreview();
      if (state.currentUser) state.currentUser.avatarUrl = url;
      applyMyActivity(res.data?.lastLoginAt);
      if (status) status.textContent = "アップロード完了。保存するを押すとプロフィール全体が確定します。";
      showToast("画像をアップロードしました");
    } catch (err) {
      console.error(err);
      if (status) status.textContent = "アップロードに失敗しました。GASの再デプロイとDrive権限を確認してください。";
      showToast(err.message || "画像アップロードに失敗しました");
    } finally {
      showLoading(false);
      e.target.value = "";
    }
  }

  async function saveProfile(e) {
    e.preventDefault();
    const profile = collectEditForm();
    if (!profile.name) {
      showToast("名前を入力してください");
      return;
    }
    if (!profile.gender || profile.gender === "all") {
      showToast("性別を選択してください");
      return;
    }
    if (!profile.location) {
      showToast("現在地を選択してください");
      return;
    }

    const shouldPublish = state.editRequired || state.currentUser?.isPublished === false;

    showLoading(true);
    try {
      const res = await GasAPI.updateProfile({
        memberNo: state.identity?.memberNo || state.currentUser?.id || "",
        email: state.identity?.email || state.currentUser?.email || "",
        profile
      });
      state.currentUser = res.data || { ...state.currentUser, ...profile };
      applyMyActivity(state.currentUser.lastLoginAt);

      if (shouldPublish) {
        const pub = await GasAPI.resumeListing({
          memberNo: state.identity?.memberNo || state.currentUser?.id || "",
          email: state.identity?.email || state.currentUser?.email || ""
        });
        state.currentUser.isPublished = pub.data?.isPublished !== false;
        state.currentUser.isNew = false;
        applyMyActivity(pub.data?.lastLoginAt || state.currentUser.lastLoginAt);
      }

      const idx = state.allUsers.findIndex((u) => u.id === state.currentUser.id);
      if (idx >= 0) state.allUsers[idx] = { ...state.currentUser };
      refreshConnectList();
      renderMyPage(state.currentUser);
      Session.save({
        email: state.identity?.email || state.currentUser.email || "",
        memberNo: state.currentUser.id || "",
        name: state.currentUser.name || ""
      });
      state.editRequired = false;
      $("#edit-screen").classList.add("hidden");
      showToast(shouldPublish ? "保存して掲載を開始しました" : "プロフィールを保存しました");
    } catch (err) {
      console.error(err);
      showToast(err.message || "保存に失敗しました");
    } finally {
      showLoading(false);
    }
  }

  function showLogin() {
    state.isLoggedIn = false;
    state.identity = null;
    state.editRequired = false;
    closeConnectMenu();
    $("#login-screen").classList.remove("hidden");
    $("#app-screen").classList.add("hidden");
    closeFilterScreen();
    closeEditScreen(true);
    setupGoogleButton();
  }

  function showApp() {
    state.isLoggedIn = true;
    $("#login-screen").classList.add("hidden");
    $("#app-screen").classList.remove("hidden");
    switchTab("home");
    // テスト用 ?splash=1 はデータ読み込みを待たずすぐ出す
    if (shouldForceSplash()) {
      showWelcomeSplashIfNeeded().finally(() => {
        loadAllData();
      });
      return;
    }
    loadAllData();
  }

  async function completeLoginWithIdToken(idToken) {
    showLoading(true);
    try {
      const loginRes = await GasAPI.loginWithGoogle({ idToken });
      const user = loginRes.data;
      state.identity = {
        email: user.email,
        memberNo: user.id
      };
      state.currentUser = user;
      Session.save({
        email: user.email,
        memberNo: user.id,
        name: user.name
      });
      showToast("ログインしました");
      applyMyActivity(user.lastLoginAt);
      lastTouchAt = Date.now();
      showApp();
    } catch (err) {
      console.error(err);
      showToast(err.message || "ログインに失敗しました");
      showLoading(false);
    }
  }

  function setupGoogleButton() {
    const hint = $("#login-hint");
    try {
      if (!(AppConfig.GOOGLE_CLIENT_ID || "").trim()) {
        hint.textContent =
          "js/config.js の GOOGLE_CLIENT_ID を設定してください。Google Cloud で OAuth クライアント（ウェブ）を作成し、生成元に http://localhost:3000 を追加します。";
        hint.classList.remove("hidden");
        $("#google-btn-host").innerHTML = "";
        return;
      }
      hint.classList.add("hidden");

      const start = () => {
        GoogleAuth.init({
          onCredential: (err, idToken) => {
            if (err) {
              showToast(err.message || "認証に失敗しました");
              return;
            }
            completeLoginWithIdToken(idToken);
          }
        });
      };

      if (window.google?.accounts?.id) {
        start();
      } else {
        let tries = 0;
        const timer = setInterval(() => {
          tries += 1;
          if (window.google?.accounts?.id) {
            clearInterval(timer);
            start();
          } else if (tries > 50) {
            clearInterval(timer);
            hint.textContent = "Googleログインの読み込みに失敗しました。ページを再読み込みしてください。";
            hint.classList.remove("hidden");
          }
        }, 100);
      }
    } catch (err) {
      console.error(err);
      hint.textContent = err.message || "Googleログインを初期化できませんでした";
      hint.classList.remove("hidden");
    }
  }

  function tryRestoreSession() {
    const saved = Session.load();
    if (!saved?.email && !saved?.memberNo) {
      showLogin();
      return;
    }
    state.identity = {
      email: saved.email || "",
      memberNo: saved.memberNo || ""
    };
    showToast("ようこそ、" + (saved.name || "会員") + "さん");
    showApp();
  }

  function bindEvents() {
    $$(".nav-item").forEach((item) => {
      item.addEventListener("click", () => switchTab(item.dataset.tab));
    });

    $("#search-open-btn").addEventListener("click", () => {
      scheduleTouchActivity();
      openFilterScreen();
    });
    $("#filter-back").addEventListener("click", closeFilterScreen);

    $$(".filter-card-toggle").forEach((btn) => {
      btn.addEventListener("click", () => {
        const card = btn.closest(".filter-card");
        const willOpen = !card.classList.contains("open");
        $$(".filter-card").forEach((c) => c.classList.remove("open"));
        if (willOpen) card.classList.add("open");
      });
    });

    ["#filter-gender-chips", "#filter-age-chips", "#filter-job-chips"].forEach((id) => {
      $(id)?.addEventListener("click", (e) => {
        const chip = e.target.closest(".chip");
        if (!chip) return;
        const grid = chip.parentElement;
        grid.querySelectorAll(".chip").forEach((c) => c.classList.remove("selected"));
        chip.classList.add("selected");
      });
    });

    $("#btn-region-link").addEventListener("click", () => {
      const url = state.regionLinkUrl || "https://www.google.com";
      window.open(url, "_blank", "noopener,noreferrer");
    });

    $("#btn-search").addEventListener("click", () => {
      state.filters = {
        gender: getSelectedChipValue("#filter-gender-chips"),
        ageGroup: getSelectedChipValue("#filter-age-chips"),
        industry: $("#filter-industry").value || "all",
        jobTitle: getSelectedChipValue("#filter-job-chips")
      };
      applyFilters();
    });

    $("#btn-reset").addEventListener("click", () => {
      resetFiltersUI();
      scheduleTouchActivity();
      refreshConnectList();
      showToast("条件をリセットしました");
    });

    $("#header-menu-btn")?.addEventListener("click", () => {
      scheduleTouchActivity();
      openConnectMenu();
    });
    $("#connect-menu-close")?.addEventListener("click", closeConnectMenu);
    $("#connect-menu-overlay")?.addEventListener("click", closeConnectMenu);
    $("#connect-menu-list")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-page-id]");
      if (!btn) return;
      selectConnectPage(btn.dataset.pageId);
    });

    $("#btn-edit-profile").addEventListener("click", () => {
      scheduleTouchActivity();
      openEditScreen();
    });
    $("#edit-back").addEventListener("click", closeEditScreen);
    $("#edit-form").addEventListener("submit", saveProfile);
    $("#edit-avatar-file")?.addEventListener("change", handleAvatarFileChange);

    ["#edit-gender-chips", "#edit-age-chips", "#edit-job-chips"].forEach((id) => {
      $(id)?.addEventListener("click", (e) => {
        const chip = e.target.closest(".chip");
        if (!chip) return;
        const grid = chip.parentElement;
        grid.querySelectorAll(".chip").forEach((c) => c.classList.remove("selected"));
        chip.classList.add("selected");
      });
    });

    $("#btn-salon").addEventListener("click", () => {
      openSalonFromMenu();
    });
    $("#btn-president-badge").addEventListener("click", async () => {
      try {
        showLoading(true);
        const res = await GasAPI.requestPresidentMark(state.identity || {});
        applyMyActivity(res.data?.lastLoginAt);
        showToast("社長マーク掲載依頼を受け付けました");
      } catch (err) {
        console.error(err);
        showToast(err.message || "依頼に失敗しました");
      } finally {
        showLoading(false);
      }
    });
    $("#btn-stop-listing").addEventListener("click", async () => {
      if (!confirm("掲載を停止しますか？")) return;
      try {
        showLoading(true);
        const res = await GasAPI.stopListing(state.identity || {});
        if (state.currentUser) {
          state.currentUser.isPublished = false;
        }
        applyMyActivity(res.data?.lastLoginAt);
        showToast("掲載を停止しました。再開するにはプロフィールを保存してください");
        openEditScreen({ required: true });
      } catch (err) {
        console.error(err);
        showToast(err.message || "掲載停止に失敗しました");
      } finally {
        showLoading(false);
      }
    });

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && state.isLoggedIn) {
        scheduleTouchActivity();
      }
    });

    $("#btn-logout").addEventListener("click", () => {
      Session.clear();
      if (window.google?.accounts?.id) {
        google.accounts.id.disableAutoSelect();
      }
      showToast("ログアウトしました");
      showLogin();
    });
  }

  async function init() {
    bindEvents();
    // テスト用 ?splash=1 はログイン前後どちらでもすぐ見えるようにする
    if (shouldForceSplash()) {
      await showWelcomeSplashIfNeeded();
    }
    tryRestoreSession();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
