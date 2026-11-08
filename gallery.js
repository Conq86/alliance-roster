(function () {
  'use strict';
  var deck = document.querySelector('.deck');
  var stage = document.querySelector('.stage');
  var list = document.getElementById('memberList');
  var search = document.getElementById('memberSearch');
  var noMatch = document.getElementById('noMatch');
  var resumeBtn = document.getElementById('resumeBtn');
  var viewArt = document.getElementById('viewArt');
  var charactersTab = document.getElementById('charactersTab');
  var badgesTab = document.getElementById('badgesTab');
  var mediaTab = document.getElementById('mediaTab');
  var directory = document.querySelector('.directory');
  var hints = document.getElementById('galleryHints');
  var media = window.AllianceMedia;
  var aliases = {};
  list.querySelectorAll('button').forEach(function (button) {
    aliases[button.textContent.trim()] = button.getAttribute('data-search');
  });
  // Static cards are a fallback if the generated roster cannot be fetched.
  var members = Array.from(deck.children).map(function (card) {
    var path = card.querySelector('img').getAttribute('data-src');
    return { name: card.querySelector('figcaption').textContent.trim(), file: path.split('/').pop(), character: true, badge: null };
  });
  var items = [], current = 0, step = 360 / members.length;
  var speed = 360 / 110;
  var requested = new URLSearchParams(location.search).get('view');
  var gallery = requested === 'badges' ? 'badges' : 'characters';
  // view is the visible tab; gallery is the wheel's content, kept while Music & Videos is open.
  var view = requested === 'media' && media ? 'media' : gallery;
  var savedRoster = false;
  var mode = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'hold' : 'spin';
  var focusTarget = 0, activeFile = null, holdPause = false, resumeTimer;
  var generation = 0, queue = [], loading = 0, lastDepthBucket = null;

  function norm(angle) {
    angle %= 360;
    return angle > 180 ? angle - 360 : angle < -180 ? angle + 360 : angle;
  }
  function radius() { return innerWidth <= 760 ? 290 : innerWidth <= 1200 ? 700 : 860; }
  function showOriginal() {
    var item = items.find(function (entry) { return entry.member.file === activeFile; });
    viewArt.hidden = !item || item.state !== 'ready';
    if (!viewArt.hidden) {
      viewArt.href = item.src;
      viewArt.textContent = 'View full ' + (gallery === 'badges' ? 'badge' : 'character');
    } else viewArt.removeAttribute('href');
  }
  function pump() {
    while (loading < 2 && queue.length) {
      var item = queue.shift();
      if (item.generation !== generation) continue;
      loading++;
      load(item);
    }
  }
  function load(item) {
    var finished = false;
    function finish(ok) {
      if (finished) return;
      finished = true;
      loading--;
      item.img.onload = item.img.onerror = null;
      if (item.generation === generation) {
        item.state = ok ? 'ready' : 'missing';
        item.card.dataset.state = item.state;
        item.card.dataset.message = ok ? '' : (gallery === 'badges' ? 'BADGE COMING SOON' : 'ARTWORK UNAVAILABLE');
        showOriginal();
      }
      pump();
    }
    item.img.onload = function () {
      // Reveal only a fully decoded image; never paint an undecoded surface.
      if (item.img.decode) item.img.decode().then(function () { finish(true); }, function () { finish(item.img.naturalWidth > 0); });
      else finish(true);
    };
    item.img.onerror = function () { finish(false); };
    item.img.src = item.src;
  }
  function warm() {
    if (!items.length) return;
    var center = ((Math.round(-current / step) % items.length) + items.length) % items.length;
    // Prioritize the front and its immediate neighbours, at most two decodes at a time.
    [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6, 7, -7].forEach(function (offset) {
      var item = items[(center + offset + items.length) % items.length];
      if (item.state !== 'waiting') return;
      item.state = 'loading';
      queue.push(item);
    });
    pump();
  }
  function render() {
    var r = radius();
    var arc = innerWidth <= 760 ? 67 : 89;
    // PR #3's flat stack, hidden rear arc and sparse depth updates, with
    // exact ranks (rounded ranks can put the farther card on top).
    var bucket = Math.floor(norm(current) / (step / 2));
    if (lastDepthBucket !== bucket) {
      items.map(function (item, i) { return { item: item, distance: Math.abs(norm(current + i * step)) }; })
        .sort(function (a, b) { return b.distance - a.distance; })
        .forEach(function (entry, rank) { entry.item.card.style.zIndex = rank + 1; });
      lastDepthBucket = bucket;
    }
    items.forEach(function (item, i) {
      var angle = norm(current + i * step);
      var visible = Math.abs(angle) <= arc;
      if (item.visible !== visible) {
        item.card.style.visibility = visible ? 'visible' : 'hidden';
        item.visible = visible;
      }
      if (!visible) return;
      var rad = angle * Math.PI / 180;
      // Equivalent flat projection of rotateY(angle) translateZ(radius),
      // without 3D GPU surfaces intersecting or being rebuilt every frame.
      item.card.style.transform = 'translateX(' + (Math.sin(rad) * r).toFixed(3) + 'px) scaleX(' + Math.cos(rad).toFixed(6) + ')';
    });
  }
  function applyFilter() {
    var query = search.value.trim().toLowerCase(), first = null;
    list.querySelectorAll('button').forEach(function (button) {
      button.hidden = !button.dataset.search.includes(query);
      if (!button.hidden && !first) first = button;
    });
    noMatch.hidden = !!first;
    return first;
  }
  function build(next, syncUrl) {
    var oldStep = step;
    var front = items.length ? items[((Math.round(-current / oldStep) % items.length) + items.length) % items.length].member.file : null;
    gallery = next;
    generation++;
    queue = [];
    deck.replaceChildren(); list.replaceChildren();
    var visibleMembers = members.filter(function (member) { return gallery === 'badges' || member.character; });
    step = 360 / Math.max(1, visibleMembers.length);
    items = visibleMembers.map(function (member, i) {
      var card = document.createElement('figure'); card.className = 'card';
      var img = document.createElement('img'); img.decoding = 'async';
      img.alt = (gallery === 'badges' ? 'Badge for ' : 'Character for ') + member.name;
      var caption = document.createElement('figcaption'); caption.textContent = member.name;
      card.append(img, caption); deck.append(card);
      var missing = gallery === 'badges' && member.badge === false;
      card.dataset.state = missing ? 'missing' : 'loading';
      card.dataset.message = missing ? 'BADGE COMING SOON' : 'LOADING ARTWORK';
      var item = { member: member, card: card, img: img, src: gallery + '/' + member.file, state: missing ? 'missing' : 'waiting', generation: generation };
      card.addEventListener('click', function () { goTo(i); });
      return item;
    });
    items.map(function (item, i) { return {item: item, i: i}; })
      .sort(function (a, b) { return a.item.member.name.localeCompare(b.item.member.name); })
      .forEach(function (entry) {
        var button = document.createElement('button'); button.type = 'button'; button.dataset.i = entry.i;
        button.textContent = entry.item.member.name;
        button.dataset.search = (aliases[entry.item.member.name] || entry.item.member.name.toLowerCase()) + ' ' + entry.item.member.file.replace(/\.png$/, '').replace(/-/g, ' ');
        list.append(button); entry.item.button = button;
      });
    if (oldStep !== step) {
      var index = items.findIndex(function (item) { return item.member.file === (activeFile || front); });
      current = index >= 0 ? -index * step : 0;
      focusTarget = current;
    }
    var active = items.find(function (item) { return item.member.file === activeFile; });
    if (active) { active.card.classList.add('active'); active.button.classList.add('active'); }
    else activeFile = null;
    lastDepthBucket = null;
    chrome(); applyFilter(); showOriginal();
    if (view !== 'media') { warm(); render(); }
    if (syncUrl) setUrl();
  }
  function chrome() {
    charactersTab.setAttribute('aria-pressed', String(view === 'characters'));
    badgesTab.setAttribute('aria-pressed', String(view === 'badges'));
    mediaTab.setAttribute('aria-pressed', String(view === 'media'));
    stage.hidden = directory.hidden = hints.hidden = view === 'media';
    if (view === 'media') return; // media.js owns the header and footer note while its tab is open
    document.getElementById('gallerySubtitle').textContent = (gallery === 'badges' ? 'MEMBER BADGES · ' : 'MEMBER SHOWCASE · ') + items.length + ' MEMBERS';
    document.getElementById('directoryHeading').textContent = gallery === 'badges' ? 'BADGE DIRECTORY' : 'MEMBER DIRECTORY';
    document.getElementById('galleryArtNote').textContent = (gallery === 'badges' ? 'Member-created badge artwork' : 'Art set in the alliance house style') + (savedRoster ? ' · Saved roster (refresh to retry updates)' : '');
    document.title = gallery === 'badges' ? 'Alliance Badges | Alliance Roster Showcase' : 'Alliance Roster Showcase';
  }
  function setUrl() {
    var url = new URL(location.href);
    if (view !== 'characters') url.searchParams.set('view', view); else url.searchParams.delete('view');
    history.replaceState(null, '', url.pathname + url.search + url.hash);
  }
  function setView(next) {
    if (next === view) return;
    var leaving = view === 'media';
    view = next;
    if (next === 'media') {
      // Freeze the wheel where it is; its focus and rotation resume on return.
      clearTimeout(resumeTimer); holdPause = false;
      chrome(); media.show();
    } else {
      if (leaving) media.hide();
      if (next !== gallery) build(next, false);
      else { chrome(); lastDepthBucket = null; warm(); render(); }
      if (leaving && mode === 'focus') resumeTimer = setTimeout(resume, 25000);
    }
    setUrl();
  }
  function goTo(i) {
    var item = items[i];
    if (!item) return;
    items.forEach(function (entry) { entry.card.classList.remove('active'); entry.button.classList.remove('active'); });
    activeFile = item.member.file;
    item.card.classList.add('active'); item.button.classList.add('active');
    focusTarget = current + norm(norm(-i * step) - norm(current));
    mode = 'focus'; resumeBtn.hidden = false; showOriginal();
    clearTimeout(resumeTimer); resumeTimer = setTimeout(resume, 25000);
  }
  function resume() {
    clearTimeout(resumeTimer); mode = 'spin'; activeFile = null;
    items.forEach(function (item) { item.card.classList.remove('active'); item.button.classList.remove('active'); });
    resumeBtn.hidden = true; showOriginal();
  }
  var last = null, lastPaint = -Infinity;
  function tick(ts) {
    if (last === null) last = ts;
    var dt = Math.min(0.05, (ts - last) / 1000); last = ts;
    var showing = view !== 'media' && !document.hidden;
    if (!holdPause && showing) {
      if (mode === 'spin') current -= speed * dt;
      else if (mode === 'focus') {
        var delta = focusTarget - current;
        current += delta * Math.min(1, dt * 2.4);
        if (Math.abs(delta) < 0.05) current = focusTarget;
      }
    }
    if (showing && ts - lastPaint >= (innerWidth <= 760 ? 32 : 16)) {
      warm(); render(); lastPaint = ts;
    }
    requestAnimationFrame(tick);
  }
  stage.addEventListener('pointerenter', function (e) { if (e.pointerType === 'mouse') holdPause = true; });
  stage.addEventListener('pointerleave', function () { holdPause = false; });
  stage.addEventListener('pointerdown', function () { holdPause = true; });
  window.addEventListener('pointerup', function () { holdPause = false; });
  window.addEventListener('pointercancel', function () { holdPause = false; });
  window.addEventListener('blur', function () { holdPause = false; });
  list.addEventListener('click', function (event) {
    var button = event.target.closest('button[data-i]');
    if (button) goTo(Number(button.dataset.i));
  });
  resumeBtn.addEventListener('click', resume);
  search.addEventListener('input', applyFilter);
  search.addEventListener('keydown', function (event) { if (event.key === 'Enter') { var first = applyFilter(); if (first) first.click(); } });
  charactersTab.addEventListener('click', function () { setView('characters'); });
  badgesTab.addEventListener('click', function () { setView('badges'); });
  if (media) mediaTab.addEventListener('click', function () { setView('media'); });
  else mediaTab.hidden = true;
  build(gallery, false);
  if (view === 'media') media.show();
  requestAnimationFrame(tick);
  fetch('gallery-data.json', { cache: 'no-cache' }).then(function (response) {
    if (!response.ok) throw new Error('Roster unavailable');
    return response.json();
  }).then(function (data) {
    var assets = new Set(data.assets), byFile = new Map();
    data.members.forEach(function (row) {
      var match = /^(characters|badges)\/([a-z0-9_-]+\.png)$/.exec(row.path);
      if (!match || !row.name) return;
      var file = match[2];
      if (!byFile.has(file)) byFile.set(file, { name: row.name, file: file, character: assets.has('characters/' + file), badge: assets.has('badges/' + file) });
    });
    if (!byFile.size) throw new Error('Empty roster');
    members = Array.from(byFile.values());
    build(gallery, false);
  }).catch(function () {
    savedRoster = true; chrome();
  });
})();
