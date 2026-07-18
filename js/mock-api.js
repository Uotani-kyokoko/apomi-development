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

  return {
    async fetchUsers(filters = {}) {
      let result = users.slice();
      if (filters.industry && filters.industry !== "all") {
        result = result.filter((u) => u.industry === filters.industry);
      }
      if (filters.gender && filters.gender !== "all") {
        result = result.filter((u) => u.gender === filters.gender);
      }
      if (filters.jobTitle && filters.jobTitle !== "all") {
        result = result.filter((u) => u.jobTitle === filters.jobTitle);
      }
      if (filters.ageGroup && filters.ageGroup !== "all") {
        result = result.filter((u) => u.ageGroup === filters.ageGroup);
      }
      return delay(result);
    },

    async fetchBanners() {
      return delay(banners);
    },

    async fetchMasters() {
      return delay({
        地域リンク: [{ value: "https://www.google.com", label: "地域を絞る" }],
        性別: [
          { value: "男性", label: "男性" },
          { value: "女性", label: "女性" }
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
        ]
      });
    },

    async fetchSettings() {
      return delay({
        アプリ名: "apomi",
        サロンURL: "https://example.com/salon",
        サロンボタン名: "井口智明オンラインサロン表示"
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
        avatarUrl: profile.avatarUrl ?? currentUser.avatarUrl,
        sns: {
          line: profile.sns?.line ?? currentUser.sns?.line ?? "",
          instagram: profile.sns?.instagram ?? currentUser.sns?.instagram ?? "",
          x: profile.sns?.x ?? currentUser.sns?.x ?? "",
          youtube: profile.sns?.youtube ?? currentUser.sns?.youtube ?? ""
        }
      });
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
