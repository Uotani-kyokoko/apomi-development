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
 * 【シート】アクセス拒否 … A列「メール」に拒否アドレス（1行1件）。API応答には含めない
 * 【申請】マイページからフォーム送信 → 申請シートへ保存。承認はスプシ手作業
 */

var ACCESS_DENIED_MESSAGE =
  'アクセスが拒否されました。詳細はコチラから問合せください。';


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
    let data;

    switch (action) {
      case 'users':
        data = getUsers_(p);
        break;
      case 'banners':
        data = getBanners_();
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
        data = getDashboard_();
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

    return json_({ success: true, data: data });
  } catch (err) {
    if (String((e && e.parameter && e.parameter.action) || '') === 'approveRequest' ||
        String((e && e.parameter && e.parameter.action) || '') === 'rejectRequest') {
      return htmlDecision_({ ok: false, message: String(err.message || err) });
    }
    return json_({ success: false, error: String(err.message || err) });
  }
}

function doPost(e) {
  try {
    const body = parseBody_(e);
    const action = String(body.action || '').trim();
    let data;

    switch (action) {
      case 'login':
        data = login_(body);
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
        data = setPublished_(body, false, '掲載停止');
        break;
      case 'resumeListing':
        data = setPublished_(body, true, '掲載再開');
        break;
      case 'touch':
        data = touchActivity_(body);
        break;
      default:
        return json_({ success: false, error: '不明なactionです: ' + action });
    }

    return json_({ success: true, data: data });
  } catch (err) {
    return json_({ success: false, error: String(err.message || err) });
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

function getUsers_(p) {
  const rows = readObjects_(SHEET.USERS);
  const industry = p.industry || 'all';
  const gender = String(p.gender || 'all');
  const jobTitle = p.jobTitle || p.job_title || 'all';
  const ageGroup = p.ageGroup || p.age_group || 'all';
  const includeUnpublished = String(p.includeUnpublished || '') === 'true';

  return rows
    .filter(function (r) {
      if (!includeUnpublished && !toBool_(r['掲載中'])) return false;
      if (gender !== 'all' && String(r['性別'] || '').trim() !== gender) return false;
      // 同一項目内OR・項目間AND（＝考えうる組み合わせのいずれか）
      if (!matchesFilterList_(r['業種'], industry)) return false;
      if (!matchesFilterList_(r['職種'], jobTitle)) return false;
      if (!matchesFilterList_(r['年代'], ageGroup)) return false;
      return true;
    })
    .map(function (r) {
      var user = mapUser_(r);
      // 非公開項目は一覧から除外
      delete user.annualSpend;
      delete user.realName;
      return user;
    });
}

/**
 * ホームダッシュボード用集計（Asia/Tokyo）
 * - 登録人数: 会員シート全件
 * - 昨日の新規: 登録日時が昨日
 * - 昨日の掲載停止者: 掲載中=FALSE かつ 最終ログイン日時が昨日
 * - 再参加者: 昨日ログインがあり、登録日が昨日より前、かつ掲載中=TRUE
 * - newLast7Days: 直近7日の新規登録（棒グラフ用）
 */
function getDashboard_() {
  const rows = readObjects_(SHEET.USERS);
  const today = tokyoDateKey_(new Date());
  const yesterday = tokyoDateKey_(addDays_(new Date(), -1));

  var totalRegistered = rows.length;
  var yesterdayNew = 0;
  var unpublished = 0;
  var yesterdayReturning = 0;
  var dayCounts = {};
  var i;
  for (i = 0; i < 7; i++) {
    dayCounts[tokyoDateKey_(addDays_(new Date(), -6 + i))] = 0;
  }

  rows.forEach(function (r) {
    const createdKey = tokyoDateKey_(parseDate_(r['登録日時']));
    const loginKey = tokyoDateKey_(parseDate_(r['最終ログイン日時']));
    const isPublished = toBool_(r['掲載中']);
    if (!isPublished && loginKey === yesterday) unpublished += 1;
    if (createdKey === yesterday) yesterdayNew += 1;
    if (loginKey === yesterday && createdKey && createdKey < yesterday && isPublished) {
      yesterdayReturning += 1;
    }
    if (createdKey && dayCounts.hasOwnProperty(createdKey)) {
      dayCounts[createdKey] += 1;
    }
  });

  const newLast7Days = Object.keys(dayCounts).sort().map(function (key) {
    return {
      date: key,
      label: key.slice(5).replace('-', '/'), // MM/DD
      count: dayCounts[key]
    };
  });

  return {
    asOf: today,
    totalRegistered: totalRegistered,
    yesterdayNew: yesterdayNew,
    unpublished: unpublished,
    yesterdayReturning: yesterdayReturning,
    newLast7Days: newLast7Days
  };
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

function getBanners_() {
  const now = new Date();
  return readObjects_(SHEET.BANNERS)
    .filter(function (r) {
      if (!toBool_(r['有効'])) return false;
      const start = parseDate_(r['開始日時']);
      const end = parseDate_(r['終了日時']);
      if (start && now < start) return false;
      if (end && now > end) return false;
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
        place: normalizeBannerPlace_(r['場所'])
      };
    });
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

  // メール指定時は先に拒否チェック（会員未登録でも弾く）
  if (email) assertNotDeniedEmail_(email);

  const sheet = getSheet_(SHEET.USERS);
  const table = readTable_(sheet);
  const idx = findUserIndex_(table.rows, memberNo, email);
  if (idx < 0) throw new Error('会員が見つかりません');

  // 会員番号のみで来た場合もシート上のメールで拒否チェック
  assertNotDeniedEmail_(table.rows[idx]['Googleメール']);

  const now = formatDateTime_(new Date());
  const rowNumber = idx + 2;
  setCellByHeader_(sheet, table.headers, rowNumber, '最終ログイン日時', now);

  const user = mapUser_(readObjects_(SHEET.USERS)[idx]);
  user.lastLoginAt = now;
  return user;
}

function getMasters_() {
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
  return grouped;
}

function getSettings_() {
  const sheet = getSheet_(SHEET.SETTINGS);
  const values = sheet.getDataRange().getValues();
  const out = {};
  for (var i = 1; i < values.length; i++) {
    const key = String(values[i][0] || '').trim();
    if (!key) continue;
    out[key] = values[i][1];
  }
  return out;
}

/** フロント公開用（拒否リスト等は含めない） */
function getPublicSettings_() {
  const out = getSettings_();
  delete out['拒否メール'];
  delete out['承認トークン'];
  return out;
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
  var set = {};
  try {
    var sheet = ensureDeniedMailSheet_();
    var values = sheet.getDataRange().getValues();
    if (!values || values.length < 2) return set;

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
      // 1セルに複数ある場合も拾う
      String(raw)
        .split(/[\s,，、;；]+/)
        .map(function (s) { return String(s || '').trim().toLowerCase(); })
        .filter(Boolean)
        .forEach(function (mail) {
          if (mail.indexOf('@') >= 0) set[mail] = true;
        });
    }
  } catch (e) {
    // 読めないときは拒否しない（可用性優先）
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

  // 会員シート更新の前に拒否判定
  assertNotDeniedEmail_(email);

  const sheet = getSheet_(SHEET.USERS);
  const table = readTable_(sheet);
  const idx = table.rows.findIndex(function (r) {
    const mail = String(r['Googleメール'] || '').toLowerCase();
    const gid = String(r['GoogleID'] || '');
    if (email && mail === email.toLowerCase()) return true;
    if (googleId && gid && gid === googleId) return true;
    return false;
  });

  const now = formatDateTime_(new Date());

  if (idx >= 0) {
    const rowNumber = idx + 2; // header = 1
    setCellByHeader_(sheet, table.headers, rowNumber, '最終ログイン日時', now);
    if (googleId) setCellByHeader_(sheet, table.headers, rowNumber, 'GoogleID', googleId);
    // 名前は初回プロフィール登録でのみ設定（Google表示名で上書きしない）
    if (picture) {
      const currentAvatar = String(table.rows[idx]['プロフィール画像URL'] || '');
      if (!currentAvatar) {
        setCellByHeader_(sheet, table.headers, rowNumber, 'プロフィール画像URL', picture);
      }
    }
    const user = mapUser_(readObjects_(SHEET.USERS)[idx]);
    user.isNew = false;
    return user;
  }

  // 新規会員（初回は未掲載 → プロフィール入力後に掲載）
  const memberNo = nextMemberNo_(table.rows);
  ensureHeader_(sheet, table.headers, 'ニックネーム');
  ensureHeader_(sheet, table.headers, '本名');
  const newRow = buildEmptyRow_(table.headers);
  setRowValue_(newRow, table.headers, '会員番号', memberNo);
  setRowValue_(newRow, table.headers, 'Googleメール', email);
  setRowValue_(newRow, table.headers, 'GoogleID', googleId);
  // ニックネーム・本名は空のまま。初回プロフィール登録で本人入力させる
  setRowValue_(newRow, table.headers, 'ニックネーム', '');
  setRowValue_(newRow, table.headers, '本名', '');
  // 旧列が残っている環境向け
  if (table.headers.indexOf('名前') >= 0) {
    setRowValue_(newRow, table.headers, '名前', '');
  }
  setRowValue_(newRow, table.headers, '性別', '');
  setRowValue_(newRow, table.headers, '年代', '30代');
  setRowValue_(newRow, table.headers, '業種', '');
  setRowValue_(newRow, table.headers, '職種', '');
  setRowValue_(newRow, table.headers, '現在地', '');
  setRowValue_(newRow, table.headers, '出身地', '');
  setRowValue_(newRow, table.headers, '自己紹介', '');
  setRowValue_(newRow, table.headers, 'こんな人と繋がりたい', '');
  setRowValue_(newRow, table.headers, 'こんな人とは繋がりたくない', '');
  setRowValue_(newRow, table.headers, '女性限定', false);
  setRowValue_(newRow, table.headers, '年間経費', '');
  setRowValue_(newRow, table.headers, '社名', '');
  setRowValue_(newRow, table.headers, 'タグ', '');
  setRowValue_(newRow, table.headers, 'プロフィール画像URL', picture || '');
  setRowValue_(newRow, table.headers, '掲載中', false);
  setRowValue_(newRow, table.headers, '社長マーク', false);
  setRowValue_(newRow, table.headers, '社長マーク状態', 'なし');
  setRowValue_(newRow, table.headers, 'サロン掲載', false);
  setRowValue_(newRow, table.headers, 'サロン掲載状態', 'なし');
  setRowValue_(newRow, table.headers, '登録日時', now);
  setRowValue_(newRow, table.headers, '更新日時', now);
  setRowValue_(newRow, table.headers, '最終ログイン日時', now);

  sheet.appendRow(newRow);
  const created = mapUser_(rowToObject_(table.headers, newRow));
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

  const sheet = getSheet_(SHEET.USERS);
  const table = readTable_(sheet);
  ensureHeader_(sheet, table.headers, '女性限定');
  ensureHeader_(sheet, table.headers, '年間経費');
  ensureHeader_(sheet, table.headers, '社名');
  ensureHeader_(sheet, table.headers, 'ニックネーム');
  ensureHeader_(sheet, table.headers, '本名');
  const idx = findUserIndex_(table.rows, memberNo, email);
  if (idx < 0) throw new Error('会員が見つかりません');

  const rowNumber = idx + 2;
  const nicknameCol = nicknameHeader_(table.headers);
  const allowed = [
    nicknameCol, '本名', '性別', '年代', '業種', '職種', '現在地', '出身地',
    '自己紹介', 'こんな人と繋がりたい', 'こんな人とは繋がりたくない',
    'タグ', 'プロフィール画像URL', 'LINE', 'Instagram', 'X', 'YouTube', '年間経費', '社名'
  ];

  const map = {
    nickname: nicknameCol,
    name: nicknameCol, // 互換: name は公開表示名＝ニックネーム
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
  const isPresident = toBool_(table.rows[idx]['社長マーク']);
  Object.keys(map).forEach(function (key) {
    if (profile[key] === undefined || profile[key] === null) return;
    // 社名は社長マーク会員のみ更新可
    if (key === 'companyName' && !isPresident) return;
    // 空文字での必須項目上書きを防ぐ
    if ((key === 'name' || key === 'nickname' || key === 'realName' || key === 'gender') &&
        String(profile[key]).trim() === '') {
      return;
    }
    if (key === 'realName') {
      var existingReal = realNameFromRow_(table.rows[idx]);
      // 一度登録した本名は変更不可（初回のみ）
      if (existingReal) return;
    }
    if (key === 'gender') {
      var existingGender = String(table.rows[idx]['性別'] || '').trim();
      // 掲載後は性別固定。未掲載（初回含む）は変更可
      if (existingGender && toBool_(table.rows[idx]['掲載中'])) return;
    }
    var value = profile[key];
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
    setCellByHeader_(sheet, table.headers, rowNumber, map[key], value);
  });

  // 女性限定は専用で必ず保存（列が無ければ上で自動追加済み）
  var sheetGender = String(table.rows[idx]['性別'] || '').trim();
  var incomingGender = String(profile.gender || '').trim();
  var genderNow = sheetGender || incomingGender;
  var femaleOnly = false;
  if (genderNow === '女性') {
    if (profile.femaleOnlyConnect !== undefined && profile.femaleOnlyConnect !== null) {
      femaleOnly = toBool_(profile.femaleOnlyConnect);
    } else {
      femaleOnly = toBool_(table.rows[idx]['女性限定']);
    }
  }
  setCellByHeader_(sheet, table.headers, rowNumber, '女性限定', femaleOnly ? 'TRUE' : 'FALSE');

  if (profile.snsLinks || profile.sns) {
    var links = [];
    if (Array.isArray(profile.snsLinks)) {
      links = profile.snsLinks;
    } else if (profile.sns && typeof profile.sns === 'object') {
      // 旧形式互換: LINE を先頭に
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
    setCellByHeader_(sheet, table.headers, rowNumber, 'SNS1', links[0] || '');
    setCellByHeader_(sheet, table.headers, rowNumber, 'SNS2', links[1] || '');
    setCellByHeader_(sheet, table.headers, rowNumber, 'SNS3', links[2] || '');
    setCellByHeader_(sheet, table.headers, rowNumber, 'SNS4', links[3] || '');
    setCellByHeader_(sheet, table.headers, rowNumber, 'LINE', links[0] || '');
  }

  allowed.forEach(function (col) {
    if (profile[col] !== undefined) {
      setCellByHeader_(sheet, table.headers, rowNumber, col, profile[col]);
    }
  });

  const now = formatDateTime_(new Date());
  setCellByHeader_(sheet, table.headers, rowNumber, '更新日時', now);
  setCellByHeader_(sheet, table.headers, rowNumber, '最終ログイン日時', now);
  return mapUser_(readObjects_(SHEET.USERS)[idx]);
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

  const sheet = getSheet_(SHEET.USERS);
  const table = readTable_(sheet);
  const idx = findUserIndex_(table.rows, memberNo, email);
  if (idx < 0) throw new Error('会員が見つかりません');

  const user = table.rows[idx];
  const no = String(user['会員番号'] || memberNo || 'user');
  const oldUrl = String(user['プロフィール画像URL'] || '');

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

  const rowNumber = idx + 2;
  const now = formatDateTime_(new Date());
  setCellByHeader_(sheet, table.headers, rowNumber, 'プロフィール画像URL', avatarUrl);
  setCellByHeader_(sheet, table.headers, rowNumber, '更新日時', now);
  setCellByHeader_(sheet, table.headers, rowNumber, '最終ログイン日時', now);

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

function setPublished_(body, published, typeLabel) {
  const memberNo = String(body.memberNo || body.member_no || '').trim();
  const email = String(body.email || '').trim();
  if (!memberNo && !email) throw new Error('memberNo または email が必要です');

  const userSheet = getSheet_(SHEET.USERS);
  const table = readTable_(userSheet);
  const idx = findUserIndex_(table.rows, memberNo, email);
  if (idx < 0) throw new Error('会員が見つかりません');

  const user = table.rows[idx];
  const no = String(user['会員番号'] || memberNo);
  const rowNumber = idx + 2;

  const now = formatDateTime_(new Date());
  setCellByHeader_(userSheet, table.headers, rowNumber, '掲載中', published);
  setCellByHeader_(userSheet, table.headers, rowNumber, '更新日時', now);
  setCellByHeader_(userSheet, table.headers, rowNumber, '最終ログイン日時', now);

  const requestId = createRequest_(no, typeLabel, '対応済', String(body.note || ''));
  return {
    requestId: requestId,
    memberNo: no,
    isPublished: published,
    lastLoginAt: now,
    publishedAt: String(user['登録日時'] || '')
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
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
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
