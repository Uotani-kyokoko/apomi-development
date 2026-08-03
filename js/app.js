/**
 * apomy マッチングアプリ - フロントエンド
 */
(() => {
  "use strict";

  /** 最新ページ：登録日から何日以内 */
  const LATEST_WITHIN_DAYS = 30;
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

  /** 繋がるページの会員番号帯（1ページあたり） */
  const CONNECT_BAND_SIZE = 100;

  const state = {
    isLoggedIn: false,
    activeTab: "home",
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
      ageGroup: []
    },
    /** 検索結果の表示件数（もっと見る用） */
    searchVisibleCount: SEARCH_RESULT_PAGE_SIZE,
    /** ホームダッシュボード集計 */
    dashboard: null
  };

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  /** 掲載SNS（最大4・URLから種別判定・表示は優先順位順） */
  const SNS_MAX = 4;
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

  /** 編集画面のSNS入力（URL配列） */
  let editSnsUrls = [];
  const TAG_MAX = 6;
  /** ネストした showLoading 用 */
  let loadingDepth = 0;

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

  function maxMemberNoAmong(users) {
    let max = 0;
    (users || []).forEach((u) => {
      const n = memberNoNum(u.id);
      if (n > max) max = n;
    });
    return max;
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
        const n = memberNoNum(u.id);
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

  /** 旧形式 {line,instagram,...} / snsLinks[] を URL 配列に統一 */
  function getUserSnsUrls(user) {
    if (!user) return [];
    if (Array.isArray(user.snsLinks) && user.snsLinks.length) {
      return user.snsLinks.map((u) => String(u || "").trim()).filter(Boolean).slice(0, SNS_MAX);
    }
    if (Array.isArray(user.sns)) {
      return user.sns
        .map((item) => (typeof item === "string" ? item : item?.url))
        .map((u) => String(u || "").trim())
        .filter(Boolean)
        .slice(0, SNS_MAX);
    }
    const obj = user.sns && typeof user.sns === "object" ? user.sns : {};
    const legacyOrder = ["line", "instagram", "facebook", "x", "youtube", "home", "litlink", "canva", "ameblo"];
    const out = [];
    legacyOrder.forEach((key) => {
      const v = String(obj[key] || "").trim();
      if (v) out.push(v);
    });
    return out.slice(0, SNS_MAX);
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

  function validateEditSnsUrls(urls) {
    const cleaned = [];
    const seen = new Set();
    for (const raw of urls || []) {
      const url = String(raw || "").trim();
      if (!url) continue;
      const normalized = normalizeSnsUrl(url);
      if (isOfficialLineUrl(normalized)) {
        return {
          ok: false,
          message: `公式LINE（lin.ee）は登録できません。line.me のURLを入力してください: ${url}`
        };
      }
      const type = detectSnsType(normalized);
      if (!type) {
        return { ok: false, message: `対応していないURLです: ${url}` };
      }
      if (seen.has(type)) {
        return { ok: false, message: `${SNS_META[type].label} はすでに追加されています` };
      }
      seen.add(type);
      cleaned.push(normalized);
      if (cleaned.length > SNS_MAX) {
        return { ok: false, message: `SNSは最大${SNS_MAX}件までです` };
      }
    }
    return { ok: true, urls: cleaned };
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
    if (addBtn) addBtn.disabled = editSnsUrls.length >= SNS_MAX;
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

  function renderTags(tags) {
    const visible = filterVisibleTags(tags);
    if (!visible.length) return "";
    return `<div class="profile-tags">${visible
      .map((t) => `<span class="profile-tag">${formatTagChipHtml(t, tagLabel(t))}</span>`)
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
  const TOUCH_MIN_INTERVAL_MS = 60 * 1000; // 連打でGASを叩かない

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
        const res = await GasAPI.touchActivity(state.identity);
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
    const presidentClass = user.presidentMark ? " is-president" : "";
    const femaleOnlyClass = isFemaleOnlyConnect(user) ? " female-only" : "";
    const avatar = normalizeAvatarUrl(user.avatarUrl, user.name);

    return `
      <article class="profile-card ${genderClass}${presidentClass}${femaleOnlyClass}" data-user-id="${escapeHtml(user.id)}" data-gender="${genderKey}">
        <div class="profile-card-band" aria-hidden="true"></div>
        <span class="profile-card-no">${escapeHtml(formatMemberNo(user.id))}</span>
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
          ${renderTags(user.tags)}
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
    try {
      const res = await GasAPI.fetchDashboard();
      state.dashboard = res.data || null;
      renderDashboard(state.dashboard);
    } catch (err) {
      console.error(err);
      try {
        const mock = await MockAPI.fetchDashboard();
        state.dashboard = mock.data || null;
        renderDashboard(state.dashboard);
      } catch (e2) {
        console.error(e2);
      }
    }
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
    if (page.type === "salon") {
      return list
        .filter((u) => {
          if (!u.salonListing) return false;
          const n = memberNoNum(u.id);
          return n >= page.from && n <= page.to;
        })
        .sort((a, b) => memberNoNum(a.id) - memberNoNum(b.id));
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
      return;
    }
    container.innerHTML = renderProfileCard(user);
    updateMypageActionLabels(user);
  }

  function updateMypageActionLabels(user) {
    const salonBtn = $("#btn-salon");
    const presidentBtn = $("#btn-president-badge");
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
      title.textContent = "apomy HOME";
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
    const allowBreak = containerId === "#edit-tag-chips";
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
      ageGroup: []
    };
    applyMastersToFilterUI();
    $$(".filter-card").forEach((c) => c.classList.remove("open"));
  }

  function filterUsersLocal(users, filters = {}) {
    const gender = filters.gender || "all";
    const ageGroup = normalizeFilterList(filters.ageGroup);
    const industry = normalizeFilterList(filters.industry);
    const jobTitle = normalizeFilterList(filters.jobTitle);

    return (users || []).filter((u) => {
      // 性別は単一選択のため必須条件（その他 ↔ LGBTQ は同一扱い）
      if (gender !== "all") {
        const want = canonicalGenderLabel(gender);
        const got = canonicalGenderLabel(u.gender);
        if (want !== got) return false;
      }
      // 同一項目内はOR、項目をまたぐとAND
      // ≒ 考えうる組み合わせ（年代×業種×職種）のいずれかに一致
      if (!matchesFilterList(u.ageGroup, ageGroup)) return false;
      if (!matchesFilterList(u.industry, industry)) return false;
      if (!matchesFilterList(u.jobTitle, jobTitle)) return false;
      return true;
    });
  }

  function hasActiveFilters(filters = state.filters) {
    if (filters.gender && filters.gender !== "all") return true;
    if (normalizeFilterList(filters.ageGroup).length) return true;
    if (normalizeFilterList(filters.industry).length) return true;
    if (normalizeFilterList(filters.jobTitle).length) return true;
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
        GasAPI.fetchSettings(),
        GasAPI.fetchDashboard()
      ]);

      const bannersRes = results[0].status === "fulfilled" ? results[0].value : null;
      const usersRes = results[1].status === "fulfilled" ? results[1].value : null;
      const meRes = results[2].status === "fulfilled" ? results[2].value : null;
      const mastersRes = results[3].status === "fulfilled" ? results[3].value : null;
      const settingsRes = results[4].status === "fulfilled" ? results[4].value : null;
      const dashboardRes = results[5].status === "fulfilled" ? results[5].value : null;

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
        console.error("masters failed", results[3].reason);
        if (GasAPI.isLive) {
          // 本番でモックマスタ（サンプルタグ）を混ぜない
          state.masters = state.masters && typeof state.masters === "object" ? state.masters : {};
          showToast("マスタの取得に失敗しました。しばらくして再読み込みしてください");
        } else {
          const mockMasters = await MockAPI.fetchMasters();
          state.masters = mockMasters.data || {};
        }
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
      let salonLabel =
        String(state.settings["サロンボタン名"] || state.salonLabel || "").trim() || state.salonLabel;
      // 旧表記「〜表示」は落とす
      if (salonLabel.endsWith("表示")) salonLabel = salonLabel.slice(0, -2).trim();
      state.salonLabel = salonLabel || "井口智明オンラインサロン";
      if (state.currentUser) updateMypageActionLabels(state.currentUser);

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
      if (dashboardRes?.data) {
        state.dashboard = dashboardRes.data;
      } else {
        try {
          const mockDash = await MockAPI.fetchDashboard();
          state.dashboard = mockDash.data || null;
        } catch {
          state.dashboard = null;
        }
      }
      renderDashboard(state.dashboard);
      renderBanners(state.banners);
      refreshConnectList();
      renderMyPage(state.currentUser);

      maybeOpenRequiredEdit();

      if (state.allUsers.length > 0) {
        console.log("[apomy] users loaded:", state.allUsers.length);
      }
    } catch (err) {
      console.error(err);
      showToast("データの読み込みに失敗しました: " + (err.message || ""));
      // 最後の手段: モック全表示（本番マスタは上書きしない）
      try {
        const mockUsers = await MockAPI.fetchUsers({});
        const mockBanners = await MockAPI.fetchBanners();
        state.allUsers = mockUsers.data || [];
        state.banners = mockBanners.data || [];
        if (!GasAPI.isLive) {
          const mockMasters = await MockAPI.fetchMasters();
          state.masters = mockMasters.data || {};
        }
        applyMastersToFilterUI();
        try {
          const mockDash = await MockAPI.fetchDashboard();
          state.dashboard = mockDash.data || null;
        } catch {
          state.dashboard = null;
        }
        renderDashboard(state.dashboard);
        renderBanners(state.banners);
        refreshConnectList();
        renderMyPage(state.currentUser);
      } catch (e2) {
        console.error(e2);
      }
    } finally {
      forceHideLoading();
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
    fillChips("#edit-gender-chips", mapGenderMasterOptions(m["性別"]), canonicalGenderLabel(user.gender) || "all");
    stripAllChip("#edit-gender-chips", user.gender);
    updateGenderEditState(user);
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
    fillAnnualSpendSelect(user.annualSpend || "");

    fillMultiChips("#edit-tag-chips", getActiveTagOptions(), filterVisibleTags(user.tags));
    updateEditTagCount();

    $("#edit-name").value = user.name || "";
    $("#edit-avatar").value = user.avatarUrl || "";
    $("#edit-bio").value = user.bio || "";
    $("#edit-want").value = user.wantMeet || "";
    $("#edit-avoid").value = user.avoidMeet || "";
    const femaleOnlyEl = $("#edit-female-only");
    if (femaleOnlyEl) femaleOnlyEl.checked = isFemaleOnlyConnect(user);
    updateFemaleOnlyOptionVisibility();
    editSnsUrls = getUserSnsUrls(user);
    if (!editSnsUrls.length) editSnsUrls = [""];
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

  function canEditGender(user = state.currentUser) {
    return !String(user?.gender || "").trim();
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
    const snsCheck = validateEditSnsUrls(editSnsUrls);
    const editableGender = canEditGender(state.currentUser);
    const gender = editableGender
      ? getSelectedChipValue("#edit-gender-chips")
      : String(state.currentUser?.gender || "").trim();
    const femaleOnlyConnect =
      gender === "女性" && Boolean($("#edit-female-only")?.checked);
    return {
      name: ($("#edit-name").value || "").trim(),
      gender,
      ageGroup: getSelectedChipValue("#edit-age-chips"),
      industry: $("#edit-industry").value || "",
      jobTitle: getSelectedChipValue("#edit-job-chips"),
      location: ($("#edit-location").value || "").trim(),
      hometown: ($("#edit-hometown").value || "").trim(),
      avatarUrl: ($("#edit-avatar").value || "").trim(),
      bio: ($("#edit-bio").value || "").trim(),
      wantMeet: ($("#edit-want").value || "").trim(),
      avoidMeet: ($("#edit-avoid").value || "").trim(),
      tags: filterVisibleTags(getSelectedChipValues("#edit-tag-chips")),
      annualSpend: ($("#edit-annual-spend")?.value || "").trim(),
      femaleOnlyConnect,
      snsLinks: snsCheck.ok ? snsCheck.urls : editSnsUrls.filter(Boolean),
      _snsError: snsCheck.ok ? "" : snsCheck.message
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
    if (profile._snsError) {
      showToast(profile._snsError);
      return;
    }
    const { _snsError, ...profilePayload } = profile;

    const shouldPublish = state.editRequired || state.currentUser?.isPublished === false;

    showLoading(true);
    try {
      const res = await GasAPI.updateProfile({
        memberNo: state.identity?.memberNo || state.currentUser?.id || "",
        email: state.identity?.email || state.currentUser?.email || "",
        profile: profilePayload
      });
      // GAS未再デプロイ時でもフォーム値を落とさない
      state.currentUser = {
        ...state.currentUser,
        ...profilePayload,
        ...(res.data || {})
      };
      state.currentUser.femaleOnlyConnect = Boolean(profilePayload.femaleOnlyConnect);
      state.currentUser.tags = normalizeTagList(
        Array.isArray(profilePayload.tags) && profilePayload.tags.length
          ? profilePayload.tags
          : res.data?.tags ?? profilePayload.tags
      );
      if (!state.currentUser.snsLinks) {
        state.currentUser.snsLinks = profilePayload.snsLinks || [];
      }
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
      return showWelcomeSplashIfNeeded().finally(() => loadAllData());
    }
    return loadAllData();
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
      await showApp();
    } catch (err) {
      console.error(err);
      showToast(err.message || "ログインに失敗しました");
    } finally {
      forceHideLoading();
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

    $("#filter-gender-chips")?.addEventListener("click", (e) => {
      const chip = e.target.closest(".chip");
      if (!chip) return;
      const grid = chip.parentElement;
      grid.querySelectorAll(".chip").forEach((c) => c.classList.remove("selected"));
      chip.classList.add("selected");
    });

    ["#filter-age-chips", "#filter-industry-chips", "#filter-job-chips"].forEach((id) => {
      $(id)?.addEventListener("click", (e) => {
        const chip = e.target.closest(".chip");
        if (!chip) return;
        chip.classList.toggle("selected");
      });
    });

    $("#btn-region-link")?.addEventListener("click", () => {
      openRegionByCurrentLocation();
    });

    $("#btn-search").addEventListener("click", () => {
      state.filters = {
        gender: getSelectedChipValue("#filter-gender-chips"),
        ageGroup: getSelectedChipValues("#filter-age-chips"),
        industry: getSelectedChipValues("#filter-industry-chips"),
        jobTitle: getSelectedChipValues("#filter-job-chips")
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

    $("#btn-add-sns")?.addEventListener("click", () => {
      syncEditSnsFromDom();
      if (editSnsUrls.length >= SNS_MAX) return;
      editSnsUrls.push("");
      renderEditSnsList();
    });
    $("#edit-sns-list")?.addEventListener("click", (e) => {
      const removeBtn = e.target.closest("[data-remove-sns]");
      if (!removeBtn) return;
      syncEditSnsFromDom();
      const idx = Number(removeBtn.dataset.removeSns);
      editSnsUrls.splice(idx, 1);
      if (!editSnsUrls.length) editSnsUrls = [""];
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

    ["#edit-gender-chips", "#edit-age-chips", "#edit-job-chips"].forEach((id) => {
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
