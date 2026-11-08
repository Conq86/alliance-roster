(function () {
  'use strict';
  // Music & Videos hub. Content comes only from media.json (see README); gallery.js calls show()/hide().
  var $ = function (id) { return document.getElementById(id); };
  var hub = $('mediaHub'), status = $('mediaStatus');
  var musicTab = $('musicTab'), videosTab = $('videosTab');
  var musicPanel = $('musicPanel'), videoPanel = $('videoPanel');
  var playlistPicker = $('playlistPicker'), playlistArt = $('playlistArt'), playlistTitle = $('playlistTitle');
  var playlistCredit = $('playlistCredit'), player = $('audioPlayer'), audio = $('mediaAudio');
  var nowPlaying = $('nowPlaying'), prevTrack = $('prevTrack'), nextTrack = $('nextTrack');
  var audioError = $('audioError'), audioFallback = $('audioFallback');
  var trackList = $('trackList'), playlistEmpty = $('playlistEmpty');
  var videoPicker = $('videoPicker'), videoGroups = $('videoGroups'), videoEmpty = $('videoEmpty');
  var ID = /^[a-z0-9_-]+$/, YOUTUBE = /^[A-Za-z0-9_-]{11}$/, DATE = /^\d{4}-\d{2}-\d{2}$/;
  var playlists = [], groups = [], videoCount = 0;
  var active = false, loadState = 'idle', section = null;
  var playlist = 0, track = -1, filter = 'all', activeTile = null;

  function text(value, max) { return typeof value === 'string' && value.trim() ? value.trim().slice(0, max || 200) : ''; }
  function el(tag, className, content) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (content) node.textContent = content;
    return node;
  }
  // Local files must live under media/. Each path segment is URL-encoded, so spaces and
  // Unicode names work, and the relative URL resolves under the Pages subpath (/alliance-roster/).
  function localSrc(value, ext) {
    var path = typeof value === 'string' ? value.trim() : '';
    var parts = path.split('/');
    if (parts[0] !== 'media' || parts.length < 2 || /[\\%?#:]/.test(path) || !ext.test(path)) return null;
    if (parts.some(function (part) { return !part || part === '.' || part === '..'; })) return null;
    return parts.map(encodeURIComponent).join('/');
  }
  function duration(value) {
    if (typeof value === 'number' && value > 0 && value < 86400) {
      var s = Math.round(value), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, sec = ('0' + (s % 60)).slice(-2);
      return h ? h + ':' + ('0' + m).slice(-2) + ':' + sec : m + ':' + sec;
    }
    return typeof value === 'string' && /^(\d+:)?\d{1,2}:\d{2}$/.test(value.trim()) ? value.trim() : '';
  }
  function published(value) {
    if (typeof value !== 'string' || !DATE.test(value)) return '';
    var date = new Date(value + 'T00:00:00Z');
    return isNaN(date) ? '' : date.toLocaleDateString(undefined, { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' });
  }
  function skip(where, reason) { console.warn('media.json: skipped ' + where + ' (' + reason + ')'); }
  function creator(row, where, seen) {
    var id = row && typeof row.creatorId === 'string' ? row.creatorId : '';
    var name = text(row && row.creator, 60);
    if (!ID.test(id) || !name) { skip(where, 'needs creatorId and creator'); return null; }
    if (seen[id]) { skip(where, 'duplicate creatorId ' + id); return null; }
    seen[id] = true;
    return { id: id, name: name, art: row.member && ID.test(row.member) ? 'badges/' + row.member + '.png' : '' };
  }
  function parse(data) {
    var seen = {};
    playlists = (Array.isArray(data.music) ? data.music : []).map(function (row, i) {
      var group = creator(row, 'music[' + i + ']', seen);
      if (!group) return null;
      group.tracks = (Array.isArray(row.tracks) ? row.tracks : []).map(function (entry, j) {
        var where = group.id + ' track ' + (j + 1), title = text(entry && entry.title);
        var src = entry && (entry.type || 'audio') === 'audio' ? localSrc(entry.src, /\.mp3$/i) : null;
        if (!title || !src) { skip(where, 'needs type "audio", title and src media/...mp3'); return null; }
        return { title: title, src: src, duration: duration(entry.duration) };
      }).filter(Boolean);
      return group;
    }).filter(Boolean);
    seen = {};
    groups = (Array.isArray(data.videos) ? data.videos : []).map(function (row, i) {
      var group = creator(row, 'videos[' + i + ']', seen);
      if (!group) return null;
      group.channel = text(row.channel, 80);
      group.channelUrl = typeof row.channelUrl === 'string' && /^https:\/\/www\.youtube\.com\/@[\w.-]+$/.test(row.channelUrl) ? row.channelUrl : '';
      group.items = (Array.isArray(row.items) ? row.items : []).map(function (entry, j) {
        var where = group.id + ' video ' + (j + 1), title = text(entry && entry.title);
        var item = { title: title, short: entry && entry.format === 'short', duration: duration(entry && entry.duration), published: published(entry && entry.published) };
        if (entry && entry.type === 'youtube' && YOUTUBE.test(entry.youtubeId)) item.youtube = entry.youtubeId;
        else if (entry && entry.type === 'video') item.src = localSrc(entry.src, /\.mp4$/i);
        if (!title || !(item.youtube || item.src)) { skip(where, 'needs title and a valid youtubeId or src media/...mp4'); return null; }
        return item;
      }).filter(Boolean);
      return group;
    }).filter(Boolean);
    videoCount = groups.reduce(function (sum, group) { return sum + group.items.length; }, 0);
  }

  // ---- Playback: only one item at a time ----
  function stopAudio() {
    audio.pause();
    if (audio.hasAttribute('src')) { audio.removeAttribute('src'); audio.load(); }
  }
  function stopVideos(except) {
    videoGroups.querySelectorAll('video').forEach(function (video) { if (video !== except) video.pause(); });
    if (activeTile && activeTile.tile !== (except && except.closest('.media-tile'))) {
      activeTile.frame.replaceChildren(activeTile.poster);
      activeTile.tile.classList.remove('is-playing');
      activeTile.direct.hidden = true;
      activeTile = null;
    }
  }
  function stopAll() { stopAudio(); stopVideos(); }

  // ---- Header / sub-navigation ----
  function header() {
    if (!active) return;
    var parts = ['MUSIC & VIDEOS'];
    if (loadState === 'ready') parts.push(playlists.length + (playlists.length === 1 ? ' PLAYLIST' : ' PLAYLISTS'), videoCount + (videoCount === 1 ? ' VIDEO' : ' VIDEOS'));
    $('gallerySubtitle').textContent = parts.join(' · ');
    $('galleryArtNote').textContent = 'Member-made music and videos, shared with permission';
    document.title = 'Music & Videos | Alliance Roster Showcase';
  }
  function setSection(next) {
    var changed = section !== next;
    section = next;
    musicTab.setAttribute('aria-pressed', String(next === 'music'));
    videosTab.setAttribute('aria-pressed', String(next === 'videos'));
    musicPanel.hidden = loadState !== 'ready' || next !== 'music';
    videoPanel.hidden = loadState !== 'ready' || next !== 'videos';
    if (!changed) return;
    // Changing category always stops what was playing; Music re-cues its selected playlist.
    if (next === 'music' && loadState === 'ready') selectPlaylist(playlist); else stopAll();
  }

  // ---- Music ----
  function renderPicker(container, options, selected, onPick) {
    container.replaceChildren();
    options.forEach(function (option) {
      var button = el('button', 'media-chip');
      button.type = 'button';
      button.setAttribute('aria-pressed', String(option.key === selected));
      button.append(el('span', '', option.label));
      if (option.count) button.append(el('span', 'media-chip-count', option.count));
      button.addEventListener('click', function () { onPick(option.key); });
      container.append(button);
    });
  }
  function selectPlaylist(index) {
    stopAll();
    playlist = index; track = -1;
    var list = playlists[index];
    renderPicker(playlistPicker, playlists.map(function (entry, i) {
      return { key: i, label: entry.name, count: entry.tracks.length ? entry.tracks.length + (entry.tracks.length === 1 ? ' track' : ' tracks') : 'Awaiting tracks' };
    }), index, selectPlaylist);
    playlistPicker.hidden = playlists.length < 2;
    $('musicEmpty').hidden = !!list;
    $('playlist').hidden = !list;
    if (!list) return;
    playlistTitle.textContent = list.name;
    playlistCredit.textContent = 'Playlist · Music by ' + list.name;
    playlistArt.hidden = !list.art;
    if (list.art) { playlistArt.onerror = function () { playlistArt.hidden = true; }; playlistArt.src = list.art; }
    trackList.replaceChildren();
    list.tracks.forEach(function (entry, i) {
      var item = el('li'), button = el('button', 'track');
      button.type = 'button';
      button.append(el('span', 'track-number', String(i + 1)), el('span', 'track-title', entry.title));
      button.lastChild.dir = 'auto';
      if (entry.duration) button.append(el('span', 'track-time', entry.duration));
      button.addEventListener('click', function () { cue(i, true); });
      item.append(button); trackList.append(item);
    });
    playlistEmpty.textContent = 'No tracks yet. ' + list.name + '’s approved songs will appear here once they are added.';
    playlistEmpty.hidden = !!list.tracks.length;
    player.hidden = !list.tracks.length;
    if (list.tracks.length) cue(0, false);
  }
  function current() { return playlists[playlist] && playlists[playlist].tracks[track]; }
  function label(prefix) {
    var entry = current();
    nowPlaying.textContent = entry ? prefix + ': ' + entry.title + ' — ' + playlists[playlist].name : '';
  }
  // Load a track (preload=none, so nothing downloads until play). Play only on an explicit user action
  // or when the previous track ends after the user started playback.
  function cue(index, play) {
    var tracks = playlists[playlist].tracks;
    if (index < 0 || index >= tracks.length) return;
    stopVideos();
    track = index;
    audio.src = tracks[index].src;
    audioError.hidden = true;
    audioFallback.href = tracks[index].src;
    trackList.querySelectorAll('.track').forEach(function (button, i) {
      if (i === index) button.setAttribute('aria-current', 'true'); else button.removeAttribute('aria-current');
    });
    prevTrack.disabled = index === 0;
    nextTrack.disabled = index === tracks.length - 1;
    label('Ready');
    if (!play) return;
    var attempt = audio.play();
    if (attempt && attempt.catch) attempt.catch(function (error) {
      if (error && error.name === 'NotAllowedError' && track === index) label('Press play to start');
    });
  }
  audio.addEventListener('play', function () { stopVideos(); label('Now playing'); });
  audio.addEventListener('pause', function () { if (!audio.ended && audio.currentTime > 0) label('Paused'); });
  audio.addEventListener('ended', function () {
    if (track < playlists[playlist].tracks.length - 1) cue(track + 1, true);
    else label('End of playlist');
  });
  audio.addEventListener('error', function () {
    if (!audio.hasAttribute('src')) return;
    label('Could not play');
    audioError.hidden = false;
  });
  prevTrack.addEventListener('click', function () { cue(track - 1, !audio.paused); });
  nextTrack.addEventListener('click', function () { cue(track + 1, !audio.paused); });

  // ---- Videos ----
  function playYouTube(tile, frame, poster, item, group, direct) {
    stopAudio(); stopVideos();
    var iframe = el('iframe');
    iframe.src = 'https://www.youtube-nocookie.com/embed/' + item.youtube + '?autoplay=1&rel=0&playsinline=1';
    iframe.title = item.title + ' — ' + group.name + ' (YouTube video)';
    iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
    iframe.setAttribute('allowfullscreen', '');
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    frame.replaceChildren(iframe);
    tile.classList.add('is-playing');
    direct.hidden = false;
    activeTile = { tile: tile, frame: frame, poster: poster, direct: direct };
    iframe.focus();
  }
  function tile(item, group) {
    var article = el('article', 'media-tile' + (item.short ? ' is-short' : ''));
    var frame = el('div', 'media-frame'), body = el('div', 'media-tile-body');
    var kind = (item.short ? 'Short' : 'Video') + (item.duration ? ' · ' + item.duration : '');
    var link, direct;
    if (item.youtube) {
      // The poster opens YouTube directly; inline playback is the explicit "Play here" button.
      var watch = 'https://www.youtube.com/watch?v=' + item.youtube;
      var watchLabel = 'Watch on YouTube: ' + item.title + ' by ' + group.name + ' (opens in a new tab)';
      var poster = el('a', 'media-poster');
      poster.href = watch; poster.target = '_blank'; poster.rel = 'noopener';
      poster.setAttribute('aria-label', watchLabel);
      poster.append(el('span', 'media-play'), el('span', 'media-watch', 'Watch on YouTube'), el('span', 'media-kind', kind));
      poster.addEventListener('click', stopAll);
      frame.append(poster);
      // Shown above the player only while it plays inline, never over the iframe.
      direct = el('div', 'media-direct');
      direct.hidden = true;
      var away = el('a', 'media-link', 'Watch on YouTube');
      away.href = watch; away.target = '_blank'; away.rel = 'noopener';
      away.setAttribute('aria-label', watchLabel);
      away.addEventListener('click', function () { stopAll(); poster.focus(); });
      direct.append(away, el('p', 'media-direct-note', 'If YouTube asks you to sign in, open this video on YouTube.'));
      link = el('button', 'media-link', 'Play here');
      link.type = 'button';
      link.setAttribute('aria-label', 'Play here: ' + item.title + ' by ' + group.name + ' (loads YouTube player)');
      link.addEventListener('click', function () { playYouTube(article, frame, poster, item, group, direct); });
    } else {
      var video = el('video');
      video.controls = true; video.preload = 'none'; video.playsInline = true;
      video.setAttribute('playsinline', '');
      video.src = item.src;
      video.setAttribute('aria-label', item.title + ' by ' + group.name);
      video.addEventListener('play', function () { stopAudio(); stopVideos(video); });
      video.addEventListener('error', function () { failed.hidden = false; });
      frame.append(video);
      link = el('a', 'media-link', 'Open video file');
      link.href = item.src;
      link.target = '_blank'; link.rel = 'noopener';
      var failed = el('p', 'media-error', 'This video could not play here. Use the link below to open the file.');
      failed.hidden = true;
    }
    var title = el('h4', 'media-tile-title', item.title);
    title.dir = 'auto';
    var meta = [group.name, item.published, item.youtube ? '' : kind].filter(Boolean).join(' · ');
    body.append(title, el('p', 'media-tile-meta', meta));
    if (failed) body.append(failed);
    body.append(link);
    if (direct) article.append(direct);
    article.append(frame, body);
    return article;
  }
  function renderVideos() {
    videoGroups.replaceChildren();
    groups.forEach(function (group) {
      if (!group.items.length) return;
      var wrap = el('section', 'video-group'), head = el('div', 'media-head'), copy = el('div');
      wrap.dataset.creator = group.id;
      if (group.art) {
        var art = el('img', 'creator-art');
        art.alt = ''; art.loading = 'lazy'; art.decoding = 'async'; art.width = art.height = 56;
        art.onerror = function () { art.remove(); };
        art.src = group.art;
        head.append(art);
      }
      copy.append(el('h3', '', group.name));
      var credit = el('p', 'media-credit', group.items.length + (group.items.length === 1 ? ' video' : ' videos') + (group.channel ? ' · YouTube: ' : ''));
      if (group.channel) {
        var channel = el(group.channelUrl ? 'a' : 'span', '', group.channel);
        if (group.channelUrl) { channel.href = group.channelUrl; channel.target = '_blank'; channel.rel = 'noopener'; }
        credit.append(channel);
      }
      copy.append(credit); head.append(copy);
      var grid = el('div', 'video-grid');
      group.items.forEach(function (item) { grid.append(tile(item, group)); });
      wrap.append(head, grid);
      videoGroups.append(wrap);
    });
    videoEmpty.hidden = videoCount > 0;
    videoPicker.hidden = videoCount === 0;
    setFilter('all');
  }
  function setFilter(next) {
    stopVideos();
    filter = next;
    var options = [{ key: 'all', label: 'All creators', count: String(videoCount) }];
    groups.forEach(function (group) { if (group.items.length) options.push({ key: group.id, label: group.name, count: String(group.items.length) }); });
    renderPicker(videoPicker, options, filter, setFilter);
    videoGroups.querySelectorAll('.video-group').forEach(function (wrap) {
      wrap.hidden = filter !== 'all' && wrap.dataset.creator !== filter;
    });
  }

  // ---- Loading ----
  function load() {
    loadState = 'loading';
    status.hidden = false; status.textContent = 'Loading the media list…';
    fetch('media.json', { cache: 'no-cache' }).then(function (response) {
      if (!response.ok) throw new Error('Media list unavailable');
      return response.json();
    }).then(function (data) {
      parse(data || {});
      loadState = 'ready';
      status.hidden = true;
      renderVideos();
      var hasTracks = playlists.some(function (entry) { return entry.tracks.length; });
      setSection(section || (hasTracks || !videoCount ? 'music' : 'videos'));
      header();
    }).catch(function () {
      loadState = 'error';
      status.textContent = 'The media list could not load. Check your connection and refresh to try again.';
      setSection(section);
    });
  }
  musicTab.addEventListener('click', function () { setSection('music'); });
  videosTab.addEventListener('click', function () { setSection('videos'); });

  window.AllianceMedia = {
    show: function () {
      active = true; hub.hidden = false;
      header();
      if (loadState === 'idle' || loadState === 'error') load();
      else if (loadState === 'ready' && section === 'music') selectPlaylist(playlist);
    },
    hide: function () {
      active = false; stopAll(); hub.hidden = true;
    }
  };
})();
