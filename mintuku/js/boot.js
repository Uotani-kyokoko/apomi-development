/**
 * [みんつく] 薄い起動スクリプト
 * - region を検証し、共通UI（../index.html）へ app=mintuku 付きで渡す
 * - Apomy本体のファイルはここでは編集しない
 */
(function () {
  "use strict";

  var VALID = {
    hokkaido: 1,
    tohoku: 1,
    kanto: 1,
    chubu: 1,
    kinki: 1,
    chugoku: 1,
    shikoku: 1,
    "kyushu-okinawa": 1
  };

  var params = new URLSearchParams(window.location.search);
  var region = String(params.get("region") || "")
    .trim()
    .toLowerCase();

  if (!region || !VALID[region]) {
    document.body.innerHTML =
      '<main style="font-family:sans-serif;padding:2rem;line-height:1.7">' +
      "<h1>みんつく</h1>" +
      "<p>地方（region）が指定されていないか、不正です。</p>" +
      "<p>Apomyの「地域を選ぶ」から開くか、<code>?region=kanto</code> のように指定してください。</p>" +
      '<p><a href="../index.html">Apomyへ戻る</a></p>' +
      "</main>";
    return;
  }

  var q = new URLSearchParams();
  q.set("app", "mintuku");
  q.set("region", region);
  // テスト用 splash を引き継ぐ
  if (params.get("splash") === "1") q.set("splash", "1");

  window.location.replace("../index.html?" + q.toString());
})();
