/**
 * apomy - GAS API
 *
 * 【デプロイ手順】
 * 1. スプレッドシートを開く → 拡張機能 → Apps Script
 * 2. この Code.gs を貼り付けて保存
 * 3. 必要なら SPREADSHEET_ID を設定（コンテナバインドなら空でOK）
 * 4. デプロイ → 新しいデプロイ → 種類: ウェブアプリ
 *    - 実行ユーザー: 自分
 *    - アクセスできるユーザー: 全員
 * 5. 発行された URL をフロントの GAS_URL に設定
 *
 * 【シート】会員 / バナー / 申請 / マスタ / 設定
 * 【会員シート】ニックネーム（公開・変更可）/ 本名（非公開・初回のみ）
 * ※旧列「名前」はニックネームとして読む互換あり（ヘッダーを「ニックネーム」へ改名推奨）
 * 【会員シート追加列】女性限定（TRUE/FALSE）…女性とだけ繋がりたい
 * 【会員シート追加列】年間経費（非公開）…人脈拡大の為の年間経費。一覧には出さない
 * 【バナー】場所=ホーム / 繋がる / 両方（空欄はホーム）
 * 【マスタ】区分=タグ の行でプロフィールタグ候補を管理（有効=FALSEで非表示）
 * 【マスタ】区分=年間経費 の行で年間経費の選択肢を管理
 * 【マスタ】区分=プライバシーポリシー の行で初回同意文を管理
 * 【マスタ】区分=公式LINE … 値に公式LINEのURL（アクセス拒否画面の問合せ先）
 * 【設定キー】サロンURL / サロンボタン名
 * 【設定キー】メンテナンス … TRUE で全ユーザーにメンテ画面（オーナーメール・開発者メールのみ利用可）
 * 【設定キー】オーナーメール / 開発者メール … メンテ中のバイパス許可
 * 【シート】アクセス拒否 … A列「メール」に拒否アドレス（1行1件）。API応答には含めない
 * 【申請】マイページからフォーム送信 → 申請シートへ保存。承認はスプシ手作業
 *
 * 【みんつく】同じ GAS / 同じスプシ。users に app=mintuku&region=…（または r=トークン）で地方一覧。
 * 会員列: みんつく掲載 / みんつく番号 / みんつく初回ログイン日 / 課金有無 / みんつく課金開始日
 * 現在地: 初回のみアプリで設定。変更はオーナー手動。手動変更後の初回ログインでみんつく番号を付け直し
 * みんつく課金開始日: 日付あり＝有料。無料期間は初回ログイン基準、課金後はこの日起算で経過表示
 * Apomy掲載開始時: みんつく掲載=TRUE＋現在地からみんつく番号を採番
 * 一覧: Apomyは掲載中のみ／みんつくは現在地がその地方なら出す（ダッシュボードと同じ。みんつく掲載は見ない）
 * 一覧APIは必要列のみ読込（全列 getDataRange しない）。ログイン時は一覧を取らない（FEが繋がる表示時に取得）
 * 設定キー: みんつく問い合わせURL（期限切れ画面の「こちら」）
 * POST: stopMintukuListing / resumeMintukuListing
 * updateProfile は publish=true で掲載開始＋みんつく採番まで1リクエスト完結可
 * 会員の単票更新は「列検索で行特定→1行読込→メモリ更新→1行 setValues」を基本とし、全件オブジェクト化を避ける
 * 掲載フラグは TRUE/FALSE 文字列で書き込み（チェックボックス／文字列列両対応）
 * 閲覧者の現在地が指定地方と一致しない一覧取得は拒否（URLいじり対策）
 *
 * 【プレジデントメイト】同じ GAS / 同じスプシ。users に app=president。
 * 会員列: プレジデントメイト掲載 / プレジデント番号
 * 入室: 社長マーク=TRUE のみ。未承認は PRESIDENT_DENIED
 * 一覧: 社長マーク=TRUE かつ プレジデントメイト掲載≠FALSE（空欄も掲載）
 * 採番: プレジデント番号=社長N。本人初回入室 or 一覧取得時に未採番へ一括付与
 * POST: stopPresidentListing / resumePresidentListing
 * バナー: 対象アプリ列（空/すべて=全アプリ、アポミー/みんつく/プレジデントメイト）
 */

var ACCESS_DENIED_MESSAGE =
  'アクセスが拒否されました。詳細はコチラから問合せください。';

var MAINTENANCE_MESSAGE =
  'メンテナンス中です。ご迷惑をおかけします。';


// コンテナバインド（スプレッドシートに紐付いたスクリプト）なら空文字のままでOK
// === BEGIN ENV (dev) ===
const SPREADSHEET_ID = '1JNnkjKwUwNY9OnCAkIvZE_5yOi0xJyUcHzdpBWhhu64';
const AVATAR_FOLDER_ID = '1Dl3UOzrbFwvK8FGUEK7ZVjZ95qUqIXvV';
const APPLICATION_FOLDER_ID = '1KH9tpnep8-0RFGjpC45kiciVRWH6c26g';
// === END ENV ===





const SHEET = {
  USERS: '会員',
  BANNERS: 'バナー',
  REQUESTS: '申請',
  MASTERS: 'マスタ',
  SETTINGS: '設定',
  DENIED_MAIL: 'アクセス拒否'
};

/* ========== Web App Entry ========== */

function doGet(e) {
  try {
    const p = (e && e.parameter) || {};
    const action = String(p.action || '').trim();
    guardMaintenance_(action, p);
    let data;

    switch (action) {
      case 'users':
        data = getUsers_(p);
        break;
      case 'banners':
        data = getBanners_(p);
        break;
      case 'me':
        data = getMe_(p);
        break;
      case 'masters':
        data = getMasters_();
        break;
      case 'settings':
        data = getPublicSettings_();
        break;
      case 'login':
        // POST の body 欠落対策として GET でもログイン可
        data = login_(p);
        break;
      case 'updateProfile':
        data = updateProfile_(parseUpdatePayload_(p));
        break;
      case 'touch':
        data = touchActivity_(p);
        break;
      case 'dashboard':
        data = getDashboard_(p);
        break;
      case 'ping':
        data = { ok: true, message: 'apomy GAS is alive' };
        break;
      case 'approveRequest':
        return htmlDecision_(processOwnerDecision_(p, '承認'));
      case 'rejectRequest':
        return htmlDecision_(processOwnerDecision_(p, '却下'));
      default:
        return json_({ success: false, error: '不明なactionです: ' + action });
    }

    return json_({ success: true, data: action === 'users' ? data : sanitizeForJson_(data) });
  } catch (err) {
    if (String((e && e.parameter && e.parameter.action) || '') === 'approveRequest' ||
        String((e && e.parameter && e.parameter.action) || '') === 'rejectRequest') {
      return htmlDecision_({ ok: false, message: String(err.message || err) });
    }
    return json_({ success: false, error: String((err && err.message) || err) });
  }
}

function doPost(e) {
  try {
    const body = parseBody_(e);
    const action = String(body.action || '').trim();
    guardMaintenance_(action, body);
    let data;

    switch (action) {
      case 'login':
        data = login_(body);
        break;
      case 'users':
        // 一覧は POST 推奨（巨大JSONのGET失敗・タイムアウト対策）
        data = getUsers_(body);
        break;
      case 'updateProfile':
        data = updateProfile_(body);
        break;
      case 'uploadAvatar':
        data = uploadAvatar_(body);
        break;
      case 'requestPresidentMark':
        data = requestListing_(body, '社長マーク');
        break;
      case 'requestSalonListing':
        data = requestListing_(body, 'サロン掲載');
        break;
      case 'stopListing':
        // [Apomy] 全国掲載のみ停止（みんつく掲載は変えない）
        data = setPublished_(body, false, '掲載停止');
        break;
      case 'resumeListing':
        // [Apomy] 全国掲載のみ再開
        data = setPublished_(body, true, '掲載再開');
        break;
      case 'stopMintukuListing':
        // [みんつく] みんつく掲載のみ停止
        data = setMintukuListed_(body, false, 'みんつく掲載停止');
        break;
      case 'resumeMintukuListing':
        // [みんつく] みんつく掲載のみ再開
        data = setMintukuListed_(body, true, 'みんつく掲載再開');
        break;
      case 'stopPresidentListing':
        // [プレジデント] プレジデントメイト掲載のみ停止
        data = setPresidentListed_(body, false, 'プレジデントメイト掲載停止');
        break;
      case 'resumePresidentListing':
        // [プレジデント] プレジデントメイト掲載のみ再開
        data = setPresidentListed_(body, true, 'プレジデントメイト掲載再開');
        break;
      case 'touch':
        data = touchActivity_(body);
        break;
      default:
        return json_({ success: false, error: '不明なactionです: ' + action });
    }

    return json_({ success: true, data: action === 'users' ? data : sanitizeForJson_(data) });
  } catch (err) {
    return json_({ success: false, error: String((err && err.message) || err) });
  }
}

/* ========== Read APIs ========== */

function parseFilterList_(raw) {
  var s = String(raw || '').trim();
  if (!s || s === 'all') return [];
  return s.split(/[,、|／\t]+/).map(function (v) { return v.trim(); }).filter(Boolean);
}

function matchesFilterList_(userValue, selectedRaw) {
  var selected = parseFilterList_(selectedRaw);
  if (!selected.length) return true;
  var current = String(userValue || '').trim();
  return selected.indexOf(current) >= 0;
}

/** タグ複数選択: 会員タグのいずれかが一致すればOK（OR） */
function matchesAnyTagFilter_(tagsRaw, selectedRaw) {
  var selected = parseFilterList_(selectedRaw);
  if (!selected.length) return true;
  var tags = String(tagsRaw || '')
    .split(/[,、|／\t]+/)
    .map(function (t) { return String(t || '').trim(); })
    .filter(Boolean);
  if (!tags.length) return false;
  for (var i = 0; i < selected.length; i++) {
    if (tags.indexOf(selected[i]) >= 0) return true;
  }
  return false;
}

function getUsers_(p) {
  p = p || {};
  const industry = p.industry || 'all';
  const gender = String(p.gender || 'all');
  const jobTitle = p.jobTitle || p.job_title || 'all';
  const ageGroup = p.ageGroup || p.age_group || 'all';
  const tags = p.tags || p.tag || 'all';
  const locationPref = String(p.locationPref || p.location || 'all').trim();
  const includeUnpublished = String(p.includeUnpublished || '') === 'true';
  const appKind = String(p.app || 'apomy').trim().toLowerCase();
  const mintukuRegion = resolveMintukuRegionId_(p.region || p.r || '');
  const isMintuku = appKind === 'mintuku';
  const isPresident = appKind === 'president' || appKind === 'presidentmate';

  if (isMintuku) {
    if (!mintukuRegion) throw new Error('みんつくの地方が不正です');
    try {
      assertMintukuViewerAccessLight_(p, mintukuRegion);
    } catch (err) {
      // 期限切れ・地方不一致はそのまま返す（JSONエラーにする）
      throw err;
    }
  }
  if (isPresident) {
    assertPresidentViewerAccessLight_(p);
  }
  if (!isMintuku && !isPresident) {
    assertApomyViewerAccessLight_(p);
  }

  var rows;
  try {
    rows = readUsersLightRows_();
  } catch (readErr) {
    // 軽量読込に失敗したら従来の全列読込へフォールバック
    Logger.log('readUsersLightRows_ failed: ' + readErr);
    rows = readObjects_(SHEET.USERS);
  }

  if (isPresident) {
    try {
      ensurePresidentNumbersBatch_(rows);
    } catch (numErr) {
      Logger.log('ensurePresidentNumbersBatch_ failed: ' + numErr);
    }
  }

  return rows
    .filter(function (r) {
      if (isMintuku) {
        if (!isPrefInMintukuRegion_(r['現在地'], mintukuRegion)) return false;
        if (locationPref && locationPref !== 'all') {
          if (canonicalPrefecture_(r['現在地']) !== canonicalPrefecture_(locationPref) &&
              String(r['現在地'] || '').trim() !== locationPref) return false;
        }
      } else if (isPresident) {
        if (!toBool_(r['社長マーク'])) return false;
        if (!includeUnpublished && !isPresidentMateListed_(r)) return false;
      } else if (!includeUnpublished && !toBool_(r['掲載中'])) {
        return false;
      }
      if (gender !== 'all' && String(r['性別'] || '').trim() !== gender) return false;
      if (!matchesFilterList_(r['業種'], industry)) return false;
      if (!matchesFilterList_(r['職種'], jobTitle)) return false;
      if (!matchesFilterList_(r['年代'], ageGroup)) return false;
      if (!matchesAnyTagFilter_(r['タグ'], tags)) return false;
      return true;
    })
    .map(function (r) {
      return mapUserListItem_(r);
    });
}

/**
 * 一覧 API 用に読む列（プロフィールカード＋絞り込みに必要なものだけ）
 */
var USER_LIST_COLUMNS_ = [
  '会員番号',
  'Googleメール',
  'ニックネーム',
  '名前',
  '性別',
  '年代',
  '業種',
  '職種',
  '現在地',
  '出身地',
  '自己紹介',
  'こんな人と繋がりたい',
  'こんな人とは繋がりたくない',
  '女性限定',
  '社名',
  'タグ',
  'プロフィール画像URL',
  '最終ログイン日時',
  '登録日時',
  '掲載中',
  'みんつく掲載',
  'みんつく番号',
  'プレジデントメイト掲載',
  'プレジデント番号',
  '社長マーク',
  '社長マーク状態',
  'サロン掲載',
  'サロン掲載状態',
  'SNS1',
  'SNS2',
  'SNS3',
  'SNS4',
  'LINE'
];

/**
 * 会員シートから指定列だけ読む
 * - getRange(row, column, numRows, numColumns)
 * - 必要列の最小〜最大を1ブロックで取得（全列 getDataRange を避ける）
 */
function readUsersColumnsRows_(columnNames) {
  var sheet = getSheet_(SHEET.USERS);
  var headers = getSheetHeaders_(sheet);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var names = columnNames || [];
  var colIndexes = [];
  for (var i = 0; i < names.length; i++) {
    var name = names[i];
    var idx = headers.indexOf(name);
    if (idx >= 0) colIndexes.push({ name: name, idx: idx });
  }
  if (!colIndexes.length) return [];

  var minIdx = colIndexes[0].idx;
  var maxIdx = colIndexes[0].idx;
  for (var j = 1; j < colIndexes.length; j++) {
    if (colIndexes[j].idx < minIdx) minIdx = colIndexes[j].idx;
    if (colIndexes[j].idx > maxIdx) maxIdx = colIndexes[j].idx;
  }

  var numRows = lastRow - 1;
  var numCols = maxIdx - minIdx + 1;
  var values = sheet.getRange(2, minIdx + 1, numRows, numCols).getValues();
  var rows = [];
  for (var r = 0; r < values.length; r++) {
    var rowVals = values[r];
    var memberNo = '';
    var memberCol = headers.indexOf('会員番号');
    if (memberCol >= minIdx && memberCol <= maxIdx) {
      memberNo = String(rowVals[memberCol - minIdx] || '').trim();
    } else if (headers.indexOf('会員番号') < 0) {
      // ダッシュボード等で会員番号列を明示していない場合は行を採用
      memberNo = '1';
    }
    // 会員番号列を要求している場合のみ空行スキップ
    var requiresMember = names.indexOf('会員番号') >= 0;
    if (requiresMember && !memberNo) continue;

    var obj = {};
    for (var k = 0; k < colIndexes.length; k++) {
      var c = colIndexes[k];
      obj[c.name] = rowVals[c.idx - minIdx];
    }
    // 会員番号がブロック外でも、空行判定用に会員番号必須ならスキップ済み
    if (!requiresMember) {
      // すべて空ならスキップ
      var any = false;
      for (var a = 0; a < colIndexes.length; a++) {
        if (String(rowVals[colIndexes[a].idx - minIdx] || '').trim() !== '') {
          any = true;
          break;
        }
      }
      if (!any) continue;
    }
    rows.push(obj);
  }
  return rows;
}

function readUsersLightRows_() {
  return readUsersColumnsRows_(USER_LIST_COLUMNS_);
}

/**
 * [みんつく] 閲覧者チェック（本人行のみ。一覧全件は読まない）
 */
function assertMintukuViewerAccessLight_(p, regionIdOpt) {
  var email = String((p && p.email) || '').trim();
  var memberNo = String((p && (p.memberNo || p.member_no)) || '').trim();
  if (!email && !memberNo) return;

  var ctx = openUserCtx_(memberNo, email);
  assertMintukuLoginAllowed_(ctx.row, 'mintuku');
  var access = evaluateMintukuAccess_(ctx.row);
  if (!access.ok) {
    throw new Error(
      'MINTUKU_EXPIRED:無料期間(30日)が終了しました。今まで通り閲覧するにはこちらからお問合せください'
    );
  }
  var regionId = resolveMintukuRegionId_(regionIdOpt || (p && (p.region || p.r)) || '');
  if (!regionId) return;
  var loc = String(ctx.row['現在地'] || '').trim();
  if (loc && !isPrefInMintukuRegion_(loc, regionId)) {
    throw new Error(
      'MINTUKU_REGION_DENIED:この地方のみんつくは、現在地が一致する会員のみ利用できます'
    );
  }
}

/**
 * [みんつく] URLの不透明トークン / 旧 region=id → 正規地方ID
 * ※ フロント AppMode.REGION_TO_TOKEN と揃える
 */
function resolveMintukuRegionId_(raw) {
  var s = String(raw || '').trim().toLowerCase();
  if (!s) return '';
  var tokenMap = {
    m8h3k9qx: 'hokkaido',
    m8t7n2wp: 'tohoku',
    m8k4r1vz: 'kanto',
    m8c5p6yd: 'chubu',
    m8n9s0ue: 'kinki',
    m8g2b8af: 'chugoku',
    m8s1d4jh: 'shikoku',
    m8y6o3lm: 'kyushu-okinawa'
  };
  if (tokenMap[s]) return tokenMap[s];
  if (mintukuRegionPrefs_(s).length) return s;
  return '';
}

/**
 * [みんつく] 地方ID → 都道府県リスト（Apomyの7ブロック地図とは別・8地方）
 */
function mintukuRegionPrefs_(regionId) {
  switch (String(regionId || '').trim().toLowerCase()) {
    case 'hokkaido':
      return ['北海道'];
    case 'tohoku':
      return ['青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県'];
    case 'kanto':
      return ['茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県'];
    case 'chubu':
      return ['新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県', '静岡県', '愛知県'];
    case 'kinki':
      return ['三重県', '滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県'];
    case 'chugoku':
      return ['鳥取県', '島根県', '岡山県', '広島県', '山口県'];
    case 'shikoku':
      return ['徳島県', '香川県', '愛媛県', '高知県'];
    case 'kyushu-okinawa':
      return ['福岡県', '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県'];
    default:
      return [];
  }
}

/**
 * 現在地セルを都道府県名に正規化
 * 「東京」「東京都港区」「東京都　」なども 東京都 に揃える
 */
function canonicalPrefecture_(raw) {
  var s = String(raw == null ? '' : raw)
    .replace(/[\s\u3000\u00a0\r\n\t]+/g, '')
    .replace(/[（(].*$/, '');
  if (!s) return '';
  var all = mintukuRegionPrefs_('hokkaido')
    .concat(mintukuRegionPrefs_('tohoku'))
    .concat(mintukuRegionPrefs_('kanto'))
    .concat(mintukuRegionPrefs_('chubu'))
    .concat(mintukuRegionPrefs_('kinki'))
    .concat(mintukuRegionPrefs_('chugoku'))
    .concat(mintukuRegionPrefs_('shikoku'))
    .concat(mintukuRegionPrefs_('kyushu-okinawa'));
  var i;
  for (i = 0; i < all.length; i++) {
    if (s === all[i] || s.indexOf(all[i]) === 0) return all[i];
  }
  for (i = 0; i < all.length; i++) {
    var stem = all[i].replace(/[都道府県]$/, '');
    if (stem && (s === stem || s.indexOf(stem) === 0)) return all[i];
  }
  return s;
}

/**
 * [みんつく] 都道府県が指定地方に含まれるか
 * ※ Apomy の「北海道・東北」結合地図とは別（8地方）
 */
function isPrefInMintukuRegion_(location, regionId) {
  var pref = canonicalPrefecture_(location);
  var id = resolveMintukuRegionId_(regionId) || String(regionId || '').trim().toLowerCase();
  if (!pref || !id) return false;
  var prefs = mintukuRegionPrefs_(id);
  if (!prefs || !prefs.length) return false;
  return prefs.indexOf(pref) >= 0;
}

/** シート用 TRUE/FALSE（チェックボックス列・文字列列どちらでも安定） */
function sheetBool_(on) {
  return on ? 'TRUE' : 'FALSE';
}

/** [みんつく] 地方ID → 表示ラベル（採番接頭辞） */
function mintukuRegionLabel_(regionId) {
  switch (String(regionId || '').trim().toLowerCase()) {
    case 'hokkaido':
      return '北海道';
    case 'tohoku':
      return '東北';
    case 'kanto':
      return '関東';
    case 'chubu':
      return '中部';
    case 'kinki':
      return '関西';
    case 'chugoku':
      return '中国';
    case 'shikoku':
      return '四国';
    case 'kyushu-okinawa':
      return '九州・沖縄';
    default:
      return '';
  }
}

/**
 * [みんつく] 「関東12」→ { label: '関東', n: 12 }
 */
function parseMintukuNumber_(raw) {
  var s = String(raw == null ? '' : raw).replace(/[\s\u3000]/g, '');
  if (!s || /^\d+$/.test(s)) return null;
  var m = s.match(/^(.+?)(?:No\.?|NO\.?|no\.?|Ｎｏ\.?)?(\d+)$/);
  if (!m) return null;
  var label = String(m[1] || '').replace(/(?:No\.?|NO\.?|no\.?|Ｎｏ\.?)$/, '');
  if (label === '近畿') label = '関西';
  var n = Number(m[2]);
  if (!label || !n) return null;
  return { label: label, n: n };
}

/** [みんつく] 地方ごとの次番号（互換: 全件オブジェクト配列から） */
function nextMintukuSeq_(rows, label) {
  var max = 0;
  (rows || []).forEach(function (r) {
    var parsed = parseMintukuNumber_(r['みんつく番号']);
    if (parsed && parsed.label === label && parsed.n > max) max = parsed.n;
  });
  return max + 1;
}

/**
 * [みんつく] みんつく番号列だけ読んで最大値を取得（全列読込しない）
 */
function scanMintukuNumberColMax_(sheet, headers, label) {
  var col = headers.indexOf('みんつく番号') + 1;
  if (col < 1) return 0;
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  // getRange(row, column, numRows, numColumns)
  var vals = sheet.getRange(2, col, lastRow - 1, 1).getValues();
  var max = 0;
  for (var i = 0; i < vals.length; i++) {
    var parsed = parseMintukuNumber_(vals[i][0]);
    if (parsed && parsed.label === label && parsed.n > max) max = parsed.n;
  }
  return max;
}

/**
 * [みんつく] 次番号（ScriptProperties + 番号列スキャン。Lockで同時採番を防ぐ）
 */
function nextMintukuSeqLocked_(sheet, headers, label) {
  var lock = null;
  try {
    lock = LockService.getScriptLock();
    lock.waitLock(10000);
  } catch (e) {
    lock = null;
  }
  try {
    var props = PropertiesService.getScriptProperties();
    var key = 'mintuku_seq_' + String(label || '');
    var n = Number(props.getProperty(key) || 0);
    if (!(n > 0)) {
      n = scanMintukuNumberColMax_(sheet, headers, label);
    }
    n += 1;
    try {
      props.setProperty(key, String(n));
    } catch (e2) {
      /* 採番自体は成功扱いで進める */
    }
    return n;
  } finally {
    if (lock) {
      try {
        lock.releaseLock();
      } catch (e3) {
        /* ignore */
      }
    }
  }
}

/**
 * [みんつく] 初回アクセス時に地方番号を自動採番（アクセス順）
 * 保存例: 関東1 / 関西2
 * ※すでに番号がある場合は掲載フラグを勝手にONに戻さない（停止操作を尊重）
 */
function ensureMintukuNumberCtx_(ctx, regionId) {
  var label = mintukuRegionLabel_(regionId);
  if (!label || !ctx) return '';

  ensureHeaderInCtx_(ctx, 'みんつく番号');
  ensureHeaderInCtx_(ctx, 'みんつく掲載');

  var current = String(ctx.row['みんつく番号'] || '').trim();
  var parsed = parseMintukuNumber_(current);
  if (parsed && parsed.label === label && parsed.n > 0) {
    var listedRaw = ctx.row['みんつく掲載'];
    if (listedRaw === '' || listedRaw === null || listedRaw === undefined) {
      setCtxValue_(ctx, 'みんつく掲載', sheetBool_(true));
    }
    return current;
  }

  var seq = nextMintukuSeqLocked_(ctx.sheet, ctx.headers, label);
  var value = label + String(seq);
  setCtxValue_(ctx, 'みんつく番号', value);
  setCtxValue_(ctx, 'みんつく掲載', sheetBool_(true));
  return value;
}

function ensureMintukuNumber_(sheet, table, idx, regionId) {
  if (idx < 0) return '';
  var ctx = userCtxFromTable_(sheet, table, idx);
  var value = ensureMintukuNumberCtx_(ctx, regionId);
  flushUserCtx_(ctx);
  return value;
}

/** [みんつく] 初回ログイン日を1回だけ記録（無料30日の起点） */
function ensureMintukuFirstLoginCtx_(ctx) {
  if (!ctx) return '';
  ensureHeaderInCtx_(ctx, 'みんつく初回ログイン日');
  ensureHeaderInCtx_(ctx, '課金有無');
  var current = sheetDateToYmd_(ctx.row['みんつく初回ログイン日']);
  if (current) return current;
  var key = tokyoDateKey_(new Date());
  if (!key) key = formatDateTime_(new Date()).slice(0, 10);
  setCtxValue_(ctx, 'みんつく初回ログイン日', key);
  return key;
}

function ensureMintukuFirstLogin_(sheet, table, idx) {
  if (idx < 0) return '';
  var ctx = userCtxFromTable_(sheet, table, idx);
  var key = ensureMintukuFirstLoginCtx_(ctx);
  flushUserCtx_(ctx);
  return key;
}

/** プロフィール初回登録が完了しているか（Apomyログイン可否の判定用） */
function isRegistrationComplete_(row) {
  return Boolean(realNameFromRow_(row)) && Boolean(nicknameFromRow_(row));
}

/**
 * [Apomy] 掲載停止済み（掲載中=FALSE）の完了会員は Apomy からログイン不可
 * ※みんつく / PM は Apomy 停止と独立して利用可
 */
function assertApomyLoginAllowed_(row, appKind) {
  var kind = String(appKind || 'apomy').trim().toLowerCase();
  if (kind === 'mintuku' || kind === 'president' || kind === 'presidentmate') return;
  if (toBool_(row['掲載中'])) return;
  if (!isRegistrationComplete_(row)) return;
  throw new Error(
    'APOMY_UNPUBLISHED:掲載が停止されているためログインできません'
  );
}

/** シート上で明示的に FALSE か（空欄は未設定扱い） */
function isExplicitFalse_(v) {
  if (v === false || v === 0) return true;
  var s = String(v == null ? '' : v).trim().toUpperCase();
  return s === 'FALSE' || s === '0' || s === 'NO' || s === '×' || s === 'いいえ';
}

/**
 * [みんつく] みんつく掲載=FALSE の完了会員はみんつくからログイン不可
 * ※空欄は初回利用として許可。Apomy掲載停止とは独立
 */
function assertMintukuLoginAllowed_(row, appKind) {
  var kind = String(appKind || '').trim().toLowerCase();
  if (kind !== 'mintuku') return;
  if (!isExplicitFalse_(row['みんつく掲載'])) return;
  if (!isRegistrationComplete_(row)) return;
  throw new Error(
    'MINTUKU_UNPUBLISHED:掲載が停止されているためログインできません'
  );
}

/**
 * [プレジデント] プレジデントメイト掲載=FALSE の完了会員は PM からログイン不可
 * ※空欄は掲載扱い。社長マーク未承認は従来どおり PRESIDENT_DENIED
 */
function assertPresidentLoginAllowed_(row, appKind) {
  var kind = String(appKind || '').trim().toLowerCase();
  if (kind !== 'president' && kind !== 'presidentmate') return;
  if (!toBool_(row['社長マーク'])) {
    throw new Error('PRESIDENT_DENIED:Apomyにて社長マークの承認をお願いします');
  }
  if (!isExplicitFalse_(row['プレジデントメイト掲載'])) return;
  if (!isRegistrationComplete_(row)) return;
  throw new Error(
    'PRESIDENT_UNPUBLISHED:掲載が停止されているためログインできません'
  );
}

/** [Apomy] 閲覧者チェック（本人行のみ。一覧全件は読まない） */
function assertApomyViewerAccessLight_(p) {
  p = p || {};
  var memberNo = String(p.memberNo || p.member_no || '').trim();
  var email = String(p.email || '').trim();
  if (!memberNo && !email) return;
  var ctx = openUserCtx_(memberNo, email);
  var appKind = String(p.app || 'apomy').trim().toLowerCase();
  assertApomyLoginAllowed_(ctx.row, appKind);
}

/**
 * [みんつく] オーナー手動で現在地変更後: 初回ログイン時に番号接頭辞を現在地に合わせる
 * ※みんつく番号が無い場合は触らない（採番は従来フロー）
 */
function syncMintukuNumberToLocationCtx_(ctx) {
  if (!ctx) return '';
  var current = String(ctx.row['みんつく番号'] || '').trim();
  if (!current) return '';
  var loc = String(ctx.row['現在地'] || '').trim();
  if (!loc) return current;
  var regionId = prefectureToMintukuRegionId_(loc);
  if (!regionId) return current;
  var label = mintukuRegionLabel_(regionId);
  var parsed = parseMintukuNumber_(current);
  if (parsed && parsed.label === label) return current;
  return ensureMintukuNumberCtx_(ctx, regionId);
}

/** 都道府県 → みんつく地方ID */
function prefectureToMintukuRegionId_(pref) {
  var p = String(pref || '').trim();
  if (!p) return '';
  var ids = ['hokkaido', 'tohoku', 'kanto', 'chubu', 'kinki', 'chugoku', 'shikoku', 'kyushu-okinawa'];
  for (var i = 0; i < ids.length; i++) {
    if (isPrefInMintukuRegion_(p, ids[i])) return ids[i];
  }
  return '';
}

/**
 * [みんつく] 現在地変更で地方が変わったら番号を付け直し（欠番は埋めない）
 * ※みんつく掲載フラグは触らない
 */
function renumberMintukuOnRegionChangeCtx_(ctx, oldLoc, newLoc) {
  var oldId = prefectureToMintukuRegionId_(oldLoc);
  var newId = prefectureToMintukuRegionId_(newLoc);
  if (!newId || oldId === newId) return '';
  var label = mintukuRegionLabel_(newId);
  if (!label) return '';
  ensureHeaderInCtx_(ctx, 'みんつく番号');
  var seq = nextMintukuSeqLocked_(ctx.sheet, ctx.headers, label);
  var value = label + String(seq);
  setCtxValue_(ctx, 'みんつく番号', value);
  return value;
}

function renumberMintukuOnRegionChange_(sheet, table, idx, oldLoc, newLoc) {
  if (idx < 0) return '';
  var ctx = userCtxFromTable_(sheet, table, idx);
  var value = renumberMintukuOnRegionChangeCtx_(ctx, oldLoc, newLoc);
  flushUserCtx_(ctx);
  return value;
}

/** [みんつく] 東京カレンダー日数差（初日=0） */
function mintukuDaysSinceFirst_(firstRaw) {
  var first = parseDate_(firstRaw);
  if (!first) return 0;
  var a = tokyoDateKey_(first);
  var b = tokyoDateKey_(new Date());
  if (!a || !b) return 0;
  var da = new Date(a + 'T00:00:00+09:00');
  var db = new Date(b + 'T00:00:00+09:00');
  var diff = Math.floor((db.getTime() - da.getTime()) / 86400000);
  return diff < 0 ? 0 : diff;
}

/**
 * シートの日付／日時を yyyy-MM-dd に正規化
 * ※ Date を String() すると "Thu Aug 13 2026 ..." になり表示が壊れるため使わない
 */
function sheetDateToYmd_(v) {
  if (v === null || v === undefined || v === '') return '';
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime())) {
    return Utilities.formatDate(v, 'Asia/Tokyo', 'yyyy-MM-dd');
  }
  var s = String(v).trim();
  if (!s) return '';
  var m = s.match(/^(\d{4})[-\/年.](\d{1,2})[-\/月.](\d{1,2})/);
  if (m) {
    return (
      m[1] +
      '-' +
      ('0' + m[2]).slice(-2) +
      '-' +
      ('0' + m[3]).slice(-2)
    );
  }
  // "Thu Aug 13 2026 ..." 等
  var d = parseDate_(v);
  if (d) return Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy-MM-dd');
  return '';
}

/**
 * [みんつく] みんつく課金開始日があれば有料扱い（主キー）
 * 互換: 旧列名「課金開始日」も読む
 */
function getMintukuPaidStartRaw_(row) {
  var v = sheetDateToYmd_((row && row['みんつく課金開始日']) || '');
  if (v) return v;
  return sheetDateToYmd_((row && row['課金開始日']) || '');
}

function isMintukuPaid_(row) {
  if (getMintukuPaidStartRaw_(row)) return true;
  var v = row && row['課金有無'];
  if (v === true || v === 1) return true;
  var s = String(v || '').trim().toUpperCase();
  if (!s) return false;
  if (s === 'TRUE' || s === '1' || s === '○' || s === 'はい' || s === '有' || s === 'あり') return true;
  return toBool_(v);
}

/**
 * [みんつく] 利用可否
 * - 無料: 初回ログイン日から30日（day 0〜29）
 * - みんつく課金開始日に日付あり → 有料（期限なし）
 * - 表示用 daysUsed/daysLeft は無料期間基準。課金後の経過は paidDaysUsed
 */
function evaluateMintukuAccess_(row) {
  var first = sheetDateToYmd_((row && row['みんつく初回ログイン日']) || '');
  var paidStart = getMintukuPaidStartRaw_(row);
  var paid = isMintukuPaid_(row);
  var paidDaysUsed = paidStart ? mintukuDaysSinceFirst_(paidStart) : 0;

  if (!first) {
    return {
      ok: true,
      expired: false,
      paid: paid,
      daysUsed: 0,
      daysLeft: 30,
      paidStartAt: paidStart,
      paidDaysUsed: paidDaysUsed
    };
  }
  var daysUsed = mintukuDaysSinceFirst_(first);
  if (daysUsed < 30) {
    return {
      ok: true,
      expired: false,
      paid: paid,
      daysUsed: daysUsed,
      daysLeft: 30 - daysUsed,
      paidStartAt: paidStart,
      paidDaysUsed: paidDaysUsed
    };
  }
  if (paid) {
    return {
      ok: true,
      expired: false,
      paid: true,
      daysUsed: daysUsed,
      daysLeft: 0,
      paidStartAt: paidStart,
      paidDaysUsed: paidDaysUsed
    };
  }
  return {
    ok: false,
    expired: true,
    paid: false,
    daysUsed: daysUsed,
    daysLeft: 0,
    paidStartAt: paidStart,
    paidDaysUsed: paidDaysUsed
  };
}

function attachMintukuAccess_(user, row) {
  var access = evaluateMintukuAccess_(row || {});
  user.mintukuAccessOk = access.ok;
  user.mintukuExpired = access.expired;
  user.mintukuPaid = access.paid;
  user.mintukuDaysUsed = access.daysUsed;
  user.mintukuDaysLeft = access.daysLeft;
  user.mintukuFirstLoginAt = sheetDateToYmd_((row && row['みんつく初回ログイン日']) || '');
  user.mintukuPaidStartAt = access.paidStartAt || '';
  user.mintukuPaidDaysUsed = access.paidDaysUsed || 0;
  return user;
}

/**
 * [みんつく] 閲覧者チェック（一覧用）
 * - 無料期間切れ
 * - 現在地が指定地方と一致（URLいじりで他地方を見られないようにする）
 * @param {Object} p
 * @param {string} [regionIdOpt]
 * @param {Object[]} [rowsOpt] 呼び出し元ですでに読んだ会員行（省略時のみ再取得）
 */
function assertMintukuViewerAccess_(p, regionIdOpt, rowsOpt) {
  var email = String((p && p.email) || '').trim();
  var memberNo = String((p && (p.memberNo || p.member_no)) || '').trim();
  if (!email && !memberNo) return;
  var rows = rowsOpt || readObjects_(SHEET.USERS);
  var idx = findUserIndex_(rows, memberNo, email);
  if (idx < 0) return;
  var access = evaluateMintukuAccess_(rows[idx]);
  if (!access.ok) {
    throw new Error(
      'MINTUKU_EXPIRED:無料期間(30日)が終了しました。今まで通り閲覧するにはこちらからお問合せください'
    );
  }
  var regionId = resolveMintukuRegionId_(regionIdOpt || (p && (p.region || p.r)) || '');
  if (!regionId) return;
  var loc = String(rows[idx]['現在地'] || '').trim();
  // 現在地未設定はプロフィール設定中として許可（一覧は地方フィルタのみ）
  if (loc && !isPrefInMintukuRegion_(loc, regionId)) {
    throw new Error(
      'MINTUKU_REGION_DENIED:この地方のみんつくは、現在地が一致する会員のみ利用できます'
    );
  }
}

/** [みんつく] みんつく掲載のON/OFF */
function setMintukuListed_(body, listed, typeLabel) {
  const memberNo = String(body.memberNo || body.member_no || '').trim();
  const email = String(body.email || '').trim();
  if (!memberNo && !email) throw new Error('memberNo または email が必要です');

  const ctx = openUserCtx_(memberNo, email);
  const no = String(ctx.row['会員番号'] || memberNo);
  const now = formatDateTime_(new Date());
  const flag = sheetBool_(listed);
  setCtxValue_(ctx, 'みんつく掲載', flag);
  setCtxValue_(ctx, '更新日時', now);
  setCtxValue_(ctx, '最終ログイン日時', now);
  flushUserCtx_(ctx);
  SpreadsheetApp.flush();

  var requestId = '';
  try {
    requestId = createRequest_(
      no,
      typeLabel || (listed ? 'みんつく掲載再開' : 'みんつく掲載停止'),
      '対応済',
      String(body.note || '')
    );
  } catch (err) {
    Logger.log('createRequest_ failed (mintuku listed): ' + err);
  }
  return {
    requestId: requestId,
    memberNo: no,
    mintukuListed: !!listed,
    isPublished: toBool_(ctx.row['掲載中']),
    lastLoginAt: now
  };
}

/* ========== [プレジデントメイト] 掲載・採番 ========== */

/** 空欄・TRUE＝掲載。FALSEのみ非表示 */
function isPresidentMateListed_(row) {
  var raw = row && row['プレジデントメイト掲載'];
  if (raw === '' || raw === null || raw === undefined) return true;
  return toBool_(raw);
}

function parsePresidentNumber_(raw) {
  var s = String(raw || '').trim();
  var m = s.match(/^社長(\d+)$/);
  if (!m) return null;
  return { n: Number(m[1]) };
}

function scanPresidentNumberColMax_(sheet, headers) {
  var col = headers.indexOf('プレジデント番号') + 1;
  if (col <= 0) return 0;
  var last = sheet.getLastRow();
  if (last < 2) return 0;
  var vals = sheet.getRange(2, col, last, col).getValues();
  var max = 0;
  for (var i = 0; i < vals.length; i++) {
    var parsed = parsePresidentNumber_(vals[i][0]);
    if (parsed && parsed.n > max) max = parsed.n;
  }
  return max;
}

function nextPresidentSeqLocked_(sheet, headers) {
  var lock = null;
  try {
    lock = LockService.getScriptLock();
    lock.waitLock(10000);
  } catch (e) {
    lock = null;
  }
  try {
    var props = PropertiesService.getScriptProperties();
    var key = 'president_seq';
    var n = Number(props.getProperty(key) || 0);
    if (!(n > 0)) {
      n = scanPresidentNumberColMax_(sheet, headers);
    }
    n += 1;
    try {
      props.setProperty(key, String(n));
    } catch (e2) {
      /* ignore */
    }
    return n;
  } finally {
    if (lock) {
      try {
        lock.releaseLock();
      } catch (e3) {
        /* ignore */
      }
    }
  }
}

/**
 * [プレジデント] 番号確保＋掲載空欄なら TRUE
 * ※FALSE（停止）は勝手に戻さない
 */
function ensurePresidentNumberCtx_(ctx) {
  if (!ctx) return '';
  ensureHeaderInCtx_(ctx, 'プレジデント番号');
  ensureHeaderInCtx_(ctx, 'プレジデントメイト掲載');

  var current = String(ctx.row['プレジデント番号'] || '').trim();
  var parsed = parsePresidentNumber_(current);
  if (parsed && parsed.n > 0) {
    var listedRaw = ctx.row['プレジデントメイト掲載'];
    if (listedRaw === '' || listedRaw === null || listedRaw === undefined) {
      setCtxValue_(ctx, 'プレジデントメイト掲載', sheetBool_(true));
    }
    return current;
  }

  var seq = nextPresidentSeqLocked_(ctx.sheet, ctx.headers);
  var value = '社長' + String(seq);
  setCtxValue_(ctx, 'プレジデント番号', value);
  var listedRaw2 = ctx.row['プレジデントメイト掲載'];
  if (listedRaw2 === '' || listedRaw2 === null || listedRaw2 === undefined) {
    setCtxValue_(ctx, 'プレジデントメイト掲載', sheetBool_(true));
  }
  return value;
}

/** 一覧取得時: 社長マークあり＆番号空へ一括採番（rows を更新） */
function ensurePresidentNumbersBatch_(rows) {
  var need = [];
  for (var i = 0; i < (rows || []).length; i++) {
    var r = rows[i];
    if (!toBool_(r['社長マーク'])) continue;
    if (parsePresidentNumber_(r['プレジデント番号'])) continue;
    need.push(r);
  }
  if (!need.length) return;

  var sheet = getSheet_(SHEET.USERS);
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  ensureHeaderOnSheet_(sheet, headers, 'プレジデント番号');
  ensureHeaderOnSheet_(sheet, headers, 'プレジデントメイト掲載');
  headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var numCol = headers.indexOf('プレジデント番号') + 1;
  var listCol = headers.indexOf('プレジデントメイト掲載') + 1;
  var emailCol = headers.indexOf('Googleメール') + 1;
  var memberCol = headers.indexOf('会員番号') + 1;
  if (numCol <= 0) return;

  for (var j = 0; j < need.length; j++) {
    var rowObj = need[j];
    var email = String(rowObj['Googleメール'] || '').trim();
    var memberNo = String(rowObj['会員番号'] || '').trim();
    var found = -1;
    var last = sheet.getLastRow();
    if (last < 2) break;
    if (memberCol > 0 && memberNo) {
      var mvals = sheet.getRange(2, memberCol, last, memberCol).getValues();
      for (var mi = 0; mi < mvals.length; mi++) {
        if (String(mvals[mi][0] || '').trim() === memberNo) {
          found = mi + 2;
          break;
        }
      }
    }
    if (found < 0 && emailCol > 0 && email) {
      var evals = sheet.getRange(2, emailCol, last, emailCol).getValues();
      for (var ei = 0; ei < evals.length; ei++) {
        if (String(evals[ei][0] || '').trim().toLowerCase() === email.toLowerCase()) {
          found = ei + 2;
          break;
        }
      }
    }
    if (found < 0) continue;
    var seq = nextPresidentSeqLocked_(sheet, headers);
    var value = '社長' + String(seq);
    sheet.getRange(found, numCol).setValue(value);
    rowObj['プレジデント番号'] = value;
    if (listCol > 0) {
      var curList = sheet.getRange(found, listCol).getValue();
      if (curList === '' || curList === null || curList === undefined) {
        sheet.getRange(found, listCol).setValue(sheetBool_(true));
        rowObj['プレジデントメイト掲載'] = sheetBool_(true);
      }
    }
  }
  SpreadsheetApp.flush();
}

function ensureHeaderOnSheet_(sheet, headers, name) {
  if (headers.indexOf(name) >= 0) return;
  var col = sheet.getLastColumn() + 1;
  sheet.getRange(1, col).setValue(name);
}

/** [プレジデント] 閲覧者チェック（本人行のみ） */
function assertPresidentViewerAccessLight_(p) {
  p = p || {};
  var memberNo = String(p.memberNo || p.member_no || '').trim();
  var email = String(p.email || '').trim();
  if (!memberNo && !email) return; // 未ログインは FE 側で弾く
  var ctx = openUserCtx_(memberNo, email);
  assertPresidentLoginAllowed_(ctx.row, 'president');
}

/** [プレジデント] 掲載のON/OFF */
function setPresidentListed_(body, listed, typeLabel) {
  const memberNo = String(body.memberNo || body.member_no || '').trim();
  const email = String(body.email || '').trim();
  if (!memberNo && !email) throw new Error('memberNo または email が必要です');

  const ctx = openUserCtx_(memberNo, email);
  if (!toBool_(ctx.row['社長マーク'])) {
    throw new Error('PRESIDENT_DENIED:Apomyにて社長マークの承認をお願いします');
  }
  const no = String(ctx.row['会員番号'] || memberNo);
  const now = formatDateTime_(new Date());
  const flag = sheetBool_(listed);
  setCtxValue_(ctx, 'プレジデントメイト掲載', flag);
  if (listed) {
    ensurePresidentNumberCtx_(ctx);
  }
  setCtxValue_(ctx, '更新日時', now);
  setCtxValue_(ctx, '最終ログイン日時', now);
  flushUserCtx_(ctx);
  SpreadsheetApp.flush();

  var requestId = '';
  try {
    requestId = createRequest_(
      no,
      typeLabel || (listed ? 'プレジデントメイト掲載再開' : 'プレジデントメイト掲載停止'),
      '対応済',
      String(body.note || '')
    );
  } catch (err) {
    Logger.log('createRequest_ failed (president listed): ' + err);
  }
  return {
    requestId: requestId,
    memberNo: no,
    presidentMateListed: !!listed,
    presidentNumber: String(ctx.row['プレジデント番号'] || '').trim(),
    presidentMark: true,
    lastLoginAt: now
  };
}

/** ダッシュボード: app / region で Apomy・みんつく・PM を出し分け */
function getDashboard_(p) {
  p = p || {};
  var appKind = String(p.app || 'apomy').trim().toLowerCase();
  if (appKind === 'mintuku') {
    var regionId = resolveMintukuRegionId_(p.region || p.r || '');
    if (regionId) return getMintukuDashboard_(regionId);
  }
  if (appKind === 'president' || appKind === 'presidentmate') {
    return getPresidentDashboard_();
  }
  return getApomyDashboard_();
}

function buildDashboardDayCounts_() {
  var dayCounts = {};
  var i;
  for (i = 0; i < 7; i++) {
    dayCounts[tokyoDateKey_(addDays_(new Date(), -6 + i))] = 0;
  }
  return dayCounts;
}

function buildDashboardSeries_(dayCounts) {
  return Object.keys(dayCounts).sort().map(function (key) {
    return {
      date: key,
      label: key.slice(5).replace('-', '/'),
      count: dayCounts[key]
    };
  });
}

function aggregateDashboardRows_(rows, matchFn) {
  const today = tokyoDateKey_(new Date());
  const yesterday = tokyoDateKey_(addDays_(new Date(), -1));
  var totalRegistered = 0;
  var yesterdayNew = 0;
  var unpublished = 0;
  var yesterdayReturning = 0;
  var dayCounts = buildDashboardDayCounts_();

  (rows || []).forEach(function (r) {
    if (!matchFn(r)) return;
    totalRegistered += 1;
    const createdKey = tokyoDateKey_(parseDate_(r['登録日時']));
    const loginKey = tokyoDateKey_(parseDate_(r['最終ログイン日時']));
    const isPublished = toBool_(r['掲載中']);
    const hasRealName = Boolean(realNameFromRow_(r));
    if (!isPublished && loginKey === yesterday && hasRealName) unpublished += 1;
    if (createdKey === yesterday) yesterdayNew += 1;
    if (loginKey === yesterday && createdKey && createdKey < yesterday && isPublished) {
      yesterdayReturning += 1;
    }
    if (createdKey && dayCounts.hasOwnProperty(createdKey)) {
      dayCounts[createdKey] += 1;
    }
  });

  return {
    asOf: today,
    totalRegistered: totalRegistered,
    yesterdayNew: yesterdayNew,
    unpublished: unpublished,
    yesterdayReturning: yesterdayReturning,
    newLast7Days: buildDashboardSeries_(dayCounts)
  };
}

/** [みんつく] 現在地がその地方の会員で集計（スプシに見える表記でカウント） */
function getMintukuDashboard_(regionId) {
  if (!regionId) {
    return {
      asOf: tokyoDateKey_(new Date()),
      totalRegistered: 0,
      yesterdayNew: 0,
      unpublished: 0,
      yesterdayReturning: 0,
      newLast7Days: buildDashboardSeries_(buildDashboardDayCounts_())
    };
  }
  var sheet = getSheet_(SHEET.USERS);
  var headers = getSheetHeaders_(sheet);
  var locCol = headers.indexOf('現在地');
  var createdCol = headers.indexOf('登録日時');
  var lastRow = sheet.getLastRow();
  if (locCol < 0 || lastRow < 2) {
    return aggregateDashboardRows_([], function () { return false; });
  }
  var num = lastRow - 1;
  var locVals = sheet.getRange(2, locCol + 1, num, 1).getDisplayValues();
  var createdVals = createdCol >= 0
    ? sheet.getRange(2, createdCol + 1, num, 1).getValues()
    : [];
  var rows = [];
  var i;
  for (i = 0; i < locVals.length; i++) {
    var loc = String(locVals[i][0] || '').trim();
    if (!loc) continue;
    rows.push({
      '現在地': loc,
      '登録日時': createdCol >= 0 ? createdVals[i][0] : ''
    });
  }
  return aggregateDashboardRows_(rows, function (r) {
    return isPrefInMintukuRegion_(r['現在地'], regionId);
  });
}

/** [プレジデント] 社長マーク=TRUE で集計 */
function getPresidentDashboard_() {
  var rows = readUsersColumnsRows_(['社長マーク', '登録日時']);
  return aggregateDashboardRows_(rows, function (r) {
    return toBool_(r['社長マーク']);
  });
}

/**
 * [Apomy] ホームダッシュボード用集計（Asia/Tokyo）
 * - 登録人数: 会員シート全件
 * - 昨日の新規: 登録日時が昨日
 * - 昨日の掲載停止者: 掲載中=FALSE かつ 最終ログイン日時が昨日 かつ 本名が空でない
 * - 再参加者: 昨日ログインがあり、登録日が昨日より前、かつ掲載中=TRUE
 */
function getApomyDashboard_() {
  var rows = readUsersColumnsRows_([
    '会員番号',
    '登録日時',
    '最終ログイン日時',
    '掲載中',
    '本名'
  ]);
  return aggregateDashboardRows_(rows, function () {
    return true;
  });
}

function addDays_(date, days) {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + days);
  return d;
}

function tokyoDateKey_(d) {
  if (!d || Object.prototype.toString.call(d) !== '[object Date]' || isNaN(d.getTime())) {
    return '';
  }
  return Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy-MM-dd');
}

function getBanners_(p) {
  p = p || {};
  const now = new Date();
  const appKind = String(p.app || 'apomy').trim().toLowerCase();
  return readObjects_(SHEET.BANNERS)
    .filter(function (r) {
      if (!toBool_(r['有効'])) return false;
      const start = parseDate_(r['開始日時']);
      const end = parseDate_(r['終了日時']);
      if (start && now < start) return false;
      if (end && now > end) return false;
      if (!bannerMatchesApp_(r['対象アプリ'], appKind)) return false;
      return true;
    })
    .sort(function (a, b) {
      return Number(a['表示順'] || 0) - Number(b['表示順'] || 0);
    })
    .map(function (r) {
      return {
        id: String(r['バナーID'] || ''),
        title: String(r['タイトル'] || ''),
        description: String(r['説明'] || ''),
        imageUrl: String(r['画像URL'] || ''),
        linkUrl: String(r['リンクURL'] || ''),
        place: normalizeBannerPlace_(r['場所']),
        targetApp: String(r['対象アプリ'] || '').trim()
      };
    });
}

/**
 * バナー対象アプリ: 空/すべて=全アプリ。
 * 正規の選択肢: アポミー / みんつく / プレジデントメイト
 * （英字 apomy/mintuku/president は互換で受け付ける）
 */
function bannerMatchesApp_(raw, appKind) {
  var rawTrim = String(raw || '').trim();
  var t = rawTrim.toLowerCase();
  if (!rawTrim || t === 'すべて' || t === 'all' || t === '全て') return true;
  var app = String(appKind || 'apomy').trim().toLowerCase();
  if (app === 'presidentmate') app = 'president';
  // 正規表記（日本語）＋互換（英字）
  if (rawTrim === 'アポミー' || t === 'apomy') return app === 'apomy';
  if (rawTrim === 'みんつく' || t === 'mintuku') return app === 'mintuku';
  if (
    rawTrim === 'プレジデントメイト' ||
    rawTrim === 'プレジデント' ||
    t === 'president' ||
    t === 'presidentmate'
  ) {
    return app === 'president';
  }
  // 不明値は互換のため出す
  return true;
}

/** バナー掲載場所: ホーム / 繋がる / 両方（空欄はホーム） */
function normalizeBannerPlace_(raw) {
  var place = String(raw || '').trim();
  if (!place || place === 'ホーム' || place === 'home' || place === 'Home') return 'ホーム';
  if (place === '繋がる' || place === 'connect' || place === 'Connect') return '繋がる';
  if (place === '両方' || place === 'both' || place === 'Both' || place === 'ALL' || place === 'すべて') return '両方';
  return 'ホーム';
}

function getMe_(p) {
  // 自分の取得＝操作とみなし最終ログインを更新
  return touchActivity_(p);
}

/**
 * 最終ログイン日時を更新（ログイン / 操作のたび）
 * @returns {Object} mapUser_ 結果（lastLoginAt 更新済み）
 */
function touchActivity_(body) {
  const memberNo = String((body && (body.memberNo || body.member_no)) || '').trim();
  const email = String((body && body.email) || '').trim();
  if (!memberNo && !email) {
    throw new Error('email または memberNo が必要です');
  }

  if (email) {
    assertNotDeniedEmail_(email);
    assertMaintenanceAccess_(email);
  }

  const ctx = openUserCtx_(memberNo, email);
  assertNotDeniedEmail_(ctx.row['Googleメール']);
  assertMaintenanceAccess_(ctx.row['Googleメール']);

  var appKindTouch = String((body && body.app) || '').trim().toLowerCase();
  assertApomyLoginAllowed_(ctx.row, appKindTouch);
  assertMintukuLoginAllowed_(ctx.row, appKindTouch);
  assertPresidentLoginAllowed_(ctx.row, appKindTouch);

  const now = formatDateTime_(new Date());
  setCtxValue_(ctx, '最終ログイン日時', now);

  if (toBool_(ctx.row['掲載中'])) {
    ensureMintukuOnApomyPublishCtx_(ctx);
  }
  syncMintukuNumberToLocationCtx_(ctx);

  var appKind = String((body && body.app) || '').trim().toLowerCase();
  var mintukuRegion = resolveMintukuRegionId_((body && (body.region || body.r)) || '');
  if (appKind === 'mintuku' && mintukuRegion) {
    var myLoc = String(ctx.row['現在地'] || '').trim();
    if (!myLoc || isPrefInMintukuRegion_(myLoc, mintukuRegion)) {
      ensureMintukuNumberCtx_(ctx, mintukuRegion);
      ensureMintukuFirstLoginCtx_(ctx);
    }
  }
  if (appKind === 'president' || appKind === 'presidentmate') {
    if (!toBool_(ctx.row['社長マーク'])) {
      throw new Error('PRESIDENT_DENIED:Apomyにて社長マークの承認をお願いします');
    }
    ensurePresidentNumberCtx_(ctx);
  }

  flushUserCtx_(ctx);

  const user = mapUser_(ctx.row);
  user.lastLoginAt = now;
  if (appKind === 'mintuku') {
    attachMintukuAccess_(user, ctx.row);
  }
  return user;
}

function getMasters_() {
  var cache = CacheService.getScriptCache();
  try {
    var cached = cache.get('apomy_masters_v1');
    if (cached) {
      return JSON.parse(cached);
    }
  } catch (e) {
    // ignore
  }

  const rows = readObjects_(SHEET.MASTERS).filter(function (r) {
    return toBool_(r['有効']);
  });

  const grouped = {};
  rows
    .sort(function (a, b) {
      return Number(a['表示順'] || 0) - Number(b['表示順'] || 0);
    })
    .forEach(function (r) {
      const cat = String(r['区分'] || '');
      var value = String(r['値'] || '').trim();
      var label = String(r['表示名'] || r['値'] || '').trim();
      // 値空でも表示名があれば採用（長文ポリシーなど）
      if (!value && label) value = label;
      if (!cat || !value) return;
      if (!grouped[cat]) grouped[cat] = [];
      // 同じ「値」の重複行は除外
      const exists = grouped[cat].some(function (item) {
        return item.value === value;
      });
      if (exists) return;
      grouped[cat].push({
        value: value,
        label: label || value
      });
    });

  try {
    // マスタはあまり変わらないので短時間キャッシュ（開くたびのシート全読を避ける）
    cache.put('apomy_masters_v1', JSON.stringify(grouped), 300);
  } catch (e2) {
    // ignore quota
  }
  return grouped;
}

function getSettings_() {
  var cache = CacheService.getScriptCache();
  try {
    var cached = cache.get('apomy_settings_v1');
    if (cached) {
      return JSON.parse(cached);
    }
  } catch (e) {
    // ignore cache errors
  }
  const sheet = getSheet_(SHEET.SETTINGS);
  const values = sheet.getDataRange().getValues();
  const out = {};
  for (var i = 1; i < values.length; i++) {
    const key = String(values[i][0] || '').trim();
    if (!key) continue;
    out[key] = values[i][1];
  }
  try {
    cache.put('apomy_settings_v1', JSON.stringify(out), 60);
  } catch (e2) {
    // ignore
  }
  return out;
}

/** フロント公開用（拒否リスト・許可メール等は含めない） */
function getPublicSettings_() {
  const out = getSettings_();
  delete out['拒否メール'];
  delete out['承認トークン'];
  delete out['オーナーメール'];
  delete out['開発者メール'];
  return out;
}

function isMaintenanceMode_() {
  try {
    var settings = getSettings_();
    return toBool_(settings['メンテナンス']);
  } catch (e) {
    return false;
  }
}

/** メンテ中バイパス: オーナーメール + 開発者メール */
function getMaintenanceBypassEmailSet_() {
  var set = {};
  try {
    var settings = getSettings_();
    [settings['オーナーメール'], settings['開発者メール']].forEach(function (raw) {
      String(raw || '')
        .split(/[\s,，、;；]+/)
        .map(function (s) { return String(s || '').trim().toLowerCase(); })
        .filter(function (mail) { return mail.indexOf('@') >= 0; })
        .forEach(function (mail) {
          set[mail] = true;
        });
    });
  } catch (e) {
    // ignore
  }
  return set;
}

function isMaintenanceBypassEmail_(email) {
  var mail = String(email || '').trim().toLowerCase();
  if (!mail) return false;
  return Boolean(getMaintenanceBypassEmailSet_()[mail]);
}

function assertMaintenanceAccess_(email) {
  if (!isMaintenanceMode_()) return;
  if (isMaintenanceBypassEmail_(email)) return;
  throw new Error(MAINTENANCE_MESSAGE);
}

/**
 * メンテ中は settings / ping / 承認リンク / login(内部判定) 以外を遮断。
 * login はメール確定後に assertMaintenanceAccess_ する。
 */
function guardMaintenance_(action, params) {
  if (!isMaintenanceMode_()) return;
  var act = String(action || '').trim();
  if (
    act === 'settings' ||
    act === 'ping' ||
    act === 'approveRequest' ||
    act === 'rejectRequest' ||
    act === 'login'
  ) {
    return;
  }
  assertMaintenanceAccess_((params && params.email) || '');
}

/**
 * 「アクセス拒否」シートを用意（無ければ作成）
 * ヘッダー: メール / メモ
 */
function ensureDeniedMailSheet_() {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(SHEET.DENIED_MAIL);
  if (sheet) return sheet;
  sheet = ss.insertSheet(SHEET.DENIED_MAIL);
  sheet.getRange(1, 1, 1, 2).setValues([['メール', 'メモ']]);
  sheet.setFrozenRows(1);
  try {
    sheet.setColumnWidth(1, 280);
    sheet.setColumnWidth(2, 200);
  } catch (e) {
    // ignore
  }
  return sheet;
}

/**
 * 「アクセス拒否」シートから拒否アドレス集合を取得（1行1メール）
 * ヘッダー名が メール / Googleメール / email ならその列、なければ A 列
 */
function getDeniedEmailSet_() {
  var cache = CacheService.getScriptCache();
  try {
    var cached = cache.get('apomy_denied_v1');
    if (cached) {
      return JSON.parse(cached);
    }
  } catch (e) {
    // ignore
  }
  var set = {};
  try {
    var sheet = ensureDeniedMailSheet_();
    var values = sheet.getDataRange().getValues();
    if (!values || values.length < 2) {
      try { cache.put('apomy_denied_v1', '{}', 60); } catch (e0) {}
      return set;
    }

    var headers = values[0].map(function (h) {
      return String(h || '').trim().toLowerCase();
    });
    var col = 0;
    for (var h = 0; h < headers.length; h++) {
      if (
        headers[h] === 'メール' ||
        headers[h] === 'googleメール' ||
        headers[h] === 'email' ||
        headers[h] === 'mail'
      ) {
        col = h;
        break;
      }
    }
    for (var i = 1; i < values.length; i++) {
      var raw = String(values[i][col] || '').trim().toLowerCase();
      if (!raw) continue;
      String(raw)
        .split(/[\s,，、;；]+/)
        .map(function (s) { return String(s || '').trim().toLowerCase(); })
        .filter(Boolean)
        .forEach(function (mail) {
          if (mail.indexOf('@') >= 0) set[mail] = true;
        });
    }
  } catch (err) {
    // ignore
  }
  try {
    cache.put('apomy_denied_v1', JSON.stringify(set), 60);
  } catch (e2) {
    // ignore
  }
  return set;
}

function assertNotDeniedEmail_(email) {
  var mail = String(email || '').trim().toLowerCase();
  if (!mail) return;
  var denied = getDeniedEmailSet_();
  if (denied[mail]) {
    throw new Error(ACCESS_DENIED_MESSAGE);
  }
}

/* ========== Write APIs ========== */

function login_(body) {
  var email = String(body.email || '').trim();
  var googleId = String(body.googleId || body.google_sub || '').trim();
  var name = String(body.name || '').trim();
  var picture = String(body.picture || body.avatarUrl || '').trim();
  var idToken = String(body.idToken || body.credential || '').trim();

  // 本番相当: Google IDトークンを検証して本人情報を取得
  if (idToken) {
    var verified = verifyGoogleIdToken_(idToken);
    email = verified.email;
    googleId = verified.googleId;
    name = verified.name || name;
    picture = verified.picture || picture;
  }

  if (!email) {
    throw new Error('email が必要です（GASを最新Code.gsで再デプロイし、idTokenまたはemailを送ってください）');
  }

  // 会員シート更新の前に拒否・メンテ判定
  assertNotDeniedEmail_(email);
  assertMaintenanceAccess_(email);

  const sheet = getSheet_(SHEET.USERS);
  var headers = getSheetHeaders_(sheet);
  ensureHeaderOnSheet_(sheet, headers, 'ニックネーム');
  ensureHeaderOnSheet_(sheet, headers, '本名');

  var rowNumber = findUserRowNumber_(sheet, headers, '', email, googleId);
  const now = formatDateTime_(new Date());
  var appKind = String((body && body.app) || '').trim().toLowerCase();
  var mintukuRegion = resolveMintukuRegionId_((body && (body.region || body.r)) || '');

  if (rowNumber >= 2) {
    var ctx = loadUserRowCtx_(sheet, headers, rowNumber);
    assertApomyLoginAllowed_(ctx.row, appKind);
    assertMintukuLoginAllowed_(ctx.row, appKind);
    assertPresidentLoginAllowed_(ctx.row, appKind);
    setCtxValue_(ctx, '最終ログイン日時', now);
    if (googleId) setCtxValue_(ctx, 'GoogleID', googleId);
    if (picture) {
      var currentAvatar = String(ctx.row['プロフィール画像URL'] || '');
      if (!currentAvatar) setCtxValue_(ctx, 'プロフィール画像URL', picture);
    }
    if (appKind === 'mintuku' && mintukuRegion) {
      var myLoc = String(ctx.row['現在地'] || '').trim();
      if (!myLoc || isPrefInMintukuRegion_(myLoc, mintukuRegion)) {
        ensureMintukuNumberCtx_(ctx, mintukuRegion);
        ensureMintukuFirstLoginCtx_(ctx);
      }
    }
    if (appKind === 'president' || appKind === 'presidentmate') {
      if (!toBool_(ctx.row['社長マーク'])) {
        throw new Error('PRESIDENT_DENIED:Apomyにて社長マークの承認をお願いします');
      }
      ensurePresidentNumberCtx_(ctx);
    }
    syncMintukuNumberToLocationCtx_(ctx);
    flushUserCtx_(ctx);

    const user = mapUser_(ctx.row);
    user.isNew = false;
    user.lastLoginAt = now;
    if (appKind === 'mintuku') {
      attachMintukuAccess_(user, ctx.row);
    }
    return user;
  }

  // 新規会員（最終行へ append。全件読込しない）
  // [プレジデント] 未登録者は社長マークがないので入室不可（Apomyで登録・承認が先）
  if (appKind === 'president' || appKind === 'presidentmate') {
    throw new Error('PRESIDENT_DENIED:Apomyにて社長マークの承認をお願いします');
  }

  const memberNo = nextMemberNoFromSheet_(sheet, headers);
  const newRow = buildEmptyRow_(headers);
  setRowValue_(newRow, headers, '会員番号', memberNo);
  setRowValue_(newRow, headers, 'Googleメール', email);
  setRowValue_(newRow, headers, 'GoogleID', googleId);
  setRowValue_(newRow, headers, 'ニックネーム', '');
  setRowValue_(newRow, headers, '本名', '');
  if (headers.indexOf('名前') >= 0) {
    setRowValue_(newRow, headers, '名前', '');
  }
  setRowValue_(newRow, headers, '性別', '');
  setRowValue_(newRow, headers, '年代', '30代');
  setRowValue_(newRow, headers, '業種', '');
  setRowValue_(newRow, headers, '職種', '');
  setRowValue_(newRow, headers, '現在地', '');
  setRowValue_(newRow, headers, '出身地', '');
  setRowValue_(newRow, headers, '自己紹介', '');
  setRowValue_(newRow, headers, 'こんな人と繋がりたい', '');
  setRowValue_(newRow, headers, 'こんな人とは繋がりたくない', '');
  setRowValue_(newRow, headers, '女性限定', false);
  setRowValue_(newRow, headers, '年間経費', '');
  setRowValue_(newRow, headers, '社名', '');
  setRowValue_(newRow, headers, 'タグ', '');
  setRowValue_(newRow, headers, 'プロフィール画像URL', picture || '');
  setRowValue_(newRow, headers, '掲載中', false);
  setRowValue_(newRow, headers, '社長マーク', false);
  setRowValue_(newRow, headers, '社長マーク状態', 'なし');
  setRowValue_(newRow, headers, 'サロン掲載', false);
  setRowValue_(newRow, headers, 'サロン掲載状態', 'なし');
  setRowValue_(newRow, headers, '登録日時', now);
  setRowValue_(newRow, headers, '更新日時', now);
  setRowValue_(newRow, headers, '最終ログイン日時', now);

  sheet.appendRow(newRow);
  const created = mapUser_(rowToObject_(headers, newRow));
  created.isNew = true;
  return created;
}

/**
 * Google IDトークン検証（簡易本番）
 * https://oauth2.googleapis.com/tokeninfo
 */
function verifyGoogleIdToken_(idToken) {
  const res = UrlFetchApp.fetch(
    'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
    { muteHttpExceptions: true }
  );
  const code = res.getResponseCode();
  const data = JSON.parse(res.getContentText());

  if (code !== 200 || data.error || data.error_description) {
    throw new Error('Google認証に失敗しました: ' + (data.error_description || data.error || code));
  }

  const clientId = getSettingValue_('GoogleクライアントID');
  if (clientId && data.aud !== clientId) {
    throw new Error('クライアントIDが一致しません');
  }

  if (String(data.email_verified) === 'false') {
    throw new Error('メール未確認のGoogleアカウントです');
  }

  if (!data.email) {
    throw new Error('メールアドレスを取得できませんでした');
  }

  return {
    email: String(data.email),
    googleId: String(data.sub || ''),
    name: String(data.name || ''),
    picture: String(data.picture || '')
  };
}

function getSettingValue_(key) {
  try {
    const settings = getSettings_();
    return String(settings[key] || '').trim();
  } catch (e) {
    return '';
  }
}

function updateProfile_(body) {
  const parsed = body || {};
  const memberNo = String(parsed.memberNo || parsed.member_no || '').trim();
  const email = String(parsed.email || '').trim();
  if (!memberNo && !email) throw new Error('memberNo または email が必要です');

  // 初回登録など: publish=true なら保存＋掲載＋みんつく採番を同一リクエストで完結
  const wantPublish = toBool_(parsed.publish || parsed.resumeListing || parsed.shouldPublish);

  const ctx = openUserCtx_(memberNo, email);
  ensureHeaderInCtx_(ctx, '女性限定');
  ensureHeaderInCtx_(ctx, '年間経費');
  ensureHeaderInCtx_(ctx, '社名');
  ensureHeaderInCtx_(ctx, 'ニックネーム');
  ensureHeaderInCtx_(ctx, '本名');

  const nicknameCol = nicknameHeader_(ctx.headers);
  const allowed = [
    nicknameCol, '本名', '性別', '年代', '業種', '職種', '現在地', '出身地',
    '自己紹介', 'こんな人と繋がりたい', 'こんな人とは繋がりたくない',
    'タグ', 'プロフィール画像URL', 'LINE', 'Instagram', 'X', 'YouTube', '年間経費', '社名'
  ];

  const map = {
    nickname: nicknameCol,
    name: nicknameCol,
    realName: '本名',
    gender: '性別',
    ageGroup: '年代',
    industry: '業種',
    jobTitle: '職種',
    location: '現在地',
    hometown: '出身地',
    bio: '自己紹介',
    wantMeet: 'こんな人と繋がりたい',
    avoidMeet: 'こんな人とは繋がりたくない',
    tags: 'タグ',
    avatarUrl: 'プロフィール画像URL',
    annualSpend: '年間経費',
    companyName: '社名'
  };

  const profile = parsed.profile || parsed;

  // 必須チェック（画面と同じ。年代も必須）
  var ageIn = String(profile.ageGroup || '').trim();
  if (!ageIn || ageIn === 'all' || ageIn === 'すべて') {
    throw new Error('年代を選択してください');
  }

  const isPresident = toBool_(ctx.row['社長マーク']);
  Object.keys(map).forEach(function (key) {
    if (profile[key] === undefined || profile[key] === null) return;
    if (key === 'companyName' && !isPresident) return;
    if ((key === 'name' || key === 'nickname' || key === 'realName' || key === 'gender') &&
        String(profile[key]).trim() === '') {
      return;
    }
    if (key === 'realName') {
      var existingReal = realNameFromRow_(ctx.row);
      if (existingReal) return;
    }
    if (key === 'gender') {
      var existingGender = String(ctx.row['性別'] || '').trim();
      if (existingGender && toBool_(ctx.row['掲載中'])) return;
    }
    var value = profile[key];
    if (key === 'location') {
      var oldLoc = String(ctx.row['現在地'] || '').trim();
      var newLoc = String(value || '').trim();
      if (!newLoc) return;
      if (oldLoc && newLoc !== oldLoc) {
        throw new Error('現在地を変更する際はオーナーへ連絡してください。');
      }
      if (!oldLoc) {
        setCtxValue_(ctx, '現在地', newLoc);
      }
      return;
    }
    if (key === 'tags') {
      value = normalizeTagsForSave_(profile[key]);
    }
    if (key === 'bio' || key === 'wantMeet' || key === 'avoidMeet') {
      value = String(value || '').replace(/[\r\n\u2028\u2029]+/g, '').trim();
      var maxLen = key === 'bio' ? 150 : 50;
      if (value.length > maxLen) {
        var label =
          key === 'bio' ? '自己紹介' :
          key === 'wantMeet' ? 'こんな人と繋がりたい' : 'こんな人とは繋がりたくない';
        throw new Error(label + 'は' + maxLen + '文字以内で入力してください');
      }
    }
    setCtxValue_(ctx, map[key], value);
  });

  var sheetGender = String(ctx.row['性別'] || '').trim();
  var incomingGender = String(profile.gender || '').trim();
  var genderNow = sheetGender || incomingGender;
  var femaleOnly = false;
  if (genderNow === '女性') {
    if (profile.femaleOnlyConnect !== undefined && profile.femaleOnlyConnect !== null) {
      femaleOnly = toBool_(profile.femaleOnlyConnect);
    } else {
      femaleOnly = toBool_(ctx.row['女性限定']);
    }
  }
  setCtxValue_(ctx, '女性限定', femaleOnly ? 'TRUE' : 'FALSE');

  if (profile.snsLinks || profile.sns) {
    var links = [];
    if (Array.isArray(profile.snsLinks)) {
      links = profile.snsLinks;
    } else if (profile.sns && typeof profile.sns === 'object') {
      if (profile.sns.line) links.push(String(profile.sns.line));
      ['instagram', 'facebook', 'x', 'youtube', 'home', 'litlink', 'canva', 'ameblo'].forEach(function (k) {
        if (profile.sns[k]) links.push(String(profile.sns[k]));
      });
    }
    links = links.map(function (u) { return String(u || '').trim(); }).filter(Boolean).slice(0, 4);
    if (!links.length) {
      throw new Error('個人LINEのURLを設定してください。');
    }
    var first = String(links[0] || '').toLowerCase();
    if (first.indexOf('lin.ee') >= 0) {
      throw new Error('公式LINE（lin.ee）は登録できません。個人の line.me URL を入力してください');
    }
    if (first.indexOf('line.me') < 0 && first.indexOf('page.line.me') < 0) {
      throw new Error('個人LINE（line.me）のURLを先頭に登録してください');
    }
    while (links.length < 4) links.push('');
    setCtxValue_(ctx, 'SNS1', links[0] || '');
    setCtxValue_(ctx, 'SNS2', links[1] || '');
    setCtxValue_(ctx, 'SNS3', links[2] || '');
    setCtxValue_(ctx, 'SNS4', links[3] || '');
    setCtxValue_(ctx, 'LINE', links[0] || '');
  }

  allowed.forEach(function (col) {
    if (profile[col] !== undefined) {
      setCtxValue_(ctx, col, profile[col]);
    }
  });

  const now = formatDateTime_(new Date());
  setCtxValue_(ctx, '更新日時', now);
  setCtxValue_(ctx, '最終ログイン日時', now);

  var mintukuNumber = String(ctx.row['みんつく番号'] || '').trim();
  var wasPublished = toBool_(ctx.row['掲載中']);
  if (wantPublish) {
    setCtxValue_(ctx, '掲載中', sheetBool_(true));
    mintukuNumber = ensureMintukuOnApomyPublishCtx_(ctx) || mintukuNumber;
  } else if (wasPublished) {
    mintukuNumber = ensureMintukuOnApomyPublishCtx_(ctx) || mintukuNumber;
  }

  flushUserCtx_(ctx);

  if (wantPublish) {
    try {
      createRequest_(
        String(ctx.row['会員番号'] || memberNo),
        wasPublished ? '掲載再開' : '掲載開始',
        '対応済',
        String(parsed.note || 'プロフィール保存と同時掲載')
      );
    } catch (err) {
      Logger.log('createRequest_ failed (updateProfile publish): ' + err);
    }
  }

  // 全件再読込はしない。メモリ上の行を返す
  const user = mapUser_(ctx.row);
  user.lastLoginAt = now;
  if (wantPublish) {
    user.isPublished = true;
    user.isNew = false;
    user.mintukuListed = toBool_(ctx.row['みんつく掲載']);
    user.mintukuNumber = mintukuNumber || String(ctx.row['みんつく番号'] || '').trim();
  }
  return user;
}

function parseUpdatePayload_(p) {
  const data = String((p && p.data) || '').trim();
  if (!data) return p || {};
  try {
    const json = Utilities.newBlob(Utilities.base64Decode(data)).getDataAsString('UTF-8');
    return JSON.parse(json);
  } catch (err) {
    throw new Error('プロフィールデータの解析に失敗しました');
  }
}

function uploadAvatar_(body) {
  const memberNo = String(body.memberNo || body.member_no || '').trim();
  const email = String(body.email || '').trim();
  const imageBase64 = String(body.imageBase64 || '').trim();
  const mimeType = String(body.mimeType || 'image/jpeg').trim();

  if (!memberNo && !email) throw new Error('memberNo または email が必要です');
  if (!imageBase64) throw new Error('画像データがありません');

  // 送信データが大きすぎる場合は拒否（容量・実行時間対策）
  if (imageBase64.length > 120000) {
    throw new Error('画像が大きすぎます。別の画像を選んでください');
  }

  const ctx = openUserCtx_(memberNo, email);
  const no = String(ctx.row['会員番号'] || memberNo || 'user');
  const oldUrl = String(ctx.row['プロフィール画像URL'] || '');

  const folder = getOrCreateAvatarFolder_();

  // この会員の古いアバターを削除（URL一致 + ファイル名プレフィックス）
  deleteOldAvatars_(folder, no, oldUrl);

  const fileName = 'avatar_' + no + '.jpg'; // 固定名（上書きしやすく容量も把握しやすい）
  const blob = Utilities.newBlob(
    Utilities.base64Decode(imageBase64),
    mimeType,
    fileName
  );
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  // imgタグ埋め込み向け（uc?export=view は表示できないことが多い）
  const avatarUrl = driveAvatarDisplayUrl_(file.getId());

  const now = formatDateTime_(new Date());
  setCtxValue_(ctx, 'プロフィール画像URL', avatarUrl);
  setCtxValue_(ctx, '更新日時', now);
  setCtxValue_(ctx, '最終ログイン日時', now);
  flushUserCtx_(ctx);

  return {
    avatarUrl: avatarUrl,
    memberNo: no,
    lastLoginAt: now
  };
}

function driveAvatarDisplayUrl_(fileId) {
  return 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w400';
}

function getOrCreateAvatarFolder_() {
  const props = PropertiesService.getScriptProperties();
  const savedId = getConfiguredFolderId_('AVATAR_FOLDER_ID', AVATAR_FOLDER_ID);
  if (savedId) {
    try {
      return DriveApp.getFolderById(savedId);
    } catch (e) {
      // 削除済みなど → 作り直す
    }
  }

  const name = 'apomi-avatars';
  const folders = DriveApp.getFoldersByName(name);
  if (folders.hasNext()) {
    const folder = folders.next();
    props.setProperty('AVATAR_FOLDER_ID', folder.getId());
    return folder;
  }

  const created = DriveApp.createFolder(name);
  props.setProperty('AVATAR_FOLDER_ID', created.getId());
  return created;
}

/** 会員の旧アバターを削除して容量を節約 */
function deleteOldAvatars_(folder, memberNo, oldUrl) {
  const oldId = extractDriveFileId_(oldUrl);
  if (oldId) {
    try {
      DriveApp.getFileById(oldId).setTrashed(true);
    } catch (e) {
      // 既に削除済みなど
    }
  }

  // avatar_{会員番号}.jpg / avatar_{会員番号}_*.jpg を掃除
  const prefix = 'avatar_' + memberNo;
  const files = folder.getFiles();
  while (files.hasNext()) {
    const f = files.next();
    const name = f.getName() || '';
    if (name === prefix + '.jpg' || name.indexOf(prefix + '_') === 0) {
      try {
        f.setTrashed(true);
      } catch (e2) {
        // ignore
      }
    }
  }
}

function extractDriveFileId_(url) {
  const s = String(url || '');
  if (!s) return '';
  var m = s.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  m = s.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  m = s.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  return '';
}

/**
 * 社長マーク / サロン掲載の申請
 * typeLabel: '社長マーク' | 'サロン掲載'
 * body: companyName, corporateNumber, evidenceUrl, imageBase64, mimeType, note
 */
function requestListing_(body, typeLabel) {
  const memberNo = String(body.memberNo || body.member_no || '').trim();
  const email = String(body.email || '').trim();
  if (!memberNo && !email) throw new Error('memberNo または email が必要です');

  const meta = listingMeta_(typeLabel);
  const userSheet = getSheet_(SHEET.USERS);
  const table = readTable_(userSheet);
  const idx = findUserIndex_(table.rows, memberNo, email);
  if (idx < 0) throw new Error('会員が見つかりません');

  const user = table.rows[idx];
  const no = String(user['会員番号'] || memberNo);
  const rowNumber = idx + 2;
  const currentStatus = String(user[meta.statusCol] || 'なし').trim();
  if (toBool_(user[meta.flagCol])) {
    throw new Error('すでに' + typeLabel + 'が許可されています');
  }
  if (currentStatus === '申請中') {
    throw new Error(typeLabel + 'はすでに申請中です。オーナーの確認をお待ちください');
  }

  const companyName = String(body.companyName || body.company_name || '').trim();
  const corporateNumber = String(body.corporateNumber || body.corporate_number || '').replace(/\D/g, '');
  const evidenceUrl = String(body.evidenceUrl || body.corporateUrl || body.url || '').trim();
  const imageBase64 = String(body.imageBase64 || '').trim();
  const mimeType = String(body.mimeType || 'image/jpeg').trim();
  const note = String(body.note || '').trim();

  var evidenceImageUrl = '';
  if (typeLabel === 'サロン掲載') {
    if (!imageBase64) throw new Error('公式LINE加入が分かる画像をアップロードしてください');
  } else {
    if (!companyName) throw new Error('社名（正式名称）を入力してください');
    if (!/^\d{13}$/.test(corporateNumber)) throw new Error('法人番号は13桁の数字で入力してください');
    if (!evidenceUrl && !imageBase64) {
      throw new Error('コーポレートサイトURLか名刺画像のどちらかを入力してください');
    }
    if (evidenceUrl && !/^https?:\/\//i.test(evidenceUrl)) {
      throw new Error('コーポレートサイトURLは https:// から入力してください');
    }
  }

  if (imageBase64) {
    if (imageBase64.length > 120000) {
      throw new Error('画像が大きすぎます。別の画像を選んでください');
    }
    evidenceImageUrl = saveApplicationImage_(no, typeLabel, imageBase64, mimeType);
  }

  const now = formatDateTime_(new Date());
  setCellByHeader_(userSheet, table.headers, rowNumber, meta.statusCol, '申請中');
  setCellByHeader_(userSheet, table.headers, rowNumber, '更新日時', now);
  setCellByHeader_(userSheet, table.headers, rowNumber, '最終ログイン日時', now);
  // 社長マーク申請時は会員シートの社名も更新
  if (typeLabel === '社長マーク' && companyName) {
    ensureHeader_(userSheet, table.headers, '社名');
    setCellByHeader_(userSheet, table.headers, rowNumber, '社名', companyName);
  }

  const requestId = createRequest_({
    memberNo: no,
    type: typeLabel,
    status: '申請中',
    companyName: typeLabel === '社長マーク' ? companyName : '',
    corporateNumber: typeLabel === '社長マーク' ? corporateNumber : '',
    evidenceUrl: typeLabel === '社長マーク' ? evidenceUrl : '',
    evidenceImageUrl: evidenceImageUrl,
    note: note
  });

  const out = {
    requestId: requestId,
    memberNo: no,
    lastLoginAt: now
  };
  out[meta.statusKey] = '申請中';
  return out;
}

function saveApplicationImage_(memberNo, typeLabel, imageBase64, mimeType) {
  const folder = getOrCreateApplicationFolder_();
  const safeType = typeLabel === 'サロン掲載' ? 'salon' : 'president';
  const stamp = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMddHHmmss');
  const fileName = 'apply_' + safeType + '_' + memberNo + '_' + stamp + '.jpg';
  const blob = Utilities.newBlob(
    Utilities.base64Decode(imageBase64),
    mimeType || 'image/jpeg',
    fileName
  );
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return 'https://drive.google.com/file/d/' + file.getId() + '/view';
}

function getOrCreateApplicationFolder_() {
  const props = PropertiesService.getScriptProperties();
  const savedId = getConfiguredFolderId_('APPLICATION_FOLDER_ID', APPLICATION_FOLDER_ID);
  if (savedId) {
    try {
      return DriveApp.getFolderById(savedId);
    } catch (e) {
      // recreate
    }
  }
  const name = 'apomy-applications';
  const folders = DriveApp.getFoldersByName(name);
  if (folders.hasNext()) {
    const folder = folders.next();
    props.setProperty('APPLICATION_FOLDER_ID', folder.getId());
    return folder;
  }
  const created = DriveApp.createFolder(name);
  props.setProperty('APPLICATION_FOLDER_ID', created.getId());
  return created;
}

function listingMeta_(typeLabel) {
  if (typeLabel === 'サロン掲載') {
    return {
      flagCol: 'サロン掲載',
      statusCol: 'サロン掲載状態',
      statusKey: 'salonListingStatus',
      flagKey: 'salonListing'
    };
  }
  return {
    flagCol: '社長マーク',
    statusCol: '社長マーク状態',
    statusKey: 'presidentMarkStatus',
    flagKey: 'presidentMark'
  };
}

function getOwnerEmail_() {
  try {
    const settings = getSettings_();
    return String(settings['オーナーメール'] || '').trim();
  } catch (e) {
    return '';
  }
}

function getApprovalToken_() {
  const props = PropertiesService.getScriptProperties();
  var token = String(props.getProperty('APPROVAL_TOKEN') || '').trim();
  if (token) return token;
  try {
    const settings = getSettings_();
    token = String(settings['承認トークン'] || '').trim();
  } catch (e) {
    token = '';
  }
  if (!token) {
    token = Utilities.getUuid().replace(/-/g, '');
  }
  props.setProperty('APPROVAL_TOKEN', token);
  return token;
}

function getWebAppUrl_() {
  try {
    return String(ScriptApp.getService().getUrl() || '').trim();
  } catch (e) {
    return '';
  }
}

function notifyOwnerOfRequest_(info) {
  // メール通知・承認リンクは廃止。オーナーは「申請」シートを手作業で確認する。
  return;
}

/**
 * メール内リンクからの承認 / 却下
 */
function processOwnerDecision_(p, decision) {
  const requestId = String((p && p.requestId) || '').trim();
  const token = String((p && p.token) || '').trim();
  if (!requestId) throw new Error('requestId がありません');
  if (!token || token !== getApprovalToken_()) throw new Error('認証トークンが無効です');

  const reqSheet = getSheet_(SHEET.REQUESTS);
  const reqTable = readTable_(reqSheet);
  const reqIdx = reqTable.rows.findIndex(function (r) {
    return String(r['申請ID'] || '') === requestId;
  });
  if (reqIdx < 0) throw new Error('申請が見つかりません');

  const req = reqTable.rows[reqIdx];
  const status = String(req['状態'] || '').trim();
  if (status === '承認' || status === '却下' || status === '対応済') {
    return {
      ok: true,
      already: true,
      message: 'この申請はすでに処理済みです（状態: ' + status + '）'
    };
  }

  const typeLabel = String(req['種別'] || '').trim();
  const memberNo = String(req['会員番号'] || '').trim();
  if (typeLabel !== '社長マーク' && typeLabel !== 'サロン掲載') {
    throw new Error('この種別はメール承認に対応していません: ' + typeLabel);
  }

  const meta = listingMeta_(typeLabel);
  const userSheet = getSheet_(SHEET.USERS);
  const userTable = readTable_(userSheet);
  const userIdx = findUserIndex_(userTable.rows, memberNo, '');
  if (userIdx < 0) throw new Error('会員が見つかりません: ' + memberNo);

  const now = formatDateTime_(new Date());
  const userRow = userIdx + 2;
  const reqRow = reqIdx + 2;

  if (decision === '承認') {
    setCellByHeader_(userSheet, userTable.headers, userRow, meta.flagCol, true);
    setCellByHeader_(userSheet, userTable.headers, userRow, meta.statusCol, '承認');
    // サロン掲載承認時は通常掲載もオン（両方に載せる前提）
    if (typeLabel === 'サロン掲載') {
      setCellByHeader_(userSheet, userTable.headers, userRow, '掲載中', true);
      userTable.rows[userIdx]['掲載中'] = 'TRUE';
      ensureMintukuOnApomyPublish_(userSheet, userTable, userIdx);
    }
    // 社長マーク承認時は申請の社名を会員へ反映（未設定時・更新）
    if (typeLabel === '社長マーク') {
      var approvedCompany = String(req['社名'] || '').trim();
      if (approvedCompany) {
        ensureHeader_(userSheet, userTable.headers, '社名');
        setCellByHeader_(userSheet, userTable.headers, userRow, '社名', approvedCompany);
      }
    }
  } else {
    setCellByHeader_(userSheet, userTable.headers, userRow, meta.flagCol, false);
    setCellByHeader_(userSheet, userTable.headers, userRow, meta.statusCol, '却下');
  }
  setCellByHeader_(userSheet, userTable.headers, userRow, '更新日時', now);

  setCellByHeader_(reqSheet, reqTable.headers, reqRow, '状態', decision);
  setCellByHeader_(reqSheet, reqTable.headers, reqRow, '対応日時', now);
  setCellByHeader_(reqSheet, reqTable.headers, reqRow, '備考',
    String(req['備考'] || '') + (String(req['備考'] || '') ? ' / ' : '') + 'メールリンクで' + decision
  );

  var message = decision === '承認'
    ? (typeLabel + 'を承認しました。apomy に反映されます。')
    : (typeLabel + 'を却下しました。');
  if (decision === '承認' && typeLabel === 'サロン掲載') {
    message += ' 井口オンラインサロン側への会員追加もお願いします。';
  }
  return { ok: true, message: message, decision: decision, typeLabel: typeLabel, memberNo: memberNo };
}

function htmlDecision_(result) {
  const ok = result && result.ok;
  const msg = String((result && result.message) || (ok ? '完了しました' : 'エラー'));
  const color = ok ? '#166534' : '#b91c1c';
  const html = [
    '<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>apomy 申請処理</title></head><body style="font-family:sans-serif;padding:32px;line-height:1.6">',
    '<h1 style="color:' + color + ';font-size:1.25rem">apomy</h1>',
    '<p>' + msg.replace(/</g, '&lt;') + '</p>',
    '<p style="color:#64748b;font-size:0.9rem">このタブは閉じて大丈夫です。</p>',
    '</body></html>'
  ].join('');
  return HtmlService.createHtmlOutput(html);
}

/**
 * [みんつく] Apomy掲載開始時: みんつく掲載ON＋現在地があれば番号採番
 * ※みんつく掲載を明示停止している場合は尊重してONに戻さない
 */
function ensureMintukuOnApomyPublishCtx_(ctx) {
  if (!ctx) return '';
  ensureHeaderInCtx_(ctx, 'みんつく掲載');
  ensureHeaderInCtx_(ctx, 'みんつく番号');

  var listedRaw = ctx.row['みんつく掲載'];
  var listedSet = !(listedRaw === '' || listedRaw === null || listedRaw === undefined);
  if (!listedSet) {
    setCtxValue_(ctx, 'みんつく掲載', sheetBool_(true));
  } else if (toBool_(listedRaw)) {
    // すでに TRUE
  } else {
    // FALSE（みんつく停止中）→ 触らない
    return String(ctx.row['みんつく番号'] || '').trim();
  }

  var loc = String(ctx.row['現在地'] || '').trim();
  var regionId = prefectureToMintukuRegionId_(loc);
  if (!regionId) return String(ctx.row['みんつく番号'] || '').trim();
  return ensureMintukuNumberCtx_(ctx, regionId);
}

function ensureMintukuOnApomyPublish_(sheet, table, idx) {
  if (idx < 0) return '';
  var ctx = userCtxFromTable_(sheet, table, idx);
  var value = ensureMintukuOnApomyPublishCtx_(ctx);
  flushUserCtx_(ctx);
  return value;
}

function setPublished_(body, published, typeLabel) {
  const memberNo = String(body.memberNo || body.member_no || '').trim();
  const email = String(body.email || '').trim();
  if (!memberNo && !email) throw new Error('memberNo または email が必要です');

  const ctx = openUserCtx_(memberNo, email);
  const no = String(ctx.row['会員番号'] || memberNo);
  const now = formatDateTime_(new Date());
  const flag = sheetBool_(published);

  setCtxValue_(ctx, '掲載中', flag);
  setCtxValue_(ctx, '更新日時', now);
  setCtxValue_(ctx, '最終ログイン日時', now);

  var mintukuNumber = '';
  if (published) {
    mintukuNumber = ensureMintukuOnApomyPublishCtx_(ctx);
  }
  flushUserCtx_(ctx);
  SpreadsheetApp.flush();

  var requestId = '';
  try {
    requestId = createRequest_(no, typeLabel, '対応済', String(body.note || ''));
  } catch (err) {
    Logger.log('createRequest_ failed (published): ' + err);
  }
  return {
    requestId: requestId,
    memberNo: no,
    isPublished: !!published,
    mintukuListed: toBool_(ctx.row['みんつく掲載']),
    mintukuNumber: mintukuNumber || String(ctx.row['みんつく番号'] || '').trim(),
    lastLoginAt: now,
    publishedAt: String(ctx.row['登録日時'] || '')
  };
}

function createRequest_(memberNoOrOpts, type, status, note) {
  var opts = (memberNoOrOpts && typeof memberNoOrOpts === 'object')
    ? memberNoOrOpts
    : {
        memberNo: memberNoOrOpts,
        type: type,
        status: status,
        note: note
      };

  const sheet = getSheet_(SHEET.REQUESTS);
  const table = readTable_(sheet);
  const now = new Date();
  const requestId = 'R' + Utilities.formatDate(now, 'Asia/Tokyo', 'yyyyMMdd-HHmmss');

  // 新列が無ければ追加
  ['社名', '法人番号', '証拠URL', '証拠画像URL'].forEach(function (col) {
    ensureHeader_(sheet, table.headers, col);
  });

  const newRow = buildEmptyRow_(table.headers);
  setRowValue_(newRow, table.headers, '申請ID', requestId);
  setRowValue_(newRow, table.headers, '会員番号', String(opts.memberNo || ''));
  setRowValue_(newRow, table.headers, '種別', String(opts.type || ''));
  setRowValue_(newRow, table.headers, '状態', String(opts.status || '申請中'));
  setRowValue_(newRow, table.headers, '社名', String(opts.companyName || ''));
  setRowValue_(newRow, table.headers, '法人番号', String(opts.corporateNumber || ''));
  setRowValue_(newRow, table.headers, '証拠URL', String(opts.evidenceUrl || ''));
  setRowValue_(newRow, table.headers, '証拠画像URL', String(opts.evidenceImageUrl || ''));
  setRowValue_(newRow, table.headers, '備考', String(opts.note || ''));
  setRowValue_(newRow, table.headers, '申請日時', formatDateTime_(now));
  if (String(opts.status || '') === '対応済' || String(opts.status || '') === '承認' || String(opts.status || '') === '却下') {
    setRowValue_(newRow, table.headers, '対応日時', formatDateTime_(now));
  }
  sheet.appendRow(newRow);
  return requestId;
}

/* ========== Mapping ========== */

function normalizeTagsForSave_(raw) {
  var list = [];
  if (Array.isArray(raw)) {
    raw.forEach(function (t) {
      String(t || '').split(/[,、|／\t]+/).forEach(function (part) {
        list.push(part);
      });
    });
  } else {
    list = String(raw || '').split(/[,、|／\t]+/);
  }
  var allowList = null;
  try {
    var tagItems = (getMasters_()['タグ'] || []);
    if (tagItems.length) {
      allowList = {};
      tagItems.forEach(function (item) {
        if (item && item.value) allowList[String(item.value).trim()] = true;
      });
    }
  } catch (err) {
    allowList = null;
  }
  var seen = {};
  var out = [];
  list.forEach(function (t) {
    var v = String(t || '').trim();
    if (!v || seen[v]) return;
    if (allowList && !allowList[v]) return;
    seen[v] = true;
    out.push(v);
  });
  // 読点区切り（カンマだと Sheets で崩れることがある）
  return out.slice(0, 6).join('、');
}

function mapUser_(r) {
  const tagsRaw = String(r['タグ'] || '').trim();
  const tags = tagsRaw
    ? tagsRaw.split(/[,、|／\t]+/).map(function (t) { return t.trim(); }).filter(Boolean)
    : [];
  const nickname = nicknameFromRow_(r);
  const realName = realNameFromRow_(r);

  return {
    id: String(r['会員番号'] || ''),
    email: String(r['Googleメール'] || ''),
    name: nickname, // 公開表示名（ニックネーム）
    nickname: nickname,
    realName: realName, // 自分用のみ。一覧 API では削除する
    gender: String(r['性別'] || ''),
    ageGroup: String(r['年代'] || ''),
    industry: String(r['業種'] || ''),
    jobTitle: String(r['職種'] || ''),
    location: String(r['現在地'] || ''),
    hometown: String(r['出身地'] || ''),
    bio: String(r['自己紹介'] || ''),
    wantMeet: String(r['こんな人と繋がりたい'] || ''),
    avoidMeet: String(r['こんな人とは繋がりたくない'] || ''),
    femaleOnlyConnect: toBool_(r['女性限定']),
    annualSpend: String(r['年間経費'] || ''),
    companyName: String(r['社名'] || ''),
    tags: tags,
    avatarUrl: String(r['プロフィール画像URL'] || ''),
    lastLoginAt: String(r['最終ログイン日時'] || ''),
    createdAt: String(r['登録日時'] || ''),
    // 最新一覧は登録日時で判定（掲載日カラムは使わない）
    publishedAt: String(r['登録日時'] || ''),
    isPublished: toBool_(r['掲載中']),
    // [みんつく] 列が無い環境では undefined 相当（false）
    mintukuListed: Object.prototype.hasOwnProperty.call(r, 'みんつく掲載')
      ? toBool_(r['みんつく掲載'])
      : false,
    // [みんつく] 例: 関東1（画面では No.00001 に変換）
    mintukuNumber: String(r['みんつく番号'] == null ? '' : r['みんつく番号']).trim(),
    mintukuFirstLoginAt: sheetDateToYmd_(r['みんつく初回ログイン日']),
    mintukuPaid: isMintukuPaid_(r),
    mintukuPaidStartAt: getMintukuPaidStartRaw_(r),
    mintukuPaidDaysUsed: getMintukuPaidStartRaw_(r)
      ? mintukuDaysSinceFirst_(getMintukuPaidStartRaw_(r))
      : 0,
    // [プレジデント] 空欄掲載扱いのため FE は isPresidentMateListed 相当で判定可
    presidentMateListed: isPresidentMateListed_(r),
    presidentNumber: String(r['プレジデント番号'] || '').trim(),
    presidentMark: toBool_(r['社長マーク']),
    presidentMarkStatus: String(r['社長マーク状態'] || 'なし'),
    salonListing: toBool_(r['サロン掲載']),
    salonListingStatus: String(r['サロン掲載状態'] || 'なし'),
    snsLinks: extractSnsLinks_(r)
  };
}

/**
 * 日時セルを JSON 安全な文字列へ（Date の String() = Thu Aug 13... を避ける）
 */
function sheetDateTimeToStr_(v) {
  if (v === null || v === undefined || v === '') return '';
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime())) {
    return Utilities.formatDate(v, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');
  }
  return String(v).trim();
}

/**
 * [共通] 一覧用の軽い会員マップ
 * - 現在地ロック計算・非公開項目・課金判定を省略して高速化
 * - Date オブジェクトを残さない（巨大JSON化失敗・HTMLエラー化を防ぐ）
 */
function mapUserListItem_(r) {
  const tagsRaw = String(r['タグ'] || '').trim();
  const tags = tagsRaw
    ? tagsRaw.split(/[,、|／\t]+/).map(function (t) { return t.trim(); }).filter(Boolean)
    : [];
  const nickname = nicknameFromRow_(r);
  var bio = String(r['自己紹介'] || '');
  var wantMeet = String(r['こんな人と繋がりたい'] || '');
  var avoidMeet = String(r['こんな人とは繋がりたくない'] || '');
  // 一覧レスポンス肥大化対策（カード表示に十分な長さ）
  if (bio.length > 200) bio = bio.slice(0, 200);
  if (wantMeet.length > 80) wantMeet = wantMeet.slice(0, 80);
  if (avoidMeet.length > 80) avoidMeet = avoidMeet.slice(0, 80);

  return {
    id: String(r['会員番号'] || ''),
    email: String(r['Googleメール'] || ''),
    name: nickname,
    nickname: nickname,
    gender: String(r['性別'] || ''),
    ageGroup: String(r['年代'] || ''),
    industry: String(r['業種'] || ''),
    jobTitle: String(r['職種'] || ''),
    location: String(r['現在地'] || ''),
    hometown: String(r['出身地'] || ''),
    bio: bio,
    wantMeet: wantMeet,
    avoidMeet: avoidMeet,
    femaleOnlyConnect: toBool_(r['女性限定']),
    companyName: String(r['社名'] || ''),
    tags: tags,
    avatarUrl: String(r['プロフィール画像URL'] || ''),
    lastLoginAt: sheetDateTimeToStr_(r['最終ログイン日時']),
    createdAt: sheetDateTimeToStr_(r['登録日時']),
    publishedAt: sheetDateTimeToStr_(r['登録日時']),
    isPublished: toBool_(r['掲載中']),
    mintukuListed: Object.prototype.hasOwnProperty.call(r, 'みんつく掲載')
      ? toBool_(r['みんつく掲載'])
      : false,
    mintukuNumber: String(r['みんつく番号'] == null ? '' : r['みんつく番号']).trim(),
    presidentMateListed: isPresidentMateListed_(r),
    presidentNumber: String(r['プレジデント番号'] || '').trim(),
    presidentMark: toBool_(r['社長マーク']),
    presidentMarkStatus: String(r['社長マーク状態'] || 'なし'),
    salonListing: toBool_(r['サロン掲載']),
    salonListingStatus: String(r['サロン掲載状態'] || 'なし'),
    snsLinks: extractSnsLinks_(r)
  };
}

/** 公開名列: ニックネーム優先、旧「名前」互換 */
function nicknameHeader_(headers) {
  var list = headers || [];
  if (list.indexOf('ニックネーム') >= 0) return 'ニックネーム';
  if (list.indexOf('名前') >= 0) return '名前';
  return 'ニックネーム';
}

function nicknameFromRow_(r) {
  var nick = String((r && r['ニックネーム']) || '').trim();
  if (nick) return nick;
  return String((r && r['名前']) || '').trim();
}

function realNameFromRow_(r) {
  return String((r && r['本名']) || '').trim();
}

function extractSnsLinks_(r) {
  var links = [];
  ['SNS1', 'SNS2', 'SNS3', 'SNS4'].forEach(function (col) {
    var v = String(r[col] || '').trim();
    if (v) links.push(v);
  });
  if (links.length) {
    var legacyLine = String(r['LINE'] || '').trim();
    var first = String(links[0] || '').toLowerCase();
    var firstIsLine = first.indexOf('line.me') >= 0 || first.indexOf('page.line.me') >= 0;
    if (!firstIsLine && legacyLine) {
      links = [legacyLine].concat(links.filter(function (u) {
        return String(u || '').trim() !== legacyLine;
      }));
    }
    return links.slice(0, 4);
  }

  // 旧列からの読み取り互換（LINEを先頭）
  var line = String(r['LINE'] || '').trim();
  if (line) links.push(line);
  ['Instagram', 'Facebook', 'X', 'YouTube'].forEach(function (col) {
    var v = String(r[col] || '').trim();
    if (v) links.push(v);
  });
  return links.slice(0, 4);
}

/* ========== Sheet Helpers ========== */

function getSpreadsheet_() {
  if (SPREADSHEET_ID) {
    return SpreadsheetApp.openById(SPREADSHEET_ID);
  }
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('スプレッドシートに紐付けてください（または SPREADSHEET_ID を設定）');
  return ss;
}

function getConfiguredFolderId_(propertyKey, defaultId) {
  const props = PropertiesService.getScriptProperties();
  const configured = String(props.getProperty(propertyKey) || '').trim();
  if (configured) return configured;
  const fallback = String(defaultId || '').trim();
  if (fallback) {
    props.setProperty(propertyKey, fallback);
    return fallback;
  }
  return '';
}

function getSheet_(name) {
  const sheet = getSpreadsheet_().getSheetByName(name);
  if (!sheet) throw new Error('シートが見つかりません: ' + name);
  return sheet;
}

/**
 * ===== 会員単票の高速アクセス =====
 * 一覧(getUsers)以外は全件オブジェクト化せず、列検索→1行読込→1行書込を基本とする
 */
function getSheetHeaders_(sheet) {
  var lastCol = Math.max(1, sheet.getLastColumn());
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) {
    return String(h || '').trim();
  });
  // 末尾の空ヘッダーは捨てる（書式だけ広い列で巨大 range になるのを防ぐ）
  while (headers.length > 1 && !headers[headers.length - 1]) {
    headers.pop();
  }
  return headers;
}

/** ヘッダー行に列を追加（headers配列も更新） */
function ensureHeaderOnSheet_(sheet, headers, colName) {
  if (!colName) return;
  if (headers.indexOf(colName) >= 0) return;
  var col = headers.length + 1;
  sheet.getRange(1, col).setValue(colName);
  headers.push(colName);
}

/**
 * 会員行番号を下から検索（新規ほど下にある前提で高速）
 * 優先: email → memberNo → googleId
 */
function findUserRowNumber_(sheet, headers, memberNo, email, googleIdOpt) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;

  var mail = String(email || '').trim().toLowerCase();
  var no = String(memberNo || '').trim();
  var gid = String(googleIdOpt || '').trim();
  var emailCol = headers.indexOf('Googleメール') + 1;
  var noCol = headers.indexOf('会員番号') + 1;
  var gidCol = headers.indexOf('GoogleID') + 1;

  if (mail && emailCol > 0) {
    var emails = sheet.getRange(2, emailCol, lastRow - 1, 1).getValues();
    for (var i = emails.length - 1; i >= 0; i--) {
      if (String(emails[i][0] || '').trim().toLowerCase() === mail) return i + 2;
    }
  }
  if (no && noCol > 0) {
    var nos = sheet.getRange(2, noCol, lastRow - 1, 1).getValues();
    for (var j = nos.length - 1; j >= 0; j--) {
      if (String(nos[j][0] || '').trim() === no) return j + 2;
    }
  }
  if (gid && gidCol > 0) {
    var gids = sheet.getRange(2, gidCol, lastRow - 1, 1).getValues();
    for (var k = gids.length - 1; k >= 0; k--) {
      if (String(gids[k][0] || '').trim() === gid) return k + 2;
    }
  }
  return -1;
}

function loadUserRowCtx_(sheet, headers, rowNumber) {
  var width = Math.max(1, headers.length);
  // getRange(row, column, numRows, numColumns) ※第3・第4は終端ではなく件数
  var values = sheet.getRange(rowNumber, 1, 1, width).getValues()[0];
  var row = {};
  for (var i = 0; i < headers.length; i++) {
    if (!headers[i]) continue;
    row[headers[i]] = values[i];
  }
  return {
    sheet: sheet,
    headers: headers,
    rowNumber: rowNumber,
    row: row,
    dirty: false,
    dirtyCols: {},
    fullRowFlush: true
  };
}

function openUserCtx_(memberNo, email) {
  var sheet = getSheet_(SHEET.USERS);
  var headers = getSheetHeaders_(sheet);
  var rowNumber = findUserRowNumber_(sheet, headers, memberNo, email);
  if (rowNumber < 2) throw new Error('会員が見つかりません');
  return loadUserRowCtx_(sheet, headers, rowNumber);
}

/** 既存の readTable_ 結果から ctx を作る（一覧処理との互換） */
function userCtxFromTable_(sheet, table, idx) {
  return {
    sheet: sheet,
    headers: table.headers,
    rowNumber: idx + 2,
    row: table.rows[idx],
    dirty: false,
    dirtyCols: {},
    // テーブル経路は他セルを setCell 済みのことがあるため、変更列だけ書く
    fullRowFlush: false
  };
}

function ensureHeaderInCtx_(ctx, colName) {
  if (!ctx || !colName) return;
  if (ctx.headers.indexOf(colName) >= 0) return;
  ensureHeaderOnSheet_(ctx.sheet, ctx.headers, colName);
  if (ctx.row[colName] === undefined) ctx.row[colName] = '';
  ctx.dirty = true;
  if (!ctx.dirtyCols) ctx.dirtyCols = {};
  ctx.dirtyCols[colName] = true;
}

function setCtxValue_(ctx, colName, value) {
  if (!ctx || !colName) return;
  ensureHeaderInCtx_(ctx, colName);
  ctx.row[colName] = value;
  ctx.dirty = true;
  if (!ctx.dirtyCols) ctx.dirtyCols = {};
  ctx.dirtyCols[colName] = true;
}

/**
 * 書き戻し（変更列の最小〜最大を1回の setValues で更新）
 * ※ getRange(row, column, numRows, numColumns) の第3・第4は件数
 */
function flushUserCtx_(ctx) {
  if (!ctx || !ctx.dirty) return;
  var cols = Object.keys(ctx.dirtyCols || {});
  if (!cols.length) {
    ctx.dirty = false;
    return;
  }

  var indices = [];
  for (var i = 0; i < cols.length; i++) {
    var ix = ctx.headers.indexOf(cols[i]);
    if (ix >= 0) indices.push(ix);
  }
  if (!indices.length) {
    ctx.dirty = false;
    ctx.dirtyCols = {};
    return;
  }
  indices.sort(function (a, b) { return a - b; });
  var minI = indices[0];
  var maxI = indices[indices.length - 1];
  var numCols = maxI - minI + 1;

  // 対象スライスを読んでから、変更列だけ上書きして戻す（行全体の次元ずれを避ける）
  var slice = ctx.sheet.getRange(ctx.rowNumber, minI + 1, 1, numCols).getValues()[0];
  for (var j = 0; j < cols.length; j++) {
    var colName = cols[j];
    var colIdx = ctx.headers.indexOf(colName);
    if (colIdx < minI || colIdx > maxI) continue;
    var v = ctx.row[colName];
    if (v === undefined || v === null) v = '';
    if (typeof v === 'object' && Object.prototype.toString.call(v) !== '[object Date]') {
      v = String(v);
    }
    slice[colIdx - minI] = v;
  }
  ctx.sheet.getRange(ctx.rowNumber, minI + 1, 1, numCols).setValues([slice]);
  ctx.dirty = false;
  ctx.dirtyCols = {};
}

/** 会員番号列だけ読んで次番号を決める */
function nextMemberNoFromSheet_(sheet, headers) {
  var col = headers.indexOf('会員番号') + 1;
  var lastRow = sheet.getLastRow();
  if (col < 1 || lastRow < 2) return '00001';
  var vals = sheet.getRange(2, col, lastRow - 1, 1).getValues();
  var max = 0;
  for (var i = 0; i < vals.length; i++) {
    var n = parseInt(String(vals[i][0] || '').replace(/\D/g, ''), 10);
    if (!isNaN(n) && n > max) max = n;
  }
  return String(max + 1).padStart(5, '0');
}

function readTable_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (!values.length) return { headers: [], rows: [] };
  const headers = values[0].map(function (h) { return String(h || '').trim(); });
  const rows = [];
  for (var i = 1; i < values.length; i++) {
    const obj = rowToObject_(headers, values[i]);
    // 会員番号 or バナーID が空の行はスキップ
    const key = obj['会員番号'] || obj['バナーID'] || obj['申請ID'] || obj['区分'] || obj['キー'];
    if (key === '' || key === null || key === undefined) continue;
    rows.push(obj);
  }
  return { headers: headers, rows: rows };
}

function readObjects_(sheetName) {
  return readTable_(getSheet_(sheetName)).rows;
}

function rowToObject_(headers, row) {
  const obj = {};
  headers.forEach(function (h, i) {
    if (!h) return;
    obj[h] = row[i];
  });
  return obj;
}

function buildEmptyRow_(headers) {
  return headers.map(function () { return ''; });
}

function setRowValue_(row, headers, colName, value) {
  const i = headers.indexOf(colName);
  if (i >= 0) row[i] = value;
}

function setCellByHeader_(sheet, headers, rowNumber, colName, value) {
  ensureHeader_(sheet, headers, colName);
  const i = headers.indexOf(colName);
  if (i < 0) return;
  sheet.getRange(rowNumber, i + 1).setValue(value);
}

/** ヘッダーが無ければ末尾に追加 */
function ensureHeader_(sheet, headers, colName) {
  if (headers.indexOf(colName) >= 0) return;
  const col = headers.length + 1;
  sheet.getRange(1, col).setValue(colName);
  headers.push(colName);
}

/**
 * 会員検索: メールを最優先、会員番号は補助
 * （途中挿入などで番号がずれても本人を取り違えない）
 */
function findUserIndex_(rows, memberNo, email) {
  var mail = String(email || '').trim().toLowerCase();
  if (mail) {
    var byEmail = rows.findIndex(function (r) {
      return String(r['Googleメール'] || '').toLowerCase() === mail;
    });
    if (byEmail >= 0) return byEmail;
  }
  var no = String(memberNo || '').trim();
  if (no) {
    var byNo = rows.findIndex(function (r) {
      return String(r['会員番号'] || '') === no;
    });
    if (byNo >= 0) return byNo;
  }
  return -1;
}

function nextMemberNo_(rows) {
  var max = 0;
  rows.forEach(function (r) {
    const n = parseInt(String(r['会員番号'] || '').replace(/\D/g, ''), 10);
    if (!isNaN(n) && n > max) max = n;
  });
  return String(max + 1).padStart(5, '0');
}

/* ========== Utils ========== */

function parseBody_(e) {
  if (!e) return {};
  if (e.postData && e.postData.contents) {
    const type = String((e.postData.type || '')).toLowerCase();
    if (type.indexOf('json') >= 0 || String(e.postData.contents).trim().charAt(0) === '{') {
      return JSON.parse(e.postData.contents);
    }
  }
  return (e.parameter) || {};
}

function json_(obj) {
  var text;
  try {
    text = JSON.stringify(obj);
  } catch (err) {
    text = JSON.stringify({
      success: false,
      error: '応答のJSON化に失敗しました: ' + String((err && err.message) || err)
    });
  }
  return ContentService
    .createTextOutput(text)
    .setMimeType(ContentService.MimeType.JSON);
}

/** Date などを JSON 安全な値へ（循環参照や特殊型で stringify が落ちるのを防ぐ） */
function sanitizeForJson_(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (err) {
    if (value === null || value === undefined) return null;
    if (typeof value !== 'object') return value;
    if (Object.prototype.toString.call(value) === '[object Date]') {
      return formatDateTime_(value);
    }
    if (Array.isArray(value)) {
      return value.map(function (v) { return sanitizeForJson_(v); });
    }
    var out = {};
    Object.keys(value).forEach(function (k) {
      try {
        out[k] = sanitizeForJson_(value[k]);
      } catch (e2) {
        out[k] = String(value[k]);
      }
    });
    return out;
  }
}

function toBool_(v) {
  if (v === true || v === 1) return true;
  const s = String(v || '').trim().toUpperCase();
  return s === 'TRUE' || s === '1' || s === '○' || s === 'はい';
}

function parseDate_(v) {
  if (!v) return null;
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v)) return v;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function formatDateTime_(d) {
  return Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');
}

/* ========== 手動テスト用 ========== */

/**
 * 初回だけエディタから実行して権限を許可する
 * 「実行」→ 権限を確認 → 許可
 */
function authorizeExternalRequest() {
  const res = UrlFetchApp.fetch('https://www.google.com', { muteHttpExceptions: true });
  Logger.log('外部通信OK: status=' + res.getResponseCode());
  const folder = getOrCreateAvatarFolder_();
  Logger.log('DriveフォルダOK: ' + folder.getName());
}

function testPing() {
  Logger.log(doGet({ parameter: { action: 'ping' } }).getContent());
}

/**
 * 初回だけエディタから実行して、メール送信権限を許可する。
 * 実行 → 権限を確認 → 許可。成功すると自分宛にテストメールが届く。
 */
function authorizeMail() {
  const to = Session.getActiveUser().getEmail() || getOwnerEmail_();
  if (!to) throw new Error('送信先メールがありません（ログインユーザーまたは設定のオーナーメール）');
  MailApp.sendEmail(to, '[apomy] メール送信テスト', 'メール送信権限の許可に成功しました。このメールは削除して大丈夫です。');
  Logger.log('送信しました: ' + to);
}

function testUsers() {
  Logger.log(doGet({ parameter: { action: 'users' } }).getContent());
}

function testBanners() {
  Logger.log(doGet({ parameter: { action: 'banners' } }).getContent());
}
