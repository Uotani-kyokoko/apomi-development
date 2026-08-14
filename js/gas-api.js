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
  const USERS_TIMEOUT_MS = 90000;

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

  function parseGasJsonResponse(text) {
    const raw = String(text || '').trim();
    if (!raw) {
      throw new Error('GAS応答が空です（再デプロイや権限・実行時間を確認してください）');
    }
    try {
      return JSON.parse(raw);
    } catch (_) {
      const plain = raw
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 180);
      const lower = plain.toLowerCase();
      if (lower.indexOf('exceeded') >= 0 || plain.indexOf('最大実行時間') >= 0) {
        throw new Error('GASの実行時間が上限を超えました。再デプロイ後にもう一度お試しください');
      }
      throw new Error(
        plain
          ? `GAS応答がJSONではありません: ${plain}`
          : 'GAS応答がJSONではありません（デプロイや権限を確認してください）'
      );
    }
  }

  async function get(action, params = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
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
    }, timeoutMs);
    const text = await res.text();
    const json = parseGasJsonResponse(text);
    if (!json.success) throw new Error(json.error || 'APIエラー');
    return json;
  }

  async function post(action, body = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
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
      redirect: 'follow',
      credentials: 'omit',
      cache: 'no-store',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    }, timeoutMs);
    const text = await res.text();
    const json = parseGasJsonResponse(text);
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
      // POST + 長めタイムアウト（一覧JSONが巨大でGET/短時間が失敗しやすい）
      return post('users', params, USERS_TIMEOUT_MS);
    },

    async fetchBanners(identity = {}) {
      if (!USE_GAS) return MockAPI.fetchBanners();
      const params = {};
      if (identity.app) params.app = identity.app;
      return get('banners', params);
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

    async fetchDashboard(params = {}) {
      if (!USE_GAS) return MockAPI.fetchDashboard(params);
      try {
        return await get('dashboard', params);
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
      if (payload.app) merged.app = payload.app;
      if (payload.region) merged.region = payload.region;

      if (!USE_GAS) return MockAPI.loginWithGoogle(merged);

      // JWT は長いので GET ではなく POST（URL制限・遅延を避ける）
      return post('login', merged);
    },

    async updateProfile(payload) {
      if (!USE_GAS) return MockAPI.updateProfile(payload);
      // POST（text/plain）で送る。旧デプロイだと updateProfile が無いので再デプロイ必須
      // publish=true なら保存＋掲載＋みんつく採番を1リクエストで完結
      return post('updateProfile', {
        memberNo: payload.memberNo || '',
        email: payload.email || '',
        profile: payload.profile || payload,
        publish: Boolean(payload.publish)
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

    /** [プレジデント] プレジデントメイト掲載のみ停止 */
    async stopPresidentListing(payload) {
      if (!USE_GAS) {
        return { success: true, data: { presidentMateListed: false } };
      }
      return post('stopPresidentListing', payload);
    },

    /** [プレジデント] プレジデントメイト掲載のみ再開 */
    async resumePresidentListing(payload) {
      if (!USE_GAS) {
        return {
          success: true,
          data: { presidentMateListed: true, presidentNumber: '社長1' }
        };
      }
      return post('resumePresidentListing', payload);
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
