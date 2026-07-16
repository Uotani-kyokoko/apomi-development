/**
 * apomi - GAS API
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
 */

// コンテナバインド（スプレッドシートに紐付いたスクリプト）なら空文字のままでOK
const SPREADSHEET_ID = '';

const SHEET = {
  USERS: '会員',
  BANNERS: 'バナー',
  REQUESTS: '申請',
  MASTERS: 'マスタ',
  SETTINGS: '設定'
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
        data = getSettings_();
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
      case 'ping':
        data = { ok: true, message: 'apomi GAS is alive' };
        break;
      default:
        return json_({ success: false, error: '不明なactionです: ' + action });
    }

    return json_({ success: true, data: data });
  } catch (err) {
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
        data = requestPresidentMark_(body);
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

function getUsers_(p) {
  const rows = readObjects_(SHEET.USERS);
  const industry = String(p.industry || 'all');
  const gender = String(p.gender || 'all');
  const jobTitle = String(p.jobTitle || p.job_title || 'all');
  const ageGroup = String(p.ageGroup || p.age_group || 'all');
  const includeUnpublished = String(p.includeUnpublished || '') === 'true';

  return rows
    .filter(function (r) {
      if (!includeUnpublished && !toBool_(r['掲載中'])) return false;
      if (industry !== 'all' && String(r['業種'] || '').trim() !== industry) return false;
      if (gender !== 'all' && String(r['性別'] || '').trim() !== gender) return false;
      if (jobTitle !== 'all' && String(r['職種'] || '').trim() !== jobTitle) return false;
      if (ageGroup !== 'all' && String(r['年代'] || '').trim() !== ageGroup) return false;
      return true;
    })
    .map(mapUser_);
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
        linkUrl: String(r['リンクURL'] || '')
      };
    });
}

function getMe_(p) {
  // 自分の取得＝操作とみなし最終ログインを更新
  return touchActivity_(p);
}

/**
 * 最終ログイン日時・オンライン状態を更新（ログイン / 操作のたび）
 * @returns {Object} mapUser_ 結果（lastLoginAt 更新済み）
 */
function touchActivity_(body) {
  const memberNo = String((body && (body.memberNo || body.member_no)) || '').trim();
  const email = String((body && body.email) || '').trim();
  if (!memberNo && !email) {
    throw new Error('email または memberNo が必要です');
  }

  const sheet = getSheet_(SHEET.USERS);
  const table = readTable_(sheet);
  const idx = findUserIndex_(table.rows, memberNo, email);
  if (idx < 0) throw new Error('会員が見つかりません');

  const now = formatDateTime_(new Date());
  const rowNumber = idx + 2;
  setCellByHeader_(sheet, table.headers, rowNumber, '最終ログイン日時', now);
  setCellByHeader_(sheet, table.headers, rowNumber, 'オンライン状態', 'オンライン');

  const user = mapUser_(readObjects_(SHEET.USERS)[idx]);
  user.lastLoginAt = now;
  user.status = 'オンライン';
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
      const value = String(r['値'] || '').trim();
      if (!cat || !value) return;
      if (!grouped[cat]) grouped[cat] = [];
      // 同じ「値」の重複行は除外
      const exists = grouped[cat].some(function (item) {
        return item.value === value;
      });
      if (exists) return;
      grouped[cat].push({
        value: value,
        label: String(r['表示名'] || r['値'] || '')
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
    setCellByHeader_(sheet, table.headers, rowNumber, 'オンライン状態', 'オンライン');
    if (googleId) setCellByHeader_(sheet, table.headers, rowNumber, 'GoogleID', googleId);
    if (name) setCellByHeader_(sheet, table.headers, rowNumber, '名前', name);
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
  const newRow = buildEmptyRow_(table.headers);
  setRowValue_(newRow, table.headers, '会員番号', memberNo);
  setRowValue_(newRow, table.headers, 'Googleメール', email);
  setRowValue_(newRow, table.headers, 'GoogleID', googleId);
  setRowValue_(newRow, table.headers, '名前', name || email.split('@')[0]);
  setRowValue_(newRow, table.headers, '性別', '男性');
  setRowValue_(newRow, table.headers, '年代', '30代');
  setRowValue_(newRow, table.headers, '業種', 'その他');
  setRowValue_(newRow, table.headers, '職種', 'その他');
  setRowValue_(newRow, table.headers, '現在地', '');
  setRowValue_(newRow, table.headers, '出身地', '');
  setRowValue_(newRow, table.headers, '自己紹介', '');
  setRowValue_(newRow, table.headers, 'こんな人と繋がりたい', '');
  setRowValue_(newRow, table.headers, 'こんな人とは繋がりたくない', '');
  setRowValue_(newRow, table.headers, 'タグ', '');
  setRowValue_(newRow, table.headers, 'プロフィール画像URL', picture || '');
  setRowValue_(newRow, table.headers, '掲載中', false);
  setRowValue_(newRow, table.headers, '社長マーク', false);
  setRowValue_(newRow, table.headers, '社長マーク状態', 'なし');
  setRowValue_(newRow, table.headers, 'オンライン状態', 'オンライン');
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
  const idx = findUserIndex_(table.rows, memberNo, email);
  if (idx < 0) throw new Error('会員が見つかりません');

  const rowNumber = idx + 2;
  const allowed = [
    '名前', '性別', '年代', '業種', '職種', '現在地', '出身地',
    '自己紹介', 'こんな人と繋がりたい', 'こんな人とは繋がりたくない',
    'タグ', 'プロフィール画像URL', 'LINE', 'Instagram', 'X', 'YouTube', 'オンライン状態'
  ];

  const map = {
    name: '名前',
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
    status: 'オンライン状態'
  };

  const profile = parsed.profile || parsed;
  Object.keys(map).forEach(function (key) {
    if (profile[key] === undefined || profile[key] === null) return;
    // 名前など必須っぽい項目は空文字での上書きを防ぐ
    if ((key === 'name' || key === 'gender') && String(profile[key]).trim() === '') return;
    setCellByHeader_(sheet, table.headers, rowNumber, map[key], profile[key]);
  });

  if (profile.sns) {
    if (profile.sns.line !== undefined) setCellByHeader_(sheet, table.headers, rowNumber, 'LINE', profile.sns.line);
    if (profile.sns.instagram !== undefined) setCellByHeader_(sheet, table.headers, rowNumber, 'Instagram', profile.sns.instagram);
    if (profile.sns.x !== undefined) setCellByHeader_(sheet, table.headers, rowNumber, 'X', profile.sns.x);
    if (profile.sns.youtube !== undefined) setCellByHeader_(sheet, table.headers, rowNumber, 'YouTube', profile.sns.youtube);
  }

  allowed.forEach(function (col) {
    if (profile[col] !== undefined) {
      setCellByHeader_(sheet, table.headers, rowNumber, col, profile[col]);
    }
  });

  const now = formatDateTime_(new Date());
  setCellByHeader_(sheet, table.headers, rowNumber, '更新日時', now);
  setCellByHeader_(sheet, table.headers, rowNumber, '最終ログイン日時', now);
  setCellByHeader_(sheet, table.headers, rowNumber, 'オンライン状態', 'オンライン');
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
  setCellByHeader_(sheet, table.headers, rowNumber, 'オンライン状態', 'オンライン');

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
  const savedId = props.getProperty('AVATAR_FOLDER_ID');
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

function requestPresidentMark_(body) {
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
  setCellByHeader_(userSheet, table.headers, rowNumber, '社長マーク状態', '申請中');
  setCellByHeader_(userSheet, table.headers, rowNumber, '更新日時', now);
  setCellByHeader_(userSheet, table.headers, rowNumber, '最終ログイン日時', now);
  setCellByHeader_(userSheet, table.headers, rowNumber, 'オンライン状態', 'オンライン');

  const requestId = createRequest_(no, '社長マーク', '受付', String(body.note || ''));
  return {
    requestId: requestId,
    memberNo: no,
    presidentMarkStatus: '申請中',
    lastLoginAt: now
  };
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
  setCellByHeader_(userSheet, table.headers, rowNumber, 'オンライン状態', 'オンライン');
  // 掲載開始・再開時に掲載日を更新（最新7日判定用）。停止時は残す（再開まで最新に出ない）
  if (published) {
    setCellByHeader_(userSheet, table.headers, rowNumber, '掲載日', now);
  }

  const requestId = createRequest_(no, typeLabel, '対応済', String(body.note || ''));
  return {
    requestId: requestId,
    memberNo: no,
    isPublished: published,
    lastLoginAt: now,
    publishedAt: published ? now : String(user['掲載日'] || '')
  };
}

function createRequest_(memberNo, type, status, note) {
  const sheet = getSheet_(SHEET.REQUESTS);
  const table = readTable_(sheet);
  const now = new Date();
  const requestId = 'R' + Utilities.formatDate(now, 'Asia/Tokyo', 'yyyyMMdd-HHmmss');

  const newRow = buildEmptyRow_(table.headers);
  setRowValue_(newRow, table.headers, '申請ID', requestId);
  setRowValue_(newRow, table.headers, '会員番号', memberNo);
  setRowValue_(newRow, table.headers, '種別', type);
  setRowValue_(newRow, table.headers, '状態', status);
  setRowValue_(newRow, table.headers, '備考', note || '');
  setRowValue_(newRow, table.headers, '申請日時', formatDateTime_(now));
  if (status === '対応済') {
    setRowValue_(newRow, table.headers, '対応日時', formatDateTime_(now));
  }
  sheet.appendRow(newRow);
  return requestId;
}

/* ========== Mapping ========== */

function mapUser_(r) {
  const tagsRaw = String(r['タグ'] || '').trim();
  const tags = tagsRaw
    ? tagsRaw.split(/[,、\t]/).map(function (t) { return t.trim(); }).filter(Boolean)
    : [];

  return {
    id: String(r['会員番号'] || ''),
    email: String(r['Googleメール'] || ''),
    name: String(r['名前'] || ''),
    gender: String(r['性別'] || ''),
    ageGroup: String(r['年代'] || ''),
    industry: String(r['業種'] || ''),
    jobTitle: String(r['職種'] || ''),
    location: String(r['現在地'] || ''),
    hometown: String(r['出身地'] || ''),
    bio: String(r['自己紹介'] || ''),
    wantMeet: String(r['こんな人と繋がりたい'] || ''),
    avoidMeet: String(r['こんな人とは繋がりたくない'] || ''),
    tags: tags,
    avatarUrl: String(r['プロフィール画像URL'] || ''),
    status: String(r['オンライン状態'] || 'オフライン'),
    lastLoginAt: String(r['最終ログイン日時'] || ''),
    createdAt: String(r['登録日時'] || ''),
    // 掲載日が空なら登録日時で代用（既存データ互換）
    publishedAt: String(r['掲載日'] || r['登録日時'] || ''),
    isPublished: toBool_(r['掲載中']),
    presidentMark: toBool_(r['社長マーク']),
    presidentMarkStatus: String(r['社長マーク状態'] || 'なし'),
    sns: {
      line: String(r['LINE'] || ''),
      instagram: String(r['Instagram'] || ''),
      x: String(r['X'] || ''),
      youtube: String(r['YouTube'] || '')
    }
  };
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

/** ヘッダーが無ければ末尾に追加（掲載日など） */
function ensureHeader_(sheet, headers, colName) {
  if (headers.indexOf(colName) >= 0) return;
  const col = headers.length + 1;
  sheet.getRange(1, col).setValue(colName);
  headers.push(colName);
}

function findUserIndex_(rows, memberNo, email) {
  return rows.findIndex(function (r) {
    if (memberNo && String(r['会員番号'] || '') === memberNo) return true;
    if (email && String(r['Googleメール'] || '').toLowerCase() === email.toLowerCase()) return true;
    return false;
  });
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

function testUsers() {
  Logger.log(doGet({ parameter: { action: 'users' } }).getContent());
}

function testBanners() {
  Logger.log(doGet({ parameter: { action: 'banners' } }).getContent());
}
