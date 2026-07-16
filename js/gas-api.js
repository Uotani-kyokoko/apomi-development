/**
 * GAS API クライアント
 * 本番: GAS_URL にウェブアプリの URL を入れる
 * 空のときは MockAPI にフォールバック
 */
const GasAPI = (() => {
  // 例: 'https://script.google.com/macros/s/XXXX/exec'
  const GAS_URL = 'https://script.google.com/macros/s/AKfycbzOgEwD8a_Ti8RwS_d55gZ-N2PyzhukECtmuRAwTB5FPYb8aaKxuSr9BdY7JazXVDkmdg/exec';

  /** true のあいだは 240件サンプル（Mock）で繋がるページを確認。本番確認後は false に戻す */
  const FORCE_SAMPLE_USERS = false;

  const USE_GAS = Boolean(GAS_URL) && !FORCE_SAMPLE_USERS;

  async function get(action, params = {}) {
    const url = new URL(GAS_URL);
    url.searchParams.set('action', action);
    url.searchParams.set('_ts', String(Date.now())); // キャッシュ防止
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
    });
    const res = await fetch(url.toString(), {
      method: 'GET',
      redirect: 'follow',
      credentials: 'omit',
      cache: 'no-store'
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch (err) {
      throw new Error('GAS応答がJSONではありません（デプロイや権限を確認してください）');
    }
    if (!json.success) throw new Error(json.error || 'APIエラー');
    return json;
  }

  async function post(action, body = {}) {
    const res = await fetch(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, ...body })
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'APIエラー');
    return json;
  }

  /** JWT の中身だけ読む（検証はGAS側） */
  function decodeJwtPayload(idToken) {
    try {
      const part = String(idToken || '').split('.')[1];
      if (!part) return {};
      const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
      const json = decodeURIComponent(
        atob(b64)
          .split('')
          .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
          .join('')
      );
      return JSON.parse(json);
    } catch {
      return {};
    }
  }

  return {
    get isLive() {
      return USE_GAS;
    },

    async fetchUsers(filters = {}) {
      if (!USE_GAS) return MockAPI.fetchUsers(filters);
      return get('users', filters);
    },

    async fetchBanners() {
      if (!USE_GAS) return MockAPI.fetchBanners();
      return get('banners');
    },

    async fetchCurrentUser(identity = {}) {
      if (!USE_GAS) return MockAPI.fetchCurrentUser();
      const email = identity.email || '';
      const memberNo = identity.memberNo || identity.member_no || '';
      if (!email && !memberNo) {
        throw new Error('ログイン情報がありません');
      }
      return get('me', { email, memberNo });
    },

    async fetchMasters() {
      if (!USE_GAS) return MockAPI.fetchMasters();
      return get('masters');
    },

    async fetchSettings() {
      if (!USE_GAS) return MockAPI.fetchSettings();
      return get('settings');
    },

    async loginWithGoogle(payload = {}) {
      const idToken = payload.idToken || '';
      const decoded = idToken ? decodeJwtPayload(idToken) : {};
      const merged = {
        idToken,
        email: payload.email || decoded.email || '',
        googleId: payload.googleId || decoded.sub || '',
        name: payload.name || decoded.name || '',
        picture: payload.picture || decoded.picture || ''
      };

      if (!USE_GAS) return MockAPI.loginWithGoogle(merged);

      // GAS の POST はリダイレクトで body が欠けることがあるため GET で送る
      return get('login', merged);
    },

    async updateProfile(payload) {
      if (!USE_GAS) return MockAPI.updateProfile(payload);
      // POST（text/plain）で送る。旧デプロイだと updateProfile が無いので再デプロイ必須
      return post('updateProfile', {
        memberNo: payload.memberNo || '',
        email: payload.email || '',
        profile: payload.profile || payload
      });
    },

    async uploadAvatar(payload) {
      if (!USE_GAS) return MockAPI.uploadAvatar(payload);
      return post('uploadAvatar', payload);
    },

    async requestPresidentMark(payload) {
      if (!USE_GAS) {
        return { success: true, data: { presidentMarkStatus: '申請中' } };
      }
      return post('requestPresidentMark', payload);
    },

    async stopListing(payload) {
      if (!USE_GAS) {
        return { success: true, data: { isPublished: false } };
      }
      return post('stopListing', payload);
    },

    async resumeListing(payload) {
      if (!USE_GAS) {
        return { success: true, data: { isPublished: true, lastLoginAt: formatNow() } };
      }
      return post('resumeListing', payload);
    },

    /** 操作のたびに最終ログイン日時を更新（デバウンス用） */
    async touchActivity(identity = {}) {
      const email = identity.email || '';
      const memberNo = identity.memberNo || identity.member_no || '';
      if (!email && !memberNo) return { success: true, data: null };
      if (!USE_GAS) {
        return { success: true, data: { lastLoginAt: formatNow(), status: 'オンライン' } };
      }
      return get('touch', { email, memberNo });
    }
  };

  function formatNow() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }
})();
