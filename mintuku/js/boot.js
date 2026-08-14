/**
 * [みんつく] 薄い起動スクリプト
 * - r=（不透明トークン）または旧 region= を検証し、共通UIへ渡す
 * - Apomy本体のファイルはここでは編集しない
 */
(function () {
  "use strict";

  /** AppMode と同じ対応表（boot 単体でも動くよう重複定義） */
  var TOKEN_TO_REGION = {
    m8h3k9qx: "hokkaido",
    m8t7n2wp: "tohoku",
    m8k4r1vz: "kanto",
    m8c5p6yd: "chubu",
    m8n9s0ue: "kinki",
    m8g2b8af: "chugoku",
    m8s1d4jh: "shikoku",
    m8y6o3lm: "kyushu-okinawa"
  };

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

  var REGION_TO_TOKEN = {};
  Object.keys(TOKEN_TO_REGION).forEach(function (tok) {
    REGION_TO_TOKEN[TOKEN_TO_REGION[tok]] = tok;
  });

  function resolveRegionId(raw) {
    var s = String(raw || "")
      .trim()
      .toLowerCase();
    if (!s) return "";
    if (TOKEN_TO_REGION[s]) return TOKEN_TO_REGION[s];
    if (VALID[s]) return s;
    return "";
  }

  var params = new URLSearchParams(window.location.search);
  var region = resolveRegionId(params.get("r") || params.get("region") || "");

  if (!region) {
    document.body.innerHTML =
      '<main style="font-family:sans-serif;padding:2rem;line-height:1.7">' +
      "<h1>みんつく</h1>" +
      "<p>入口リンクが指定されていないか、不正です。</p>" +
      "<p>Apomyの「地域を選ぶ」から開いてください。</p>" +
      '<p><a href="../index.html">Apomyへ戻る</a></p>' +
      "</main>";
    return;
  }

  var token = REGION_TO_TOKEN[region] || region;

  // ホーム追加用に、リダイレクト前に地方manifestをセット
  try {
    var existing = document.querySelector('link[rel="manifest"]');
    if (!existing) {
      existing = document.createElement("link");
      existing.rel = "manifest";
      document.head.appendChild(existing);
    }
    existing.href = "manifest-" + region + ".webmanifest";
    document.title = "みんつく";
  } catch (_) {
    /* ignore */
  }

  var q = new URLSearchParams();
  q.set("app", "mintuku");
  q.set("r", token);
  if (params.get("splash") === "1") q.set("splash", "1");

  var mainUrl = "../index.html?" + q.toString();

  function goMain(withInstall) {
    var url = withInstall ? mainUrl + "&install=1" : mainUrl;
    window.location.replace(url);
  }

  if (params.get("install") === "1") {
    var done = false;
    function finish() {
      if (done) return;
      done = true;
      goMain(true);
    }
    window.addEventListener(
      "beforeinstallprompt",
      function (e) {
        e.preventDefault();
        try {
          e.prompt();
          if (e.userChoice && e.userChoice.finally) {
            e.userChoice.finally(finish);
          } else {
            setTimeout(finish, 400);
          }
        } catch (_) {
          finish();
        }
      },
      { once: true }
    );
    setTimeout(finish, 5000);
    return;
  }

  window.location.replace(mainUrl);
})();
