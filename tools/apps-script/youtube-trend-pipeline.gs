/**
 * 競合YouTube → スプレッドシート蓄積 → 水曜定時 → 伸び率・キーワード集計
 *
 * 事前準備:
 * 1) GCP で YouTube Data API v3 を有効化し API キーを発行
 * 2) このスクリプトをスプレッドシートに紐づけたプロジェクトに貼り付け
 * 3) プロジェクトの設定 → スクリプトのプロパティ → YOUTUBE_API_KEY を追加
 * 4) runFullPipeline を一度手動実行して権限を承認
 * 5) トリガー: 時間主導型 → 週次 → 水曜日 → runFullPipeline
 */

var SHEET_VIDEOS = 'Videos_Log';
var SHEET_TRENDS = 'Weekly_Trends';
var SHEET_KEYWORDS = 'Keyword_Summary';

/** 観測対象: handle は @なし。videoId を渡すとその動画のチャンネルを観測 */
var COMPETITORS = [
  { label: '人生100年物語', handle: '人生100年物語' },
  { label: 'シニアの心が軽くなる知恵', videoId: 'fz_K2ZGe0BM' },
  { label: 'シニアライフ60代', handle: 'シニアライフ60代' },
];

var MAX_VIDEOS_PER_CHANNEL = 15;

function getApiKey_() {
  var key = PropertiesService.getScriptProperties().getProperty('YOUTUBE_API_KEY');
  if (!key) throw new Error('スクリプトのプロパティ YOUTUBE_API_KEY を設定してください。');
  return key;
}

function ytGet_(path, query) {
  var base = 'https://www.googleapis.com/youtube/v3/' + path;
  var q = query || {};
  q.key = getApiKey_();
  var params = [];
  for (var k in q) {
    if (q[k] !== undefined && q[k] !== null) params.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(q[k])));
  }
  var url = base + '?' + params.join('&');
  var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  var code = res.getResponseCode();
  var body = res.getContentText();
  if (code !== 200) {
    throw new Error('YouTube API ' + code + ': ' + body);
  }
  return JSON.parse(body);
}

function resolveChannelId_(comp) {
  if (comp.videoId) {
    var data = ytGet_('videos', { part: 'snippet', id: comp.videoId });
    if (!data.items || !data.items.length) throw new Error('videoId が見つかりません: ' + comp.videoId);
    return data.items[0].snippet.channelId;
  }
  if (comp.handle) {
    var ch = ytGet_('channels', { part: 'contentDetails', forHandle: comp.handle });
    if (!ch.items || !ch.items.length) throw new Error('ハンドルが見つかりません: ' + comp.handle);
    return ch.items[0].id;
  }
  throw new Error('handle または videoId を指定してください');
}

function getUploadsPlaylistId_(channelId) {
  var data = ytGet_('channels', { part: 'contentDetails', id: channelId });
  if (!data.items || !data.items.length) return null;
  return data.items[0].contentDetails.relatedPlaylists.uploads;
}

function fetchPlaylistVideoIds_(playlistId, maxResults) {
  var ids = [];
  var pageToken;
  while (ids.length < maxResults) {
    var take = Math.min(50, maxResults - ids.length);
    var q = { part: 'contentDetails', playlistId: playlistId, maxResults: take };
    if (pageToken) q.pageToken = pageToken;
    var data = ytGet_('playlistItems', q);
    var items = data.items || [];
    for (var i = 0; i < items.length; i++) {
      ids.push(items[i].contentDetails.videoId);
    }
    pageToken = data.nextPageToken;
    if (!pageToken || !items.length) break;
  }
  return ids;
}

function fetchVideoDetails_(videoIds) {
  if (!videoIds.length) return [];
  var out = [];
  for (var i = 0; i < videoIds.length; i += 50) {
    var chunk = videoIds.slice(i, i + 50);
    var data = ytGet_('videos', { part: 'snippet,statistics', id: chunk.join(',') });
    var items = data.items || [];
    for (var j = 0; j < items.length; j++) out.push(items[j]);
  }
  return out;
}

function ensureSheet_(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  }
  return sh;
}

function appendVideoLog_(rows) {
  var headers = ['videoId', 'title', 'viewCount', 'publishedAt', 'channelLabel', 'fetchedAt'];
  var sh = ensureSheet_(SHEET_VIDEOS, headers);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, sh.getLastRow() + rows.length, headers.length).setValues(rows);
}

function isoNow_() {
  return new Date().toISOString();
}

function ingestLatestVideos_() {
  var fetchedAt = isoNow_();
  var allRows = [];

  for (var c = 0; c < COMPETITORS.length; c++) {
    var comp = COMPETITORS[c];
    var channelId = resolveChannelId_(comp);
    var playlistId = getUploadsPlaylistId_(channelId);
    if (!playlistId) continue;
    var vids = fetchPlaylistVideoIds_(playlistId, MAX_VIDEOS_PER_CHANNEL);
    var details = fetchVideoDetails_(vids);
    for (var i = 0; i < details.length; i++) {
      var v = details[i];
      var views = (v.statistics && v.statistics.viewCount) ? Number(v.statistics.viewCount) : 0;
      allRows.push([
        v.id,
        v.snippet.title,
        views,
        v.snippet.publishedAt,
        comp.label,
        fetchedAt,
      ]);
    }
  }
  appendVideoLog_(allRows);
  return allRows.length;
}

/**
 * 同一 videoId の直近2件の viewCount から伸び率を計算し Weekly_Trends に出力
 */
function computeWeeklyTrends_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_VIDEOS);
  if (!sh || sh.getLastRow() < 2) return;

  var data = sh.getDataRange().getValues();
  var header = data[0];
  var colId = header.indexOf('videoId');
  var colViews = header.indexOf('viewCount');
  var colTitle = header.indexOf('title');
  var colPub = header.indexOf('publishedAt');
  var colCh = header.indexOf('channelLabel');
  var colFetched = header.indexOf('fetchedAt');
  if (colId < 0 || colViews < 0) return;

  var byVideo = {};
  for (var r = 1; r < data.length; r++) {
    var id = data[r][colId];
    if (!id) continue;
    var fetched = data[r][colFetched];
    var fetchedMs = 0;
    if (fetched instanceof Date) fetchedMs = fetched.getTime();
    else if (fetched) fetchedMs = new Date(fetched).getTime();
    if (!byVideo[id]) byVideo[id] = [];
    byVideo[id].push({
      views: Number(data[r][colViews]) || 0,
      fetched: fetchedMs,
      title: data[r][colTitle],
      publishedAt: data[r][colPub],
      channel: data[r][colCh],
    });
  }

  var out = [['videoId', 'title', 'channelLabel', 'publishedAt', 'viewsPrev', 'viewsLatest', 'delta', 'growthRatePct', 'analyzedAt']];
  var now = isoNow_();

  for (var vid in byVideo) {
    var snaps = byVideo[vid].sort(function (a, b) {
      return a.fetched - b.fetched;
    });
    if (snaps.length < 2) continue;
    var prev = snaps[snaps.length - 2];
    var latest = snaps[snaps.length - 1];
    var delta = latest.views - prev.views;
    var rate = prev.views > 0 ? (delta / prev.views) * 100 : '';
    out.push([
      vid,
      latest.title,
      latest.channel,
      latest.publishedAt,
      prev.views,
      latest.views,
      delta,
      rate === '' ? '' : Math.round(rate * 100) / 100,
      now,
    ]);
  }

  var tsh = ensureSheet_(SHEET_TRENDS, out[0]);
  tsh.clearContents();
  tsh.getRange(1, 1, out.length, out[0].length).setValues(out);
  tsh.getRange(1, 1, 1, out[0].length).setFontWeight('bold');
}

var STOPWORDS = {
  'の': 1, 'に': 1, 'は': 1, 'を': 1, 'が': 1, 'と': 1, 'も': 1, 'で': 1, 'や': 1, 'へ': 1, 'から': 1, 'まで': 1,
  '　': 1, ' ': 1, '【': 1, '】': 1, '|': 1, '-': 1, 'ー': 1,
};

function tokenizeTitle_(title) {
  if (!title) return [];
  var normalized = String(title).replace(/[#【】\[\]「」『』｜|]/g, ' ');
  var parts = normalized.split(/[\s\/、，。．.]+/);
  var tokens = [];
  for (var i = 0; i < parts.length; i++) {
    var w = parts[i].trim();
    if (w.length >= 2 && !STOPWORDS[w]) tokens.push(w);
  }
  return tokens;
}

function computeKeywordSummary_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_VIDEOS);
  if (!sh || sh.getLastRow() < 2) return;

  var data = sh.getDataRange().getValues();
  var header = data[0];
  var colTitle = header.indexOf('title');
  var colFetched = header.indexOf('fetchedAt');
  if (colTitle < 0) return;

  var latestMs = 0;
  for (var r = 1; r < data.length; r++) {
    var f = data[r][colFetched];
    var ms = f instanceof Date ? f.getTime() : f ? new Date(f).getTime() : 0;
    if (ms > latestMs) latestMs = ms;
  }
  if (!latestMs) return;

  var counts = {};
  for (var r2 = 1; r2 < data.length; r2++) {
    var f2 = data[r2][colFetched];
    var ms2 = f2 instanceof Date ? f2.getTime() : f2 ? new Date(f2).getTime() : 0;
    if (ms2 !== latestMs) continue;
    var toks = tokenizeTitle_(data[r2][colTitle]);
    for (var t = 0; t < toks.length; t++) {
      var k = toks[t];
      counts[k] = (counts[k] || 0) + 1;
    }
  }

  var latestFetchLabel = new Date(latestMs).toISOString();
  var rows = [['keyword', 'count', 'batchFetchedAt']];
  var keys = Object.keys(counts).sort(function (a, b) {
    return counts[b] - counts[a];
  });
  for (var i = 0; i < keys.length; i++) {
    rows.push([keys[i], counts[keys[i]], latestFetchLabel]);
  }

  var ksh = ensureSheet_(SHEET_KEYWORDS, rows[0]);
  ksh.clearContents();
  ksh.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
  ksh.getRange(1, 1, 1, rows[0].length).setFontWeight('bold');
}

/** 手動・トリガー共通のエントリポイント */
function runFullPipeline() {
  ingestLatestVideos_();
  computeWeeklyTrends_();
  computeKeywordSummary_();
}
