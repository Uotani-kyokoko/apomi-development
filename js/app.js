/**
 * apomy / みんつく マッチングアプリ - フロントエンド（共通UI）
 * - Apomy固有: 全国一覧・地域リンク導線
 * - みんつく固有: 地方絞り込み・みんつく名表示（app-mode.js）
 */
(() => {
  "use strict";

  /** 最新ページ：登録日から何日以内 */
  const LATEST_WITHIN_DAYS = 30;
  /** 検索結果の初回表示件数・追加読み込み単位 */
  const SEARCH_RESULT_PAGE_SIZE = 50;
  /** 初回ログイン時のウェルカム文言（新規会員のみ）[Apomy] */
  const WELCOME_MESSAGES = [
    "アポイントメイトへようこそ！",
    "あなたのこと教えてください"
  ];
  const SPLASH_FADE_MS = 220;
  const SPLASH_HOLD_MS = 900;

  /** このセッションでウェルカムを出したら再表示しない */
  let welcomeSplashShown = false;
  /** ログイン直後は me/touch を1回スキップ（シート二重書き込み・タイムアウト対策） */
  let skipMeTouchOnce = false;
  /** 会員一覧のセッションキャッシュ（繋がる表示時のみ取得） */
  const USERS_CACHE_KEY = "apomy_users_cache_v1";
  const USERS_CACHE_TTL_MS = 5 * 60 * 1000;
  let usersLoadedAt = 0;
  let usersCacheKey = "";
  let usersFetchPromise = null;

  /** 繋がるページの会員番号帯（1ページあたり） */
  const CONNECT_BAND_SIZE = 100;

  const bootMode =
    typeof AppMode !== "undefined" && AppMode.detect
      ? AppMode.detect()
      : { app: "apomy", region: "" };

  const state = {
    isLoggedIn: false,
    activeTab: "home",
    /** apomy | mintuku | president */
    appKind:
      bootMode.app === "mintuku"
        ? "mintuku"
        : bootMode.app === "president"
          ? "president"
          : "apomy",
    /** みんつく地方ID（例: kanto）。Apomy時は空 */
    mintukuRegion: bootMode.app === "mintuku" ? bootMode.region || "" : "",
    users: [],
    allUsers: [],
    banners: [],
    masters: {},
    settings: {},
    regionLinkUrl: "https://www.google.com",
    regionLinks: [],
    salonUrl: "https://example.com/salon",
    salonLabel: "井口智明オンラインサロン",
    currentUser: null,
    identity: null,
    /** 未掲載時の必須プロフィール入力（初回 / 掲載停止） */
    editRequired: false,
    /** 繋がるページ id（latest / no-N / pres-N / salon） */
    connectPageId: "latest",
    filters: {
      industry: [],
      gender: "all",
      jobTitle: [],
      ageGroup: [],
      tags: [],
      /** [みんつく] 都道府県絞り込み（all | 東京都 …） */
      locationPref: "all"
    },
    /** 検索結果の表示件数（もっと見る用） */
    searchVisibleCount: SEARCH_RESULT_PAGE_SIZE,
    /** ホームダッシュボード集計 */
    dashboard: null
  };

  function isMintukuMode() {
    return state.appKind === "mintuku";
  }

  function isPresidentMode() {
    return state.appKind === "president";
  }

  /** [プレジデント] 空欄・TRUE＝掲載、FALSEのみ非表示 */
  function isPresidentMateListed(user) {
    if (!user) return false;
    if (user.presidentMateListed === false) return false;
    if (user.presidentMateListed === true) return true;
    const raw = user.presidentMateListed;
    if (raw === "" || raw === null || raw === undefined) return true;
    return Boolean(raw);
  }

  function mintukuDisplayName() {
    if (typeof AppMode === "undefined") return "みんつく";
    return AppMode.displayName(state.mintukuRegion);
  }

  /** [みんつく] GAS / ローカル両方で使う一覧取得パラメータ */
  function usersFetchParams(extra = {}) {
    const params = { ...extra };
    if (isMintukuMode() && state.mintukuRegion) {
      params.app = "mintuku";
      params.region = state.mintukuRegion;
    }
    if (isPresidentMode()) {
      params.app = "president";
    }
    // 性別・業種などの詳細絞り込みはフロント側（一覧は掲載／地方だけサーバで絞る）
    return params;
  }

  /** [みんつく] 地方外の会員を落とす（画面側の二重チェック） */
  function applyMintukuScope(users) {
    if (!isMintukuMode() || !state.mintukuRegion) return users || [];
    if (typeof AppMode === "undefined") return users || [];
    return (users || []).filter((u) =>
      AppMode.isPrefectureInRegion(u.location, state.mintukuRegion)
    );
  }

  function applyMintukuChrome() {
    applyAppChrome();
  }

  function applyAppChrome() {
    const brandApomy = document.getElementById("login-brand-apomy");
    const brandMintuku = document.getElementById("login-brand-mintuku");
    const brandPresident = document.getElementById("login-brand-president");
    const manifestLink = document.querySelector('link[rel="manifest"]');
    const appleIcon = document.querySelector('link[rel="apple-touch-icon"]');
    const favicons = document.querySelectorAll('link[rel="icon"]');
    const prefFilter = document.getElementById("mintuku-pref-filter");
    const regionBtn = document.getElementById("btn-region-link");
    const presidentBtn = document.getElementById("btn-president-mate-link");
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    const appleTitle = document.querySelector('meta[name="apple-mobile-web-app-title"]');

    brandApomy?.classList.add("hidden");
    brandMintuku?.classList.add("hidden");
    brandPresident?.classList.add("hidden");

    document.body.classList.toggle("app-president", isPresidentMode());
    document.body.classList.toggle("app-mintuku", isMintukuMode());

    if (isPresidentMode()) {
      document.title = "プレジデントメイト";
      if (appleTitle) appleTitle.setAttribute("content", "PRESIDENT MATE");
      if (themeMeta) themeMeta.setAttribute("content", "#ffffff");
      document.documentElement.style.setProperty("--theme-color", "#ffffff");
      brandPresident?.classList.remove("hidden");
      if (manifestLink) {
        manifestLink.setAttribute("href", "president/manifest.webmanifest?v=20260814f");
      }
      if (appleIcon) appleIcon.setAttribute("href", "president/icons/apple-touch-icon.png");
      favicons.forEach((link) => {
        const sizes = link.getAttribute("sizes") || "";
        if (sizes.indexOf("512") >= 0) {
          link.setAttribute("href", "president/icons/icon-512.png");
        } else {
          link.setAttribute("href", "president/icons/icon-192.png");
        }
      });
      regionBtn?.classList.add("hidden");
      presidentBtn?.classList.add("hidden");
      prefFilter?.classList.add("hidden");
      return;
    }

    if (!isMintukuMode()) {
      brandApomy?.classList.remove("hidden");
      document.documentElement.style.setProperty("--theme-color", "#5B6CFF");
      prefFilter?.classList.add("hidden");
      regionBtn?.classList.remove("hidden");
      presidentBtn?.classList.remove("hidden");
      return;
    }

    const name = mintukuDisplayName();
    document.title = name;
    if (appleTitle) appleTitle.setAttribute("content", name);
    if (themeMeta) themeMeta.setAttribute("content", "#111111");
    brandMintuku?.classList.remove("hidden");

    if (manifestLink && state.mintukuRegion) {
      manifestLink.setAttribute(
        "href",
        `mintuku/manifest-${state.mintukuRegion}.webmanifest?v=20260813a`
      );
    }
    if (appleIcon) appleIcon.setAttribute("href", "mintuku/icons/apple-touch-icon.png");
    favicons.forEach((link) => {
      const sizes = link.getAttribute("sizes") || "";
      if (sizes.indexOf("512") >= 0) {
        link.setAttribute("href", "mintuku/icons/icon-512.png");
      } else {
        link.setAttribute("href", "mintuku/icons/icon-192.png");
      }
    });

    regionBtn?.classList.add("hidden");
    presidentBtn?.classList.add("hidden");
    prefFilter?.classList.remove("hidden");
  }

  function identityForApi(extra = {}) {
    const base = { ...(state.identity || {}), ...extra };
    if (isMintukuMode() && state.mintukuRegion) {
      base.app = "mintuku";
      base.region = state.mintukuRegion;
    }
    if (isPresidentMode()) {
      base.app = "president";
    }
    return base;
  }

  function mintukuRegionLabel() {
    if (typeof AppMode === "undefined") return "";
    const meta = AppMode.getRegionMeta(state.mintukuRegion);
    return meta ? meta.label : "";
  }

  function parseMintukuNumber(raw) {
    const s = String(raw || "").trim();
    const m = s.match(/^(.+?)(\d+)$/);
    if (!m) return null;
    return { label: m[1], n: Number(m[2]) };
  }

  function parsePresidentNumber(raw) {
    const s = String(raw || "").trim();
    const m = s.match(/^社長(\d+)$/);
    if (!m) return null;
    return { n: Number(m[1]) };
  }

  /** みんつく: みんつく番号 / プレジデント: プレジデント番号 / Apomy: 会員番号 */
  function userMemberSortKey(user) {
    if (isMintukuMode()) {
      const parsed = parseMintukuNumber(user?.mintukuNumber);
      const label = mintukuRegionLabel();
      if (parsed && parsed.label === label && parsed.n > 0) return parsed.n;
      return Number.MAX_SAFE_INTEGER;
    }
    if (isPresidentMode()) {
      const parsed = parsePresidentNumber(user?.presidentNumber);
      if (parsed && parsed.n > 0) return parsed.n;
      return Number.MAX_SAFE_INTEGER;
    }
    return memberNoNum(user?.id);
  }

  function formatMemberNo(idOrNum) {
    const digits = String(idOrNum || "").replace(/\D/g, "");
    if (!digits) return "No.00000";
    return `No.${digits.padStart(5, "0")}`;
  }

  /** カード表示用 */
  function formatUserMemberNo(user) {
    if (isMintukuMode()) {
      const parsed = parseMintukuNumber(user?.mintukuNumber);
      const label = mintukuRegionLabel();
      if (!parsed || parsed.label !== label || !parsed.n) return "No.-----";
      return `No.${String(parsed.n).padStart(5, "0")}`;
    }
    if (isPresidentMode()) {
      const parsed = parsePresidentNumber(user?.presidentNumber);
      if (!parsed || !parsed.n) return "No.-----";
      return `No.${String(parsed.n).padStart(5, "0")}`;
    }
    return formatMemberNo(user?.id);
  }

  function memberNoNum(id) {
    const n = parseInt(String(id || "").replace(/\D/g, ""), 10);
    return Number.isFinite(n) ? n : 0;
  }

  /** 会員No.の昇順（00001 → 00002 → …） */
  function sortUsersByMemberNo(users) {
    return (users || []).slice().sort((a, b) => userMemberSortKey(a) - userMemberSortKey(b));
  }

  function maxMemberNoAmong(users) {
    let max = 0;
    (users || []).forEach((u) => {
      const n = userMemberSortKey(u);
      if (n < Number.MAX_SAFE_INTEGER && n > max) max = n;
    });
    return max;
  }

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  /** 掲載SNS: 個人LINE必須 + その他最大3件 */
  const SNS_OTHER_MAX = 3;
  const SNS_MAX = 1 + SNS_OTHER_MAX;
  const SNS_PRIORITY = [
    "line",
    "instagram",
    "facebook",
    "x",
    "youtube",
    "home",
    "litlink",
    "canva",
    "ameblo"
  ];
  const SNS_META = {
    instagram: { label: "Instagram", icon: "fa-brands fa-instagram", cls: "sns-instagram" },
    facebook: { label: "Facebook", icon: "fa-brands fa-facebook-f", cls: "sns-facebook" },
    x: { label: "X", icon: "fa-brands fa-x-twitter", cls: "sns-x" },
    line: { label: "LINE", icon: "fa-brands fa-line", cls: "sns-line" },
    youtube: { label: "YouTube", icon: "fa-brands fa-youtube", cls: "sns-youtube" },
    home: { label: "ホーム", icon: "fa-solid fa-globe", cls: "sns-home" },
    litlink: { label: "lit.link", icon: "fa-solid fa-link", cls: "sns-litlink" },
    canva: { label: "Canva", icon: "fa-solid fa-palette", cls: "sns-canva" },
    ameblo: { label: "アメブロ", icon: "fa-solid fa-blog", cls: "sns-ameblo" }
  };

  /** 編集画面: その他SNS入力（URL配列。LINEは別欄） */
  let editSnsUrls = [];
  const TAG_MAX = 6;
  const BIO_MAX = 150;
  const WANT_MEET_MAX = 50;
  const AVOID_MEET_MAX = 50;
  /** ネストした showLoading 用 */
  let loadingDepth = 0;

  /** 自己紹介系: 改行を除去（空白にはしない） */
  function stripProfileNewlines(text) {
    return String(text || "").replace(/[\r\n\u2028\u2029]+/g, "");
  }

  function updateProfileTextCounts() {
    const fields = [
      { id: "#edit-bio", countId: "#edit-bio-count", max: BIO_MAX },
      { id: "#edit-want", countId: "#edit-want-count", max: WANT_MEET_MAX },
      { id: "#edit-avoid", countId: "#edit-avoid-count", max: AVOID_MEET_MAX }
    ];
    fields.forEach(({ id, countId, max }) => {
      const el = $(id);
      const note = $(countId);
      if (!el || !note) return;
      const len = stripProfileNewlines(el.value).length;
      note.textContent = `${len} / ${max}`;
      note.classList.toggle("is-over", len > max);
    });
  }

  function sanitizeProfileTextarea(el, options = {}) {
    if (!el) return "";
    const notifyNewline = Boolean(options.notifyNewline);
    const truncateOver = Boolean(options.truncateOver);
    const before = el.value;
    let next = stripProfileNewlines(before);
    const hadNewline = next !== before;
    const max = Number(el.getAttribute("maxlength") || 0);
    let truncated = false;
    // 貼り付けなど新規に溢れた分だけ切る。既存の超過文は保存時トーストで止める
    if (truncateOver && max > 0 && next.length > max) {
      next = next.slice(0, max);
      truncated = true;
    }
    if (next !== before) {
      const start = el.selectionStart;
      el.value = next;
      if (typeof start === "number") {
        const pos = Math.min(start, next.length);
        try {
          el.setSelectionRange(pos, pos);
        } catch {
          /* ignore */
        }
      }
    }
    if (notifyNewline && hadNewline) {
      showToast("改行は入力できません");
    } else if (truncated && max > 0) {
      showToast(`${max}文字以内で入力してください`);
    }
    updateProfileTextCounts();
    return next;
  }

  function bindProfileTextLimits() {
    ["#edit-bio", "#edit-want", "#edit-avoid"].forEach((id) => {
      const el = $(id);
      if (!el || el.dataset.limitBound === "1") return;
      el.dataset.limitBound = "1";
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          showToast("改行は入力できません");
        }
      });
      el.addEventListener("input", () => sanitizeProfileTextarea(el));
      el.addEventListener("paste", () => {
        requestAnimationFrame(() =>
          sanitizeProfileTextarea(el, { notifyNewline: true, truncateOver: true })
        );
      });
    });
  }

  function normalizeGender(gender) {
    const g = (gender || "").trim();
    if (g === "男性" || g === "男" || g.toLowerCase() === "male" || g === "M") return "male";
    if (g === "女性" || g === "女" || g.toLowerCase() === "female" || g === "F") return "female";
    // マスタ例: その他 / その他(LGBTQ) / LGBTQ など
    if (
      g === "その他" ||
      g.includes("LGBTQ") ||
      g.includes("LGBT") ||
      g.toLowerCase().includes("other")
    ) {
      return "other";
    }
    return "unknown";
  }

  /** 性別マスタの「その他」系を LGBTQ に揃える */
  function canonicalGenderLabel(value) {
    const g = String(value || "").trim();
    if (!g) return g;
    if (g === "その他" || g === "その他(LGBTQ)" || g.includes("LGBT")) return "LGBTQ";
    return g;
  }

  function mapGenderMasterOptions(options) {
    return uniqueOptions(options || []).map((o) => {
      const value = canonicalGenderLabel(o.value);
      return { value, label: value };
    });
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str ?? "";
    return div.innerHTML;
  }

  /**
   * 条件に合う会員がいる No.帯だけ返す（空帯は出さない）
   */
  function occupiedBands(users, predicate) {
    const matched = (users || []).filter(predicate);
    if (!matched.length) return [];
    const maxNo = maxMemberNoAmong(matched);
    const bandCount = Math.max(1, Math.ceil(maxNo / CONNECT_BAND_SIZE));
    const bands = [];
    for (let i = 0; i < bandCount; i++) {
      const from = i * CONNECT_BAND_SIZE + 1;
      const to = (i + 1) * CONNECT_BAND_SIZE;
      const has = matched.some((u) => {
        const n = userMemberSortKey(u);
        return n >= from && n <= to;
      });
      if (!has) continue;
      bands.push({ index: i + 1, from, to });
    }
    return bands;
  }

  /**
   * 通常会員: 最大No.までの帯を表示
   * 社長 / サロン: 該当会員がいる帯だけ表示
   */
  function buildConnectMenu(users = state.allUsers) {
    const list = users || [];

    // [プレジデント] 社長帯のみ（プレジデント番号順の帯）
    if (isPresidentMode()) {
      const menu = [{ id: "latest", label: "最新ユーザー", type: "latest" }];
      occupiedBands(list, () => true).forEach((b) => {
        menu.push({
          id: `pres-${b.index}`,
          label: `社長 No.${b.from}～No.${b.to}`,
          type: "president",
          from: b.from,
          to: b.to
        });
      });
      return menu;
    }

    const maxNo = Math.max(maxMemberNoAmong(list), 1);
    const bandCount = Math.max(1, Math.ceil(maxNo / CONNECT_BAND_SIZE));
    const menu = [{ id: "latest", label: "最新ユーザー", type: "latest" }];

    for (let i = 0; i < bandCount; i++) {
      const from = i * CONNECT_BAND_SIZE + 1;
      const to = (i + 1) * CONNECT_BAND_SIZE;
      menu.push({
        id: `no-${i + 1}`,
        label: `No.${from}～No.${to}`,
        type: "range",
        from,
        to
      });
    }

    occupiedBands(list, (u) => u.presidentMark).forEach((b) => {
      menu.push({
        id: `pres-${b.index}`,
        label: `社長 No.${b.from}～No.${b.to}`,
        type: "president",
        from: b.from,
        to: b.to
      });
    });

    const salonName = state.salonLabel || "井口智明オンラインサロン";
    occupiedBands(list, (u) => u.salonListing).forEach((b, idx) => {
      menu.push({
        id: `salon-${b.index}`,
        label: `${salonName} No.${b.from}～No.${b.to}`,
        type: "salon",
        from: b.from,
        to: b.to,
        salonFirst: idx === 0
      });
    });

    return menu;
  }

  function getConnectMenu() {
    return buildConnectMenu(state.allUsers);
  }

  function getConnectPage(pageId = state.connectPageId) {
    const menu = getConnectMenu();
    return menu.find((p) => p.id === pageId) || menu[0];
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

  function isOfficialLineUrl(url) {
    const raw = String(url || "").trim();
    if (!raw) return false;
    try {
      const u = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
      const host = u.hostname.replace(/^www\./, "").toLowerCase();
      // 公式LINE短縮URL（lin.ee）は不可。line.me は可
      return host === "lin.ee" || host.endsWith(".lin.ee");
    } catch {
      return /(^|\.)lin\.ee(\/|$)/i.test(raw);
    }
  }

  function isPersonalLineUrl(url) {
    const raw = String(url || "").trim();
    if (!raw || isOfficialLineUrl(raw)) return false;
    try {
      const u = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
      const host = u.hostname.replace(/^www\./, "").toLowerCase();
      return host.includes("line.me") || host.includes("page.line.me");
    } catch {
      return /line\.me/i.test(raw);
    }
  }

  function detectSnsType(url) {
    const raw = String(url || "").trim().toLowerCase();
    if (!raw) return null;
    if (isOfficialLineUrl(raw)) return null;
    try {
      const u = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
      const host = u.hostname.replace(/^www\./, "");
      if (host.includes("instagram.com") || host === "instagr.am") return "instagram";
      if (host.includes("facebook.com") || host === "fb.com" || host === "fb.me") return "facebook";
      if (host === "x.com" || host.includes("twitter.com")) return "x";
      if (host.includes("line.me") || host.includes("page.line.me")) return "line";
      if (host.includes("youtube.com") || host === "youtu.be") return "youtube";
      if (host === "lit.link" || host.endsWith(".lit.link")) return "litlink";
      if (host.includes("canva.com")) return "canva";
      if (host.includes("ameblo.jp")) return "ameblo";
      if (u.protocol === "http:" || u.protocol === "https:") return "home";
    } catch {
      return null;
    }
    return null;
  }

  function normalizeSnsUrl(url) {
    const raw = String(url || "").trim();
    if (!raw) return "";
    if (/^https?:\/\//i.test(raw)) return raw;
    return `https://${raw}`;
  }

  /** 旧形式 {line,instagram,...} / snsLinks[] を URL 配列に統一（LINE優先） */
  function getUserSnsUrls(user) {
    if (!user) return [];
    let raw = [];
    if (Array.isArray(user.snsLinks) && user.snsLinks.length) {
      raw = user.snsLinks.map((u) => String(u || "").trim()).filter(Boolean);
    } else if (Array.isArray(user.sns)) {
      raw = user.sns
        .map((item) => (typeof item === "string" ? item : item?.url))
        .map((u) => String(u || "").trim())
        .filter(Boolean);
    } else {
      const obj = user.sns && typeof user.sns === "object" ? user.sns : {};
      const legacyOrder = ["line", "instagram", "facebook", "x", "youtube", "home", "litlink", "canva", "ameblo"];
      legacyOrder.forEach((key) => {
        const v = String(obj[key] || "").trim();
        if (v) raw.push(v);
      });
    }
    return splitSnsUrls(raw).all.slice(0, SNS_MAX);
  }

  function splitSnsUrls(urls) {
    const list = (urls || []).map((u) => normalizeSnsUrl(u)).filter(Boolean);
    let lineUrl = "";
    const others = [];
    list.forEach((url) => {
      const type = detectSnsType(url);
      if (type === "line" && !lineUrl) {
        lineUrl = url;
        return;
      }
      if (type === "line") return; // 2件目以降のLINEは無視
      others.push(url);
    });
    return {
      lineUrl,
      otherUrls: others.slice(0, SNS_OTHER_MAX),
      all: lineUrl ? [lineUrl, ...others.slice(0, SNS_OTHER_MAX)] : others.slice(0, SNS_OTHER_MAX)
    };
  }

  function sortSnsByPriority(urls) {
    return (urls || [])
      .map((url) => {
        const normalized = normalizeSnsUrl(url);
        const type = detectSnsType(normalized);
        return type ? { type, url: normalized } : null;
      })
      .filter(Boolean)
      .sort((a, b) => SNS_PRIORITY.indexOf(a.type) - SNS_PRIORITY.indexOf(b.type));
  }

  function shouldBlockSnsOpen(targetUser) {
    if (!isFemaleOnlyConnect(targetUser)) return false;
    // 男性閲覧者のみブロック（女性・LGBTQ・未設定は遷移可）
    return normalizeGender(state.currentUser?.gender) === "male";
  }

  function renderSns(user) {
    const items = sortSnsByPriority(getUserSnsUrls(user));
    if (!items.length) return "";
    const blocked = shouldBlockSnsOpen(user);
    return items
      .map(({ type, url }) => {
        const meta = SNS_META[type] || SNS_META.home;
        if (blocked) {
          return `<a href="${escapeHtml(url)}" class="sns-link ${meta.cls}" data-sns-guard="female-only" aria-label="${escapeHtml(meta.label)}"><i class="${meta.icon}"></i></a>`;
        }
        return `<a href="${escapeHtml(url)}" class="sns-link ${meta.cls}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(meta.label)}"><i class="${meta.icon}"></i></a>`;
      })
      .join("");
  }

  function validateEditSnsUrls(lineRaw, otherUrls) {
    const lineUrl = normalizeSnsUrl(lineRaw);
    if (!lineUrl) {
      return { ok: false, message: "個人LINEのURLを設定してください。", urls: [] };
    }
    if (isOfficialLineUrl(lineUrl)) {
      return {
        ok: false,
        message: "公式LINE（lin.ee）は登録できません。個人の line.me URL を入力してください",
        urls: []
      };
    }
    if (!isPersonalLineUrl(lineUrl) || detectSnsType(lineUrl) !== "line") {
      return {
        ok: false,
        message: "個人LINEは line.me のURLを入力してください",
        urls: []
      };
    }

    const cleaned = [];
    const seen = new Set(["line"]);
    for (const raw of otherUrls || []) {
      const url = String(raw || "").trim();
      if (!url) continue;
      const normalized = normalizeSnsUrl(url);
      if (isOfficialLineUrl(normalized)) {
        return {
          ok: false,
          message: `公式LINE（lin.ee）は登録できません: ${url}`,
          urls: []
        };
      }
      const type = detectSnsType(normalized);
      if (!type) {
        return { ok: false, message: `対応していないURLです: ${url}`, urls: [] };
      }
      if (type === "line") {
        return {
          ok: false,
          message: "LINEは上の「個人LINE」欄に入力してください",
          urls: []
        };
      }
      if (seen.has(type)) {
        return { ok: false, message: `${SNS_META[type].label} はすでに追加されています`, urls: [] };
      }
      seen.add(type);
      cleaned.push(normalized);
      if (cleaned.length > SNS_OTHER_MAX) {
        return { ok: false, message: `その他SNSは最大${SNS_OTHER_MAX}件までです`, urls: [] };
      }
    }
    return { ok: true, urls: [lineUrl, ...cleaned] };
  }

  function renderEditSnsList() {
    const list = $("#edit-sns-list");
    const addBtn = $("#btn-add-sns");
    if (!list) return;
    list.innerHTML = editSnsUrls
      .map((url, idx) => {
        const type = detectSnsType(normalizeSnsUrl(url));
        const meta = type ? SNS_META[type] : null;
        const previewCls = meta ? meta.cls : "";
        const icon = meta ? meta.icon : "fa-solid fa-question";
        return `
          <div class="edit-sns-row" data-sns-index="${idx}">
            <span class="edit-sns-preview ${previewCls}" aria-hidden="true"><i class="${icon}"></i></span>
            <input type="url" class="edit-input edit-sns-url" value="${escapeHtml(url)}" placeholder="https://..." inputmode="url">
            <button type="button" class="edit-sns-remove" data-remove-sns="${idx}" aria-label="削除">
              <i class="fa-solid fa-xmark"></i>
            </button>
          </div>`;
      })
      .join("");
    if (addBtn) addBtn.disabled = editSnsUrls.length >= SNS_OTHER_MAX;
  }

  function syncEditSnsFromDom() {
    editSnsUrls = Array.from(document.querySelectorAll(".edit-sns-url")).map((el) => el.value.trim());
  }

  function getActiveTagOptions() {
    return uniqueOptions((state.masters || {})["タグ"] || []).map((o) => ({
      value: o.value,
      label: getTagDisplayLabel(o.value, o.label)
    }));
  }

  /** 編集画面などで見やすいよう、指定タグは改行表示 */
  const TAG_LABEL_LINES = {
    ビジネスマッチング: ["ビジネス", "マッチング"],
    オンライン交流会: ["オンライン", "交流会"],
    イベント: ["イベント", "（飲み会など）"]
  };

  function getTagDisplayLabel(value, fallbackLabel) {
    const key = String(value || "").trim();
    if (TAG_LABEL_LINES[key]) return TAG_LABEL_LINES[key].join("\n");
    return String(fallbackLabel || value || "").replace(/\\n/g, "\n");
  }

  function getTagDisplayLines(value, fallbackLabel) {
    const key = String(value || "").trim();
    if (TAG_LABEL_LINES[key]) return TAG_LABEL_LINES[key].slice();
    return String(getTagDisplayLabel(value, fallbackLabel) || key)
      .replace(/\\n/g, "\n")
      .split(/\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  /** 1行目通常、2行目以降は小さく・途中改行なし */
  function formatTagChipHtml(value, fallbackLabel) {
    const lines = getTagDisplayLines(value, fallbackLabel);
    if (!lines.length) return escapeHtml(String(value || ""));
    if (lines.length === 1) return escapeHtml(lines[0]);
    const [first, ...rest] = lines;
    return (
      `<span class="chip-main">${escapeHtml(first)}</span>` +
      rest.map((line) => `<span class="chip-sub">${escapeHtml(line)}</span>`).join("")
    );
  }

  function getActiveTagValueSet() {
    return new Set(getActiveTagOptions().map((o) => o.value));
  }

  function normalizeTagList(tags) {
    const parts = [];
    const pushSplit = (raw) => {
      String(raw || "")
        .split(/[,、|／\t]+/)
        .map((t) => t.trim())
        .filter(Boolean)
        .forEach((t) => parts.push(t));
    };
    if (Array.isArray(tags)) {
      tags.forEach((t) => pushSplit(t));
    } else {
      pushSplit(tags);
    }
    return parts;
  }

  /** マスタで有効なタグだけ残す（削除・無効化済みは非表示） */
  function filterVisibleTags(tags) {
    const allowed = getActiveTagValueSet();
    const list = normalizeTagList(tags);
    const seen = new Set();
    const out = [];
    list.forEach((t) => {
      if (seen.has(t)) return;
      // マスタ未取得時は一旦すべて表示（読み込み直後の取りこぼし防止）
      if (allowed.size && !allowed.has(t)) return;
      seen.add(t);
      out.push(t);
    });
    return out.slice(0, TAG_MAX);
  }

  function tagLabel(value) {
    const hit = getActiveTagOptions().find((o) => o.value === value);
    return hit?.label || value;
  }

  const SALON_BADGE_LABEL = "井口の囲炉裏";

  function renderTags(userOrTags) {
    let tags = userOrTags;
    let showSalonBadge = false;
    if (userOrTags && typeof userOrTags === "object" && !Array.isArray(userOrTags)) {
      tags = userOrTags.tags;
      showSalonBadge = isTruthyFlag(userOrTags.salonListing);
    }
    const visible = filterVisibleTags(tags);
    const parts = [];
    visible.forEach((t) => {
      parts.push(`<span class="profile-tag">${formatTagChipHtml(t, tagLabel(t))}</span>`);
    });
    if (showSalonBadge) {
      parts.push(
        `<span class="profile-tag profile-tag-salon">${escapeHtml(SALON_BADGE_LABEL)}</span>`
      );
    }
    if (!parts.length) return "";
    return `<div class="profile-tags">${parts.join("")}</div>`;
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

  /** 自分の最終ログインを画面上に反映 */
  function applyMyActivity(lastLoginAt) {
    const stamp = lastLoginAt || formatLocalDateTime();
    if (!state.currentUser) return;
    state.currentUser.lastLoginAt = stamp;
    const idx = state.allUsers.findIndex((u) => u.id === state.currentUser.id);
    if (idx >= 0) {
      state.allUsers[idx] = {
        ...state.allUsers[idx],
        lastLoginAt: stamp
      };
    }
    if (state.activeTab === "mypage") renderMyPage(state.currentUser);
    if (state.activeTab === "connect") refreshConnectList();
  }

  let touchTimer = null;
  let lastTouchAt = 0;
  const TOUCH_MIN_INTERVAL_MS = 90 * 1000; // 連打でGASを叩かない
  let lastDashboardAt = 0;
  const DASHBOARD_CACHE_MS = 5 * 60 * 1000;

  function scheduleTouchActivity(force = false) {
    if (!state.isLoggedIn || !state.identity) return;
    const now = Date.now();
    if (!force && now - lastTouchAt < TOUCH_MIN_INTERVAL_MS) {
      applyMyActivity(); // ローカルの最終ログインを更新
      return;
    }
    clearTimeout(touchTimer);
    touchTimer = setTimeout(async () => {
      try {
        const res = await GasAPI.touchActivity(identityForApi());
        lastTouchAt = Date.now();
        applyMyActivity(res.data?.lastLoginAt);
      } catch (err) {
        console.warn("touchActivity failed", err);
        applyMyActivity();
      }
    }, force ? 0 : 300);
  }

  function isTruthyFlag(v) {
    if (v === true || v === 1) return true;
    const s = String(v ?? "")
      .trim()
      .toUpperCase();
    return s === "TRUE" || s === "1" || s === "○" || s === "はい";
  }

  function isFemaleOnlyConnect(user) {
    return isTruthyFlag(user?.femaleOnlyConnect) && normalizeGender(user?.gender) === "female";
  }

  /* ---------- Profile Card（繋がる / マイページ共通） ---------- */
  function renderProfileCard(user) {
    const genderKey = normalizeGender(user.gender);
    const genderClass =
      genderKey === "female"
        ? "gender-female"
        : genderKey === "other"
          ? "gender-other"
          : "gender-male";
    // プレジデントメイトは全員社長のため帯の暗色カードは使わず白背景のまま
    const presidentClass =
      user.presidentMark && !isPresidentMode() ? " is-president" : "";
    const femaleOnlyClass = isFemaleOnlyConnect(user) ? " female-only" : "";
    const avatar = normalizeAvatarUrl(user.avatarUrl, user.name);

    return `
      <article class="profile-card ${genderClass}${presidentClass}${femaleOnlyClass}" data-user-id="${escapeHtml(user.id)}" data-gender="${genderKey}">
        <div class="profile-card-band" aria-hidden="true"></div>
        <span class="profile-card-no">${escapeHtml(formatUserMemberNo(user))}</span>
        <div class="profile-card-body">
          <div class="profile-top-row">
            <img class="profile-avatar" src="${escapeHtml(avatar)}" alt="${escapeHtml(user.name)}" loading="lazy" onerror="this.onerror=null;this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(user.name || "User")}&background=93c5fd&color=1e3a8a';">
            <div class="profile-sns">${renderSns(user)}</div>
          </div>
          <div class="profile-name-row">
            <h2 class="profile-name">${escapeHtml(user.name || user.nickname || "（ニックネーム未設定）")}</h2>
            ${
              user.presidentMark && String(user.companyName || "").trim()
                ? `<span class="profile-company">${escapeHtml(String(user.companyName).trim())}</span>`
                : ""
            }
          </div>
          <p class="profile-job-line">業種：${escapeHtml(user.industry || "-")}　職種：${escapeHtml(user.jobTitle || "-")}</p>
          <div class="profile-meta-row">
            <span><i class="fa-solid fa-location-dot"></i>${escapeHtml(user.location || "-")}</span>
            <span><i class="fa-solid fa-rotate"></i>${escapeHtml(user.ageGroup || "-")}</span>
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
          ${renderTags(user)}
        </div>
      </article>
    `;
  }

  function formatDashNumber(n) {
    const num = Number(n);
    if (!Number.isFinite(num)) return "—";
    return num.toLocaleString("ja-JP");
  }

  function renderDashboard(stats) {
    const data = stats || state.dashboard;
    const asof = $("#dashboard-asof");
    const total = $("#dash-total");
    const neu = $("#dash-new");
    const unpublished = $("#dash-unpublished");
    const returning = $("#dash-returning");
    const bars = $("#dash-bars");
    const chartTotal = $("#dash-chart-total");

    if (!data) {
      if (total) total.textContent = "—";
      if (neu) neu.textContent = "—";
      if (unpublished) unpublished.textContent = "—";
      if (returning) returning.textContent = "—";
      if (asof) asof.textContent = "";
      if (bars) bars.innerHTML = "";
      if (chartTotal) chartTotal.textContent = "";
      return;
    }

    if (total) total.textContent = formatDashNumber(data.totalRegistered);
    if (neu) neu.textContent = formatDashNumber(data.yesterdayNew);
    if (unpublished) unpublished.textContent = formatDashNumber(data.unpublished);
    if (returning) returning.textContent = formatDashNumber(data.yesterdayReturning);
    if (asof) {
      asof.textContent = data.asOf ? `${String(data.asOf).replace(/-/g, "/")} 時点` : "";
    }

    const series = Array.isArray(data.newLast7Days) ? data.newLast7Days : [];
    const max = Math.max(1, ...series.map((d) => Number(d.count) || 0));
    const sum7 = series.reduce((acc, d) => acc + (Number(d.count) || 0), 0);
    if (chartTotal) chartTotal.textContent = `合計 ${formatDashNumber(sum7)}人`;
    if (bars) {
      bars.innerHTML = series
        .map((d) => {
          const count = Number(d.count) || 0;
          const pct = Math.round((count / max) * 100);
          const zeroCls = count === 0 ? " is-zero" : "";
          return `
            <div class="dash-bar-col">
              <span class="dash-bar-count">${count}</span>
              <div class="dash-bar-track">
                <div class="dash-bar${zeroCls}" style="height:${Math.max(count === 0 ? 3 : 8, pct)}%"></div>
              </div>
              <span class="dash-bar-label">${escapeHtml(d.label || "")}</span>
            </div>
          `;
        })
        .join("");
    }
  }

  async function loadDashboardStats() {
    // 直近取得済みなら再取得しない（ホーム切替の体感を速く）
    if (state.dashboard && Date.now() - lastDashboardAt < DASHBOARD_CACHE_MS) {
      renderDashboard(state.dashboard);
      return;
    }
    try {
      const res = await GasAPI.fetchDashboard();
      state.dashboard = res.data || null;
      lastDashboardAt = Date.now();
      renderDashboard(state.dashboard);
      writeBootCache();
    } catch (err) {
      console.error(err);
      try {
        const mock = await MockAPI.fetchDashboard();
        state.dashboard = mock.data || null;
        lastDashboardAt = Date.now();
        renderDashboard(state.dashboard);
      } catch (e2) {
        console.error(e2);
      }
    }
  }

  function normalizeBannerPlace(place) {
    const p = String(place || "").trim();
    if (!p || p === "ホーム" || /^home$/i.test(p)) return "ホーム";
    if (p === "繋がる" || /^connect$/i.test(p)) return "繋がる";
    if (p === "両方" || p === "すべて" || /^both$/i.test(p) || /^all$/i.test(p)) return "両方";
    return "ホーム";
  }

  function filterBannersByPlace(banners, place) {
    const want = normalizeBannerPlace(place);
    return (banners || []).filter((b) => {
      const bp = normalizeBannerPlace(b.place);
      if (bp === "両方") return true;
      return bp === want;
    });
  }

  function renderBannerCardsHtml(banners, options = {}) {
    const compact = Boolean(options.compact);
    return (banners || [])
      .map(
        (b) => `
        <a href="${escapeHtml(b.linkUrl || "#")}" class="banner-card${compact ? " is-compact" : ""}" target="_blank" rel="noopener noreferrer">
          <div class="banner-inner">
            <div class="banner-text">
              <h3>${escapeHtml(b.title)}</h3>
              ${
                compact || !b.description
                  ? ""
                  : `<p>${escapeHtml(b.description)}</p>`
              }
            </div>
            ${
              b.imageUrl
                ? `<img class="banner-thumb" src="${escapeHtml(b.imageUrl)}" alt="">`
                : ""
            }
          </div>
        </a>
      `
      )
      .join("");
  }

  function renderBanners(banners) {
    const container = $("#banner-list");
    if (!container) return;
    const list = filterBannersByPlace(banners || state.banners, "ホーム");
    if (!list.length) {
      container.innerHTML = "";
      return;
    }
    container.innerHTML = renderBannerCardsHtml(list);
  }

  function updateConnectBannerDockVisibility() {
    const dock = $("#connect-banner-dock");
    const jump = $("#connect-jump");
    if (!dock) return;
    const list = filterBannersByPlace(state.banners, "繋がる");
    const onConnect = state.activeTab === "connect";
    const show = onConnect && list.length > 0;
    dock.classList.toggle("hidden", !show);
    document.body.classList.toggle("has-connect-banner-dock", show);
    jump?.classList.toggle("has-banner-dock", show);
  }

  function renderConnectBanners(banners) {
    const container = $("#connect-banner-list");
    if (!container) return;
    const list = filterBannersByPlace(banners || state.banners, "繋がる");
    if (!list.length) {
      container.innerHTML = "";
      updateConnectBannerDockVisibility();
      return;
    }
    container.innerHTML = renderBannerCardsHtml(list, { compact: true });
    updateConnectBannerDockVisibility();
  }

  function renderAllBanners() {
    renderBanners(state.banners);
    renderConnectBanners(state.banners);
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
    if (page.type === "range" || page.type === "president" || page.type === "salon") {
      const prefix = page.type === "president" ? "社長 " : page.type === "salon" ? "サロン " : "";
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
          const n = userMemberSortKey(u);
          return n >= page.from && n <= page.to;
        })
        .sort((a, b) => userMemberSortKey(a) - userMemberSortKey(b));
    }
    if (page.type === "president") {
      // 会員番号帯のうち社長マークあり（番号の繰り上がりなし）
      return list
        .filter((u) => {
          if (!u.presidentMark) return false;
          const n = userMemberSortKey(u);
          return n >= page.from && n <= page.to;
        })
        .sort((a, b) => userMemberSortKey(a) - userMemberSortKey(b));
    }
    if (page.type === "salon") {
      return list
        .filter((u) => {
          if (!u.salonListing) return false;
          const n = userMemberSortKey(u);
          return n >= page.from && n <= page.to;
        })
        .sort((a, b) => userMemberSortKey(a) - userMemberSortKey(b));
    }
    return list;
  }

  function refreshConnectList() {
    ensureConnectPageAccess();
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
    const menu = getConnectMenu();
    list.innerHTML = menu.map((item) => {
      const label = item.label;
      const active = item.id === state.connectPageId;
      const locked = !canAccessConnectPage(item);
      const salonCls = item.type === "salon" ? (item.salonFirst ? " is-salon is-salon-start" : " is-salon") : "";
      const activeCls = active ? " is-active" : "";
      const lockedCls = locked ? " is-locked" : "";
      return `<li><button type="button" class="connect-menu-item${activeCls}${salonCls}${lockedCls}" data-page-id="${escapeHtml(item.id)}">${escapeHtml(label)}</button></li>`;
    }).join("");
  }

  function canViewPresidentPages(user = state.currentUser) {
    return true;
  }

  function canViewSalonPages(user = state.currentUser) {
    return true;
  }

  function canAccessConnectPage(page, user = state.currentUser) {
    if (!page) return false;
    if (page.type === "president") return canViewPresidentPages(user);
    if (page.type === "salon") return canViewSalonPages(user);
    return true;
  }

  /** 未許可・存在しないページに居る場合は最新へ戻す */
  function ensureConnectPageAccess() {
    const menu = getConnectMenu();
    const page = menu.find((p) => p.id === state.connectPageId);
    if (!page || !canAccessConnectPage(page)) {
      state.connectPageId = "latest";
    }
  }

  function openSalonCommunityUrl() {
    const url = state.salonUrl || "https://example.com/salon";
    window.open(url, "_blank", "noopener,noreferrer");
    scheduleTouchActivity();
  }

  /** 繋がるタブの井口智明オンラインサロン一覧へ移動（先頭の該当帯） */
  function goToSalonConnectPage() {
    const first = getConnectMenu().find((p) => p.type === "salon");
    if (!first) {
      showToast("サロン掲載会員がまだいません");
      return;
    }
    state.connectPageId = first.id;
    switchTab("connect");
    showToast(first.label);
  }

  function selectConnectPage(pageId) {
    const page = getConnectPage(pageId);
    if (!page) return;
    if (!canAccessConnectPage(page)) {
      closeConnectMenu();
      showToast("許可後に閲覧できます");
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
      renderMintukuPlanPanel(null);
      return;
    }
    container.innerHTML = renderProfileCard(user);
    renderMintukuPlanPanel(user);
    updateMypageActionLabels(user);
  }

  /** [みんつく] 無料期間／課金後の経過日数（マイページ） */
  function getMintukuPlanInfo(user) {
    if (!user) return null;
    const firstAt = String(user.mintukuFirstLoginAt || "").trim();
    const paidStartAt = String(user.mintukuPaidStartAt || "").trim();
    const paid = Boolean(paidStartAt) || Boolean(user.mintukuPaid);

    const calcDays = (raw) => {
      if (!raw) return null;
      const d = new Date(String(raw).replace(/-/g, "/"));
      if (Number.isNaN(d.getTime())) return null;
      const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      return Math.max(0, Math.floor((today - start) / 86400000));
    };

    if (paidStartAt) {
      let paidDays =
        user.mintukuPaidDaysUsed !== undefined && user.mintukuPaidDaysUsed !== null
          ? Number(user.mintukuPaidDaysUsed)
          : calcDays(paidStartAt);
      if (paidDays === null || Number.isNaN(paidDays)) paidDays = 0;
      return {
        mode: "paid",
        firstAt,
        paidStartAt,
        paid: true,
        daysUsed: paidDays,
        daysLeft: 0,
        expired: false,
        ok: true
      };
    }

    let daysUsed = user.mintukuDaysUsed;
    let daysLeft = user.mintukuDaysLeft;
    if ((daysUsed === undefined || daysUsed === null) && firstAt) {
      daysUsed = calcDays(firstAt);
      if (daysUsed !== null) daysLeft = Math.max(0, 30 - daysUsed);
    }
    if (daysUsed === undefined || daysUsed === null) {
      daysUsed = 0;
      daysLeft = 30;
    }
    daysUsed = Number(daysUsed) || 0;
    if (daysLeft === undefined || daysLeft === null) {
      daysLeft = Math.max(0, 30 - daysUsed);
    } else {
      daysLeft = Number(daysLeft) || 0;
    }
    const expired = Boolean(user.mintukuExpired) || (!paid && daysUsed >= 30);
    return {
      mode: "free",
      firstAt,
      paidStartAt: "",
      paid: false,
      daysUsed,
      daysLeft,
      expired,
      ok: user.mintukuAccessOk !== false && !expired
    };
  }

  function formatMintukuDateLabel(raw) {
    if (raw === undefined || raw === null || raw === "") return "未記録";

    const months = {
      jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
      apr: 4, april: 4, may: 5, jun: 6, june: 6,
      jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
      oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12
    };

    let y = 0;
    let mo = 0;
    let d = 0;

    if (Object.prototype.toString.call(raw) === "[object Date]" && !isNaN(raw.getTime())) {
      // Asia/Tokyo 基準で年月日を取る
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Tokyo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }).formatToParts(raw);
      const get = (t) => Number((parts.find((p) => p.type === t) || {}).value || 0);
      y = get("year");
      mo = get("month");
      d = get("day");
    } else {
      const s = String(raw).trim();
      if (!s) return "未記録";

      let m =
        s.match(/^(\d{4})[-\/.年](\d{1,2})[-\/.月](\d{1,2})/) ||
        s.match(/^(\d{4})(\d{2})(\d{2})/);
      if (m) {
        y = Number(m[1]);
        mo = Number(m[2]);
        d = Number(m[3]);
      } else {
        // "Thu Aug 13 2026 ..." / "Aug 13, 2026"
        m = s.match(/\b([A-Za-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/);
        if (m && months[m[1].toLowerCase()]) {
          mo = months[m[1].toLowerCase()];
          d = Number(m[2]);
          y = Number(m[3]);
        } else {
          m = s.match(/\b([A-Za-z]{3,9})\s+(\d{1,2})\b/);
          if (m && months[m[1].toLowerCase()]) {
            mo = months[m[1].toLowerCase()];
            d = Number(m[2]);
            y = new Date().getFullYear();
          } else {
            const dt = new Date(s);
            if (!isNaN(dt.getTime())) {
              y = dt.getFullYear();
              mo = dt.getMonth() + 1;
              d = dt.getDate();
            }
          }
        }
      }
    }

    if (!y || !mo || !d) return "未記録";
    return `${y}年${String(mo).padStart(2, "0")}月${String(d).padStart(2, "0")}日`;
  }

  function renderMintukuPlanPanel(user) {
    const el = $("#mypage-mintuku-plan");
    if (!el) return;
    if (!isMintukuMode() || !user) {
      el.classList.add("hidden");
      el.innerHTML = "";
      return;
    }
    const info = getMintukuPlanInfo(user);
    if (!info) {
      el.classList.add("hidden");
      el.innerHTML = "";
      return;
    }

    let rowsHtml = "";
    let note = "";
    if (info.mode === "paid") {
      rowsHtml = `
      <div class="mypage-mintuku-plan-row">
        <span class="mypage-mintuku-plan-label">みんつく課金開始日</span>
        <span class="mypage-mintuku-plan-value">${formatMintukuDateLabel(info.paidStartAt)}</span>
      </div>
      <div class="mypage-mintuku-plan-row">
        <span class="mypage-mintuku-plan-label">課金からの経過</span>
        <span class="mypage-mintuku-plan-value">${info.daysUsed} 日目</span>
      </div>
      <div class="mypage-mintuku-plan-row">
        <span class="mypage-mintuku-plan-label">利用状況</span>
        <span class="mypage-mintuku-plan-value">有料契約中</span>
      </div>`;
      note = "みんつく課金開始日が入っているため、課金後の経過日数を表示しています。";
    } else {
      let statusValue = info.expired
        ? "無料期間終了"
        : `残り ${info.daysLeft} 日`;
      rowsHtml = `
      <div class="mypage-mintuku-plan-row">
        <span class="mypage-mintuku-plan-label">初回ログイン</span>
        <span class="mypage-mintuku-plan-value">${formatMintukuDateLabel(info.firstAt)}</span>
      </div>
      <div class="mypage-mintuku-plan-row">
        <span class="mypage-mintuku-plan-label">経過日数</span>
        <span class="mypage-mintuku-plan-value">${info.daysUsed} 日目</span>
      </div>
      <div class="mypage-mintuku-plan-row">
        <span class="mypage-mintuku-plan-label">無料期間</span>
        <span class="mypage-mintuku-plan-value">${statusValue}</span>
      </div>`;
      note = info.expired
        ? "閲覧を続けるにはお問い合わせください。"
        : "初回ログイン日から30日間は無料です。みんつく課金開始日が入ると課金後の経過表示に切り替わります。";
    }

    el.innerHTML = `
      <p class="mypage-mintuku-plan-title">みんつく利用状況</p>
      ${rowsHtml}
      <p class="mypage-mintuku-plan-note">${note}</p>
    `;
    el.classList.remove("hidden");
  }

  function updateMypageActionLabels(user) {
    const salonBtn = $("#btn-salon");
    const presidentBtn = $("#btn-president-badge");
    const stopApomy = $("#btn-stop-listing");
    const stopApomyMintuku = $("#btn-stop-apomy-from-mintuku");
    const resumeApomyMintuku = $("#btn-resume-apomy-from-mintuku");
    const stopMintuku = $("#btn-stop-mintuku-listing");
    const resumeMintuku = $("#btn-resume-mintuku-listing");
    const salonStatus = String(user?.salonListingStatus || "なし");
    const presidentStatus = String(user?.presidentMarkStatus || "なし");
    const salonName = state.salonLabel || "井口智明オンラインサロン";

    if (salonBtn) {
      if (user?.salonListing) {
        salonBtn.textContent = `${salonName}（オンラインサロンを開く）`;
        salonBtn.disabled = false;
      } else if (salonStatus === "申請中") {
        salonBtn.textContent = `${salonName}（申請中）`;
        salonBtn.disabled = true;
      } else if (salonStatus === "却下") {
        salonBtn.textContent = `${salonName}を再申請`;
        salonBtn.disabled = false;
      } else {
        salonBtn.textContent = `${salonName}掲載を申請`;
        salonBtn.disabled = false;
      }
    }

    if (presidentBtn) {
      if (user?.presidentMark) {
        presidentBtn.textContent = "社長マーク掲載済み";
        presidentBtn.disabled = true;
      } else if (presidentStatus === "申請中") {
        presidentBtn.textContent = "社長マーク：申請中";
        presidentBtn.disabled = true;
      } else if (presidentStatus === "却下") {
        presidentBtn.textContent = "社長マークを再申請";
        presidentBtn.disabled = false;
      } else {
        presidentBtn.textContent = "社長マーク掲載を申請";
        presidentBtn.disabled = false;
      }
    }

    // [みんつく] 掲載スイッチ分離 / [プレジデント] PM掲載 / [Apomy] 従来の掲載停止1つ
    const published = user?.isPublished !== false;
    const mintukuOn = Boolean(user?.mintukuListed);
    const presidentOn = isPresidentMateListed(user);
    const stopPresident = $("#btn-stop-president-listing");
    const resumePresident = $("#btn-resume-president-listing");

    if (isPresidentMode()) {
      stopApomy?.classList.add("hidden");
      stopApomyMintuku?.classList.add("hidden");
      resumeApomyMintuku?.classList.add("hidden");
      stopMintuku?.classList.add("hidden");
      resumeMintuku?.classList.add("hidden");
      salonBtn?.classList.add("hidden");
      presidentBtn?.classList.add("hidden");
      if (presidentOn) {
        stopPresident?.classList.remove("hidden");
        resumePresident?.classList.add("hidden");
      } else {
        stopPresident?.classList.add("hidden");
        resumePresident?.classList.remove("hidden");
      }
    } else if (isMintukuMode()) {
      stopApomy?.classList.add("hidden");
      stopPresident?.classList.add("hidden");
      resumePresident?.classList.add("hidden");
      if (published) {
        stopApomyMintuku?.classList.remove("hidden");
        resumeApomyMintuku?.classList.add("hidden");
      } else {
        stopApomyMintuku?.classList.add("hidden");
        resumeApomyMintuku?.classList.remove("hidden");
      }
      if (mintukuOn) {
        stopMintuku?.classList.remove("hidden");
        resumeMintuku?.classList.add("hidden");
      } else {
        stopMintuku?.classList.add("hidden");
        resumeMintuku?.classList.remove("hidden");
      }
    } else {
      stopApomy?.classList.remove("hidden");
      stopApomyMintuku?.classList.add("hidden");
      resumeApomyMintuku?.classList.add("hidden");
      stopMintuku?.classList.add("hidden");
      resumeMintuku?.classList.add("hidden");
      stopPresident?.classList.add("hidden");
      resumePresident?.classList.add("hidden");
      salonBtn?.classList.remove("hidden");
      presidentBtn?.classList.remove("hidden");
    }
  }

  function isMintukuExpiredError(err) {
    const msg = String(err?.message || err || "");
    return msg.indexOf("MINTUKU_EXPIRED:") === 0 || msg.indexOf("無料期間(30日)が終了") >= 0;
  }

  function isMintukuRegionDeniedError(err) {
    const msg = String(err?.message || err || "");
    return msg.indexOf("MINTUKU_REGION_DENIED:") === 0 || msg.indexOf("現在地が一致する会員のみ") >= 0;
  }

  function isPresidentDeniedError(err) {
    const msg = String(err?.message || err || "");
    return (
      msg.indexOf("PRESIDENT_DENIED:") === 0 ||
      msg.indexOf("社長マークの承認") >= 0
    );
  }

  function handlePresidentDenied() {
    showToast("Apomyにて社長マークの承認をお願いします");
    try {
      Session.clear();
    } catch (_) {
      /* ignore */
    }
    state.isLoggedIn = false;
    state.currentUser = null;
    state.identity = null;
    setTimeout(() => {
      window.location.assign("index.html");
    }, 1400);
  }

  /**
   * [みんつく] Apomy掲載をみんつくから停止した人だけ、Apomy起動時にみんつくへ誘導
   * （新規・未完成プロフィール・単なる掲載停止は Apomy に残す）
   * @returns {boolean} 遷移したとき true
   */
  function redirectApomyUnpublishedToMintuku(user) {
    if (isMintukuMode() || !user) return false;
    if (user.isNew) return false;
    if (user.isPublished !== false) return false;
    if (!user.mintukuListed) return false;
    if (!String(user.mintukuNumber || "").trim()) return false;
    // みんつく側の「Apomy掲載を停止」直後のみ誘導（localStorage）
    let shouldRedirect = false;
    try {
      if (localStorage.getItem("apomy_open_mintuku_after_stop") === "1") {
        shouldRedirect = true;
      }
    } catch (_) {
      /* ignore */
    }
    if (!shouldRedirect) return false;
    // 復旧用: ?stay=1 で Apomy に留まる
    try {
      if (new URLSearchParams(window.location.search).get("stay") === "1") return false;
    } catch (_) {
      /* ignore */
    }
    if (typeof AppMode === "undefined" || !AppMode.prefectureToRegionId) return false;
    const regionId = AppMode.prefectureToRegionId(user.location);
    if (!regionId) return false;
    const entry = AppMode.mintukuEntryUrl(regionId);
    try {
      localStorage.removeItem("apomy_open_mintuku_after_stop");
    } catch (_) {
      /* ignore */
    }
    showToast("Apomy掲載停止中のため、みんつくへ移動します");
    window.location.replace(entry);
    return true;
  }

  /**
   * [みんつく] URLの地方と現在地が食い違うとき、自分の地方へ寄せる
   * @returns {boolean} 遷移したとき true
   */
  function redirectMintukuToOwnRegion(user) {
    if (!isMintukuMode() || !user) return false;
    if (typeof AppMode === "undefined" || !AppMode.prefectureToRegionId) return false;
    const own = AppMode.prefectureToRegionId(user.location);
    if (!own || !state.mintukuRegion || own === state.mintukuRegion) return false;
    showToast("現在地の地方のみんつくへ移動します");
    window.location.replace(AppMode.mintukuEntryUrl(own));
    return true;
  }

  function mintukuExpiredMessage(err) {
    const msg = String(err?.message || err || "");
    return msg.replace(/^MINTUKU_EXPIRED:/, "").trim() ||
      "無料期間(30日)が終了しました。今まで通り閲覧するにはこちらからお問合せください";
  }

  function showMintukuExpiredScreen(err) {
    const screen = $("#mintuku-expired-screen");
    const app = $("#app-screen");
    const login = $("#login-screen");
    if (login) login.classList.add("hidden");
    if (app) app.classList.add("hidden");
    showLoading(false);

    const contactUrl = String(
      state.settings?.["みんつく問い合わせURL"] ||
        state.settings?.["みんつくの問い合わせ用リンク"] ||
        ""
    ).trim();
    const link = $("#mintuku-expired-link");
    const btn = $("#mintuku-expired-btn");
    const text = document.querySelector(".mintuku-expired-text");
    if (text) {
      const body = mintukuExpiredMessage(err);
      // 仕様文言をベースに「こちら」リンクを維持
      text.innerHTML =
        '無料期間(30日)が終了しました。今まで通り閲覧するには' +
        '<a id="mintuku-expired-link" class="mintuku-expired-link" href="#" target="_blank" rel="noopener noreferrer">こちら</a>' +
        'からお問合せください';
    }
    const linkEl = $("#mintuku-expired-link");
    if (contactUrl) {
      if (linkEl) {
        linkEl.href = contactUrl;
        linkEl.classList.remove("hidden");
      }
      if (btn) {
        btn.href = contactUrl;
        btn.classList.remove("hidden");
      }
    } else {
      if (linkEl) {
        linkEl.removeAttribute("href");
        linkEl.onclick = (e) => {
          e.preventDefault();
          showToast("問い合わせ先が未設定です。設定シートに「みんつく問い合わせURL」を追加してください");
        };
      }
      if (btn) btn.classList.add("hidden");
      showToast("設定に「みんつく問い合わせURL」がありません");
    }
    screen?.classList.remove("hidden");
    state.isLoggedIn = false;
  }

  function hideMintukuExpiredScreen() {
    $("#mintuku-expired-screen")?.classList.add("hidden");
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
      title.textContent = isMintukuMode()
        ? `${mintukuDisplayName()} HOME`
        : isPresidentMode()
          ? "PRESIDENT MATE HOME"
          : "apomy HOME";
      title.classList.remove("hidden");
    } else if (tabId === "mypage") {
      title.textContent = "マイページ";
      title.classList.remove("hidden");
    } else {
      title.classList.add("hidden");
    }
    updateInstallButtonVisibility();
    updateConnectJumpVisibility();
  }

  function updateConnectJumpVisibility() {
    const el = $("#connect-jump");
    if (!el) return;
    el.classList.toggle("hidden", state.activeTab !== "connect");
    updateConnectBannerDockVisibility();
  }

  function jumpConnectList(where) {
    const cards = $$("#user-list .profile-card");
    if (!cards.length) {
      showToast("表示中の一覧がありません");
      return;
    }
    let target = null;
    if (where === "top") {
      target = cards[0];
    } else if (where === "bottom") {
      target = cards[cards.length - 1];
    } else {
      target = cards[Math.floor(cards.length / 2)];
    }
    if (!target) return;
    target.scrollIntoView({
      behavior: "smooth",
      block: where === "middle" ? "center" : where === "bottom" ? "end" : "start"
    });
  }

  function bindConnectJumpEvents() {
    $("#connect-jump")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-jump]");
      if (!btn) return;
      e.preventDefault();
      jumpConnectList(btn.getAttribute("data-jump"));
    });
  }

  /* ---------- PWA インストール（マイページ右） ---------- */
  let deferredInstallPrompt = null;

  function isAppInstalled() {
    try {
      if (window.matchMedia("(display-mode: standalone)").matches) return true;
      if (window.matchMedia("(display-mode: fullscreen)").matches) return true;
    } catch {
      /* ignore */
    }
    // iOS Safari
    if (typeof navigator.standalone === "boolean" && navigator.standalone) return true;
    return false;
  }

  function isIosDevice() {
    const ua = navigator.userAgent || "";
    if (/iPad|iPhone|iPod/.test(ua)) return true;
    // iPadOS 13+
    return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  }

  function canShowInstallButton() {
    if (isAppInstalled()) return false;
    if (deferredInstallPrompt) return true;
    if (isIosDevice()) return true;
    return false;
  }

  function updateInstallButtonVisibility() {
    const btn = $("#btn-install-app");
    if (!btn) return;
    const show = state.activeTab === "mypage" && canShowInstallButton();
    btn.classList.toggle("hidden", !show);
  }

  function openInstallGuide() {
    const overlay = $("#install-guide-overlay");
    if (!overlay) return;
    overlay.classList.remove("hidden");
    overlay.setAttribute("aria-hidden", "false");
  }

  function closeInstallGuide() {
    const overlay = $("#install-guide-overlay");
    if (!overlay) return;
    overlay.classList.add("hidden");
    overlay.setAttribute("aria-hidden", "true");
  }

  async function handleInstallAppClick() {
    if (deferredInstallPrompt) {
      try {
        deferredInstallPrompt.prompt();
        const choice = await deferredInstallPrompt.userChoice;
        deferredInstallPrompt = null;
        updateInstallButtonVisibility();
        if (choice?.outcome === "accepted") {
          showToast("ホーム画面に追加しました");
        }
      } catch (err) {
        console.warn(err);
        showToast("インストールを開始できませんでした");
      }
      return;
    }
    if (isIosDevice()) {
      openInstallGuide();
      return;
    }
    showToast("このブラウザではインストールできません");
  }

  function bindInstallAppEvents() {
    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      deferredInstallPrompt = e;
      updateInstallButtonVisibility();
    });
    window.addEventListener("appinstalled", () => {
      deferredInstallPrompt = null;
      closeInstallGuide();
      updateInstallButtonVisibility();
      showToast("ホーム画面に追加しました");
    });
    $("#btn-install-app")?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleInstallAppClick();
    });
    $("#install-guide-close")?.addEventListener("click", closeInstallGuide);
    $("#install-guide-overlay")?.addEventListener("click", (e) => {
      if (e.target === e.currentTarget) closeInstallGuide();
    });
  }

  function switchTab(tabId) {
    state.activeTab = tabId;
    $$(".tab-panel").forEach((p) => p.classList.remove("active"));
    $(`#tab-${tabId}`)?.classList.add("active");
    $$(".nav-item").forEach((n) => n.classList.remove("active"));
    $(`.nav-item[data-tab="${tabId}"]`)?.classList.add("active");
    updateHeader(tabId);
    scheduleTouchActivity();

    if (tabId === "connect") {
      void ensureConnectUsersLoaded()
        .then(() => refreshConnectList())
        .catch((err) => {
          console.error(err);
          showToast(err.message || "会員一覧の取得に失敗しました");
        });
      return;
    }
    if (tabId === "mypage") {
      renderMyPage(state.currentUser);
      return;
    }
    if (tabId === "home") {
      renderAllBanners();
      renderDashboard(state.dashboard);
      loadDashboardStats();
    }
  }

  function showLoading(show) {
    const el = $("#loading-overlay");
    if (!el) return;
    if (show) {
      loadingDepth += 1;
      el.classList.remove("hidden");
      return;
    }
    loadingDepth = Math.max(0, loadingDepth - 1);
    if (loadingDepth === 0) el.classList.add("hidden");
  }

  function forceHideLoading() {
    loadingDepth = 0;
    const el = $("#loading-overlay");
    if (el) el.classList.add("hidden");
  }

  /** 申請フォーム（サロン / 社長マーク） */
  let applyType = ""; // salon | president
  let applyImageBase64 = "";
  let applyImageMime = "image/jpeg";

  function isValidCorporateNumber(value) {
    return /^\d{13}$/.test(String(value || "").replace(/\D/g, ""));
  }

  function resetApplyForm() {
    applyImageBase64 = "";
    applyImageMime = "image/jpeg";
    const company = $("#apply-company-name");
    const corpNo = $("#apply-corporate-number");
    const url = $("#apply-corporate-url");
    if (company) company.value = "";
    if (corpNo) corpNo.value = "";
    if (url) url.value = "";
    const salonFile = $("#apply-salon-image-file");
    const cardFile = $("#apply-card-image-file");
    if (salonFile) salonFile.value = "";
    if (cardFile) cardFile.value = "";
    const salonStatus = $("#apply-salon-image-status");
    const cardStatus = $("#apply-card-image-status");
    if (salonStatus) salonStatus.textContent = "未選択";
    if (cardStatus) cardStatus.textContent = "未選択";
    const salonPrev = $("#apply-salon-image-preview");
    const cardPrev = $("#apply-card-image-preview");
    if (salonPrev) {
      salonPrev.src = "";
      salonPrev.classList.add("hidden");
    }
    if (cardPrev) {
      cardPrev.src = "";
      cardPrev.classList.add("hidden");
    }
  }

  function openApplyScreen(type) {
    applyType = type;
    resetApplyForm();
    const title = $("#apply-title");
    const lead = $("#apply-lead");
    const salonFields = $("#apply-salon-fields");
    const presidentFields = $("#apply-president-fields");
    const salonName = state.salonLabel || "井口智明オンラインサロン";

    if (type === "salon") {
      if (title) title.textContent = `${salonName}掲載申請`;
      if (lead) {
        lead.textContent =
          "公式LINEに加入していることが分かる画像を添付して申請してください。オーナーが確認後に反映します。";
      }
      salonFields?.classList.remove("hidden");
      presidentFields?.classList.add("hidden");
    } else {
      if (title) title.textContent = "社長マーク掲載申請";
      if (lead) {
        lead.textContent =
          "社名・法人番号と、コーポレートサイトURLまたは名刺画像を提出してください。オーナーが確認後に反映します。";
      }
      salonFields?.classList.add("hidden");
      presidentFields?.classList.remove("hidden");
    }
    $("#apply-screen")?.classList.remove("hidden");
  }

  function closeApplyScreen() {
    $("#apply-screen")?.classList.add("hidden");
    applyType = "";
    resetApplyForm();
  }

  async function handleApplyImageChange(e, kind) {
    const file = e.target.files && e.target.files[0];
    const statusEl = $(kind === "salon" ? "#apply-salon-image-status" : "#apply-card-image-status");
    const previewEl = $(kind === "salon" ? "#apply-salon-image-preview" : "#apply-card-image-preview");
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      showToast("画像ファイルを選んでください");
      e.target.value = "";
      return;
    }
    try {
      showLoading(true);
      if (statusEl) statusEl.textContent = "画像を処理中…";
      const compressed = await compressImageFile(file);
      applyImageBase64 = compressed.base64;
      applyImageMime = compressed.mimeType;
      if (statusEl) statusEl.textContent = "画像を選択済み（送信時にアップロード）";
      if (previewEl) {
        previewEl.src = compressed.dataUrl;
        previewEl.classList.remove("hidden");
      }
    } catch (err) {
      console.error(err);
      applyImageBase64 = "";
      if (statusEl) statusEl.textContent = "画像の処理に失敗しました";
      showToast(err.message || "画像の処理に失敗しました");
    } finally {
      showLoading(false);
    }
  }

  async function submitApplyForm(e) {
    e.preventDefault();
    if (!applyType) return;

    const payload = {
      memberNo: state.identity?.memberNo || state.currentUser?.id || "",
      email: state.identity?.email || state.currentUser?.email || ""
    };

    if (applyType === "salon") {
      if (!applyImageBase64) {
        showToast("公式LINE加入が分かる画像を選択してください");
        return;
      }
      payload.imageBase64 = applyImageBase64;
      payload.mimeType = applyImageMime;
    } else {
      const companyName = ($("#apply-company-name")?.value || "").trim();
      const corporateNumber = ($("#apply-corporate-number")?.value || "").replace(/\D/g, "");
      const evidenceUrl = ($("#apply-corporate-url")?.value || "").trim();
      if (!companyName) {
        showToast("社名（正式名称）を入力してください");
        return;
      }
      if (!isValidCorporateNumber(corporateNumber)) {
        showToast("法人番号は13桁の数字で入力してください");
        return;
      }
      if (!evidenceUrl && !applyImageBase64) {
        showToast("コーポレートサイトURLか名刺画像のどちらかを入力してください");
        return;
      }
      if (evidenceUrl && !/^https?:\/\//i.test(evidenceUrl)) {
        showToast("コーポレートサイトURLは https:// から入力してください");
        return;
      }
      payload.companyName = companyName;
      payload.corporateNumber = corporateNumber;
      payload.evidenceUrl = evidenceUrl;
      if (applyImageBase64) {
        payload.imageBase64 = applyImageBase64;
        payload.mimeType = applyImageMime;
      }
    }

    showLoading(true);
    try {
      const res =
        applyType === "salon"
          ? await GasAPI.requestSalonListing(payload)
          : await GasAPI.requestPresidentMark(payload);
      if (state.currentUser) {
        if (applyType === "salon") {
          state.currentUser.salonListingStatus = res.data?.salonListingStatus || "申請中";
        } else {
          state.currentUser.presidentMarkStatus = res.data?.presidentMarkStatus || "申請中";
        }
      }
      applyMyActivity(res.data?.lastLoginAt);
      updateMypageActionLabels(state.currentUser);
      closeApplyScreen();
      showToast("申請を受け付けました。オーナー確認後に反映されます");
    } catch (err) {
      console.error(err);
      showToast(err.message || "申請に失敗しました");
    } finally {
      showLoading(false);
    }
  }

  function showToast(message) {
    const toast = $("#toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 2500);
  }

  async function refreshMastersFromServer() {
    try {
      const res = await GasAPI.fetchMasters();
      if (res?.data && typeof res.data === "object") {
        state.masters = res.data;
        applyMastersToFilterUI();
        return true;
      }
    } catch (err) {
      console.warn("masters refresh failed", err);
    }
    return false;
  }

  async function openFilterScreen() {
    // ローディング（z-index 999）が残っているとボタン／画面が押せない・見えない
    forceHideLoading();

    const screen = $("#filter-screen");
    if (!screen) {
      showToast("絞り込み画面を開けませんでした");
      return;
    }
    // 先に表示（マスタ適用やGAS待ちで失敗しても「無反応」にしない）
    screen.classList.remove("hidden");

    try {
      applyMastersToFilterUI();
    } catch (err) {
      console.warn("applyMastersToFilterUI failed", err);
    }

    // マスタは裏で更新。初回だけ未取得なら取得後にチップを描き直す
    if (!state.masters || !Object.keys(state.masters).length) {
      void refreshMastersFromServer()
        .then((ok) => {
          if (ok) {
            try {
              applyMastersToFilterUI();
            } catch (err) {
              console.warn("applyMastersToFilterUI failed", err);
            }
          }
        })
        .catch((err) => console.warn("masters refresh failed", err));
    } else {
      void refreshMastersFromServer().catch((err) =>
        console.warn("masters refresh failed", err)
      );
    }

    // 絞り込み適用用に一覧も裏で温める（画面表示は待たない）
    if (!state.allUsers || state.allUsers.length === 0) {
      void ensureConnectUsersLoaded({ silent: true }).catch((err) =>
        console.warn("prefetch users failed", err)
      );
    }
  }

  function closeFilterScreen() {
    $("#filter-screen").classList.add("hidden");
  }

  function uniqueOptions(options) {
    const seen = new Set();
    const out = [];
    const list = Array.isArray(options)
      ? options
      : options == null || options === ""
        ? []
        : [options];
    list.forEach((o) => {
      // {value,label} でも文字列単体でも受け付ける
      const value = String(
        o && typeof o === "object" ? o.value ?? o.label ?? "" : o || ""
      ).trim();
      if (!value || seen.has(value)) return;
      seen.add(value);
      const label =
        o && typeof o === "object"
          ? String(o.label || o.value || value).trim()
          : value;
      out.push({ value, label: label || value });
    });
    return out;
  }

  /** マスタ区分のゆれ（空白など）を吸収してオプション取得 */
  function getMasterCategoryOptions(masters, categoryName) {
    const m = masters || {};
    const want = String(categoryName || "").trim();
    if (!want) return [];
    if (Array.isArray(m[want])) return uniqueOptions(m[want]);
    const hitKey = Object.keys(m).find((k) => String(k || "").trim() === want);
    if (hitKey && Array.isArray(m[hitKey])) return uniqueOptions(m[hitKey]);
    return [];
  }

  function fillEditRequiredSelect(selectId, options, selectedValue) {
    const el = $(selectId);
    if (!el) return;
    let current = String(selectedValue || "").trim();
    // all / すべては編集プルダウンでは使わない
    if (!current || current === "all" || current === "すべて") current = "";
    let opts = uniqueOptions(options).filter(
      (o) => o.value && o.value !== "all" && o.value !== "すべて"
    );
    // マスタに無い既存値でも表示できるよう残す（all系は除く）
    if (current && !opts.some((o) => o.value === current)) {
      opts = [{ value: current, label: current }, ...opts];
    }
    const rows = opts.length
      ? [{ value: "", label: "選択してください" }, ...opts]
      : [{ value: "", label: "選択してください" }];
    el.innerHTML = rows
      .map((o) => {
        const selected = o.value === current ? " selected" : "";
        return `<option value="${escapeHtml(o.value)}"${selected}>${escapeHtml(o.label || o.value)}</option>`;
      })
      .join("");
    el.value = current;
    if (el.value !== current) el.selectedIndex = 0;
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

  function normalizeFilterList(value) {
    if (Array.isArray(value)) {
      return value.map((v) => String(v || "").trim()).filter((v) => v && v !== "all");
    }
    const raw = String(value || "").trim();
    if (!raw || raw === "all") return [];
    return raw.split(/[,、|／\t]+/).map((v) => v.trim()).filter(Boolean);
  }

  function matchesFilterList(userValue, selectedList) {
    const selected = normalizeFilterList(selectedList);
    if (!selected.length) return true;
    const current = String(userValue || "").trim();
    return selected.includes(current);
  }

  /** タグ複数選択: 会員タグのいずれかが一致すればOK（OR） */
  function matchesAnyTagFilter(userTags, selectedList) {
    const selected = normalizeFilterList(selectedList);
    if (!selected.length) return true;
    const tags = normalizeTagList(userTags);
    if (!tags.length) return false;
    return selected.some((t) => tags.includes(t));
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

  function fillMultiChips(containerId, options, selectedValues) {
    const el = $(containerId);
    if (!el) return;
    const selected = new Set((selectedValues || []).map((v) => String(v)));
    const opts = uniqueOptions(options);
    const allowBreak = containerId === "#edit-tag-chips" || containerId === "#filter-tag-chips";
    el.innerHTML = opts
      .map((o) => {
        const label = allowBreak
          ? formatTagChipHtml(o.value, o.label)
          : escapeHtml(o.label || o.value);
        return `<button type="button" class="chip${selected.has(o.value) ? " selected" : ""}${allowBreak ? " chip-multiline" : ""}" data-value="${escapeHtml(o.value)}">${label}</button>`;
      })
      .join("");
  }

  function getSelectedChipValues(containerId) {
    return Array.from(document.querySelectorAll(`${containerId} .chip.selected`))
      .map((el) => String(el.dataset.value || "").trim())
      .filter(Boolean);
  }

  function updateEditTagCount() {
    const note = $("#edit-tag-count");
    if (!note) return;
    const count = getSelectedChipValues("#edit-tag-chips").length;
    note.textContent = `${count} / ${TAG_MAX}`;
  }

  function applyMastersToFilterUI() {
    const m = state.masters || {};
    fillChips("#filter-gender-chips", mapGenderMasterOptions(m["性別"]), canonicalGenderLabel(state.filters.gender) || "all");
    fillMultiChips("#filter-age-chips", m["年代"], normalizeFilterList(state.filters.ageGroup));
    fillMultiChips("#filter-industry-chips", m["業種"], normalizeFilterList(state.filters.industry));
    fillMultiChips("#filter-job-chips", m["職種"], normalizeFilterList(state.filters.jobTitle));
    fillMultiChips("#filter-tag-chips", getActiveTagOptions(), normalizeFilterList(state.filters.tags));
    const regionItems = Array.isArray(m["地域リンク"]) ? m["地域リンク"] : [];
    state.regionLinks = regionItems.length
      ? regionItems
      : [
          { label: "北海道・東北", value: "https://example.com/region/hokkaido-tohoku" },
          { label: "関東", value: "https://example.com/region/kanto" },
          { label: "中部", value: "https://example.com/region/chubu" },
          { label: "中国", value: "https://example.com/region/chugoku" },
          { label: "四国", value: "https://example.com/region/shikoku" },
          { label: "近畿", value: "https://example.com/region/kinki" },
          { label: "九州・沖縄", value: "https://example.com/region/kyushu-okinawa" }
        ];
    const label = $("#region-link-label");
    if (label) label.textContent = "地域を選ぶ";

    // [みんつく] いまの地方の都道府県だけを選択肢に
    const prefSelect = $("#filter-mintuku-pref");
    if (prefSelect && typeof AppMode !== "undefined") {
      const meta = AppMode.getRegionMeta(state.mintukuRegion);
      const prefs = Array.isArray(meta?.prefs) ? meta.prefs.slice() : [];
      const current = String(state.filters.locationPref || "all");
      prefSelect.innerHTML =
        `<option value="all">すべて（この地方）</option>` +
        prefs
          .map(
            (p) =>
              `<option value="${escapeHtml(p)}"${p === current ? " selected" : ""}>${escapeHtml(p)}</option>`
          )
          .join("");
      if (current !== "all" && !prefs.includes(current)) {
        state.filters.locationPref = "all";
        prefSelect.value = "all";
      }
    }
  }

  /** 都道府県 → 地域ブロック名 */
  const PREFECTURE_TO_REGION = {
    北海道: "北海道・東北",
    青森県: "北海道・東北",
    岩手県: "北海道・東北",
    宮城県: "北海道・東北",
    秋田県: "北海道・東北",
    山形県: "北海道・東北",
    福島県: "北海道・東北",
    茨城県: "関東",
    栃木県: "関東",
    群馬県: "関東",
    埼玉県: "関東",
    千葉県: "関東",
    東京都: "関東",
    神奈川県: "関東",
    新潟県: "中部",
    富山県: "中部",
    石川県: "中部",
    福井県: "中部",
    山梨県: "中部",
    長野県: "中部",
    岐阜県: "中部",
    静岡県: "中部",
    愛知県: "中部",
    三重県: "近畿",
    滋賀県: "近畿",
    京都府: "近畿",
    大阪府: "近畿",
    兵庫県: "近畿",
    奈良県: "近畿",
    和歌山県: "近畿",
    鳥取県: "中国",
    島根県: "中国",
    岡山県: "中国",
    広島県: "中国",
    山口県: "中国",
    徳島県: "四国",
    香川県: "四国",
    愛媛県: "四国",
    高知県: "四国",
    福岡県: "九州・沖縄",
    佐賀県: "九州・沖縄",
    長崎県: "九州・沖縄",
    熊本県: "九州・沖縄",
    大分県: "九州・沖縄",
    宮崎県: "九州・沖縄",
    鹿児島県: "九州・沖縄",
    沖縄県: "九州・沖縄"
  };

  function resolveRegionFromLocation(location) {
    const pref = String(location || "").trim();
    if (!pref) return null;
    return PREFECTURE_TO_REGION[pref] || null;
  }

  function resolveRegionUrl(regionName) {
    const rows = state.regionLinks || [];
    const hit = rows.find((r) => String(r.label || "").trim() === regionName);
    return hit?.value || "";
  }

  function openRegionByCurrentLocation() {
    // [みんつく] みんつく内では地域導線を出さない（入口はApomy側）
    if (isMintukuMode()) {
      showToast("みんつくでは地域の切り替えはありません");
      return;
    }
    const location = String(state.currentUser?.location || "").trim();
    if (!location) {
      showToast("現在地が未設定です。プロフィールで現在地を選んでください");
      return;
    }
    // 47都道府県以外（海外など）は地域検索対象外
    if (!Object.prototype.hasOwnProperty.call(PREFECTURE_TO_REGION, location)) {
      showToast("日本在住者のみのサービスとなります。");
      return;
    }
    // [みんつく] Apomyの「地域を選ぶ」→ みんつく地方アプリへ
    if (typeof AppMode !== "undefined" && AppMode.prefectureToRegionId) {
      const mintukuRegionId = AppMode.prefectureToRegionId(location);
      if (!mintukuRegionId) {
        showToast("日本在住者のみのサービスとなります。");
        return;
      }
      const entry = AppMode.mintukuEntryUrl(mintukuRegionId);
      window.location.assign(entry);
      return;
    }
    const region = resolveRegionFromLocation(location);
    if (!region) {
      showToast("日本在住者のみのサービスとなります。");
      return;
    }
    const url = resolveRegionUrl(region);
    if (!url) {
      showToast(`「${region}」の遷移先URLがマスタ未設定です`);
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
    scheduleTouchActivity();
  }

  function resetFiltersUI() {
    state.filters = {
      industry: [],
      gender: "all",
      jobTitle: [],
      ageGroup: [],
      tags: [],
      locationPref: "all"
    };
    applyMastersToFilterUI();
    $$(".filter-card").forEach((c) => c.classList.remove("open"));
  }

  function filterUsersLocal(users, filters = {}) {
    const gender = filters.gender || "all";
    const ageGroup = normalizeFilterList(filters.ageGroup);
    const industry = normalizeFilterList(filters.industry);
    const jobTitle = normalizeFilterList(filters.jobTitle);
    const tags = normalizeFilterList(filters.tags);
    const locationPref = String(filters.locationPref || "all").trim();

    return (users || []).filter((u) => {
      // 性別は単一選択のため必須条件（その他 ↔ LGBTQ は同一扱い）
      if (gender !== "all") {
        const want = canonicalGenderLabel(gender);
        const got = canonicalGenderLabel(u.gender);
        if (want !== got) return false;
      }
      // 同一項目内はOR、項目をまたぐとAND
      // ≒ 考えうる組み合わせ（年代×業種×職種×タグ）のいずれかに一致
      if (!matchesFilterList(u.ageGroup, ageGroup)) return false;
      if (!matchesFilterList(u.industry, industry)) return false;
      if (!matchesFilterList(u.jobTitle, jobTitle)) return false;
      if (!matchesAnyTagFilter(u.tags, tags)) return false;
      // [みんつく] 地方外は一覧に出さない
      if (isMintukuMode() && state.mintukuRegion && typeof AppMode !== "undefined") {
        if (!AppMode.isPrefectureInRegion(u.location, state.mintukuRegion)) return false;
      }
      // [みんつく] 都道府県プルダウン
      if (isMintukuMode() && locationPref && locationPref !== "all") {
        if (String(u.location || "").trim() !== locationPref) return false;
      }
      // [プレジデント] 二重チェック（サーバでも絞る）
      if (isPresidentMode()) {
        if (!u.presidentMark) return false;
        if (!isPresidentMateListed(u)) return false;
      }
      return true;
    });
  }

  function hasActiveFilters(filters = state.filters) {
    if (filters.gender && filters.gender !== "all") return true;
    if (normalizeFilterList(filters.ageGroup).length) return true;
    if (normalizeFilterList(filters.industry).length) return true;
    if (normalizeFilterList(filters.jobTitle).length) return true;
    if (normalizeFilterList(filters.tags).length) return true;
    if (isMintukuMode() && filters.locationPref && filters.locationPref !== "all") return true;
    return false;
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
    normalizeFilterList(state.filters.ageGroup).forEach((v) => parts.push(v));
    normalizeFilterList(state.filters.industry).forEach((v) => parts.push(v));
    normalizeFilterList(state.filters.jobTitle).forEach((v) => parts.push(v));
    normalizeFilterList(state.filters.tags).forEach((v) =>
      parts.push(String(tagLabel(v) || v).replace(/\n/g, ""))
    );
    if (isMintukuMode() && state.filters.locationPref && state.filters.locationPref !== "all") {
      parts.push(state.filters.locationPref);
    }
    el.textContent = `絞り込み: ${parts.join(" / ")}（全 ${state.users.length} 件・No.順）`;
    el.classList.remove("hidden");
  }

  const BOOT_CACHE_KEY = "apomy_boot_cache_v1";

  function readBootCache() {
    try {
      const raw = sessionStorage.getItem(BOOT_CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      return parsed;
    } catch (_) {
      return null;
    }
  }

  function writeBootCache() {
    try {
      sessionStorage.setItem(
        BOOT_CACHE_KEY,
        JSON.stringify({
          banners: state.banners || [],
          masters: state.masters || {},
          settings: state.settings || {},
          dashboard: state.dashboard || null,
          savedAt: Date.now()
        })
      );
    } catch (_) {
      /* ignore */
    }
  }

  function hydrateBootCache() {
    const cached = readBootCache();
    if (!cached) return;
    // 10分以内のキャッシュだけ使う
    if (cached.savedAt && Date.now() - Number(cached.savedAt) > 10 * 60 * 1000) return;
    if (Array.isArray(cached.banners) && !(state.banners && state.banners.length)) {
      state.banners = cached.banners;
    }
    if (cached.masters && typeof cached.masters === "object" && (!state.masters || !Object.keys(state.masters).length)) {
      state.masters = cached.masters;
    }
    if (cached.settings && typeof cached.settings === "object") {
      state.settings = { ...(cached.settings || {}), ...(state.settings || {}) };
    }
    if (cached.dashboard && !state.dashboard) {
      state.dashboard = cached.dashboard;
      lastDashboardAt = Number(cached.savedAt) || Date.now();
    }
  }

  function applySalonSettingsFromState() {
    state.salonUrl = String(state.settings["サロンURL"] || state.salonUrl || "").trim() || state.salonUrl;
    let salonLabel =
      String(state.settings["サロンボタン名"] || state.salonLabel || "").trim() || state.salonLabel;
    if (salonLabel.endsWith("表示")) salonLabel = salonLabel.slice(0, -2).trim();
    state.salonLabel = salonLabel || "井口智明オンラインサロン";
    if (state.currentUser) updateMypageActionLabels(state.currentUser);
  }

  function paintAppShell() {
    applySalonSettingsFromState();
    applyMastersToFilterUI();
    renderDashboard(state.dashboard);
    renderAllBanners();
    refreshConnectList();
    renderMyPage(state.currentUser);
  }

  async function loadSecondaryDataInBackground() {
    try {
      const results = await Promise.allSettled([
        GasAPI.fetchBanners(identityForApi()),
        GasAPI.fetchMasters(),
        GasAPI.fetchSettings()
      ]);
      const bannersRes = results[0].status === "fulfilled" ? results[0].value : null;
      const mastersRes = results[1].status === "fulfilled" ? results[1].value : null;
      const settingsRes = results[2].status === "fulfilled" ? results[2].value : null;

      if (results.some((r) => r.status === "rejected" && isMaintenanceError(r.reason))) {
        forceLogoutForMaintenance("メンテナンス中です。ご迷惑をおかけします。");
        return;
      }

      if (bannersRes?.data) state.banners = bannersRes.data || [];
      if (mastersRes?.data) state.masters = mastersRes.data || {};
      if (settingsRes?.data) state.settings = settingsRes.data || state.settings || {};

      applySalonSettingsFromState();
      applyMastersToFilterUI();
      renderAllBanners();
      if (state.currentUser) updateMypageActionLabels(state.currentUser);

      try {
        const dashboardRes = await GasAPI.fetchDashboard();
        if (dashboardRes?.data) {
          state.dashboard = dashboardRes.data;
          lastDashboardAt = Date.now();
          renderDashboard(state.dashboard);
        }
      } catch (dashErr) {
        console.warn("dashboard failed", dashErr);
        if (isMaintenanceError(dashErr)) {
          forceLogoutForMaintenance("メンテナンス中です。ご迷惑をおかけします。");
          return;
        }
      }
      writeBootCache();
    } catch (err) {
      console.warn("secondary boot load failed", err);
    }
  }

  function currentUsersCacheKey() {
    const filterKey = JSON.stringify(usersFetchParams());
    return `${
      isMintukuMode()
        ? `mintuku:${state.mintukuRegion}`
        : isPresidentMode()
          ? "president"
          : "apomy"
    }|${filterKey}`;
  }

  function invalidateUsersCache() {
    usersLoadedAt = 0;
    usersCacheKey = "";
    try {
      sessionStorage.removeItem(USERS_CACHE_KEY);
    } catch (_) {
      /* ignore */
    }
  }

  function readUsersSessionCache(expectedKey) {
    try {
      const raw = sessionStorage.getItem(USERS_CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.key !== expectedKey) return null;
      if (Date.now() - Number(parsed.at || 0) > USERS_CACHE_TTL_MS) return null;
      if (!Array.isArray(parsed.users)) return null;
      return parsed.users;
    } catch (_) {
      return null;
    }
  }

  function writeUsersSessionCache(key, users) {
    try {
      sessionStorage.setItem(
        USERS_CACHE_KEY,
        JSON.stringify({
          key,
          at: Date.now(),
          users: users || []
        })
      );
    } catch (_) {
      /* quota 超過時はメモリキャッシュのみ */
    }
  }

  /**
   * 繋がる用の会員一覧を必要時だけ取得（ログインでは呼ばない）
   * @param {{ force?: boolean, silent?: boolean }} [options]
   */
  async function ensureConnectUsersLoaded(options = {}) {
    const force = Boolean(options.force);
    const silent = Boolean(options.silent);
    const key = currentUsersCacheKey();

    if (
      !force &&
      usersCacheKey === key &&
      Array.isArray(state.allUsers) &&
      state.allUsers.length > 0 &&
      Date.now() - usersLoadedAt < USERS_CACHE_TTL_MS
    ) {
      return state.allUsers;
    }

    if (!force) {
      const cached = readUsersSessionCache(key);
      if (cached) {
        state.allUsers = applyMintukuScope(cached);
        usersLoadedAt = Date.now();
        usersCacheKey = key;
        return state.allUsers;
      }
    }

    if (usersFetchPromise) return usersFetchPromise;

    usersFetchPromise = (async () => {
      if (!silent) showLoading(true);
      try {
        const res = await GasAPI.fetchUsers(usersFetchParams());
        state.allUsers = applyMintukuScope(res.data || []);
        usersLoadedAt = Date.now();
        usersCacheKey = key;
        writeUsersSessionCache(key, state.allUsers);
        console.log("[apomy] users loaded (connect):", state.allUsers.length);
        return state.allUsers;
      } catch (reason) {
        if (isMaintenanceError(reason)) {
          forceLogoutForMaintenance("メンテナンス中です。ご迷惑をおかけします。");
          throw reason;
        }
        if (isMintukuMode() && isMintukuExpiredError(reason)) {
          showMintukuExpiredScreen(reason);
          throw reason;
        }
        if (isMintukuMode() && isMintukuRegionDeniedError(reason)) {
          if (redirectMintukuToOwnRegion(state.currentUser)) throw reason;
          state.allUsers = [];
          throw reason;
        }
        if (isPresidentMode() && isPresidentDeniedError(reason)) {
          handlePresidentDenied();
          throw reason;
        }
        const detail = String(reason?.message || reason || "").trim();
        if (!GasAPI.isLive) {
          const mockUsers = await MockAPI.fetchUsers({});
          state.allUsers = mockUsers.data || [];
          usersLoadedAt = Date.now();
          usersCacheKey = key;
          return state.allUsers;
        }
        throw new Error(
          detail
            ? `会員データの取得に失敗しました: ${detail}`
            : "会員データの取得に失敗しました"
        );
      } finally {
        usersFetchPromise = null;
        if (!silent) showLoading(false);
      }
    })();

    return usersFetchPromise;
  }

  async function loadAllData() {
    showLoading(true);
    try {
      const identity = state.identity || {};

      // [みんつく] 先に me を完了（初回ログイン日の書き込み・期限判定）。
      // ただし Google ログイン直後は login_ 側で更新済みなので省略する。
      let meRes = null;
      const skipMe = skipMeTouchOnce;
      skipMeTouchOnce = false;
      if (!skipMe && (identity.email || identity.memberNo)) {
        try {
          meRes = await GasAPI.fetchCurrentUser(identityForApi(identity));
        } catch (err) {
          if (isAccessDeniedError(err)) {
            forceLogoutForAccessDenied(err.message || err);
            return;
          }
          if (isMaintenanceError(err)) {
            forceLogoutForMaintenance(err.message || err);
            return;
          }
          if (isMintukuMode() && isMintukuExpiredError(err)) {
            showMintukuExpiredScreen(err);
            return;
          }
          if (isPresidentMode() && isPresidentDeniedError(err)) {
            handlePresidentDenied();
            return;
          }
          console.error("me failed", err);
          showToast(err.message || "プロフィールの取得に失敗しました");
        }
      } else if (!skipMe) {
        showToast("ログイン情報がありません");
        return;
      }

      if (meRes?.data) {
        const wasNew = Boolean(state.currentUser?.isNew);
        state.currentUser = meRes.data;
        if (wasNew) state.currentUser.isNew = true;
        lastTouchAt = Date.now();
        applyMyActivity(meRes.data.lastLoginAt);
        if (redirectApomyUnpublishedToMintuku(state.currentUser)) return;
        if (redirectMintukuToOwnRegion(state.currentUser)) return;
        if (isMintukuMode() && meRes.data.mintukuAccessOk === false) {
          showMintukuExpiredScreen();
          return;
        }
      } else if (skipMe && state.currentUser) {
        if (redirectApomyUnpublishedToMintuku(state.currentUser)) return;
        if (redirectMintukuToOwnRegion(state.currentUser)) return;
        if (isMintukuMode() && state.currentUser.mintukuAccessOk === false) {
          showMintukuExpiredScreen();
          return;
        }
      }

      if (!state.currentUser && (identity.email || identity.memberNo)) {
        showToast("マイページ用プロフィールを取得できませんでした");
      }

      // 前回のバナー／マスタ等があれば先に出して体感を速くする
      hydrateBootCache();

      // 会員一覧はログインでは取らない（繋がるタブ表示時に Lazy Load）
      const secondaryPromise = loadSecondaryDataInBackground();

      paintAppShell();
      maybeOpenRequiredEdit();

      forceHideLoading();
      void secondaryPromise;
      return;
    } catch (err) {
      console.error(err);
      showToast("データの読み込みに失敗しました: " + (err.message || ""));
      try {
        if (!GasAPI.isLive) {
          const mockBanners = await MockAPI.fetchBanners();
          const mockMasters = await MockAPI.fetchMasters();
          state.banners = mockBanners.data || [];
          state.masters = mockMasters.data || {};
        } else {
          state.banners = [];
        }
        paintAppShell();
      } catch (e2) {
        console.error(e2);
      }
    } finally {
      forceHideLoading();
    }
  }

  async function applyFilters() {
    scheduleTouchActivity();
    state.searchVisibleCount = SEARCH_RESULT_PAGE_SIZE;
    let loadingShown = false;
    try {
      // 一覧が無ければ取得（進行中の取得があればそれ待ち。force禁止＝キャッシュ／再利用）
      // ※ここでの再取得が「絞り込みが遅い」主因だった
      if (!state.allUsers || state.allUsers.length === 0) {
        showLoading(true);
        loadingShown = true;
        await ensureConnectUsersLoaded({ silent: true });
      }
      refreshConnectList();
      closeFilterScreen();
      if (state.activeTab !== "connect") {
        state.activeTab = "connect";
        $$(".tab-panel").forEach((p) => p.classList.remove("active"));
        $("#tab-connect")?.classList.add("active");
        $$(".nav-item").forEach((n) => n.classList.remove("active"));
        $(`.nav-item[data-tab="connect"]`)?.classList.add("active");
        updateHeader("connect");
      }
      if (state.users.length === 0) {
        showToast("条件に一致する人がいません");
      } else {
        showToast(`${state.users.length}件のユーザーが見つかりました`);
      }
    } catch (err) {
      console.error(err);
      showToast(err.message || "検索に失敗しました");
    } finally {
      if (loadingShown) showLoading(false);
    }
  }

  const PREFECTURES = [
    "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県",
    "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県",
    "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県", "岐阜県",
    "静岡県", "愛知県", "三重県", "滋賀県", "京都府", "大阪府", "兵庫県",
    "奈良県", "和歌山県", "鳥取県", "島根県", "岡山県", "広島県", "山口県",
    "徳島県", "香川県", "愛媛県", "高知県", "福岡県", "佐賀県", "長崎県",
    "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県", "海外"
  ];

  function getPrefectureOptions() {
    const m = state.masters || {};
    const fromMaster = uniqueOptions(m["都道府県"] || m["現在地"] || []);
    if (fromMaster.length) return fromMaster;
    return PREFECTURES.map((p) => ({ value: p, label: p }));
  }

  const DEFAULT_ANNUAL_SPEND_OPTIONS = [
    "年間0円",
    "年間5,000円未満",
    "年間10,000円未満",
    "年間10,000円以上",
    "年間48,000円以上",
    "年間90,000円以上"
  ];

  function getAnnualSpendOptions() {
    const fromMaster = uniqueOptions((state.masters || {})["年間経費"] || []);
    if (fromMaster.length) return fromMaster;
    return DEFAULT_ANNUAL_SPEND_OPTIONS.map((v) => ({ value: v, label: v }));
  }

  function fillAnnualSpendSelect(selectedValue) {
    const el = $("#edit-annual-spend");
    if (!el) return;
    const opts = [{ value: "", label: "選択してください" }, ...getAnnualSpendOptions()];
    const current = selectedValue || "";
    el.innerHTML = opts
      .map((o) => {
        // 年間経費はマスタの「値」をそのまま表示・保存する
        const text = o.value === "" ? o.label || "選択してください" : o.value;
        return `<option value="${escapeHtml(o.value)}"${o.value === current ? " selected" : ""}>${escapeHtml(text)}</option>`;
      })
      .join("");
    if (current && !opts.some((o) => o.value === current)) {
      el.insertAdjacentHTML(
        "beforeend",
        `<option value="${escapeHtml(current)}" selected>${escapeHtml(current)}</option>`
      );
    }
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

  function displayNameOf(user) {
    return String(user?.nickname || user?.name || "").trim();
  }

  function needsProfileSetup(user) {
    if (!user) return false;
    if (user.isNew) return true;
    if (user.isPublished === false) return true;
    if (!displayNameOf(user)) return true;
    if (!String(user.realName || "").trim()) return true;
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
    if (shouldForceSplash()) return true;
    if (isMintukuMode() && state.mintukuRegion) {
      try {
        const key = `mintuku_intro_${state.mintukuRegion}`;
        if (!sessionStorage.getItem(key)) return true;
      } catch {
        return true;
      }
    }
    return Boolean(state.currentUser?.isNew);
  }

  function welcomeMessagesForMode() {
    if (isMintukuMode()) {
      return [`${mintukuDisplayName()}へようこそ！`, "同じ地方の人と繋がろう"];
    }
    if (isPresidentMode()) {
      return ["PRESIDENT MATEへようこそ！", "社長限定のマッチング"];
    }
    return WELCOME_MESSAGES;
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

        for (const text of welcomeMessagesForMode()) {
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
    if (isMintukuMode() && state.mintukuRegion) {
      try {
        sessionStorage.setItem(`mintuku_intro_${state.mintukuRegion}`, "1");
      } catch {
        /* ignore */
      }
    }
  }

  async function maybeOpenRequiredEdit() {
    await showWelcomeSplashIfNeeded();
    if (!needsProfileSetup(state.currentUser)) return;
    openEditScreen({ required: true });
  }

  function canEditRealName(user) {
    if (!user) return false;
    if (user.isNew) return true;
    return !String(user.realName || "").trim();
  }

  function applyEditNameFieldsState(user) {
    const realInput = $("#edit-real-name");
    const noteFirst = $("#edit-real-name-note-first");
    const noteLocked = $("#edit-real-name-note-locked");
    const nickInput = $("#edit-nickname");

    if (realInput) {
      const editable = canEditRealName(user);
      if (editable) {
        realInput.classList.remove("hidden");
        realInput.disabled = false;
        realInput.value = "";
        realInput.placeholder = "本名（フルネーム）を入力";
        noteFirst?.classList.remove("hidden");
        noteLocked?.classList.add("hidden");
      } else {
        // 登録後は値を出さず、注記のみ（非公開のため）
        realInput.value = "";
        realInput.disabled = true;
        realInput.classList.add("hidden");
        realInput.placeholder = "";
        noteFirst?.classList.add("hidden");
        noteLocked?.classList.remove("hidden");
      }
    }

    if (nickInput) {
      nickInput.disabled = false;
      nickInput.classList.remove("hidden");
      nickInput.value = displayNameOf(user);
      nickInput.placeholder = "ニックネームを入力";
    }
  }

  async function openEditScreen(options = {}) {
    const user = state.currentUser;
    if (!user) {
      showToast("プロフィールを読み込めませんでした");
      return;
    }

    const required = Boolean(options.required) || needsProfileSetup(user);
    state.editRequired = required;

    // マスタ変更をすぐ反映するため、編集画面を開くたびに再取得
    showLoading(true);
    try {
      await refreshMastersFromServer();
    } finally {
      forceHideLoading();
    }

    const m = state.masters || {};
    fillChips("#edit-gender-chips", mapGenderMasterOptions(m["性別"]), canonicalGenderLabel(user.gender) || "all");
    stripAllChip("#edit-gender-chips", user.gender);
    // 新規は性別未選択にして自分で選ばせる（デフォルト男性を強制しない）
    if (user.isNew && !String(user.gender || "").trim()) {
      const genderGrid = $("#edit-gender-chips");
      genderGrid?.querySelectorAll(".chip").forEach((c) => c.classList.remove("selected"));
    }
    updateGenderEditState(user);
    fillChips("#edit-age-chips", m["年代"], user.ageGroup || "all");
    stripAllChip("#edit-age-chips", user.ageGroup);
    // 初回登録は業種・職種を空欄スタート（既存会員は保存値を表示）
    // all / すべては無視して「選択してください」にする
    const normalizeEditSelectValue = (raw) => {
      const v = String(raw || "").trim();
      if (!v || v === "all" || v === "すべて") return "";
      return v;
    };
    const industryForEdit = user.isNew ? "" : normalizeEditSelectValue(user.industry);
    const jobForEdit = user.isNew ? "" : normalizeEditSelectValue(user.jobTitle);
    fillEditRequiredSelect("#edit-industry", getMasterCategoryOptions(m, "業種"), industryForEdit);
    fillEditRequiredSelect("#edit-job", getMasterCategoryOptions(m, "職種"), jobForEdit);

    fillPrefectureSelect("#edit-location", user.location || "");
    fillPrefectureSelect("#edit-hometown", user.hometown || "");
    applyLocationEditLockState(user);
    fillAnnualSpendSelect(user.annualSpend || "");
    // 初回登録、または未掲載の必須入力（掲載停止後の再掲載含む）で表示
    const showPrivacy = Boolean(user.isNew) || (required && user.isPublished === false);
    fillPrivacyPolicySection(showPrivacy);

    fillMultiChips("#edit-tag-chips", getActiveTagOptions(), filterVisibleTags(user.tags));
    updateEditTagCount();

    applyEditNameFieldsState(user);
    const companyCard = $("#edit-company-card");
    const companyInput = $("#edit-company-name");
    if (companyCard && companyInput) {
      if (user.presidentMark) {
        companyCard.classList.remove("hidden");
        companyInput.value = user.companyName || "";
      } else {
        companyCard.classList.add("hidden");
        companyInput.value = "";
      }
    }
    $("#edit-avatar").value = user.avatarUrl || "";
    // 編集欄では改行を除去して表示（シート保存は「保存する」時）
    $("#edit-bio").value = stripProfileNewlines(user.bio || "");
    $("#edit-want").value = stripProfileNewlines(user.wantMeet || "");
    $("#edit-avoid").value = stripProfileNewlines(user.avoidMeet || "");
    updateProfileTextCounts();
    const femaleOnlyEl = $("#edit-female-only");
    if (femaleOnlyEl) femaleOnlyEl.checked = isFemaleOnlyConnect(user);
    updateFemaleOnlyOptionVisibility();
    const split = splitSnsUrls(getUserSnsUrls(user));
    const lineInput = $("#edit-line-url");
    if (lineInput) lineInput.value = split.lineUrl || "";
    editSnsUrls = split.otherUrls.length ? split.otherUrls.slice() : [];
    renderEditSnsList();
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
    el.querySelectorAll(".chip").forEach((c) => c.classList.remove("selected"));
    const current = String(selectedValue || "").trim();
    if (!current || current === "all" || current === "すべて") return;
    const match = el.querySelector(`.chip[data-value="${CSS.escape(current)}"]`);
    if (match) match.classList.add("selected");
  }

  function canEditGender(user = state.currentUser) {
    // 初回（新規）または性別未設定なら選択可
    if (user?.isNew) return true;
    return !String(user?.gender || "").trim();
  }

  function getPrivacyPolicyParagraphs() {
    const items = uniqueOptions((state.masters || {})["プライバシーポリシー"] || []);
    const chunks = [];
    items.forEach((o) => {
      const text = String(o.label || o.value || "")
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .trim();
      if (!text) return;
      // 空行区切りがあれば段落に分割
      const parts = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
      if (parts.length) chunks.push(...parts);
      else chunks.push(text);
    });
    return chunks;
  }

  function fillPrivacyPolicySection(show) {
    const card = $("#edit-privacy-card");
    const body = $("#edit-privacy-body");
    const agree = $("#edit-privacy-agree");
    if (!card || !body) return;
    if (!show) {
      card.classList.add("hidden");
      if (agree) agree.checked = false;
      body.innerHTML = "";
      return;
    }
    const paragraphs = getPrivacyPolicyParagraphs();
    if (paragraphs.length) {
      body.innerHTML = paragraphs.map((t) => `<p>${escapeHtml(t)}</p>`).join("");
    } else {
      body.innerHTML = `<p class="privacy-empty">プライバシーポリシーがまだ設定されていません。オーナーがマスタ（区分＝プライバシーポリシー）に追加できます。</p>`;
    }
    if (agree) agree.checked = false;
    card.classList.remove("hidden");
  }

  function updateGenderEditState(user = state.currentUser) {
    const grid = $("#edit-gender-chips");
    const note = $("#edit-gender-note");
    const editable = canEditGender(user);
    if (grid) {
      grid.dataset.locked = editable ? "false" : "true";
      grid.querySelectorAll(".chip").forEach((chip) => {
        chip.classList.toggle("is-disabled", !editable);
        chip.setAttribute("aria-disabled", editable ? "false" : "true");
        chip.tabIndex = editable ? 0 : -1;
      });
    }
    if (note) {
      note.textContent = editable
        ? "※性別選択が可能なのは初回のみです"
        : "※性別変更を希望する際はオーナーへ連絡してください。";
    }
    updateFemaleOnlyOptionVisibility(user);
  }

  function getEditGenderValue(user = state.currentUser) {
    if (canEditGender(user)) {
      return String(getSelectedChipValue("#edit-gender-chips") || "").trim();
    }
    return String(user?.gender || "").trim();
  }

  function updateFemaleOnlyOptionVisibility(user = state.currentUser) {
    const card = $("#edit-female-only-card");
    const check = $("#edit-female-only");
    if (!card) return;
    const isFemale = getEditGenderValue(user) === "女性";
    card.classList.toggle("hidden", !isFemale);
    if (!isFemale && check) check.checked = false;
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
    syncEditSnsFromDom();
    const lineRaw = ($("#edit-line-url")?.value || "").trim();
    const snsCheck = validateEditSnsUrls(lineRaw, editSnsUrls);
    const editableGender = canEditGender(state.currentUser);
    const gender = editableGender
      ? getSelectedChipValue("#edit-gender-chips")
      : String(state.currentUser?.gender || "").trim();
    const femaleOnlyConnect =
      gender === "女性" && Boolean($("#edit-female-only")?.checked);
    const editableRealName = canEditRealName(state.currentUser);
    const realName = editableRealName
      ? ($("#edit-real-name")?.value || "").trim()
      : String(state.currentUser?.realName || "").trim();
    const nickname = ($("#edit-nickname")?.value || "").trim();
    const bio = stripProfileNewlines($("#edit-bio")?.value || "").trim();
    const wantMeet = stripProfileNewlines($("#edit-want")?.value || "").trim();
    const avoidMeet = stripProfileNewlines($("#edit-avoid")?.value || "").trim();
    let textError = "";
    if (bio.length > BIO_MAX) {
      textError = `自己紹介は${BIO_MAX}文字以内で入力してください`;
    } else if (wantMeet.length > WANT_MEET_MAX) {
      textError = `「こんな人と繋がりたい」は${WANT_MEET_MAX}文字以内で入力してください`;
    } else if (avoidMeet.length > AVOID_MEET_MAX) {
      textError = `「こんな人とは繋がりたくない」は${AVOID_MEET_MAX}文字以内で入力してください`;
    }
    return {
      realName,
      nickname,
      name: nickname, // 互換: 公開表示名
      gender,
      ageGroup: getSelectedChipValue("#edit-age-chips"),
      industry: $("#edit-industry").value || "",
      jobTitle: ($("#edit-job")?.value || "").trim(),
      location: ($("#edit-location").value || "").trim(),
      hometown: ($("#edit-hometown").value || "").trim(),
      avatarUrl: ($("#edit-avatar").value || "").trim(),
      bio,
      wantMeet,
      avoidMeet,
      tags: filterVisibleTags(getSelectedChipValues("#edit-tag-chips")),
      annualSpend: ($("#edit-annual-spend")?.value || "").trim(),
      companyName: state.currentUser?.presidentMark
        ? ($("#edit-company-name")?.value || "").trim()
        : String(state.currentUser?.companyName || "").trim(),
      femaleOnlyConnect,
      snsLinks: snsCheck.ok ? snsCheck.urls : [],
      _snsError: snsCheck.ok ? "" : snsCheck.message,
      _textError: textError
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

  function applyLocationEditLockState(user) {
    const sel = $("#edit-location");
    const help = $("#edit-location-help");
    if (!sel) return;
    const locked = Boolean(user?.locationChangeLocked);
    sel.disabled = locked;
    if (help) {
      if (locked) {
        const next = String(user.locationChangeNextDate || "").trim();
        help.textContent = next
          ? `現在地は変更後30日間、新たな変更はできません（次回変更可能日: ${next}）`
          : "現在地は変更後30日間、新たな変更はできません";
      } else if (String(user?.location || "").trim()) {
        help.textContent =
          "現在地を変更すると、変更後30日間は新たな変更はできません。地方が変わる場合はみんつく番号も付け直されます。";
      } else {
        help.textContent = "お引越しする際は現在地の変更とオーナーへお問合せください";
      }
    }
  }

  async function saveProfile(e) {
    e.preventDefault();
    const profile = collectEditForm();
    if (!profile.realName) {
      showToast("本名（フルネーム）を入力してください（公開されません）");
      return;
    }
    if (!profile.nickname) {
      showToast("ニックネームを入力してください");
      return;
    }
    if (!profile.gender || profile.gender === "all") {
      showToast("性別を選択してください");
      return;
    }
    if (!profile.ageGroup || profile.ageGroup === "all") {
      showToast("年代を選択してください");
      return;
    }
    const privacyCard = $("#edit-privacy-card");
    if (privacyCard && !privacyCard.classList.contains("hidden")) {
      if (!$("#edit-privacy-agree")?.checked) {
        showToast("プライバシーポリシーに同意してください");
        return;
      }
    }
    if (!profile.location) {
      showToast("現在地を選択してください");
      return;
    }
    const prevLocation = String(state.currentUser?.location || "").trim();
    const nextLocation = String(profile.location || "").trim();
    if (prevLocation && nextLocation && prevLocation !== nextLocation) {
      if (state.currentUser?.locationChangeLocked) {
        const next = String(state.currentUser.locationChangeNextDate || "").trim();
        showToast(
          next
            ? `現在地は変更後30日間、新たな変更はできません（次回変更可能日: ${next}）`
            : "現在地は変更後30日間、新たな変更はできません"
        );
        return;
      }
      const ok = confirm(
        "現在地は変更後30日間、新たな変更はできません。\n変更してよろしいですか？"
      );
      if (!ok) return;
    }
    if (!profile.industry) {
      showToast("業種を選択してください");
      return;
    }
    if (!profile.jobTitle) {
      showToast("職種を選択してください");
      return;
    }
    if (!profile.annualSpend) {
      showToast("人脈拡大の為の年間経費（非公開）を選択してください");
      return;
    }
    if (profile._snsError) {
      showToast(profile._snsError);
      return;
    }
    if (profile._textError) {
      showToast(profile._textError);
      return;
    }
    const { _snsError, _textError, ...profilePayload } = profile;

    const shouldPublish = state.editRequired || state.currentUser?.isPublished === false;

    showLoading(true);
    try {
      const res = await GasAPI.updateProfile({
        memberNo: state.identity?.memberNo || state.currentUser?.id || "",
        email: state.identity?.email || state.currentUser?.email || "",
        profile: profilePayload,
        publish: shouldPublish
      });
      // GAS未再デプロイ時でもフォーム値を落とさない
      state.currentUser = {
        ...state.currentUser,
        ...profilePayload,
        ...(res.data || {})
      };
      state.currentUser.nickname =
        state.currentUser.nickname || profilePayload.nickname || "";
      state.currentUser.name = state.currentUser.nickname;
      state.currentUser.realName =
        state.currentUser.realName || profilePayload.realName || "";
      state.currentUser.femaleOnlyConnect = Boolean(profilePayload.femaleOnlyConnect);
      state.currentUser.tags = normalizeTagList(
        Array.isArray(profilePayload.tags) && profilePayload.tags.length
          ? profilePayload.tags
          : res.data?.tags ?? profilePayload.tags
      );
      if (!state.currentUser.snsLinks) {
        state.currentUser.snsLinks = profilePayload.snsLinks || [];
      }
      if (shouldPublish) {
        state.currentUser.isPublished = res.data?.isPublished !== false;
        state.currentUser.isNew = false;
        if (res.data?.mintukuListed !== undefined) {
          state.currentUser.mintukuListed = Boolean(res.data.mintukuListed);
        }
        if (res.data?.mintukuNumber) {
          state.currentUser.mintukuNumber = String(res.data.mintukuNumber);
        }
      }
      applyMyActivity(state.currentUser.lastLoginAt);

      const idx = state.allUsers.findIndex((u) => u.id === state.currentUser.id);
      if (idx >= 0) {
        const publicUser = { ...state.currentUser };
        delete publicUser.realName;
        delete publicUser.annualSpend;
        state.allUsers[idx] = publicUser;
      }
      refreshConnectList();
      renderMyPage(state.currentUser);
      Session.save({
        email: state.identity?.email || state.currentUser.email || "",
        memberNo: state.currentUser.id || "",
        name: state.currentUser.nickname || state.currentUser.name || ""
      });
      state.editRequired = false;
      $("#edit-screen").classList.add("hidden");
      invalidateUsersCache();
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
    hideMintukuExpiredScreen();
    $("#access-denied-screen")?.classList.add("hidden");
    $("#maintenance-screen")?.classList.add("hidden");
    $("#login-screen").classList.remove("hidden");
    $("#app-screen").classList.add("hidden");
    closeFilterScreen();
    closeEditScreen(true);
    setupGoogleButton("google-btn-host");
  }

  function isAccessDeniedError(err) {
    const msg = String(err?.message || err || "");
    return msg.includes("アクセスが拒否されました");
  }

  function isMaintenanceError(err) {
    const msg = String(err?.message || err || "");
    return msg.includes("メンテナンス中です");
  }

  function isMaintenanceOn(settings) {
    const raw = settings?.["メンテナンス"];
    if (raw === true || raw === 1) return true;
    const s = String(raw || "").trim().toUpperCase();
    return s === "TRUE" || s === "1" || s === "○" || s === "はい";
  }

  function resolveOfficialLineUrl(masters = state.masters) {
    const items = getMasterCategoryOptions(masters, "公式LINE");
    for (const item of items) {
      const url = String(item?.value || item?.label || "").trim();
      if (/^https?:\/\//i.test(url)) return url;
    }
    return "";
  }

  function applyAccessDeniedLineUrl(url) {
    const link = $("#access-denied-line-link");
    const btn = $("#access-denied-line-btn");
    const safe = String(url || "").trim();
    if (link) {
      if (safe) {
        link.href = safe;
        link.classList.remove("is-disabled");
      } else {
        link.removeAttribute("href");
        link.classList.add("is-disabled");
      }
    }
    if (btn) {
      if (safe) {
        btn.href = safe;
        btn.classList.remove("hidden");
      } else {
        btn.classList.add("hidden");
      }
    }
  }

  async function showAccessDeniedScreen() {
    state.isLoggedIn = false;
    state.identity = null;
    state.editRequired = false;
    closeConnectMenu();
    $("#login-screen")?.classList.add("hidden");
    $("#app-screen")?.classList.add("hidden");
    $("#maintenance-screen")?.classList.add("hidden");
    $("#access-denied-screen")?.classList.remove("hidden");
    closeFilterScreen();
    closeEditScreen(true);

    applyAccessDeniedLineUrl(resolveOfficialLineUrl());
    try {
      const res = await GasAPI.fetchMasters();
      if (res?.data) {
        state.masters = res.data;
        applyAccessDeniedLineUrl(resolveOfficialLineUrl(res.data));
      }
    } catch (err) {
      console.warn("access-denied masters fetch failed", err);
    }
  }

  function showMaintenanceScreen() {
    state.isLoggedIn = false;
    state.identity = null;
    state.editRequired = false;
    closeConnectMenu();
    $("#login-screen")?.classList.add("hidden");
    $("#app-screen")?.classList.add("hidden");
    $("#access-denied-screen")?.classList.add("hidden");
    $("#maintenance-screen")?.classList.remove("hidden");
    closeFilterScreen();
    closeEditScreen(true);
    // 一般ユーザーにはログインを出さない。管理者のみロゴ連打 / ?admin=1 で解錠
    hideMaintenanceAdminLogin();
    bindMaintenanceAdminUnlock();
    if (shouldUnlockMaintenanceAdmin()) {
      revealMaintenanceAdminLogin();
    }
  }

  function hideMaintenanceAdminLogin() {
    const panel = $("#maintenance-admin-panel");
    const host = $("#maintenance-google-btn-host");
    panel?.classList.add("hidden");
    if (host) host.innerHTML = "";
  }

  function revealMaintenanceAdminLogin() {
    const panel = $("#maintenance-admin-panel");
    if (!panel) return;
    panel.classList.remove("hidden");
    setupGoogleButton("maintenance-google-btn-host");
  }

  function shouldUnlockMaintenanceAdmin() {
    try {
      const q = new URLSearchParams(window.location.search || "");
      return q.get("admin") === "1";
    } catch {
      return false;
    }
  }

  function bindMaintenanceAdminUnlock() {
    const logo = $("#maintenance-logo");
    if (!logo || logo.dataset.adminUnlockBound === "1") return;
    logo.dataset.adminUnlockBound = "1";
    let taps = 0;
    let resetTimer = null;
    const NEED = 5;
    const WINDOW_MS = 2500;
    logo.addEventListener("click", () => {
      taps += 1;
      if (resetTimer) clearTimeout(resetTimer);
      resetTimer = setTimeout(() => {
        taps = 0;
      }, WINDOW_MS);
      if (taps < NEED) return;
      taps = 0;
      if (resetTimer) clearTimeout(resetTimer);
      revealMaintenanceAdminLogin();
    });
  }

  /** 拒否時: セッション破棄して拒否画面へ */
  function forceLogoutForAccessDenied(_message) {
    try {
      Session.clear();
    } catch (err) {
      console.warn(err);
    }
    try {
      window.google?.accounts?.id?.disableAutoSelect?.();
    } catch (err) {
      console.warn(err);
    }
    state.currentUser = null;
    state.allUsers = [];
    state.users = [];
    state.banners = [];
    state.dashboard = null;
    state.identity = null;
    state.isLoggedIn = false;
    state.editRequired = false;
    invalidateUsersCache();
    showAccessDeniedScreen();
  }

  /** メンテ時: セッション破棄してメンテ画面へ */
  function forceLogoutForMaintenance(_message) {
    try {
      Session.clear();
    } catch (err) {
      console.warn(err);
    }
    try {
      window.google?.accounts?.id?.disableAutoSelect?.();
    } catch (err) {
      console.warn(err);
    }
    state.currentUser = null;
    state.allUsers = [];
    state.users = [];
    state.banners = [];
    state.dashboard = null;
    state.identity = null;
    state.isLoggedIn = false;
    state.editRequired = false;
    invalidateUsersCache();
    showMaintenanceScreen();
  }

  /** 開発者用: セッション破棄してログイン画面へ */
  function logoutToLogin() {
    try {
      Session.clear();
    } catch (err) {
      console.warn(err);
    }
    try {
      window.google?.accounts?.id?.disableAutoSelect?.();
    } catch (err) {
      console.warn(err);
    }
    state.currentUser = null;
    state.allUsers = [];
    state.users = [];
    state.banners = [];
    state.dashboard = null;
    state.identity = null;
    state.isLoggedIn = false;
    state.editRequired = false;
    invalidateUsersCache();
    showToast("ログアウトしました");
    showLogin();
  }

  /** ヘッダー右上タイトルを連続タップで開発者ログアウト */
  function bindDevLogoutOnHeaderTitle() {
    const title = $("#header-title");
    if (!title || title.dataset.devLogoutBound === "1") return;
    title.dataset.devLogoutBound = "1";
    let taps = 0;
    let resetTimer = null;
    const NEED = 6;
    const WINDOW_MS = 2500;
    title.addEventListener("click", (e) => {
      e.preventDefault();
      taps += 1;
      if (resetTimer) clearTimeout(resetTimer);
      resetTimer = setTimeout(() => {
        taps = 0;
      }, WINDOW_MS);
      if (taps < NEED) return;
      taps = 0;
      if (resetTimer) clearTimeout(resetTimer);
      logoutToLogin();
    });
  }

  function showApp() {
    state.isLoggedIn = true;
    $("#access-denied-screen")?.classList.add("hidden");
    $("#maintenance-screen")?.classList.add("hidden");
    $("#login-screen").classList.add("hidden");
    $("#app-screen").classList.remove("hidden");
    switchTab("home");
    // テスト用 ?splash=1 はデータ読み込みを待たずすぐ出す
    if (shouldForceSplash()) {
      return showWelcomeSplashIfNeeded().finally(() => loadAllData());
    }
    return loadAllData();
  }

  async function completeLoginWithIdToken(idToken) {
    showLoading(true);
    try {
      const loginPayload = { idToken };
      if (isMintukuMode() && state.mintukuRegion) {
        loginPayload.app = "mintuku";
        loginPayload.region = state.mintukuRegion;
      }
      if (isPresidentMode()) {
        loginPayload.app = "president";
      }
      const loginRes = await GasAPI.loginWithGoogle(loginPayload);
      const user = loginRes.data;
      state.identity = {
        email: user.email,
        memberNo: user.id
      };
      state.currentUser = user;
      Session.save({
        email: user.email,
        memberNo: user.id,
        name: user.nickname || user.name || ""
      });
      showToast("ログインしました");
      applyMyActivity(user.lastLoginAt);
      lastTouchAt = Date.now();
      // ログイン処理で最終ログイン・みんつく採番済みなので直後の me は省略
      skipMeTouchOnce = true;
      await showApp();
    } catch (err) {
      console.error(err);
      if (isAccessDeniedError(err)) {
        forceLogoutForAccessDenied(err.message);
      } else if (isMaintenanceError(err)) {
        forceLogoutForMaintenance(err.message);
      } else if (isPresidentMode() && isPresidentDeniedError(err)) {
        handlePresidentDenied();
      } else {
        showToast(err.message || "ログインに失敗しました");
      }
    } finally {
      forceHideLoading();
    }
  }

  function setupGoogleButton(buttonHostId = "google-btn-host") {
    const hint = $("#login-hint");
    const isMainLogin = buttonHostId === "google-btn-host";
    try {
      if (!(AppConfig.GOOGLE_CLIENT_ID || "").trim()) {
        if (hint && isMainLogin) {
          hint.textContent =
            "js/config.js の GOOGLE_CLIENT_ID を設定してください。Google Cloud で OAuth クライアント（ウェブ）を作成し、生成元に http://localhost:3000 を追加します。";
          hint.classList.remove("is-loading");
          hint.classList.remove("hidden");
        }
        const host = document.getElementById(buttonHostId);
        if (host) host.innerHTML = "";
        return;
      }

      // GSI 読込中は最初から案内を出す
      if (hint && isMainLogin) {
        hint.textContent = "Googleログインを読み込み中…";
        hint.classList.add("is-loading");
        hint.classList.remove("hidden");
      }

      const clearLoadingHint = () => {
        if (hint && isMainLogin) {
          hint.textContent = "";
          hint.classList.remove("is-loading");
          hint.classList.add("hidden");
        }
      };

      const start = () => {
        GoogleAuth.init({
          buttonHostId,
          onCredential: (err, idToken) => {
            if (err) {
              showToast(err.message || "認証に失敗しました");
              return;
            }
            completeLoginWithIdToken(idToken);
          }
        });
        clearLoadingHint();
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
          } else if (tries > 100) {
            clearInterval(timer);
            if (hint && isMainLogin) {
              hint.textContent = "Googleログインの読み込みに失敗しました。ページを再読み込みしてください。";
              hint.classList.remove("is-loading");
              hint.classList.remove("hidden");
            }
          }
        }, 100);
      }
    } catch (err) {
      console.error(err);
      if (hint && isMainLogin) {
        hint.textContent = err.message || "Googleログインを初期化できませんでした";
        hint.classList.remove("is-loading");
        hint.classList.remove("hidden");
      }
    }
  }

  /**
   * 起動時メンテ判定。
   * @returns {Promise<boolean>} true=メンテ画面表示済み（またはバイパスでアプリ起動済み）
   */
  async function checkAndApplyMaintenanceGate() {
    try {
      // 起動をブロックしすぎないよう短めタイムアウト
      const res = await Promise.race([
        GasAPI.fetchSettings(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("settings timeout")), 8000)
        )
      ]);
      const settings = res?.data || {};
      state.settings = settings;
      if (!isMaintenanceOn(settings)) return false;

      const saved = Session.load();
      if (saved?.email || saved?.memberNo) {
        state.identity = {
          email: saved.email || "",
          memberNo: saved.memberNo || ""
        };
        try {
          const meRes = await GasAPI.fetchCurrentUser(state.identity);
          const user = meRes?.data;
          if (user) {
            state.currentUser = user;
            showToast("ようこそ、" + (saved.name || user.nickname || user.name || "会員") + "さん");
            await showApp();
            return true;
          }
        } catch (err) {
          if (isAccessDeniedError(err)) {
            forceLogoutForAccessDenied(err.message);
            return true;
          }
          // メンテ対象 or その他 → メンテ画面へ
          try {
            Session.clear();
          } catch (_) {
            /* ignore */
          }
          state.identity = null;
        }
      }

      showMaintenanceScreen();
      return true;
    } catch (err) {
      console.warn("maintenance gate settings fetch failed", err);
      return false;
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
    bindDevLogoutOnHeaderTitle();
    bindInstallAppEvents();
    bindConnectJumpEvents();

    $("#access-denied-back-login")?.addEventListener("click", () => {
      showLogin();
    });

    document.addEventListener("click", (e) => {
      const guarded = e.target.closest("a.sns-link[data-sns-guard='female-only']");
      if (!guarded) return;
      e.preventDefault();
      e.stopPropagation();
      showToast("こちらのユーザーは女性のみのつながりを求めております");
    });

    $$(".nav-item").forEach((item) => {
      item.addEventListener("click", () => switchTab(item.dataset.tab));
    });

    $("#search-open-btn")?.addEventListener("click", () => {
      scheduleTouchActivity();
      void openFilterScreen().catch((err) => {
        console.error(err);
        showToast(err.message || "絞り込み画面を開けませんでした");
      });
    });
    $("#filter-back")?.addEventListener("click", closeFilterScreen);

    $$(".filter-card-toggle").forEach((btn) => {
      btn.addEventListener("click", () => {
        const card = btn.closest(".filter-card");
        const willOpen = !card.classList.contains("open");
        $$(".filter-card").forEach((c) => c.classList.remove("open"));
        if (willOpen) card.classList.add("open");
      });
    });

    $("#filter-gender-chips")?.addEventListener("click", (e) => {
      const chip = e.target.closest(".chip");
      if (!chip) return;
      const grid = chip.parentElement;
      grid.querySelectorAll(".chip").forEach((c) => c.classList.remove("selected"));
      chip.classList.add("selected");
    });

    ["#filter-age-chips", "#filter-industry-chips", "#filter-job-chips", "#filter-tag-chips"].forEach((id) => {
      $(id)?.addEventListener("click", (e) => {
        const chip = e.target.closest(".chip");
        if (!chip) return;
        chip.classList.toggle("selected");
      });
    });

    $("#btn-region-link")?.addEventListener("click", () => {
      openRegionByCurrentLocation();
    });

    $("#btn-president-mate-link")?.addEventListener("click", () => {
      scheduleTouchActivity();
      if (isMintukuMode() || isPresidentMode()) return;
      const user = state.currentUser;
      if (user?.presidentMark) {
        const url =
          typeof AppMode !== "undefined" && AppMode.presidentEntryUrl
            ? AppMode.presidentEntryUrl()
            : "president/index.html";
        window.location.assign(url);
        return;
      }
      showToast("社長承認者のみアクセスできます。マイページから社長申請して下さい。");
    });

    $("#btn-search").addEventListener("click", () => {
      state.filters = {
        gender: getSelectedChipValue("#filter-gender-chips"),
        ageGroup: getSelectedChipValues("#filter-age-chips"),
        industry: getSelectedChipValues("#filter-industry-chips"),
        jobTitle: getSelectedChipValues("#filter-job-chips"),
        tags: getSelectedChipValues("#filter-tag-chips"),
        locationPref: $("#filter-mintuku-pref")?.value || "all"
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
    bindProfileTextLimits();
    updateProfileTextCounts();

    $("#btn-add-sns")?.addEventListener("click", () => {
      syncEditSnsFromDom();
      if (editSnsUrls.length >= SNS_OTHER_MAX) return;
      editSnsUrls.push("");
      renderEditSnsList();
    });
    $("#edit-sns-list")?.addEventListener("click", (e) => {
      const removeBtn = e.target.closest("[data-remove-sns]");
      if (!removeBtn) return;
      syncEditSnsFromDom();
      const idx = Number(removeBtn.dataset.removeSns);
      editSnsUrls.splice(idx, 1);
      renderEditSnsList();
    });
    $("#edit-sns-list")?.addEventListener("input", (e) => {
      const input = e.target.closest(".edit-sns-url");
      if (!input) return;
      const row = input.closest(".edit-sns-row");
      if (!row) return;
      const preview = row.querySelector(".edit-sns-preview");
      const type = detectSnsType(normalizeSnsUrl(input.value));
      const meta = type ? SNS_META[type] : null;
      if (preview) {
        preview.className = `edit-sns-preview ${meta ? meta.cls : ""}`;
        preview.innerHTML = `<i class="${meta ? meta.icon : "fa-solid fa-question"}"></i>`;
      }
    });

    ["#edit-gender-chips", "#edit-age-chips"].forEach((id) => {
      $(id)?.addEventListener("click", (e) => {
        const chip = e.target.closest(".chip");
        if (!chip) return;
        const grid = chip.parentElement;
        if (id === "#edit-gender-chips" && grid?.dataset.locked === "true") return;
        grid.querySelectorAll(".chip").forEach((c) => c.classList.remove("selected"));
        chip.classList.add("selected");
        if (id === "#edit-gender-chips") updateFemaleOnlyOptionVisibility();
      });
    });

    $("#edit-tag-chips")?.addEventListener("click", (e) => {
      const chip = e.target.closest(".chip");
      if (!chip) return;
      if (chip.classList.contains("selected")) {
        chip.classList.remove("selected");
        updateEditTagCount();
        return;
      }
      const count = getSelectedChipValues("#edit-tag-chips").length;
      if (count >= TAG_MAX) {
        showToast(`タグは最大${TAG_MAX}つまでです`);
        return;
      }
      chip.classList.add("selected");
      updateEditTagCount();
    });

    $("#btn-salon").addEventListener("click", async () => {
      const user = state.currentUser;
      const salonStatus = String(user?.salonListingStatus || "なし");

      // 掲載許可済みのみ一覧へ。申請中は閲覧不可
      if (user?.salonListing) {
        goToSalonConnectPage();
        return;
      }
      if (salonStatus === "申請中") {
        showToast("申請中です。オーナー確認後に閲覧できます");
        return;
      }
      openApplyScreen("salon");
    });
    $("#btn-president-badge").addEventListener("click", () => {
      const user = state.currentUser;
      if (user?.presidentMark) {
        showToast("すでに社長マーク掲載済みです");
        return;
      }
      if (String(user?.presidentMarkStatus || "") === "申請中") {
        showToast("申請中です。オーナーの確認をお待ちください");
        return;
      }
      openApplyScreen("president");
    });
    $("#apply-back")?.addEventListener("click", closeApplyScreen);
    $("#apply-form")?.addEventListener("submit", submitApplyForm);
    $("#apply-salon-image-file")?.addEventListener("change", (e) => handleApplyImageChange(e, "salon"));
    $("#apply-card-image-file")?.addEventListener("change", (e) => handleApplyImageChange(e, "card"));
    $("#btn-stop-listing").addEventListener("click", async () => {
      if (!confirm("掲載を停止しますか？")) return;
      try {
        showLoading(true);
        const res = await GasAPI.stopListing(state.identity || {});
        if (state.currentUser) {
          state.currentUser.isPublished = false;
        }
        applyMyActivity(res.data?.lastLoginAt);
        invalidateUsersCache();
        showToast("掲載を停止しました。再開するにはプロフィールを保存してください");
        openEditScreen({ required: true });
      } catch (err) {
        console.error(err);
        showToast(err.message || "掲載停止に失敗しました");
      } finally {
        showLoading(false);
      }
    });

    // [みんつく] Apomy掲載のみ停止（みんつくには残る）
    $("#btn-stop-apomy-from-mintuku")?.addEventListener("click", async () => {
      if (!confirm("Apomy（全国）の掲載だけを停止しますか？\nみんつくには引き続き掲載されます。")) return;
      try {
        showLoading(true);
        const res = await GasAPI.stopListing(identityForApi());
        if (state.currentUser) {
          state.currentUser.isPublished = false;
        }
        try {
          localStorage.setItem("apomy_open_mintuku_after_stop", "1");
        } catch (_) {
          /* ignore */
        }
        applyMyActivity(res.data?.lastLoginAt);
        updateMypageActionLabels(state.currentUser);
        invalidateUsersCache();
        showToast("Apomyの掲載を停止しました（みんつくには残ります）");
      } catch (err) {
        console.error(err);
        showToast(err.message || "停止に失敗しました");
      } finally {
        showLoading(false);
      }
    });

    $("#btn-resume-apomy-from-mintuku")?.addEventListener("click", async () => {
      if (!confirm("Apomy（全国）の掲載を再開しますか？")) return;
      try {
        showLoading(true);
        const res = await GasAPI.resumeListing(identityForApi());
        if (state.currentUser) {
          state.currentUser.isPublished = res.data?.isPublished !== false;
          if (res.data?.mintukuListed !== undefined) {
            state.currentUser.mintukuListed = Boolean(res.data.mintukuListed);
          }
        }
        try {
          localStorage.removeItem("apomy_open_mintuku_after_stop");
        } catch (_) {
          /* ignore */
        }
        applyMyActivity(res.data?.lastLoginAt);
        updateMypageActionLabels(state.currentUser);
        invalidateUsersCache();
        showToast("Apomyの掲載を再開しました");
      } catch (err) {
        console.error(err);
        showToast(err.message || "再開に失敗しました");
      } finally {
        showLoading(false);
      }
    });

    $("#btn-stop-mintuku-listing")?.addEventListener("click", async () => {
      if (!confirm("みんつくの掲載を停止しますか？")) return;
      try {
        showLoading(true);
        const res = await GasAPI.stopMintukuListing(identityForApi());
        if (state.currentUser) {
          state.currentUser.mintukuListed = false;
        }
        applyMyActivity(res.data?.lastLoginAt);
        updateMypageActionLabels(state.currentUser);
        invalidateUsersCache();
        showToast("みんつくの掲載を停止しました");
      } catch (err) {
        console.error(err);
        showToast(err.message || "停止に失敗しました");
      } finally {
        showLoading(false);
      }
    });

    $("#btn-resume-mintuku-listing")?.addEventListener("click", async () => {
      if (!confirm("みんつくの掲載を再開しますか？")) return;
      try {
        showLoading(true);
        const res = await GasAPI.resumeMintukuListing(identityForApi());
        if (state.currentUser) {
          state.currentUser.mintukuListed = res.data?.mintukuListed !== false;
        }
        applyMyActivity(res.data?.lastLoginAt);
        updateMypageActionLabels(state.currentUser);
        invalidateUsersCache();
        showToast("みんつくの掲載を再開しました");
      } catch (err) {
        console.error(err);
        showToast(err.message || "再開に失敗しました");
      } finally {
        showLoading(false);
      }
    });

    $("#btn-stop-president-listing")?.addEventListener("click", async () => {
      if (!confirm("プレジデントメイトの掲載を停止しますか？")) return;
      try {
        showLoading(true);
        const res = await GasAPI.stopPresidentListing(identityForApi());
        if (state.currentUser) {
          state.currentUser.presidentMateListed = false;
        }
        applyMyActivity(res.data?.lastLoginAt);
        updateMypageActionLabels(state.currentUser);
        invalidateUsersCache();
        showToast("プレジデントメイトの掲載を停止しました");
      } catch (err) {
        console.error(err);
        showToast(err.message || "停止に失敗しました");
      } finally {
        showLoading(false);
      }
    });

    $("#btn-resume-president-listing")?.addEventListener("click", async () => {
      if (!confirm("プレジデントメイトの掲載を再開しますか？")) return;
      try {
        showLoading(true);
        const res = await GasAPI.resumePresidentListing(identityForApi());
        if (state.currentUser) {
          state.currentUser.presidentMateListed =
            res.data?.presidentMateListed !== false;
          if (res.data?.presidentNumber) {
            state.currentUser.presidentNumber = res.data.presidentNumber;
          }
        }
        applyMyActivity(res.data?.lastLoginAt);
        updateMypageActionLabels(state.currentUser);
        invalidateUsersCache();
        showToast("プレジデントメイトの掲載を再開しました");
      } catch (err) {
        console.error(err);
        showToast(err.message || "再開に失敗しました");
      } finally {
        showLoading(false);
      }
    });

    $("#mintuku-expired-back")?.addEventListener("click", () => {
      Session.clear();
      showLogin();
    });

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && state.isLoggedIn) {
        scheduleTouchActivity();
      }
    });
  }

  async function init() {
    applyMintukuChrome();
    // 復旧: ?stay=1 でみんつく自動遷移フラグを消す
    try {
      if (new URLSearchParams(window.location.search).get("stay") === "1") {
        localStorage.removeItem("apomy_open_mintuku_after_stop");
      }
    } catch (_) {
      /* ignore */
    }
    if (isMintukuMode() && !state.mintukuRegion) {
      showToast(`みんつくの地方が指定されていません。「地域を選ぶ」から開いてください`);
    }
    bindEvents();
    // テスト用 ?splash=1 はログイン前後どちらでもすぐ見えるようにする
    if (shouldForceSplash()) {
      await showWelcomeSplashIfNeeded();
    }

    const saved = Session.load();
    const hasSession = Boolean(saved?.email || saved?.memberNo);

    // 未ログイン時は GAS を待たず、すぐ Google ボタンを出す
    if (!hasSession) {
      showLogin();
      checkAndApplyMaintenanceGate().then((handled) => {
        if (handled) return;
        // メンテでなければログイン画面のまま
      });
      return;
    }

    const handled = await checkAndApplyMaintenanceGate();
    if (!handled) {
      tryRestoreSession();
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
