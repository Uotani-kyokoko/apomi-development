/**
 * Google Identity Services（簡易本番認証）
 */
const GoogleAuth = (() => {
  let initialized = false;
  let onCredential = null;

  function ensureClientId() {
    const id = (AppConfig.GOOGLE_CLIENT_ID || '').trim();
    if (!id) {
      throw new Error(
        'GoogleクライアントIDが未設定です。js/config.js の GOOGLE_CLIENT_ID を設定してください。'
      );
    }
    return id;
  }

  function init(handlers = {}) {
    onCredential = handlers.onCredential || null;
    const clientId = ensureClientId();

    if (!window.google?.accounts?.id) {
      throw new Error('Google Identity Services の読み込みに失敗しました');
    }

    google.accounts.id.initialize({
      client_id: clientId,
      callback: handleCredentialResponse,
      auto_select: false,
      cancel_on_tap_outside: true,
      // メール・プロフィールをトークンに含める
      scope: 'openid email profile'
    });

    initialized = true;

    const btnHost = document.getElementById('google-btn-host');
    if (btnHost) {
      btnHost.innerHTML = '';
      google.accounts.id.renderButton(btnHost, {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        text: 'signin_with',
        shape: 'rectangular',
        logo_alignment: 'left',
        width: 280
      });
    }
  }

  function handleCredentialResponse(response) {
    if (!response?.credential) {
      if (onCredential) onCredential(new Error('認証トークンを取得できませんでした'), null);
      return;
    }
    if (onCredential) onCredential(null, response.credential);
  }

  /** ボタン以外からプロンプトを出す場合 */
  function prompt() {
    if (!initialized) init({ onCredential });
    google.accounts.id.prompt();
  }

  return { init, prompt };
})();

const Session = {
  load() {
    try {
      const raw = localStorage.getItem(AppConfig.SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },

  save(data) {
    localStorage.setItem(AppConfig.SESSION_KEY, JSON.stringify(data));
  },

  clear() {
    localStorage.removeItem(AppConfig.SESSION_KEY);
  }
};
