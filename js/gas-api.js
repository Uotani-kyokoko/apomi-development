/**
 * GAS API クライアント
 * 本番: GAS_URL にウェブアプリの URL を入れる
 * 空のときは MockAPI にフォールバック
 */
const GasAPI = (() => {
  // 例: 'https://script.google.com/macros/s/XXXX/exec'
  const GAS_URL = (typeof AppConfig !== 'undefined' && AppConfig.GAS_URL) || '';

  /** true のあいだは 240件サンプル（Mock）で繋がるページを確認。本番確認後は false に戻す */
  const FORCE_SAMPLE_USERS = false;

  const USE_GAS = Boolean(GAS_URL) && !FORCE_SAMPLE_USERS;
  const REQUEST_TIMEOUT_MS = 45000;

  async function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } catch (err) {
      if (err && err.name === 'AbortError') {
        throw new Error('通信がタイムアウトしました。回線状況を確認して再読み込みしてください');
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  async function get(action, params = {}) {
    const url = new URL(GAS_URL);
    url.searchParams.set('action', action);
    url.searchParams.set('_ts', String(Date.now())); // キャッシュ防止
    const merged = { ...params };
    // メンテ中バイパス判定用: セッションのメールを付与（明示指定を優先）
    if (!merged.email && typeof Session !== 'undefined') {
      try {
        const saved = Session.load();
        if (saved?.email) merged.email = saved.email;
        if (!merged.memberNo && saved?.memberNo) merged.memberNo = saved.memberNo;
      } catch (_) {
        /* ignore */
      }
    }
    Object.entries(merged).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
    });
    const res = await fetchWithTimeout(url.toString(), {
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
    const payload = { action, ...body };
    if (!payload.email && typeof Session !== 'undefined') {
      try {
        const saved = Session.load();
        if (saved?.email) payload.email = saved.email;
        if (!payload.memberNo && saved?.memberNo) payload.memberNo = saved.memberNo;
      } catch (_) {
        /* ignore */
      }
    }
    const res = await fetchWithTimeout(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
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
      const params = { ...filters };
      ['industry', 'jobTitle', 'ageGroup', 'tags'].forEach((key) => {
        if (Array.isArray(params[key])) {
          params[key] = params[key].filter(Boolean).join('、');
        }
      });
      // [みんつく] app / region はそのまま query に載せる（GAS側でも地方絞り込み）
      return get('users', params);
    },

    async fetchBanners() {
      if (!USE_GAS) return MockAPI.fetchBanners();
      return get('banners');
    },

    async fetchCurrentUser(identity = {}) {
      if (!USE_GAS) return MockAPI.fetchCurrentUser(identity);
      const email = identity.email || '';
      const memberNo = identity.memberNo || identity.member_no || '';
      if (!email && !memberNo) {
        throw new Error('ログイン情報がありません');
      }
      const params = { email, memberNo };
      // [みんつく] me 呼び出し時に採番させる
      if (identity.app) params.app = identity.app;
      if (identity.region) params.region = identity.region;
      return get('me', params);
    },

    async fetchMasters() {
      if (!USE_GAS) return MockAPI.fetchMasters();
      return get('masters');
    },

    async fetchSettings() {
      if (!USE_GAS) return MockAPI.fetchSettings();
      return get('settings');
    },

    async fetchDashboard() {
      if (!USE_GAS) return MockAPI.fetchDashboard();
      try {
        return await get('dashboard');
      } catch (err) {
        // 旧デプロイ時は未掲載込み一覧からフロント集計
        console.warn('[apomy] dashboard API fallback', err);
        const res = await get('users', { includeUnpublished: 'true' });
        return {
          success: true,
          data: MockAPI.computeDashboardFromUsers(res.data || [])
        };
      }
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
        return MockAPI.requestPresidentMark
          ? MockAPI.requestPresidentMark(payload)
          : { success: true, data: { presidentMarkStatus: '申請中' } };
      }
      return post('requestPresidentMark', payload);
    },

    async requestSalonListing(payload) {
      if (!USE_GAS) {
        return MockAPI.requestSalonListing
          ? MockAPI.requestSalonListing(payload)
          : { success: true, data: { salonListingStatus: '申請中' } };
      }
      return post('requestSalonListing', payload);
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

    /** [みんつく] みんつく掲載のみ停止 */
    async stopMintukuListing(payload) {
      if (!USE_GAS) {
        return { success: true, data: { mintukuListed: false } };
      }
      return post('stopMintukuListing', payload);
    },

    /** [みんつく] みんつく掲載のみ再開 */
    async resumeMintukuListing(payload) {
      if (!USE_GAS) {
        return { success: true, data: { mintukuListed: true } };
      }
      return post('resumeMintukuListing', payload);
    },

    /** 操作のたびに最終ログイン日時を更新（デバウンス用） */
    async touchActivity(identity = {}) {
      const email = identity.email || '';
      const memberNo = identity.memberNo || identity.member_no || '';
      if (!email && !memberNo) return { success: true, data: null };
      if (!USE_GAS) {
        return { success: true, data: { lastLoginAt: formatNow() } };
      }
      const params = { email, memberNo };
      if (identity.app) params.app = identity.app;
      if (identity.region) params.region = identity.region;
      return get('touch', params);
    }
  };

  function formatNow() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }
})();
