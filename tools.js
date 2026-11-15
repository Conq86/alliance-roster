(function () {
  'use strict';
  // Tools & Trackers landing hub. The tools site does not allow being shown inside other
  // pages, so this is a static launch card (markup in index.html) that opens it in its own
  // tab. Nothing external is requested until a member clicks the link. See README.
  var $ = function (id) { return document.getElementById(id); };
  var hub = $('toolsHub');

  window.AllianceTools = {
    show: function () {
      hub.hidden = false;
      $('gallerySubtitle').textContent = 'TOOLS & TRACKERS';
      $('galleryArtNote').textContent = 'Tools & Trackers by POW xD3V3LOP3Rx · opens in its own tab';
      document.title = 'Tools & Trackers | POW 713';
    },
    hide: function () { hub.hidden = true; }
  };
})();
