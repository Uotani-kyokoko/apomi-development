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
