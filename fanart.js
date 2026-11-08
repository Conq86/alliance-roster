(function () {
  'use strict';
  // Fan Art gallery. Content comes only from fanart.json (approved entries, written by the
  // owner approval screen). Nothing here reads pending submissions.
  var $ = function (id) { return document.getElementById(id); };
  var hub = $('fanArtHub'), status = $('fanArtStatus'), grid = $('fanArtGrid'), empty = $('fanArtEmpty');
  var dialog = $('fanArtDialog'), full = $('fanArtFull'), caption = $('fanArtCaption');
  var openLink = $('fanArtOpen'), closeBtn = $('fanArtClose');
  var active = false, loadState = 'idle', count = 0;

  function el(tag, className, content) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (content) node.textContent = content;
    return node;
  }
  function text(value, max) { return typeof value === 'string' && value.trim() ? value.trim().slice(0, max || 200) : ''; }
  // Approved fan art must live under fanart/. Same path rules as the music loader.
  function artSrc(value) {
    var path = typeof value === 'string' ? value.trim() : '';
    var parts = path.split('/');
    if (parts[0] !== 'fanart' || parts.length < 2 || /[\\%?#:]/.test(path) || !/\.(png|jpe?g|webp)$/i.test(path)) return null;
    if (parts.some(function (part) { return !part || part === '.' || part === '..'; })) return null;
    return parts.map(encodeURIComponent).join('/');
  }
  function parse(data) {
    var list = Array.isArray(data && data.art) ? data.art : [];
    return list.map(function (entry, i) {
      var title = text(entry && entry.title, 120), creator = text(entry && entry.creator, 40);
      var src = artSrc(entry && entry.src);
      if (!title || !creator || !src) { console.warn('fanart.json: skipped art[' + i + '] (needs title, creator and src fanart/...)'); return null; }
      return { title: title, creator: creator, description: text(entry.description, 500), src: src };
    }).filter(Boolean);
  }
  function openFull(entry) {
    full.src = entry.src;
    full.alt = entry.title + ' — fan art by ' + entry.creator;
    caption.textContent = entry.title + ' · by ' + entry.creator + (entry.description ? ' — ' + entry.description : '');
    openLink.href = entry.src;
    if (dialog.showModal) dialog.showModal(); else window.open(entry.src, '_blank', 'noopener');
  }
  function render(list) {
    grid.replaceChildren();
    count = list.length;
    list.forEach(function (entry) {
      var card = el('figure', 'fanart-card');
      var button = el('button', 'fanart-thumb');
      button.type = 'button';
      button.setAttribute('aria-label', 'View full size: ' + entry.title + ' by ' + entry.creator);
      var img = el('img');
      img.src = entry.src; img.alt = entry.title + ' — fan art by ' + entry.creator;
      img.loading = 'lazy'; img.decoding = 'async';
      img.onerror = function () { card.classList.add('is-missing'); };
      button.append(img);
      button.addEventListener('click', function () { openFull(entry); });
      var cap = el('figcaption', 'fanart-caption');
      var title = el('span', 'fanart-title', entry.title);
      title.dir = 'auto';
      cap.append(title, el('span', 'fanart-creator', 'by ' + entry.creator));
      if (entry.description) {
        var desc = el('span', 'fanart-desc', entry.description);
        desc.dir = 'auto';
        cap.append(desc);
      }
      card.append(button, cap);
      grid.append(card);
    });
    empty.hidden = !!list.length;
    header();
  }
  function header() {
    if (!active) return;
    $('gallerySubtitle').textContent = 'FAN ART' + (loadState === 'ready' ? ' · ' + count + (count === 1 ? ' PIECE' : ' PIECES') : '');
    $('galleryArtNote').textContent = 'Member-made fan art, shared with permission';
    document.title = 'Fan Art | POW 713';
  }
  closeBtn.addEventListener('click', function () { if (dialog.close) dialog.close(); });
  dialog.addEventListener('click', function (event) { if (event.target === dialog && dialog.close) dialog.close(); });

  window.AllianceFanArt = {
    show: function () {
      active = true; hub.hidden = false;
      header();
      if (loadState === 'idle' || loadState === 'error') {
        loadState = 'loading';
        status.hidden = false; status.textContent = 'Loading the fan art list…';
        fetch('fanart.json', { cache: 'no-cache' }).then(function (response) {
          if (!response.ok) throw new Error('Fan art list unavailable');
          return response.json();
        }).then(function (data) {
          loadState = 'ready';
          status.hidden = true;
          render(parse(data || {}));
        }).catch(function () {
          loadState = 'error';
          status.textContent = 'The fan art list could not load. Check your connection and refresh to try again.';
        });
      } else if (loadState === 'ready') header();
    },
    hide: function () {
      active = false; hub.hidden = true;
      if (dialog.open && dialog.close) dialog.close();
    }
  };
})();
