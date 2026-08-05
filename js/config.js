/**
 * アプリ設定
 * 接続値は js/env.js（env.dev.js / env.prod.js から生成）を参照します。
 */
const AppConfig = {
  ENV: (window.ApomyEnv && window.ApomyEnv.name) || "dev",
  GAS_URL: (window.ApomyEnv && window.ApomyEnv.GAS_URL) || "",
  GOOGLE_CLIENT_ID: (window.ApomyEnv && window.ApomyEnv.GOOGLE_CLIENT_ID) || "",
  SESSION_KEY: "apomi_session"
};
