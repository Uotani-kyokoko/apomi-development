/**
 * [共通] Apomy / みんつく / プレジデントメイトの起動モードと地方定義
 * - Apomy: 全国（既存）
 * - みんつく: ?app=mintuku&r=（不透明トークン）※旧 ?region=kanto も互換
 * - プレジデント: ?app=president
 */
(function (global) {
  "use strict";

  /** @type {Record<string, { id: string, label: string, prefs: string[] }>} */
  const MINTUKU_REGIONS = {
    hokkaido: {
      id: "hokkaido",
      label: "北海道",
      prefs: ["北海道"]
    },
    tohoku: {
      id: "tohoku",
      label: "東北",
      prefs: ["青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県"]
    },
    kanto: {
      id: "kanto",
      label: "関東",
      prefs: ["茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県"]
    },
    chubu: {
      id: "chubu",
      label: "中部",
      prefs: [
        "新潟県",
        "富山県",
        "石川県",
        "福井県",
        "山梨県",
        "長野県",
        "岐阜県",
        "静岡県",
        "愛知県"
      ]
    },
    kinki: {
      id: "kinki",
      label: "近畿",
      prefs: ["三重県", "滋賀県", "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県"]
    },
    chugoku: {
      id: "chugoku",
      label: "中国",
      prefs: ["鳥取県", "島根県", "岡山県", "広島県", "山口県"]
    },
    shikoku: {
      id: "shikoku",
      label: "四国",
      prefs: ["徳島県", "香川県", "愛媛県", "高知県"]
    },
    "kyushu-okinawa": {
      id: "kyushu-okinawa",
      label: "九州・沖縄",
      prefs: [
        "福岡県",
        "佐賀県",
        "長崎県",
        "熊本県",
        "大分県",
        "宮崎県",
        "鹿児島県",
        "沖縄県"
      ]
    }
  };

  /**
   * URL用の不透明トークン（推測しにくい固定値）
   * GAS 側 resolveMintukuRegionId_ と揃えること
   */
  const REGION_TO_TOKEN = {
    hokkaido: "m8h3k9qx",
    tohoku: "m8t7n2wp",
    kanto: "m8k4r1vz",
    chubu: "m8c5p6yd",
    kinki: "m8n9s0ue",
    chugoku: "m8g2b8af",
    shikoku: "m8s1d4jh",
    "kyushu-okinawa": "m8y6o3lm"
  };

  const TOKEN_TO_REGION = (function () {
    const map = {};
    Object.keys(REGION_TO_TOKEN).forEach(function (id) {
      map[REGION_TO_TOKEN[id]] = id;
    });
    return map;
  })();

  /** 都道府県 → みんつく地方ID（8地方。Apomyの7ブロック地図とは別） */
  const PREFECTURE_TO_MINTUKU_REGION = (function () {
    const map = {};
    Object.keys(MINTUKU_REGIONS).forEach(function (id) {
      MINTUKU_REGIONS[id].prefs.forEach(function (pref) {
        map[pref] = id;
      });
    });
    return map;
  })();

  /** r=トークン または 旧 region=id を正規の地方IDへ */
  function resolveRegionId(raw) {
    const s = String(raw || "")
      .trim()
      .toLowerCase();
    if (!s) return "";
    if (TOKEN_TO_REGION[s]) return TOKEN_TO_REGION[s];
    if (MINTUKU_REGIONS[s]) return s;
    return "";
  }

  function regionToken(regionId) {
    const id = String(regionId || "")
      .trim()
      .toLowerCase();
    return REGION_TO_TOKEN[id] || "";
  }

  function parseModeFromLocation(loc) {
    const url = loc || (typeof window !== "undefined" ? window.location : null);
    let app = "apomy";
    let region = "";
    try {
      const params = new URLSearchParams(url && url.search ? url.search : "");
      const rawApp = String(params.get("app") || "apomy").trim().toLowerCase();
      if (rawApp === "mintuku") app = "mintuku";
      else if (rawApp === "president" || rawApp === "presidentmate") app = "president";
      region = resolveRegionId(params.get("r") || params.get("region") || "");
    } catch (_) {
      /* ignore */
    }
    return { app: app, region: region };
  }

  function getRegionMeta(regionId) {
    return MINTUKU_REGIONS[regionId] || null;
  }

  function displayName(regionId) {
    const meta = getRegionMeta(regionId);
    if (!meta) return "みんつく";
    return "みんつく" + meta.label;
  }

  function prefectureToRegionId(prefecture) {
    const pref = String(prefecture || "").trim();
    return PREFECTURE_TO_MINTUKU_REGION[pref] || null;
  }

  function isPrefectureInRegion(prefecture, regionId) {
    const meta = getRegionMeta(regionId);
    if (!meta) return false;
    return meta.prefs.indexOf(String(prefecture || "").trim()) >= 0;
  }

  function mintukuEntryUrl(regionId, opts) {
    const token = regionToken(regionId) || String(regionId || "");
    const q = "r=" + encodeURIComponent(token);
    if (opts && opts.fromMintukuDir) {
      return "./index.html?" + q;
    }
    return "mintuku/index.html?" + q;
  }

  function presidentEntryUrl(opts) {
    if (opts && opts.fromPresidentDir) return "./index.html";
    return "president/index.html";
  }

  function appShellUrl(regionId) {
    const q = new URLSearchParams();
    q.set("app", "mintuku");
    const token = regionToken(regionId);
    if (token) q.set("r", token);
    else if (regionId) q.set("region", regionId);
    return "../index.html?" + q.toString();
  }

  function presidentAppShellUrl() {
    return "../index.html?app=president";
  }

  function detect() {
    return parseModeFromLocation(typeof window !== "undefined" ? window.location : null);
  }

  global.AppMode = {
    MINTUKU_REGIONS: MINTUKU_REGIONS,
    REGION_TO_TOKEN: REGION_TO_TOKEN,
    TOKEN_TO_REGION: TOKEN_TO_REGION,
    PREFECTURE_TO_MINTUKU_REGION: PREFECTURE_TO_MINTUKU_REGION,
    parseModeFromLocation: parseModeFromLocation,
    detect: detect,
    resolveRegionId: resolveRegionId,
    regionToken: regionToken,
    getRegionMeta: getRegionMeta,
    displayName: displayName,
    prefectureToRegionId: prefectureToRegionId,
    isPrefectureInRegion: isPrefectureInRegion,
    mintukuEntryUrl: mintukuEntryUrl,
    presidentEntryUrl: presidentEntryUrl,
    appShellUrl: appShellUrl,
    presidentAppShellUrl: presidentAppShellUrl
  };
})(typeof window !== "undefined" ? window : globalThis);
