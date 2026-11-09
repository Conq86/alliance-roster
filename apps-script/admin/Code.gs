/**
 * POW 713 Alliance — owner approval screen.
 *
 * Private admin web app. Deploy as a web app: Execute as = Me (the owner).
 * Who has access = Only myself. That Google-account restriction is the authentication;
 * every function below also checks Session.getActiveUser() against OWNER_EMAIL.
 *
 * What it does:
 * - Lists pending submissions (private Drive files + tracking Sheet, shared with the
 *   Submissions project) and lets the owner preview them, correct titles and game
 *   names, approve or reject them.
 * - Approval publishes without any GitHub editing: the file is copied from private
 *   Drive into the repo via the GitHub API, media.json / fanart.json is updated, and
 *   GitHub Pages deploys it. The screen reports "approved — publishing" and offers a
 *   "Check live" button that confirms the file is actually serving.
 * - Unpublish removes the listing (and the published file) later.
 * - Optional daily YouTube playlist sync (ordinary time trigger, not an AI run).
 *   It only runs when playlist IDs are configured in Settings; none are configured
 *   by default and none are invented here.
 *
 * Script Properties (Project Settings > Script Properties, or the Settings panel here):
 *   OWNER_EMAIL       — set automatically to the deploying account on first use.
 *   GITHUB_TOKEN      — fine-grained PAT with Contents: read/write on Conq86/alliance-roster only.
 *                       Server-side only; never returned to the browser.
 *   DRIVE_FOLDER_ID / SHEET_ID — created by setupDrive() (same folder/Sheet the
 *                       Submissions project uses; paste the IDs into that project too).
 *   YOUTUBE_API_KEY   — optional, for playlist sync and video metadata.
 *   PLAYLISTS         — optional JSON array: [{playlistId, creatorId, creator, member, channel, channelUrl}].
 *   CAPACITY_LIMIT_MB — default 900. Publishing refuses above this (Pages limit is 1 GB).
 *   REPO              — default Conq86/alliance-roster.
 */

// ---- Configuration ----
var REPO_DEFAULT = 'Conq86/alliance-roster';
var SITE_BASE = 'https://conq86.github.io/alliance-roster/';
var PREVIEW_MAX_BYTES = 8 * 1024 * 1024; // previews over 8 MB open in Drive instead
var SHEET_HEADERS = ['id', 'submittedAt', 'type', 'gameName', 'title', 'description',
  'fileName', 'fileId', 'fileSize', 'sha256', 'youtubeId', 'youtubeUrl', 'status',
  'publishedPath', 'publishedCommit', 'reviewNote', 'approvedAt'];
var COL = {};
SHEET_HEADERS.forEach(function (h, i) { COL[h] = i; });

// ---- Small helpers ----
function props_() { return PropertiesService.getScriptProperties(); }
function repo_() { return props_().getProperty('REPO') || REPO_DEFAULT; }
function capacityLimitMB_() { return parseInt(props_().getProperty('CAPACITY_LIMIT_MB') || '900', 10) || 900; }

function text_(value, max) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
}

function extOf_(name) {
  var parts = String(name || '').split('.');
  return parts.length > 1 ? parts.pop().toLowerCase() : '';
}

function slug_(text) {
  return String(text || '').toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'member';
}

function ownerEmail_() {
  var stored = props_().getProperty('OWNER_EMAIL');
  if (stored) return stored;
  var me = Session.getActiveUser().getEmail();
  if (me) props_().setProperty('OWNER_EMAIL', me);
  return me || '';
}

function requireOwner_() {
  var me = Session.getActiveUser().getEmail();
  var owner = ownerEmail_();
  if (!me || !owner || me.toLowerCase() !== owner.toLowerCase()) {
    throw new Error('Only the owner can use this screen.');
  }
}

function folder_() {
  var id = props_().getProperty('DRIVE_FOLDER_ID');
  if (!id) throw new Error('Drive folder is not set up yet. Use the Setup panel.');
  return DriveApp.getFolderById(id);
}

function sheet_() {
  var id = props_().getProperty('SHEET_ID');
  if (!id) throw new Error('Tracking Sheet is not set up yet. Use the Setup panel.');
  var ss = SpreadsheetApp.openById(id);
  return ss.getSheetByName('Submissions') || ss.getSheets()[0];
}

function rows_() {
  var sh = sheet_();
  var last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, SHEET_HEADERS.length).getValues();
}

function rowObj_(values) {
  var o = {};
  SHEET_HEADERS.forEach(function (h, i) { o[h] = values[i]; });
  o.submittedAt = values[COL.submittedAt] ? new Date(values[COL.submittedAt]).toISOString() : '';
  o.approvedAt = values[COL.approvedAt] ? new Date(values[COL.approvedAt]).toISOString() : '';
  return o;
}

function findRow_(id) {
  var values = rows_();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][COL.id]) === String(id)) return { row: i + 2, values: values[i] };
  }
  return null;
}

function setRowFields_(row, patch) {
  var sh = sheet_();
  Object.keys(patch).forEach(function (key) {
    var idx = COL[key];
    if (idx !== undefined) sh.getRange(row, idx + 1).setValue(patch[key]);
  });
}

function liveUrl_(path) {
  if (path === 'media.json') return SITE_BASE + '?view=media';
  if (path.indexOf('fanart/') === 0) return SITE_BASE + '?view=fanart';
  return SITE_BASE + path;
}

// ---- GitHub API (server-side only; the token never leaves this script) ----
function ghToken_() {
  var t = props_().getProperty('GITHUB_TOKEN');
  if (!t) throw new Error('GitHub token is not set. Add it in Settings (a fine-grained token with Contents: read/write on this repo only).');
  return t;
}

function gh_(method, path, body) {
  var opts = {
    method: method, muteHttpExceptions: true,
    headers: { 'Authorization': 'Bearer ' + ghToken_(), 'Accept': 'application/vnd.github+json', 'User-Agent': 'pow713-admin' }
  };
  if (body) { opts.contentType = 'application/json'; opts.payload = JSON.stringify(body); }
  var res = UrlFetchApp.fetch('https://api.github.com' + path, opts);
  var code = res.getResponseCode();
  var data = null;
  try { data = JSON.parse(res.getContentText()); } catch (e) {}
  if (code < 200 || code >= 300) {
    throw new Error('GitHub ' + method + ' ' + path + ' failed (' + code + '): ' + String(data && data.message || res.getContentText()).slice(0, 200));
  }
  return data;
}

function repoSizeMB_() {
  var data = gh_('get', '/repos/' + repo_());
  return { repo: repo_(), sizeMB: Math.round((data.size || 0) / 1024 * 10) / 10, limitMB: capacityLimitMB_() };
}

function ghGetFile_(path) {
  try { return gh_('get', '/repos/' + repo_() + '/contents/' + path); }
  catch (e) { if (String(e.message).indexOf('(404)') !== -1) return null; throw e; }
}

function ghPutFile_(path, base64, message, sha) {
  var body = { message: message, content: base64, branch: 'main' };
  if (sha) body.sha = sha;
  return gh_('put', '/repos/' + repo_() + '/contents/' + path, body);
}

function ghDeleteFile_(path, message, sha) {
  return gh_('delete', '/repos/' + repo_() + '/contents/' + path, { message: message, sha: sha, branch: 'main' });
}

function getJsonFile_(path, fallback) {
  var file = ghGetFile_(path);
  if (!file || !file.content) return fallback;
  var text = Utilities.newBlob(Utilities.base64Decode(file.content.replace(/\s/g, ''))).getDataAsString();
  try { return JSON.parse(text); }
  catch (e) { throw new Error(path + ' is not valid JSON: ' + e.message); }
}

function putJsonFile_(path, obj, message) {
  var file = ghGetFile_(path);
  var content = Utilities.base64Encode(Utilities.newBlob(JSON.stringify(obj, null, 2) + '\n').getBytes());
  return ghPutFile_(path, content, message, file ? file.sha : null);
}

// ---- YouTube Data API (only when a key is configured) ----
function ytVideo_(videoId) {
  var key = props_().getProperty('YOUTUBE_API_KEY');
  if (!key) return null;
  try {
    var url = 'https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&id=' + encodeURIComponent(videoId) + '&key=' + encodeURIComponent(key);
    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return null;
    var data = JSON.parse(res.getContentText());
    var it = (data.items || [])[0];
    if (!it) return null;
    return { published: (it.snippet.publishedAt || '').slice(0, 10), duration: isoDuration_(it.contentDetails.duration) };
  } catch (e) { return null; }
}

function isoDuration_(iso) {
  var m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || '');
  if (!m) return '';
  return (parseInt(m[1] || '0', 10) * 3600) + (parseInt(m[2] || '0', 10) * 60) + parseInt(m[3] || '0', 10);
}

function ytPlaylistItems_(playlistId, key) {
  var out = [], token = '';
  do {
    var url = 'https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&maxResults=50&playlistId=' + encodeURIComponent(playlistId) + '&key=' + encodeURIComponent(key) + (token ? '&pageToken=' + encodeURIComponent(token) : '');
    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) throw new Error('YouTube API error (' + res.getResponseCode() + '): ' + res.getContentText().slice(0, 200));
    var data = JSON.parse(res.getContentText());
    (data.items || []).forEach(function (it) {
      var vid = it.contentDetails && it.contentDetails.videoId;
      if (!vid) return;
      out.push({ youtubeId: vid, title: (it.snippet && it.snippet.title) || vid, published: ((it.snippet && it.snippet.publishedAt) || '').slice(0, 10) });
    });
    token = data.nextPageToken || '';
  } while (token);
  return out;
}

function getPlaylists_() {
  try {
    var list = JSON.parse(props_().getProperty('PLAYLISTS') || '[]');
    return Array.isArray(list) ? list : [];
  } catch (e) { return []; }
}

// ---- Web app entry point ----
function doGet() {
  requireOwner_();
  return HtmlService.createTemplateFromFile('Admin').evaluate()
    .setTitle('POW 713 — Approvals')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

// ---- Admin actions (called from Admin.html via google.script.run) ----
function getStatus() {
  requireOwner_();
  var p = props_();
  var counts = { pending: 0, approved: 0, rejected: 0, unpublished: 0 };
  var countsError = '';
  try {
    rows_().forEach(function (r) {
      var s = String(r[COL.status] || '');
      if (counts[s] !== undefined) counts[s]++;
    });
  } catch (e) { countsError = String(e.message); }
  var size = null;
  try { size = repoSizeMB_(); } catch (e) { size = { error: String(e.message) }; }
  return {
    ok: true, owner: ownerEmail_(),
    configured: {
      drive: !!p.getProperty('DRIVE_FOLDER_ID'),
      sheet: !!p.getProperty('SHEET_ID'),
      github: !!p.getProperty('GITHUB_TOKEN'),
      youtube: !!p.getProperty('YOUTUBE_API_KEY')
    },
    // Non-secret settings so the Setup form can prefill them. Tokens/keys are never returned.
    settings: {
      folderId: p.getProperty('DRIVE_FOLDER_ID') || '',
      sheetId: p.getProperty('SHEET_ID') || '',
      capacityLimitMB: capacityLimitMB_(),
      repo: repo_()
    },
    countsError: countsError, repo: size, counts: counts,
    playlists: getPlaylists_(),
    syncTrigger: ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'syncPlaylists'; }),
    submitEndpointHint: 'Paste the Submissions web app URL into submit.js (SUBMIT_ENDPOINT) after deploying that project.'
  };
}

function setupDrive() {
  requireOwner_();
  var p = props_();
  var folderId = p.getProperty('DRIVE_FOLDER_ID');
  var sheetId = p.getProperty('SHEET_ID');
  if (!folderId) {
    folderId = DriveApp.createFolder('POW 713 Submissions (private)').getId();
    p.setProperty('DRIVE_FOLDER_ID', folderId);
  }
  if (!sheetId) {
    var ss = SpreadsheetApp.create('POW 713 Submissions');
    var sh = ss.getSheets()[0];
    sh.setName('Submissions');
    sh.appendRow(SHEET_HEADERS);
    sh.setFrozenRows(1);
    sheetId = ss.getId();
    p.setProperty('SHEET_ID', sheetId);
  }
  return {
    ok: true, folderId: folderId, sheetId: sheetId,
    folderUrl: 'https://drive.google.com/drive/folders/' + folderId,
    sheetUrl: 'https://docs.google.com/spreadsheets/d/' + sheetId,
    note: 'Copy these two IDs into the Submissions project\'s Script Properties (DRIVE_FOLDER_ID and SHEET_ID) so both projects share the same folder and Sheet.'
  };
}

function saveSettings(settings) {
  requireOwner_();
  settings = settings || {};
  var p = props_();
  if (settings.githubToken) p.setProperty('GITHUB_TOKEN', String(settings.githubToken));
  if (settings.youtubeKey) p.setProperty('YOUTUBE_API_KEY', String(settings.youtubeKey));
  if (settings.playlists !== undefined) {
    var parsed = JSON.parse(settings.playlists || '[]');
    if (!Array.isArray(parsed)) throw new Error('Playlists must be a JSON array.');
    p.setProperty('PLAYLISTS', JSON.stringify(parsed));
  }
  if (settings.capacityLimitMB !== undefined) p.setProperty('CAPACITY_LIMIT_MB', String(parseInt(settings.capacityLimitMB, 10) || 900));
  // Blank folder/Sheet fields keep the configured IDs (never wipe them).
  var sheetId = String(settings.sheetId || '').trim();
  var folderId = String(settings.folderId || '').trim();
  if (sheetId) p.setProperty('SHEET_ID', sheetId);
  if (folderId) p.setProperty('DRIVE_FOLDER_ID', folderId);
  if (settings.repo !== undefined) p.setProperty('REPO', String(settings.repo || REPO_DEFAULT));
  return getStatus();
}

function listByStatus_(status) {
  requireOwner_();
  var out = [];
  rows_().slice().reverse().forEach(function (r) {
    if (String(r[COL.status]) === status) out.push(rowObj_(r));
  });
  return out.slice(0, 100);
}
function listPending() { return listByStatus_('pending'); }
function listApproved() { return listByStatus_('approved'); }

function getPreview(id) {
  requireOwner_();
  var found = findRow_(id);
  if (!found) throw new Error('Submission not found.');
  var row = rowObj_(found.values);
  if (row.type === 'youtube') {
    return { type: 'youtube', youtubeId: row.youtubeId, youtubeUrl: row.youtubeUrl, title: row.title, gameName: row.gameName };
  }
  var file = DriveApp.getFileById(row.fileId);
  var size = file.getSize();
  if (size > PREVIEW_MAX_BYTES) {
    return { type: row.type, driveUrl: file.getUrl(), title: row.title, gameName: row.gameName, tooBig: true, size: size };
  }
  var blob = file.getBlob();
  var mime = row.type === 'music'
    ? (extOf_(row.fileName) === 'm4a' ? 'audio/mp4' : 'audio/mpeg')
    : blob.getContentType();
  return {
    type: row.type, size: size, title: row.title, gameName: row.gameName,
    dataUrl: 'data:' + mime + ';base64,' + Utilities.base64Encode(blob.getBytes())
  };
}

function approveSubmission(id, edits) {
  requireOwner_();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('The approval service is busy. Please try again.');
  try {
    edits = edits || {};
    var found = findRow_(id);
    if (!found) throw new Error('Submission not found.');
    var row = rowObj_(found.values);
    if (row.status === 'approved' && row.publishedPath) {
      return { ok: true, already: true, id: id, path: row.publishedPath, commit: row.publishedCommit, liveUrl: liveUrl_(row.publishedPath), note: 'This submission was already approved.' };
    }
    if (row.status !== 'pending') throw new Error('Only pending submissions can be approved (current status: ' + row.status + ').');
    var title = text_(edits.title, 120) || row.title;
    var gameName = text_(edits.gameName, 40) || row.gameName;
    var creatorId = slug_(gameName);
    var commitMsg = 'Publish approved ' + row.type + ': ' + title + ' by ' + gameName + ' (submission ' + id + ')';
    var path = '', commit = null;

    if (row.type === 'music' || row.type === 'fanart') {
      var driveFile = DriveApp.getFileById(row.fileId);
      var bytes = driveFile.getBlob().getBytes();
      var ext = extOf_(row.fileName);
      var size = repoSizeMB_();
      if (size.sizeMB + bytes.length / 1048576 > size.limitMB) {
        throw new Error('Publishing this file would take the site past its ' + size.limitMB + ' MB safety limit (currently ' + size.sizeMB + ' MB). Free up space or raise the limit in Settings.');
      }
      var base = slug_(title) || 'untitled';
      if (row.type === 'music') {
        path = 'media/' + creatorId + '/' + id.slice(0, 8) + '-' + base + '.' + ext;
        var media = getJsonFile_('media.json', { music: [], videos: [] });
        media.music = media.music || [];
        var already = false;
        media.music.forEach(function (pl) { (pl.tracks || []).forEach(function (t) { if (t.submissionId === id) already = true; }); });
        if (already) throw new Error('This submission is already listed in media.json.');
        var pl = null;
        media.music.forEach(function (p) { if (p.creatorId === creatorId) pl = p; });
        if (!pl) { pl = { creatorId: creatorId, creator: gameName, member: creatorId, tracks: [] }; media.music.push(pl); }
        else { pl.creator = gameName; }
        pl.tracks.push({ type: 'audio', title: title, src: path, submissionId: id });
        ghPutFile_(path, Utilities.base64Encode(bytes), commitMsg);
        commit = putJsonFile_('media.json', media, commitMsg);
      } else {
        path = 'fanart/' + id.slice(0, 8) + '-' + base + '.' + ext;
        var fan = getJsonFile_('fanart.json', { art: [] });
        fan.art = fan.art || [];
        var fanAlready = false;
        fan.art.forEach(function (a) { if (a.submissionId === id) fanAlready = true; });
        if (fanAlready) throw new Error('This submission is already listed in fanart.json.');
        fan.art.push({ title: title, creator: gameName, description: row.description || '', src: path, submissionId: id, approved: new Date().toISOString().slice(0, 10) });
        ghPutFile_(path, Utilities.base64Encode(bytes), commitMsg);
        commit = putJsonFile_('fanart.json', fan, commitMsg);
      }
    } else {
      // YouTube link: no file to move; the video is listed in media.json.
      var media2 = getJsonFile_('media.json', { music: [], videos: [] });
      media2.videos = media2.videos || [];
      var dup = false;
      media2.videos.forEach(function (g) { (g.items || []).forEach(function (it) { if (it.youtubeId === row.youtubeId) dup = true; }); });
      if (dup) throw new Error('That video is already listed in media.json.');
      var group = null;
      media2.videos.forEach(function (g) { if (g.creatorId === creatorId) group = g; });
      if (!group) { group = { creatorId: creatorId, creator: gameName, member: creatorId, items: [] }; media2.videos.push(group); }
      else { group.creator = gameName; }
      var item = { type: 'youtube', youtubeId: row.youtubeId, title: title, format: /\/shorts\//.test(row.youtubeUrl || '') ? 'short' : 'video', submissionId: id };
      var meta = ytVideo_(row.youtubeId);
      if (meta) { if (meta.published) item.published = meta.published; if (meta.duration) item.duration = meta.duration; }
      group.items.unshift(item); // newest first
      commit = putJsonFile_('media.json', media2, commitMsg);
      path = 'media.json';
    }

    setRowFields_(found.row, {
      title: title, gameName: gameName, status: 'approved',
      publishedPath: path, publishedCommit: commit.commit.sha, approvedAt: new Date()
    });
    return {
      ok: true, id: id, path: path, commit: commit.commit.sha, liveUrl: liveUrl_(path),
      note: 'Approved. GitHub Pages usually takes 1–2 minutes to publish — use Check live to confirm it is actually serving.'
    };
  } finally {
    lock.releaseLock();
  }
}

function rejectSubmission(id, reason) {
  requireOwner_();
  var found = findRow_(id);
  if (!found) throw new Error('Submission not found.');
  var row = rowObj_(found.values);
  if (row.status !== 'pending') throw new Error('Only pending submissions can be rejected (current status: ' + row.status + ').');
  setRowFields_(found.row, { status: 'rejected', reviewNote: text_(reason, 300) });
  return { ok: true, id: id };
}

function unpublishSubmission(id) {
  requireOwner_();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('The approval service is busy. Please try again.');
  try {
    var found = findRow_(id);
    if (!found) throw new Error('Submission not found.');
    var row = rowObj_(found.values);
    if (row.status !== 'approved') throw new Error('Only approved submissions can be unpublished (current status: ' + row.status + ').');
    var path = row.publishedPath;
    if (row.type === 'music') {
      var media = getJsonFile_('media.json', { music: [], videos: [] });
      (media.music || []).forEach(function (pl) { pl.tracks = (pl.tracks || []).filter(function (t) { return t.submissionId !== id; }); });
      putJsonFile_('media.json', media, 'Unpublish: ' + row.title + ' by ' + row.gameName + ' (submission ' + id + ')');
      var f = ghGetFile_(path);
      if (f) ghDeleteFile_(path, 'Unpublish: remove ' + path + ' (submission ' + id + ')', f.sha);
    } else if (row.type === 'fanart') {
      var fan = getJsonFile_('fanart.json', { art: [] });
      fan.art = (fan.art || []).filter(function (a) { return a.submissionId !== id; });
      putJsonFile_('fanart.json', fan, 'Unpublish: ' + row.title + ' by ' + row.gameName + ' (submission ' + id + ')');
      var f2 = ghGetFile_(path);
      if (f2) ghDeleteFile_(path, 'Unpublish: remove ' + path + ' (submission ' + id + ')', f2.sha);
    } else {
      var media2 = getJsonFile_('media.json', { music: [], videos: [] });
      (media2.videos || []).forEach(function (g) { g.items = (g.items || []).filter(function (it) { return it.submissionId !== id; }); });
      putJsonFile_('media.json', media2, 'Unpublish: ' + row.title + ' by ' + row.gameName + ' (submission ' + id + ')');
    }
    setRowFields_(found.row, { status: 'unpublished', reviewNote: 'Unpublished by owner' });
    return { ok: true, id: id };
  } finally {
    lock.releaseLock();
  }
}

function checkLive(path) {
  requireOwner_();
  var url = liveUrl_(path);
  var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, headers: { Range: 'bytes=0-0' } });
  var code = res.getResponseCode();
  return { ok: true, live: code === 200 || code === 206, code: code, url: url };
}

// ---- YouTube playlist sync (ordinary scheduled code; runs once a day when enabled) ----
function syncPlaylists() {
  requireOwner_();
  var key = props_().getProperty('YOUTUBE_API_KEY');
  if (!key) throw new Error('YouTube API key is not set. Add it in Settings to enable playlist sync.');
  var lists = getPlaylists_();
  if (!lists.length) return { ok: true, added: 0, message: 'No playlists configured. Add playlist IDs in Settings first.' };
  var media = getJsonFile_('media.json', { music: [], videos: [] });
  media.videos = media.videos || [];
  var known = {};
  media.videos.forEach(function (g) { (g.items || []).forEach(function (it) { if (it.youtubeId) known[it.youtubeId] = true; }); });
  var added = [];
  lists.forEach(function (cfg) {
    if (!cfg.playlistId || !cfg.creatorId || !cfg.creator) return;
    var items = ytPlaylistItems_(cfg.playlistId, key);
    var group = null;
    media.videos.forEach(function (g) { if (g.creatorId === cfg.creatorId) group = g; });
    if (!group) {
      group = { creatorId: cfg.creatorId, creator: cfg.creator, member: cfg.member || cfg.creatorId, channel: cfg.channel || '', channelUrl: cfg.channelUrl || '', items: [] };
      media.videos.push(group);
    }
    items.forEach(function (it) {
      if (known[it.youtubeId]) return;
      known[it.youtubeId] = true;
      group.items.push({ type: 'youtube', youtubeId: it.youtubeId, title: it.title, format: 'video', published: it.published, playlistSync: true });
      added.push(it.youtubeId);
    });
    group.items.sort(function (a, b) { return String(b.published || '') < String(a.published || '') ? -1 : 1; });
  });
  if (!added.length) return { ok: true, added: 0, message: 'No new videos found in the configured playlists.' };
  var commit = putJsonFile_('media.json', media, 'Sync YouTube playlists: add ' + added.length + ' video(s)');
  return { ok: true, added: added.length, commit: commit.commit.sha, message: added.length + ' new video(s) added to media.json.' };
}

function installSyncTrigger() {
  requireOwner_();
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'syncPlaylists') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('syncPlaylists').timeBased().everyDays(1).atHour(9).create();
  return { ok: true, message: 'Daily playlist sync is on (runs about 9 AM owner time). It only adds videos once playlist IDs are configured in Settings.' };
}
