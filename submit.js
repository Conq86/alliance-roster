(function () {
  'use strict';
  // Member submissions. The form posts to a Google Apps Script web app (see apps-script/submissions/).
  // The form stays disabled until SUBMIT_ENDPOINT is set AND the endpoint answers a ping.
  // Uploads go to a private Drive folder; nothing here publishes anything.
  // The success message is shown ONLY when the backend answers "ok" after storing the file.
  var SUBMIT_ENDPOINT = 'https://script.google.com/macros/s/AKfycby-JgLxCeCKyb6YGkafYtWShhsfaH7LqrfZDt-Nr6o3cyb8XbeIhUBV3gitihr-8N29gg/exec'; // Owner: paste the deployed Submissions web app URL here (https://script.google.com/macros/s/.../exec)
  var MAX_BYTES = 25 * 1024 * 1024;
  var NAME_KEY = 'pow713.gameName';
  var YOUTUBE_URL = /^(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?[^#]*v=|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})(?:[?&#].*)?$/;
  var $ = function (id) { return document.getElementById(id); };
  var hub = $('submitHub'), status = $('submitStatus'), form = $('submitForm'), frame = $('submitFrame');
  var typeRadios = form ? form.querySelectorAll('input[name="type"]') : [];
  var gameName = $('gameName'), title = $('submitTitle'), desc = $('submitDesc');
  var fileField = $('fileField'), linkField = $('linkField'), fileInput = $('fileInput'), youtubeUrl = $('youtubeUrl');
  var fileLabel = $('fileLabel'), submitBtn = $('submitBtn');
  var honeypot = $('honeypot'), nonceInput = $('nonceInput'), actionInput = $('actionInput');
  var active = false, loadState = 'idle', nonce = '', timer = null;

  function showStatus(message, kind) {
    status.hidden = false;
    status.textContent = message;
    status.className = 'submit-status' + (kind ? ' is-' + kind : '');
  }
  function setEnabled(on, message) {
    form.querySelectorAll('input, textarea, button').forEach(function (node) { node.disabled = !on; });
    if (message) showStatus(message, on ? '' : 'error');
  }
  function currentType() {
    var checked = form.querySelector('input[name="type"]:checked');
    return checked ? checked.value : 'music';
  }
  function applyType() {
    var type = currentType();
    var isLink = type === 'youtube';
    fileField.hidden = isLink;
    linkField.hidden = !isLink;
    if (type === 'music') fileLabel.textContent = 'Audio file (MP3 or M4A, up to 25 MB)';
    else if (type === 'fanart') fileLabel.textContent = 'Artwork file (PNG, JPG or WebP, up to 25 MB)';
    fileInput.accept = type === 'music' ? '.mp3,.m4a,audio/mpeg,audio/mp4,audio/x-m4a' : '.png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp';
  }
  function validate() {
    var type = currentType();
    if (!gameName.value.trim() || gameName.value.trim().length > 40) return 'Enter your game name (up to 40 characters).';
    if (!title.value.trim() || title.value.trim().length > 120) return 'Enter a title (up to 120 characters).';
    if (desc.value.length > 500) return 'Keep the description to 500 characters or fewer.';
    if (type === 'youtube') {
      if (!YOUTUBE_URL.test(youtubeUrl.value.trim())) return 'Paste a valid YouTube watch or Shorts link.';
      return '';
    }
    var file = fileInput.files && fileInput.files[0];
    if (!file) return 'Choose a file to upload.';
    var ext = (file.name.split('.').pop() || '').toLowerCase();
    var okExt = type === 'music' ? (ext === 'mp3' || ext === 'm4a') : (ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'webp');
    if (!okExt) return type === 'music' ? 'Music must be an MP3 or M4A file.' : 'Fan art must be a PNG, JPG or WebP file.';
    if (file.size > MAX_BYTES) return 'That file is over the 25 MB limit.';
    if (!file.size) return 'That file looks empty.';
    return '';
  }
  // Reachability ping: loads the endpoint in a hidden frame (no CORS involved).
  // A load means the service answers; a timeout or error means it does not.
  function ping(onResult) {
    var done = false, probe = document.createElement('iframe');
    probe.hidden = true;
    probe.title = 'Submission service check';
    var finish = function (ok) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      probe.remove();
      onResult(ok);
    };
    probe.onload = function () { finish(true); };
    probe.onerror = function () { finish(false); };
    timer = setTimeout(function () { finish(false); }, 15000);
    probe.src = SUBMIT_ENDPOINT;
    document.body.appendChild(probe);
  }
  function onMessage(event) {
    if (!nonce || !event.data || event.data.nonce !== nonce) return;
    if (typeof event.origin !== 'string' || event.origin.indexOf('script.googleusercontent.com') === -1) return;
    clearTimeout(timer);
    window.removeEventListener('message', onMessage);
    submitBtn.disabled = false;
    submitBtn.textContent = 'Submit for approval';
    if (event.data.ok) {
      try { localStorage.setItem(NAME_KEY, gameName.value.trim()); } catch (e) {}
      var text = 'Submitted — awaiting approval.' + (event.data.id ? ' Your submission ID is ' + event.data.id + '.' : '') + ' The owner reviews every submission before anything goes public.';
      showStatus(text, 'ok');
      form.reset();
      try { gameName.value = localStorage.getItem(NAME_KEY) || ''; } catch (e) {}
      applyType();
    } else {
      showStatus('That did not go through: ' + (event.data.error || 'the submission service returned an error.') + ' Nothing was published. Please try again.', 'error');
    }
  }
  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var problem = validate();
    if (problem) { showStatus(problem, 'error'); return; }
    if (honeypot.value) { showStatus('That did not go through. Please try again.', 'error'); return; }
    nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
    nonceInput.value = nonce;
    actionInput.value = 'submit';
    form.action = SUBMIT_ENDPOINT;
    form.target = 'submitFrame';
    window.addEventListener('message', onMessage);
    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending…';
    showStatus('Sending your submission…', '');
    timer = setTimeout(function () {
      window.removeEventListener('message', onMessage);
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit for approval';
      showStatus('The submission service did not answer in time. Nothing was published. Please check your connection and try again.', 'error');
    }, 90000);
    form.submit();
  });
  typeRadios.forEach(function (radio) { radio.addEventListener('change', applyType); });
  gameName.addEventListener('input', function () {
    try { localStorage.setItem(NAME_KEY, gameName.value.trim()); } catch (e) {}
  });

  function header() {
    if (!active) return;
    $('gallerySubtitle').textContent = 'SUBMIT · MEMBER SUBMISSIONS';
    $('galleryArtNote').textContent = 'Reviewed by the owner before anything goes public';
    document.title = 'Submit | POW 713';
  }
  window.AllianceSubmit = {
    show: function () {
      active = true; hub.hidden = false;
      header();
      if (loadState === 'ready') return;
      loadState = 'loading';
      try { gameName.value = localStorage.getItem(NAME_KEY) || ''; } catch (e) {}
      applyType();
      if (!SUBMIT_ENDPOINT) {
        loadState = 'idle';
        setEnabled(false, 'Submissions are not open yet. The owner is still connecting the submission service.');
        return;
      }
      showStatus('Checking the submission service…', '');
      ping(function (ok) {
        loadState = ok ? 'ready' : 'error';
        if (ok) {
          status.hidden = true;
          setEnabled(true);
        } else {
          setEnabled(false, 'The submission service is not responding right now. Nothing can be submitted until the owner reconnects it. Please try again later.');
        }
      });
    },
    hide: function () {
      active = false; hub.hidden = true;
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
    }
  };
})();
