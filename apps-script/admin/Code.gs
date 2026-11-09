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
 * - Hourly YouTube channel sync (ordinary time trigger, not an AI run). Reads the
 *   public Videos and Shorts tabs of the owner-trusted creator channels (no API key)
 *   and publishes new uploads to media.json. Key-backed playlist sync stays optional.
 *
 * Script Properties (Project Settings > Script Properties, or the Settings panel here):
 *   OWNER_EMAIL       — set automatically to the deploying account on first use.
 *   GITHUB_TOKEN      — fine-grained PAT with Contents: read/write on Conq86/alliance-roster only.
 *                       Server-side only; never returned to the browser.
 *   DRIVE_FOLDER_ID / SHEET_ID — created by setupDrive() (same folder/Sheet the
 *                       Submissions project uses; paste the IDs into that project too).
 *   YOUTUBE_API_KEY   — optional, for playlist sync and video metadata.
 *   PLAYLISTS         — optional JSON array: [{playlistId, creatorId, creator, member, channel, channelUrl}].
 *   CHANNELS          — optional JSON array: [{channelId, creatorId, since?, creator?, member?, channel?, channelUrl?}].
 *                       When unset, TRUSTED_CHANNELS (MED, POW Ruthless) are synced.
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

function sha256Hex_(bytes) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes)
    .map(function (b) { var v = b & 0xFF; return (v < 16 ? '0' : '') + v.toString(16); }).join('');
}

// Problem with a stored/published copy versus the size and SHA-256 recorded at submission,
// or '' when the bytes match. Empty files are never acceptable.
function bytesProblem_(bytes, row) {
  if (!bytes || !bytes.length) return 'the file is empty (0 bytes)';
  var size = Number(row.fileSize) || 0;
  if (size && bytes.length !== size) return 'the file is ' + bytes.length + ' bytes but ' + size + ' bytes were submitted';
  if (row.sha256 && sha256Hex_(bytes) !== String(row.sha256)) return 'the file contents do not match what was submitted (SHA-256 differs)';
  return '';
}

// Reads the private Drive original and refuses to hand back empty or mismatched bytes.
function storedBytes_(row) {
  var bytes = DriveApp.getFileById(row.fileId).getBlob().getBytes();
  var problem = bytesProblem_(bytes, row);
  if (problem) throw new Error('The stored file for this submission is damaged: ' + problem + '. Reject it and ask the member to submit again.');
  return bytes;
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
    channels: (function () { try { return getChannels_(); } catch (e) { return { error: String(e.message) }; } })(),
    lastSync: (function () { try { return JSON.parse(props_().getProperty('LAST_SYNC') || 'null'); } catch (e) { return null; } })(),
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
  var bytes = storedBytes_(row);
  var mime = row.type === 'music'
    ? (extOf_(row.fileName) === 'm4a' ? 'audio/mp4' : 'audio/mpeg')
    : file.getMimeType();
  return {
    type: row.type, size: bytes.length, title: row.title, gameName: row.gameName,
    dataUrl: 'data:' + mime + ';base64,' + Utilities.base64Encode(bytes)
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
      var bytes = storedBytes_(row); // never publish an empty or mismatched copy
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
  path = String(path || '');
  if (path.indexOf('media/') !== 0 && path.indexOf('fanart/') !== 0) {
    // media.json listing (YouTube links): the page answering is the check.
    var url = liveUrl_(path);
    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, headers: { Range: 'bytes=0-0' } });
    var code = res.getResponseCode();
    return { ok: true, live: code === 200 || code === 206, code: code, url: url };
  }
  // Music / fan art: fetch the published file itself and require the submitted bytes.
  // HTTP 200 alone is not proof — an empty or wrong file also answers 200.
  var row = null;
  rows_().forEach(function (r) {
    if (String(r[COL.publishedPath]) === path && String(r[COL.status]) === 'approved') row = rowObj_(r);
  });
  var fileUrl = SITE_BASE + path;
  var fileRes = UrlFetchApp.fetch(fileUrl + '?check=' + Date.now(), { muteHttpExceptions: true, followRedirects: true });
  var fileCode = fileRes.getResponseCode();
  if (fileCode !== 200) return { ok: true, live: false, code: fileCode, url: fileUrl };
  var problem = bytesProblem_(fileRes.getContent(), row || {});
  return { ok: true, live: !problem, code: fileCode, url: fileUrl, problem: problem };
}

// ---- YouTube sync (ordinary scheduled code; runs hourly when enabled) ----
// Owner-trusted creator channels: their new uploads publish to media.json without the
// approval queue (owner-authorized). Everything else still needs approval. MED uploads
// before 2026-10-10 were never approved, so that backlog is not imported.
var TRUSTED_CHANNELS = [
  { channelId: 'UCJRuTu8UfGlM40IjvAc4N9Q', creatorId: 'med', since: '2026-10-10' },
  { channelId: 'UC-AlzeeDBHbfnrjjlpC-Gng', creatorId: 'ruthless' }
];

function getChannels_() {
  var raw = props_().getProperty('CHANNELS');
  if (!raw) return TRUSTED_CHANNELS;
  var list = JSON.parse(raw);
  if (!Array.isArray(list)) throw new Error('CHANNELS must be a JSON array.');
  return list;
}

function ytFetch_(url) {
  var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true, headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9'
  } });
  if (res.getResponseCode() !== 200) throw new Error(url + ' returned HTTP ' + res.getResponseCode());
  return res.getContentText();
}

// Short description of a page that lacked ytInitialData, for the sync error message.
function ytPageHint_(html) {
  var t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  var title = t ? t[1].replace(/\s+/g, ' ').trim().slice(0, 80) : '(no title)';
  var kind = /consent\.(youtube|google)\.com|Before you continue/i.test(html) ? 'consent page'
    : /not a bot|unusual traffic|\/sorry\/|captcha/i.test(html) ? 'bot check page' : 'other page';
  var at = html.indexOf('ytInitialData');
  var near = at < 0 ? 'ytInitialData marker absent'
    : 'ytInitialData at ' + at + ': ' + JSON.stringify(html.slice(Math.max(0, at - 100), at + 113).replace(/\s+/g, ' '));
  return 'title "' + title + '", ' + kind + ', ' + html.length + ' chars, ' + near;
}

// Pulls a JSON object assigned in a page script: var/let/const/bare/window.x/window["x"] = {...}
// or = '\x7b...' (JS-escaped string). Returns null if absent or unparseable.
function ytJson_(html, name) {
  var re = new RegExp('(?:^|[^\\w$.\'"])(?:(?:var|let|const)\\s+|window\\.|window\\[["\'])?' + name + '(?:["\']\\])?\\s*=\\s*([{\'])', 'g');
  var m;
  while ((m = re.exec(html))) {
    var start = m.index + m[0].length - 1, q = m[1] === '{' ? '"' : '\'', depth = 0, inStr = q === '\'';
    for (var i = m[1] === '{' ? start : start + 1; i < html.length; i++) {
      var c = html.charAt(i);
      if (inStr) {
        if (c === '\\') i++;
        else if (c === q) {
          if (q === '\'') return ytParse_(ytUnescape_(html.slice(start + 1, i)));
          inStr = false;
        }
      }
      else if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) return ytParse_(html.slice(start, i + 1));
    }
  }
  return null;
}

// JSON.parse without letting a huge payload end up in an error message.
function ytParse_(s) {
  try { return JSON.parse(s); } catch (e) { return null; }
}

// Decodes a JS single-quoted string body (\xHH, \uHHHH, \', \/ ...) into plain text.
function ytUnescape_(s) {
  return s.replace(/\\(x([0-9a-fA-F]{2})|u([0-9a-fA-F]{4})|([\s\S]))/g, function (_, all, x, u, ch) {
    if (x) return String.fromCharCode(parseInt(x, 16));
    if (u) return String.fromCharCode(parseInt(u, 16));
    return ch === 'n' ? '\n' : ch === 't' ? '\t' : ch === 'r' ? '\r' : ch;
  });
}

// Newest-first uploads from one tab ('videos' or 'shorts') of exactly this channel.
function ytChannelTab_(channelId, tab) {
  var html = ytFetch_('https://www.youtube.com/channel/' + channelId + '/' + tab + '?hl=en&gl=US');
  var data = ytJson_(html, 'ytInitialData');
  if (!data) throw new Error(tab + ': page data not found (' + ytPageHint_(html) + ')');
  var meta = data.metadata && data.metadata.channelMetadataRenderer;
  if (!meta || meta.externalId !== channelId) throw new Error(tab + ': page is not channel ' + channelId);
  var grid = null;
  var tabs = (data.contents && data.contents.twoColumnBrowseResultsRenderer && data.contents.twoColumnBrowseResultsRenderer.tabs) || [];
  tabs.forEach(function (t) {
    var r = t.tabRenderer;
    var url = r && r.endpoint && r.endpoint.commandMetadata && r.endpoint.commandMetadata.webCommandMetadata.url;
    if (r && r.selected && r.content && String(url || '').slice(-(tab.length + 1)) === '/' + tab) grid = r.content.richGridRenderer;
  });
  if (!grid) throw new Error(tab + ': upload grid not found');
  var out = [];
  (grid.contents || []).slice(0, 50).forEach(function (x) {
    var c = x.richItemRenderer && x.richItemRenderer.content;
    var id = '', title = '';
    if (c && c.lockupViewModel && c.lockupViewModel.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO') {
      id = c.lockupViewModel.contentId;
      var md = c.lockupViewModel.metadata && c.lockupViewModel.metadata.lockupMetadataViewModel;
      title = md && md.title && md.title.content;
    } else if (c && c.shortsLockupViewModel) {
      var cmd = c.shortsLockupViewModel.onTap && c.shortsLockupViewModel.onTap.innertubeCommand;
      var pt = c.shortsLockupViewModel.overlayMetadata && c.shortsLockupViewModel.overlayMetadata.primaryText;
      id = cmd && cmd.reelWatchEndpoint && cmd.reelWatchEndpoint.videoId;
      title = pt && pt.content;
    }
    if (/^[A-Za-z0-9_-]{11}$/.test(id || '')) out.push({ youtubeId: id, title: text_(title, 300), format: tab === 'shorts' ? 'short' : 'video' });
  });
  return out;
}

// Real upload date, length and owning channel from the video's own watch page.
function ytWatchMeta_(videoId) {
  try {
    var p = ytJson_(ytFetch_('https://www.youtube.com/watch?v=' + videoId + '&hl=en&gl=US'), 'ytInitialPlayerResponse');
    var v = p && p.videoDetails, mf = p && p.microformat && p.microformat.playerMicroformatRenderer;
    if (!v || !mf || v.videoId !== videoId) return null;
    var published = String(mf.publishDate || mf.uploadDate || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(published)) return null;
    return { channelId: v.channelId, title: text_(v.title, 300), published: published, duration: parseInt(v.lengthSeconds, 10) || 0, live: !!(v.isUpcoming || v.isLive) };
  } catch (e) { return null; }
}

function syncChannels_(media, known) {
  var added = [], notes = [];
  // Read every channel first; an unusable channel aborts before media.json changes.
  var plans = getChannels_().map(function (cfg) {
    if (!cfg.channelId || !cfg.creatorId) throw new Error('Each channel needs channelId and creatorId.');
    var group = null;
    media.videos.forEach(function (g) { if (g.creatorId === cfg.creatorId) group = g; });
    if (!group && !cfg.creator) throw new Error('media.json has no creator "' + cfg.creatorId + '" for channel ' + cfg.channelId + '. Nothing was changed.');
    var entries = [], errors = [];
    ['videos', 'shorts'].forEach(function (tab) {
      try { entries = entries.concat(ytChannelTab_(cfg.channelId, tab)); }
      catch (e) { errors.push(e.message); }
    });
    if (!entries.length) throw new Error('Channel ' + cfg.creatorId + ' (' + cfg.channelId + '): no usable uploads on Videos or Shorts (' + (errors.join('; ') || 'both tabs empty') + '). Nothing was changed.');
    if (errors.length) notes.push(cfg.creatorId + ' ' + errors.join('; '));
    return { cfg: cfg, group: group, entries: entries };
  });
  plans.forEach(function (plan) {
    var cfg = plan.cfg, older = {};
    plan.entries.forEach(function (it) {
      if (known[it.youtubeId] || older[it.format]) return;
      var meta = ytWatchMeta_(it.youtubeId);
      if (!meta) { notes.push(it.youtubeId + ' skipped (upload date unavailable; retried next run)'); return; }
      if (meta.channelId !== cfg.channelId) { known[it.youtubeId] = true; notes.push(it.youtubeId + ' skipped (owned by another channel)'); return; }
      if (meta.live) return;
      if (cfg.since && meta.published < cfg.since) { older[it.format] = true; return; } // tabs are newest first: the rest is older backlog
      if (!plan.group) {
        plan.group = { creatorId: cfg.creatorId, creator: cfg.creator, member: cfg.member || cfg.creatorId, channel: cfg.channel || '', channelUrl: cfg.channelUrl || '', items: [] };
        media.videos.push(plan.group);
      }
      var item = { type: 'youtube', youtubeId: it.youtubeId, title: it.title || meta.title || it.youtubeId, format: it.format, published: meta.published };
      if (meta.duration) item.duration = meta.duration;
      item.channelSync = true;
      // Insert newest first without reordering existing entries.
      var items = plan.group.items = plan.group.items || [], at = 0;
      while (at < items.length && String(items[at].published || '') > item.published) at++;
      items.splice(at, 0, item);
      known[it.youtubeId] = true;
      added.push(it.youtubeId);
    });
  });
  return { added: added, notes: notes, channels: plans.length };
}

// Optional key-backed mode: custom playlists configured in Settings.
function syncPlaylistItems_(media, known, key, lists) {
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
  return added;
}

// Owner via the web app, or this project's own installed trigger (e.triggerUid).
function requireOwnerOrTrigger_(e) {
  var uid = e && e.triggerUid;
  if (uid && ScriptApp.getProjectTriggers().some(function (t) { return t.getUniqueId() === String(uid); })) return;
  requireOwner_();
}

function syncPlaylists(e) {
  requireOwnerOrTrigger_(e);
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('An approval or sync is already running. Please try again.');
  var result = null;
  try {
    var media = getJsonFile_('media.json', null);
    if (!media || !Array.isArray(media.videos)) throw new Error('media.json could not be read. Nothing was changed.');
    var known = {};
    media.videos.forEach(function (g) { (g.items || []).forEach(function (it) { if (it.youtubeId) known[it.youtubeId] = true; }); });
    var ch = syncChannels_(media, known);
    var added = ch.added;
    var key = props_().getProperty('YOUTUBE_API_KEY'), lists = getPlaylists_();
    if (key && lists.length) added = added.concat(syncPlaylistItems_(media, known, key, lists));
    var notes = ch.notes.length ? ' Notes: ' + ch.notes.join(' | ') : '';
    if (!added.length) {
      result = { ok: true, added: 0, message: 'Checked ' + ch.channels + ' channel(s): no new uploads.' + notes };
    } else {
      var commit = putJsonFile_('media.json', media, 'Sync YouTube channels: add ' + added.length + ' video(s): ' + added.join(', '));
      result = { ok: true, added: added.length, ids: added, commit: commit.commit.sha, message: added.length + ' new video(s) added to media.json: ' + added.join(', ') + '.' + notes };
    }
  } catch (err) {
    result = { ok: false, message: String(err.message) };
    throw err;
  } finally {
    props_().setProperty('LAST_SYNC', JSON.stringify({ at: new Date().toISOString(), ok: !!(result && result.ok), message: result ? result.message : 'Sync stopped unexpectedly.' }));
    lock.releaseLock();
  }
  return result;
}

function installSyncTrigger() {
  requireOwner_();
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'syncPlaylists') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('syncPlaylists').timeBased().everyHours(1).create();
  return { ok: true, message: 'Hourly YouTube sync is on. New uploads from the configured channels are added to media.json automatically.' };
}
