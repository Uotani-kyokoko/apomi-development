/**
 * GAS API モック
 * 本番では fetch(GAS_WEB_APP_URL + '?action=...') に差し替え
 * サンプル: js/sample-users-240.js（240件）
 */
const MockAPI = (() => {
  const DELAY_MS = 200;

  const banners = [
    {
      id: "b1",
      title: "Webブラウザ版 GLOOK リリース！",
      description: "いつでもどこでもマッチング",
      imageUrl: "https://images.unsplash.com/photo-1511578314322-379afb476865?w=600&h=300&fit=crop",
      linkUrl: "https://example.com/glook"
    },
    {
      id: "b2",
      title: "オンラインサロン開催中",
      description: "経営者限定の交流イベント",
      imageUrl: "https://images.unsplash.com/photo-1521737711862-ece3cc7dabbc?w=600&h=300&fit=crop",
      linkUrl: "https://example.com/salon"
    },
    {
      id: "b3",
      title: "社長マーク掲載キャンペーン",
      description: "先着50名様に特別バッジをプレゼント",
      imageUrl: "https://images.unsplash.com/photo-1552664730-d307ca884978?w=600&h=300&fit=crop",
      linkUrl: "https://example.com/badge"
    }
  ];

  const allUsers = Array.isArray(window.APOMI_SAMPLE_USERS)
    ? window.APOMI_SAMPLE_USERS.map((u) => ({ ...u, sns: { ...(u.sns || {}) } }))
    : [];

  /** 一覧は掲載中のみ（GAS getUsers_ と同じ） */
  let users = allUsers.filter((u) => u.isPublished !== false);
  let currentUser = allUsers.find((u) => u.id === "00001") || allUsers[0] || null;

  function delay(data) {
    return new Promise((resolve) => {
      setTimeout(() => resolve({ success: true, data }), DELAY_MS);
    });
  }

  function toDateKeyTokyo(value) {
    if (!value) return "";
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    // Asia/Tokyo 近似（端末TZに依存しにくいよう +9h 固定ではなく locale で）
    try {
      return new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Tokyo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }).format(d);
    } catch {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    }
  }

  function addDaysKey(baseDate, days) {
    const d = new Date(baseDate.getTime());
    d.setDate(d.getDate() + days);
    return toDateKeyTokyo(d);
  }

  function computeDashboardFromUsers(list) {
    const users = Array.isArray(list) ? list : [];
    const now = new Date();
    const today = toDateKeyTokyo(now);
    const yesterday = addDaysKey(now, -1);
    const dayCounts = {};
    for (let i = 0; i < 7; i++) {
      dayCounts[addDaysKey(now, -6 + i)] = 0;
    }

    let yesterdayNew = 0;
    let unpublished = 0;
    let yesterdayReturning = 0;

    users.forEach((u) => {
      const createdKey = toDateKeyTokyo(u.createdAt || u.publishedAt);
      const loginKey = toDateKeyTokyo(u.lastLoginAt);
      if (u.isPublished === false) unpublished += 1;
      if (createdKey === yesterday) yesterdayNew += 1;
      if (loginKey === yesterday && createdKey && createdKey < yesterday) {
        yesterdayReturning += 1;
      }
      if (createdKey && Object.prototype.hasOwnProperty.call(dayCounts, createdKey)) {
        dayCounts[createdKey] += 1;
      }
    });

    const newLast7Days = Object.keys(dayCounts)
      .sort()
      .map((key) => ({
        date: key,
        label: key.slice(5).replace("-", "/"),
        count: dayCounts[key]
      }));

    return {
      asOf: today,
      totalRegistered: users.length,
      yesterdayNew,
      unpublished,
      yesterdayReturning,
      newLast7Days
    };
  }

  return {
    computeDashboardFromUsers,

    async fetchDashboard() {
      return delay(computeDashboardFromUsers(allUsers));
    },

    async fetchUsers(filters = {}) {
      const toList = (v) => {
        if (Array.isArray(v)) return v.map((x) => String(x || "").trim()).filter((x) => x && x !== "all");
        const raw = String(v || "").trim();
        if (!raw || raw === "all") return [];
        return raw.split(/[,、|／\t]+/).map((x) => x.trim()).filter(Boolean);
      };
      const matchList = (userValue, selected) => {
        const list = toList(selected);
        if (!list.length) return true; // 未選択＝条件なし
        return list.includes(String(userValue || "").trim());
      };

      let result = users.slice();
      if (filters.gender && filters.gender !== "all") {
        result = result.filter((u) => u.gender === filters.gender);
      }
      // 同一項目内OR・項目間AND
      result = result.filter((u) => matchList(u.ageGroup, filters.ageGroup));
      result = result.filter((u) => matchList(u.industry, filters.industry));
      result = result.filter((u) => matchList(u.jobTitle, filters.jobTitle));
      return delay(result);
    },

    async fetchBanners() {
      return delay(banners);
    },

    async fetchMasters() {
      return delay({
        地域リンク: [
          { value: "https://example.com/region/hokkaido-tohoku", label: "北海道・東北" },
          { value: "https://example.com/region/kanto", label: "関東" },
          { value: "https://example.com/region/chubu", label: "中部" },
          { value: "https://example.com/region/chugoku", label: "中国" },
          { value: "https://example.com/region/shikoku", label: "四国" },
          { value: "https://example.com/region/kinki", label: "近畿" },
          { value: "https://example.com/region/kyushu-okinawa", label: "九州・沖縄" }
        ],
        性別: [
          { value: "男性", label: "男性" },
          { value: "女性", label: "女性" },
          { value: "その他(LGBTQ)", label: "その他(LGBTQ)" }
        ],
        年代: [
          { value: "20代", label: "20代" },
          { value: "30代", label: "30代" },
          { value: "40代", label: "40代" },
          { value: "50代", label: "50代" },
          { value: "60代", label: "60代" }
        ],
        業種: [
          { value: "サービス業", label: "サービス業" },
          { value: "美容・健康", label: "美容・健康" },
          { value: "建設・不動産", label: "建設・不動産" },
          { value: "飲食・サービス", label: "飲食・サービス" },
          { value: "製造業", label: "製造業" },
          { value: "IT・通信", label: "IT・通信" },
          { value: "小売", label: "小売" },
          { value: "教育", label: "教育" },
          { value: "医療・福祉", label: "医療・福祉" },
          { value: "その他", label: "その他" }
        ],
        職種: [
          { value: "経営者", label: "経営者" },
          { value: "代表取締役", label: "代表取締役" },
          { value: "CEO", label: "CEO" },
          { value: "サロンオーナー", label: "サロンオーナー" },
          { value: "専務取締役", label: "専務取締役" },
          { value: "工場長", label: "工場長" },
          { value: "部長", label: "部長" },
          { value: "個人事業主", label: "個人事業主" },
          { value: "フリーランス", label: "フリーランス" },
          { value: "その他", label: "その他" }
        ],
        タグ: [
          { value: "ビジネスマッチング", label: "ビジネス\nマッチング" },
          { value: "カフェ会", label: "カフェ会" },
          { value: "異業種交流会", label: "異業種交流会" },
          { value: "オンライン交流会", label: "オンライン\n交流会" },
          { value: "イベント", label: "イベント\n（飲み会など）" },
          { value: "勉強会", label: "勉強会" },
          { value: "ランチ会", label: "ランチ会" },
          { value: "飲み会", label: "飲み会" }
        ]
      });
    },

    async fetchSettings() {
      return delay({
        アプリ名: "apomy",
        サロンURL: "https://example.com/salon",
        サロンボタン名: "井口智明オンラインサロン",
        オーナーメール: ""
      });
    },

    async fetchCurrentUser() {
      return delay(currentUser);
    },

    async updateProfile(payload = {}) {
      const profile = payload.profile || payload;
      if (!currentUser) return delay(null);
      Object.assign(currentUser, {
        name: profile.name ?? currentUser.name,
        gender: profile.gender ?? currentUser.gender,
        ageGroup: profile.ageGroup ?? currentUser.ageGroup,
        industry: profile.industry ?? currentUser.industry,
        jobTitle: profile.jobTitle ?? currentUser.jobTitle,
        location: profile.location ?? currentUser.location,
        hometown: profile.hometown ?? currentUser.hometown,
        bio: profile.bio ?? currentUser.bio,
        wantMeet: profile.wantMeet ?? currentUser.wantMeet,
        avoidMeet: profile.avoidMeet ?? currentUser.avoidMeet,
        tags: Array.isArray(profile.tags)
          ? profile.tags.map((t) => String(t || "").trim()).filter(Boolean).slice(0, 6)
          : currentUser.tags,
        femaleOnlyConnect:
          profile.femaleOnlyConnect !== undefined
            ? Boolean(profile.femaleOnlyConnect) && (profile.gender ?? currentUser.gender) === "女性"
            : currentUser.femaleOnlyConnect,
        avatarUrl: profile.avatarUrl ?? currentUser.avatarUrl,
        snsLinks: Array.isArray(profile.snsLinks)
          ? profile.snsLinks.map((u) => String(u || "").trim()).filter(Boolean).slice(0, 4)
          : currentUser.snsLinks || []
      });
      // 旧フィールドは残さない
      delete currentUser.sns;
      const idx = users.findIndex((u) => u.id === currentUser.id);
      if (idx >= 0) users[idx] = { ...currentUser };
      return delay({ ...currentUser });
    },

    async uploadAvatar(payload = {}) {
      const dataUrl = payload.imageBase64
        ? `data:${payload.mimeType || "image/jpeg"};base64,${payload.imageBase64}`
        : "";
      if (dataUrl && currentUser) currentUser.avatarUrl = dataUrl;
      const idx = users.findIndex((u) => u.id === currentUser?.id);
      if (idx >= 0) users[idx] = { ...currentUser };
      return delay({ avatarUrl: currentUser?.avatarUrl || "", memberNo: currentUser?.id || "" });
    },

    async requestSalonListing(payload = {}) {
      if (!payload.imageBase64) throw new Error("公式LINE加入が分かる画像をアップロードしてください");
      if (currentUser) currentUser.salonListingStatus = "申請中";
      return delay({ salonListingStatus: "申請中", memberNo: currentUser?.id || "" });
    },

    async requestPresidentMark(payload = {}) {
      const companyName = String(payload.companyName || "").trim();
      const corporateNumber = String(payload.corporateNumber || "").replace(/\D/g, "");
      const evidenceUrl = String(payload.evidenceUrl || "").trim();
      if (!companyName) throw new Error("社名（正式名称）を入力してください");
      if (!/^\d{13}$/.test(corporateNumber)) throw new Error("法人番号は13桁の数字で入力してください");
      if (!evidenceUrl && !payload.imageBase64) {
        throw new Error("コーポレートサイトURLか名刺画像のどちらかを入力してください");
      }
      if (currentUser) currentUser.presidentMarkStatus = "申請中";
      return delay({ presidentMarkStatus: "申請中", memberNo: currentUser?.id || "" });
    },

    async loginWithGoogle(payload = {}) {
      if (payload.idToken) {
        try {
          const part = payload.idToken.split(".")[1];
          const json = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/")));
          if (currentUser) {
            currentUser = {
              ...currentUser,
              email: json.email || currentUser.email,
              name: json.name || currentUser.name,
              avatarUrl: json.picture || currentUser.avatarUrl
            };
          }
          return delay(currentUser);
        } catch (e) {
          /* fallthrough */
        }
      }
      return delay(currentUser);
    }
  };
})();
