/**
 * [プレジデント] 薄い起動スクリプト
 * → 共通UI ../index.html?app=president
 */
(function () {
  "use strict";

  try {
    var existing = document.querySelector('link[rel="manifest"]');
    if (!existing) {
      existing = document.createElement("link");
      existing.rel = "manifest";
      document.head.appendChild(existing);
    }
    existing.href = "manifest.webmanifest";
    document.title = "プレジデントメイト";
  } catch (_) {
    /* ignore */
  }

  var params = new URLSearchParams(window.location.search);
  var q = new URLSearchParams();
  q.set("app", "president");
  if (params.get("splash") === "1") q.set("splash", "1");
  if (params.get("stay") === "1") q.set("stay", "1");

  window.location.replace("../index.html?" + q.toString());
})();
