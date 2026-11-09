/**
 * POW 713 Alliance — public submissions endpoint.
 *
 * What it does: accepts anonymous member submissions (music, fan art, YouTube links)
 * from the Submit tab on https://conq86.github.io/alliance-roster/ and stores them
 * PRIVATELY in the owner's Google Drive folder + a tracking Sheet. It never publishes
 * anything and never lists submissions. Approval and publishing happen only in the
 * separate owner-only Admin project (apps-script/admin).
 *
 * Deploy as a web app: Execute as = Me (the owner). Who has access = Anyone.
 * The endpoint URL goes into submit.js as SUBMIT_ENDPOINT.
 *
 * Script Properties (Project Settings > Script Properties):
 *   DRIVE_FOLDER_ID — private Drive folder for submitted originals (created by Admin setupDrive).
 *   SHEET_ID        — tracking Sheet (same one the Admin project uses).
 *
 * Security notes:
 * - No credentials live in this file. The only secrets are the two IDs above, which are
 *   not sensitive on their own: the folder and Sheet stay private to the owner's account.
 * - File type and size are validated here, server-side, including magic-byte checks.
 * - Spam protection is proportionate: a honeypot field, a daily submission cap, a
 *   per-name cap, and duplicate detection by file hash. Apps Script does not expose the
 *   visitor's IP to doPost, so IP-based limiting is not possible here.
 * - The site posts a url-encoded form through a hidden iframe. The file travels as a
 *   base64 text field (fileData) plus fileName; GAS form posts do not deliver file Blobs.
 *   This script answers with a tiny HTML page that postMessages the result to the site
 *   (window.top, exact SITE_ORIGIN). XFrameOptionsMode.ALLOWALL is required for that page
 *   to load in the iframe; the page contains only a JSON payload.
 */

// ---- Configuration ----
var MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB per file
var MAX_BASE64_CHARS = Math.ceil(MAX_FILE_BYTES / 3) * 4;
var BASE64_RE = /^[A-Za-z0-9+\/]*={0,2}$/;
var SITE_ORIGIN = 'https://conq86.github.io'; // the only page allowed to receive answers
var DAILY_CAP = 50;                     // submissions per day, all members
var PER_NAME_CAP = 10;                  // submissions per day, per game name
var MUSIC_EXTS = { mp3: 'audio/mpeg', m4a: 'audio/mp4' };
var ART_EXTS = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
// Keep these columns identical to the Admin project's SHEET_HEADERS.
var SHEET_HEADERS = ['id', 'submittedAt', 'type', 'gameName', 'title', 'description',
  'fileName', 'fileId', 'fileSize', 'sha256', 'youtubeId', 'youtubeUrl', 'status',
  'publishedPath', 'publishedCommit', 'reviewNote', 'approvedAt'];
var COL = {};
SHEET_HEADERS.forEach(function (h, i) { COL[h] = i; });
var YOUTUBE_RE = /^(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?[^#]*v=|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})(?:[?&#].*)?$/;

// ---- Small helpers ----
function props_() { return PropertiesService.getScriptProperties(); }

function fail_(message) { throw new Error(message); }

function text_(value, max) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
}

function hex_(bytes) {
  return bytes.map(function (b) { var v = b & 0xFF; return (v < 16 ? '0' : '') + v.toString(16); }).join('');
}

function sha256Hex_(bytes) {
  return hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes));
}

function folder_() {
  var id = props_().getProperty('DRIVE_FOLDER_ID');
  if (!id) fail_('Submissions are not configured yet.');
  return DriveApp.getFolderById(id);
}

function sheet_() {
  var id = props_().getProperty('SHEET_ID');
  if (!id) fail_('Submissions are not configured yet.');
  var ss = SpreadsheetApp.openById(id);
  var sh = ss.getSheetByName('Submissions') || ss.getSheets()[0];
  if (sh.getLastRow() === 0) sh.appendRow(SHEET_HEADERS);
  return sh;
}

function rows_() {
  var sh = sheet_();
  var last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, SHEET_HEADERS.length).getValues();
}

function extOf_(name) {
  var parts = String(name || '').split('.');
  return parts.length > 1 ? parts.pop().toLowerCase() : '';
}

// Magic-byte check: extension alone is not proof of file type.
function magicOk_(bytes, ext) {
  var b = function (i) { return bytes.length > i ? bytes[i] & 0xFF : -1; };
  if (ext === 'png') return b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4E && b(3) === 0x47;
  if (ext === 'jpg' || ext === 'jpeg') return b(0) === 0xFF && b(1) === 0xD8 && b(2) === 0xFF;
  if (ext === 'webp') return b(0) === 0x52 && b(1) === 0x49 && b(2) === 0x46 && b(3) === 0x46 && b(8) === 0x57 && b(9) === 0x45 && b(10) === 0x42 && b(11) === 0x50;
  if (ext === 'mp3') return (b(0) === 0x49 && b(1) === 0x44 && b(2) === 0x33) || (b(0) === 0xFF && (b(1) & 0xE0) === 0xE0);
  if (ext === 'm4a') return b(4) === 0x66 && b(5) === 0x74 && b(6) === 0x79 && b(7) === 0x70; // 'ftyp' at offset 4
  return false;
}

// Writes the decoded bytes to the private folder, then reads the Drive copy back and
// requires the same byte length and SHA-256 as the upload. A copy that does not match
// is trashed and the submission fails, so a pending row always points at real bytes.
function storeVerified_(bytes, mime, storedName, expectedSize, expectedSha) {
  var blob = Utilities.newBlob('');
  blob.setBytes(bytes);
  blob.setContentType(mime);
  blob.setName(storedName);
  if (blob.getBytes().length !== expectedSize) fail_('The file could not be prepared for saving. Nothing was saved. Please try again.');
  var file = folder_().createFile(blob);
  var saved = [];
  try { saved = DriveApp.getFileById(file.getId()).getBlob().getBytes(); } catch (ignore) {}
  if (saved.length !== expectedSize || sha256Hex_(saved) !== expectedSha) {
    try { file.setTrashed(true); } catch (ignore) {}
    fail_('The file could not be saved intact. Nothing was saved. Please try again.');
  }
  return file.getId();
}

function safeName_(name) {
  return String(name || 'file')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'file';
}

// ---- Web app entry points ----
function doGet(e) {
  var q = (e && e.parameter) || {};
  // Handshake for the Submit tab: proves the web app itself answered (not a Google error page).
  if (q.action === 'ping') return answer_({ ok: true, ping: true, nonce: text_(q.nonce, 64) });
  var out = { ok: true, service: 'alliance-submissions', version: 1 };
  return ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var nonce = '';
  try {
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) fail_('The submission service is busy. Please try again.');
    try {
      var p = (e && e.parameter) || {};
      nonce = text_(p.nonce, 64);
      if (p.action !== 'submit') fail_('Bad request.');
      if (p.website) fail_('That did not go through. Please try again.'); // honeypot
      var type = text_(p.type, 20);
      if (type !== 'music' && type !== 'fanart' && type !== 'youtube') fail_('Choose Music, Fan Art or YouTube video link.');
      var gameName = text_(p.gameName, 40);
      if (!gameName) fail_('Enter your game name.');
      var title = text_(p.title, 120);
      if (!title) fail_('Enter a title.');
      var description = text_(p.description, 500);

      var bytes = null, mime = '', fileName = '', fileSize = 0, sha = '', youtubeId = '', youtubeUrl = '';
      if (type === 'youtube') {
        youtubeUrl = text_(p.youtubeUrl, 300);
        var m = YOUTUBE_RE.exec(youtubeUrl);
        if (!m) fail_('Paste a valid YouTube watch or Shorts link.');
        youtubeId = m[1];
      } else {
        var data = p.fileData;
        if (typeof data !== 'string' || !data) fail_('Choose a file to upload.');
        if (data.length > MAX_BASE64_CHARS) fail_('That file is over the 25 MB limit.');
        if (data.length % 4 !== 0 || !BASE64_RE.test(data)) fail_('The file did not arrive intact. Please try again.');
        fileName = text_(p.fileName, 200);
        var ext = extOf_(fileName);
        var allowed = type === 'music' ? MUSIC_EXTS : ART_EXTS;
        if (!allowed[ext]) fail_(type === 'music' ? 'Music must be an MP3 or M4A file.' : 'Fan art must be a PNG, JPG or WebP file.');
        bytes = Utilities.base64Decode(data);
        if (!bytes.length) fail_('That file looks empty.');
        if (bytes.length > MAX_FILE_BYTES) fail_('That file is over the 25 MB limit.');
        if (!magicOk_(bytes, ext)) fail_('That file does not look like a real .' + ext + ' file.');
        // MIME comes from the validated extension, never from the client.
        mime = allowed[ext];
        fileSize = bytes.length;
        sha = sha256Hex_(bytes);
      }

      var id = Utilities.getUuid();
      var now = new Date();
      var today = now.toDateString();
      var existing = rows_();
      var dayCount = 0, nameCount = 0;
      for (var i = 0; i < existing.length; i++) {
        var row = existing[i];
        if (sha && row[COL.sha256] === sha && (row[COL.status] === 'pending' || row[COL.status] === 'approved')) {
          return answer_({ ok: true, id: row[COL.id], duplicate: true, nonce: nonce });
        }
        if (youtubeId && row[COL.youtubeId] === youtubeId && (row[COL.status] === 'pending' || row[COL.status] === 'approved')) {
          return answer_({ ok: true, id: row[COL.id], duplicate: true, nonce: nonce });
        }
        if (row[COL.submittedAt] && new Date(row[COL.submittedAt]).toDateString() === today) {
          dayCount++;
          if (String(row[COL.gameName]).toLowerCase() === gameName.toLowerCase()) nameCount++;
        }
      }
      if (dayCount >= DAILY_CAP) fail_('The daily submission limit has been reached. Please try again tomorrow.');
      if (nameCount >= PER_NAME_CAP) fail_('That game name has reached the daily submission limit. Please try again tomorrow.');

      var storedName = '';
      var fileId = '';
      if (bytes) {
        storedName = id + '_' + safeName_(fileName);
        fileId = storeVerified_(bytes, mime, storedName, fileSize, sha);
      }
      var values = [];
      values[COL.id] = id;
      values[COL.submittedAt] = now;
      values[COL.type] = type;
      values[COL.gameName] = gameName;
      values[COL.title] = title;
      values[COL.description] = description;
      values[COL.fileName] = storedName || fileName;
      values[COL.fileId] = fileId;
      values[COL.fileSize] = fileSize;
      values[COL.sha256] = sha;
      values[COL.youtubeId] = youtubeId;
      values[COL.youtubeUrl] = youtubeUrl;
      values[COL.status] = 'pending';
      values[COL.publishedPath] = '';
      values[COL.publishedCommit] = '';
      values[COL.reviewNote] = '';
      values[COL.approvedAt] = '';
      try {
        sheet_().appendRow(values);
      } catch (appendErr) {
        // Never leave an untracked upload behind: trash only the file created above.
        if (fileId) { try { DriveApp.getFileById(fileId).setTrashed(true); } catch (ignore) {} }
        fail_('The submission could not be recorded. Nothing was saved. Please try again.');
      }
      return answer_({ ok: true, id: id, nonce: nonce });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return answer_({ ok: false, error: String(err && err.message || err), nonce: nonce });
  }
}

// The answer is a tiny page that postMessages the result to the site. The form on the
// site listens for it and only then shows "Submitted — awaiting approval".
function answer_(payload) {
  var json = JSON.stringify(payload).replace(/</g, '\\u003c');
  var html = '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>' +
    // HtmlService nests this page inside a Google wrapper frame, so window.parent is not the
    // site; window.top is. The exact target origin keeps the result from leaking elsewhere.
    '<script>window.top.postMessage(' + json + ', ' + JSON.stringify(SITE_ORIGIN) + ');<\/script>' +
    '</body></html>';
  return HtmlService.createHtmlOutput(html)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
