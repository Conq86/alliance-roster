(function () {
  'use strict';
  // Guides hub: season tips and walkthroughs. Content comes only from guides.json (see README).
  // Text is always set with textContent; nothing from the manifest is parsed as HTML.
  var $ = function (id) { return document.getElementById(id); };
  var hub = $('guidesHub'), status = $('guidesStatus'), picker = $('seasonPicker'), body = $('guideBody');
  var active = false, loadState = 'idle', seasons = [], current = null, fallback = null;

  function el(tag, className, content) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (content) node.textContent = content;
    return node;
  }
  function text(value, max) { return typeof value === 'string' && value.trim() ? value.trim().slice(0, max || 400) : ''; }
  function arr(value) { return Array.isArray(value) ? value : []; }
  function slug(value) { return typeof value === 'string' && /^[a-z0-9_-]{1,40}$/.test(value) ? value : ''; }
  // Downloads must live under guides/ (same path rules as the other loaders).
  function fileSrc(value) {
    var path = typeof value === 'string' ? value.trim() : '';
    var parts = path.split('/');
    if (parts[0] !== 'guides' || parts.length < 2 || /[\\%?#:]/.test(path) || !/\.(pdf|pptx|png|jpe?g|webp)$/i.test(path)) return null;
    if (parts.some(function (part) { return !part || part === '.' || part === '..'; })) return null;
    return parts.map(encodeURIComponent).join('/');
  }
  function httpsUrl(value) {
    try { var url = new URL(value); return url.protocol === 'https:' ? url.href : null; } catch (e) { return null; }
  }
  // A line is either a string or { lead, text }; the lead is shown in gold.
  function line(tag, value) {
    var node = el(tag);
    var lead = text(value && value.lead, 120), rest = typeof value === 'string' ? text(value) : text(value && value.text);
    if (lead) { node.append(el('strong', 'guide-lead', lead)); if (rest) node.append(' '); }
    if (rest) node.append(rest);
    return lead || rest ? node : null;
  }
  function label(value) { return el('p', 'guide-label', value); }

  function renderSection(section, seasonId) {
    var heading = text(section && section.heading, 120);
    if (!heading) return null;
    var box = el('section', 'guide-section');
    var id = slug(section.id);
    if (id) box.id = 'guide-' + seasonId + '-' + id;
    box.append(el('h3', 'guide-heading', heading));
    var intro = text(section.intro);
    if (intro) box.append(el('p', 'guide-intro', intro));

    var stats = arr(section.stats).filter(function (s) { return text(s && s.value, 24); });
    if (stats.length) {
      var statGrid = el('div', 'guide-stats');
      stats.forEach(function (s) {
        var card = el('div', 'guide-stat');
        card.append(el('span', 'guide-stat-value', text(s.value, 24)), el('span', 'guide-stat-label', text(s.label, 160)));
        statGrid.append(card);
      });
      box.append(statGrid);
    }
    var flow = arr(section.flow).map(function (f) { return text(f, 40); }).filter(Boolean);
    if (flow.length) {
      if (text(section.flowLabel, 40)) box.append(label(text(section.flowLabel, 40)));
      var chain = el('ol', 'guide-flow');
      flow.forEach(function (f) { chain.append(el('li', null, f)); });
      box.append(chain);
    }
    var list = arr(section.list).map(function (item) { return line('li', item); }).filter(Boolean);
    if (list.length) {
      var ul = el('ul', 'guide-list');
      list.forEach(function (li) { ul.append(li); });
      box.append(ul);
    }
    var steps = arr(section.steps).filter(function (s) { return text(s && s.title, 120); });
    if (steps.length) {
      if (text(section.stepsLabel, 40)) box.append(label(text(section.stepsLabel, 40)));
      var ol = el('ol', 'guide-steps');
      steps.forEach(function (s, i) {
        var li = el('li', 'guide-step');
        li.append(el('span', 'guide-step-num', String(i + 1)));
        var copy = el('div', 'guide-step-copy');
        var title = el('p', 'guide-step-title', text(s.title, 120));
        if (text(s.tag, 30)) title.append(el('span', 'guide-tag', text(s.tag, 30)));
        copy.append(title);
        if (text(s.text)) copy.append(el('p', 'guide-step-text', text(s.text)));
        li.append(copy);
        ol.append(li);
      });
      box.append(ol);
    }
    var cards = arr(section.cards).filter(function (c) { return text(c && c.title, 80); });
    if (cards.length) {
      var cardGrid = el('div', 'guide-cards');
      cards.forEach(function (c) {
        var card = el('article', 'guide-card' + (c.tone === 'warn' ? ' is-warn' : ''));
        var title = el('h4', 'guide-card-title', text(c.title, 80));
        if (text(c.tag, 30)) title.append(el('span', 'guide-tag', text(c.tag, 30)));
        card.append(title);
        var lines = el('ul', 'guide-list');
        arr(c.lines).forEach(function (item) { var li = line('li', item); if (li) lines.append(li); });
        card.append(lines);
        cardGrid.append(card);
      });
      box.append(cardGrid);
    }
    var table = section.table;
    var columns = arr(table && table.columns).map(function (c) { return text(c, 40); });
    if (columns.length) {
      var wrap = el('div', 'guide-table-wrap');
      var t = el('table', 'guide-table');
      var head = el('tr');
      columns.forEach(function (c) { head.append(el('th', null, c)); });
      t.append(el('thead')); t.tHead.append(head);
      var tbody = el('tbody');
      var rows = arr(table.rows);
      rows.forEach(function (row, r) {
        var tr = el('tr', table.highlightLast && r === rows.length - 1 ? 'is-key' : null);
        columns.forEach(function (c, i) { tr.append(el(i ? 'td' : 'th', null, text(arr(row)[i], 160))); });
        tbody.append(tr);
      });
      t.append(tbody);
      wrap.append(t);
      box.append(wrap);
    }
    // Event times: Apocalypse Time is UTC-2; show each one in the viewer's own time zone.
    var times = arr(section.times).filter(function (t) { return text(t && t.label, 80) && /^([01]\d|2[0-3]):[0-5]\d$/.test(t.at || ''); });
    if (times.length) {
      var tw = el('div', 'guide-table-wrap');
      var tt = el('table', 'guide-table');
      var zone = '';
      try { zone = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' }).formatToParts(new Date()).filter(function (p) { return p.type === 'timeZoneName'; })[0].value; } catch (e) { zone = ''; }
      var hr = el('tr');
      ['Event', 'Apocalypse Time', 'Your time' + (zone ? ' (' + zone + ')' : '')].forEach(function (c) { hr.append(el('th', null, c)); });
      tt.append(el('thead')); tt.tHead.append(hr);
      var tb = el('tbody'), now = new Date();
      // Today's date in Apocalypse Time, so the conversion uses today's daylight-saving rules.
      var atNow = new Date(now.getTime() - 2 * 3600000);
      times.forEach(function (t) {
        var hm = t.at.split(':').map(Number);
        var when = new Date(Date.UTC(atNow.getUTCFullYear(), atNow.getUTCMonth(), atNow.getUTCDate(), hm[0] + 2, hm[1]));
        var local = when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
        var shift = (Date.UTC(when.getFullYear(), when.getMonth(), when.getDate()) - Date.UTC(atNow.getUTCFullYear(), atNow.getUTCMonth(), atNow.getUTCDate())) / 86400000;
        if (shift > 0) local += ' (next day)'; else if (shift < 0) local += ' (day before)';
        var tr = el('tr');
        tr.append(el('th', null, text(t.label, 80)), el('td', null, t.at + ' AT'), el('td', 'guide-local', local));
        tb.append(tr);
      });
      tt.append(tb); tw.append(tt); box.append(tw);
    }
    var note = line('p', section.note);
    if (note) { note.className = 'guide-note'; box.append(note); }
    return box;
  }

  function sourcesLine(season) {
    var sources = arr(season.sources).map(function (s) { return { name: text(s && s.label, 80), url: httpsUrl(s && s.url) }; }).filter(function (s) { return s.name && s.url; });
    if (!sources.length) return null;
    var foot = el('p', 'media-fineprint guide-sources', 'Sources: ');
    sources.forEach(function (s, i) {
      var a = el('a', null, s.name);
      a.href = s.url; a.target = '_blank'; a.rel = 'noopener';
      foot.append(a);
      if (i < sources.length - 1) foot.append(' · ');
    });
    return foot;
  }
  function smooth() { return matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'; }
  function param(name, value) {
    var url = new URL(location.href);
    if (value) url.searchParams.set(name, value); else url.searchParams.delete(name);
    history.replaceState(null, '', url.pathname + url.search + url.hash);
  }

  // Page-by-page reader for an illustrated guide (book.pages in guides.json).
  // Images load lazily as they come into view; each page opens full size in a new tab for zooming.
  function renderBook(season, wrap) {
    var book = season.book, pages = [];
    arr(book.pages).forEach(function (p, i) {
      var image = fileSrc(p && p.image), title = text(p && p.title, 80);
      if (!image || !title) { console.warn('guides.json: skipped book page ' + (i + 1)); return; }
      pages.push({ n: pages.length + 1, title: title, chapter: text(p.chapter, 40), image: image, thumb: fileSrc(p.thumb) || image });
    });
    if (!pages.length) return;
    var w = Number(book.width) > 0 ? Number(book.width) : 1280, h = Number(book.height) > 0 ? Number(book.height) : 1920;

    // Contents: thumbnail grid, collapsed by default.
    var contents = el('details', 'wb-contents');
    contents.append(el('summary', 'wb-contents-toggle', 'Contents · ' + pages.length + ' pages'));
    var grid = el('ol', 'wb-grid');
    pages.forEach(function (p) {
      var li = el('li'), b = el('button', 'wb-thumb');
      b.type = 'button';
      var img = el('img');
      img.src = p.thumb; img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; img.width = 170; img.height = Math.round(170 * h / w);
      var cap = el('span', 'wb-thumb-cap');
      cap.append(el('span', 'wb-thumb-num', String(p.n)), document.createTextNode(p.title));
      b.append(img, cap);
      b.addEventListener('click', function () { contents.open = false; go(p.n); });
      li.append(b); grid.append(li);
    });
    contents.append(grid);

    // Sticky page bar: previous / jump-to / next.
    var bar = el('div', 'wb-bar');
    bar.setAttribute('role', 'navigation'); bar.setAttribute('aria-label', 'Warbook pages');
    var prev = el('button', 'wb-step', '‹'), next = el('button', 'wb-step', '›');
    prev.type = next.type = 'button';
    prev.setAttribute('aria-label', 'Previous page'); next.setAttribute('aria-label', 'Next page');
    var pick = el('select', 'wb-select');
    pick.setAttribute('aria-label', 'Go to page');
    pages.forEach(function (p) {
      var o = el('option', null, p.n + ' / ' + pages.length + ' · ' + p.title);
      o.value = String(p.n); pick.append(o);
    });
    bar.append(prev, pick, next);

    var stack = el('ol', 'wb-pages');
    var figs = pages.map(function (p) {
      var li = el('li', 'wb-page');
      li.id = 'wb-' + season.id + '-' + p.n;
      li.dataset.page = String(p.n);
      var a = el('a', 'wb-open');
      a.href = p.image; a.target = '_blank'; a.rel = 'noopener';
      a.setAttribute('aria-label', 'Page ' + p.n + ': ' + p.title + ' (open full size)');
      var img = el('img');
      img.src = p.image; img.alt = 'Page ' + p.n + ': ' + p.title; img.width = w; img.height = h;
      img.loading = p.n <= 2 ? 'eager' : 'lazy'; img.decoding = 'async';
      a.append(img);
      var cap = el('p', 'wb-caption');
      cap.append(el('span', 'wb-caption-num', 'Page ' + p.n), document.createTextNode((p.chapter ? p.chapter + ' · ' : '') + p.title));
      li.append(a, cap);
      stack.append(li);
      return li;
    });

    var currentPage = 1;
    function show(n) {
      currentPage = n;
      pick.value = String(n);
      prev.disabled = n <= 1; next.disabled = n >= pages.length;
    }
    function go(n) {
      n = Math.min(pages.length, Math.max(1, n));
      show(n);
      figs[n - 1].scrollIntoView({ behavior: smooth(), block: 'start' });
      param('page', n > 1 ? String(n) : null);
    }
    prev.addEventListener('click', function () { go(currentPage - 1); });
    next.addEventListener('click', function () { go(currentPage + 1); });
    pick.addEventListener('change', function () { go(Number(pick.value)); });
    // Track the page being read so the bar stays in sync while scrolling.
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) { if (e.isIntersecting) show(Number(e.target.dataset.page)); });
      }, { rootMargin: '-45% 0px -50% 0px' });
      figs.forEach(function (f) { io.observe(f); });
    }
    show(1);

    var pdf = fileSrc(book.pdf);
    if (pdf) {
      var dl = el('div', 'media-actions guide-downloads wb-download');
      var a = el('a', 'media-link', text(book.pdfLabel, 60) || 'Download the PDF');
      a.href = pdf; a.setAttribute('download', '');
      dl.append(a);
      wrap.append(dl);
    }
    wrap.append(contents, bar, stack);
    var startPage = Number(new URLSearchParams(location.search).get('page'));
    if (startPage > 1 && startPage <= pages.length) {
      show(startPage);
      requestAnimationFrame(function () { figs[startPage - 1].scrollIntoView({ block: 'start' }); });
    }
  }

  function renderText(season, sections, wrap) {
    var jump = el('nav', 'media-chips guide-jump');
    jump.setAttribute('aria-label', 'Jump to a section');
    sections.forEach(function (s) {
      if (!s.id) return;
      var a = el('a', 'media-chip', s.querySelector('h3').textContent);
      a.href = '#' + s.id;
      a.addEventListener('click', function (event) {
        event.preventDefault();
        s.scrollIntoView({ behavior: smooth(), block: 'start' });
      });
      jump.append(a);
    });
    if (jump.childElementCount) wrap.append(jump);
    sections.forEach(function (s) { wrap.append(s); });
    var foot = sourcesLine(season);
    if (foot) wrap.append(foot);
  }

  function render(season) {
    body.replaceChildren();
    var sections = arr(season.sections).map(function (s) { return renderSection(s, season.id); }).filter(Boolean);
    var hasBook = !!(season.book && arr(season.book.pages).length);
    if (!sections.length && !hasBook) {
      body.append(el('p', 'media-empty', 'No ' + season.label + ' guide yet. Tips and walkthroughs will appear here once they are added.'));
      return;
    }
    var intro = el('div', 'guide-hero');
    intro.append(el('p', 'guide-kicker', season.label), el('h3', 'guide-title', text(season.title, 80) || season.label));
    if (text(season.tagline)) intro.append(el('p', 'guide-tagline', text(season.tagline)));
    if (/^\d{4}-\d{2}-\d{2}$/.test(season.updated || '')) intro.append(el('p', 'guide-updated', 'Updated ' + season.updated));
    var downloads = el('div', 'media-actions guide-downloads');
    arr(season.downloads).forEach(function (d) {
      var src = fileSrc(d && d.src), name = text(d && d.label, 60);
      if (!src || !name) return;
      var a = el('a', 'media-link', name);
      a.href = src; a.target = '_blank'; a.rel = 'noopener';
      downloads.append(a);
    });
    if (downloads.childElementCount) intro.append(downloads);
    body.append(intro);

    var view = el('div');
    var mode = hasBook && sections.length && new URLSearchParams(location.search).get('mode') === 'text' ? 'text' : (hasBook ? 'book' : 'text');
    function draw() {
      view.replaceChildren();
      if (mode === 'book') renderBook(season, view); else renderText(season, sections, view);
    }
    if (hasBook && sections.length) {
      // Two ways to read: the illustrated warbook or the plain-text quick guide.
      var modes = el('div', 'media-subtabs guide-modes');
      modes.setAttribute('role', 'group'); modes.setAttribute('aria-label', 'Choose how to read');
      [['book', text(season.book.label, 30) || 'Warbook'], ['text', 'Text guide']].forEach(function (m) {
        var b = el('button', null, m[1]);
        b.type = 'button'; b.dataset.mode = m[0]; b.setAttribute('aria-pressed', String(mode === m[0]));
        b.addEventListener('click', function () {
          if (mode === m[0]) return;
          mode = m[0];
          modes.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', String(x.dataset.mode === mode)); });
          param('mode', mode === 'text' ? 'text' : null); param('page', null);
          draw();
        });
        modes.append(b);
      });
      body.append(modes);
    }
    body.append(view);
    draw();
  }

  function setUrl(id) {
    var url = new URL(location.href);
    if (id) url.searchParams.set('season', id); else url.searchParams.delete('season');
    if (!id || id !== url.searchParams.get('season')) { url.searchParams.delete('page'); url.searchParams.delete('mode'); }
    history.replaceState(null, '', url.pathname + url.search + url.hash);
  }
  function select(id, syncUrl) {
    var season = seasons.find(function (s) { return s.id === id; }) || seasons.find(function (s) { return s.id === fallback; }) || seasons[0];
    if (!season) return;
    current = season.id;
    picker.querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.season === current)); });
    render(season);
    header();
    if (syncUrl) setUrl(current);
  }
  function parse(data) {
    var seen = {};
    seasons = arr(data && data.seasons).map(function (s, i) {
      var id = slug(s && s.id), name = text(s && s.label, 30);
      if (!id || !name || seen[id]) { console.warn('guides.json: skipped seasons[' + i + '] (needs a unique id and label)'); return null; }
      seen[id] = true;
      return { id: id, label: name, title: s.title, tagline: s.tagline, updated: s.updated, downloads: s.downloads, sections: s.sections, sources: s.sources, book: s.book && typeof s.book === 'object' ? s.book : null };
    }).filter(Boolean);
    fallback = slug(data && data.default);
    picker.replaceChildren();
    seasons.forEach(function (s) {
      var b = el('button', null, s.label);
      b.type = 'button'; b.dataset.season = s.id; b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', function () { if (s.id !== current) { param('page', null); param('mode', null); select(s.id, true); } });
      picker.append(b);
    });
    picker.hidden = !seasons.length;
    if (!seasons.length) body.replaceChildren(el('p', 'media-empty', 'No guides yet. Season tips and walkthroughs will appear here once they are added.'));
  }
  function header() {
    if (!active) return;
    var season = seasons.find(function (s) { return s.id === current; });
    $('gallerySubtitle').textContent = 'SEASON GUIDES' + (season ? ' · ' + season.label.toUpperCase() : '');
    $('galleryArtNote').textContent = 'Alliance tips and walkthroughs';
    document.title = (season ? season.label + ' Guide' : 'Season Guides') + ' | POW 713';
  }

  window.AllianceGuides = {
    show: function () {
      active = true; hub.hidden = false;
      header();
      if (loadState === 'idle' || loadState === 'error') {
        loadState = 'loading';
        status.hidden = false; status.textContent = 'Loading the season guides…';
        fetch('guides.json', { cache: 'no-cache' }).then(function (response) {
          if (!response.ok) throw new Error('Guides unavailable');
          return response.json();
        }).then(function (data) {
          loadState = 'ready';
          status.hidden = true;
          parse(data || {});
          select(new URLSearchParams(location.search).get('season'), true);
        }).catch(function () {
          loadState = 'error';
          status.textContent = 'The season guides could not load. Check your connection and refresh to try again.';
        });
      } else if (loadState === 'ready') { setUrl(current); header(); }
    },
    hide: function () {
      active = false; hub.hidden = true;
      setUrl(null);
    }
  };
})();
