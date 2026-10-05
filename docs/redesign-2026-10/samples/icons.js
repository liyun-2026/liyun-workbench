/* 砺蕴教务系统 · 样张 · icons.js
   图标 sprite：一次注入，5 页共用（<symbol> + <use>，零依赖）。 */
(function () {
  var SPRITE = '' +
    '<symbol id="ic-target" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></symbol>' +
    '<symbol id="ic-clipboard" viewBox="0 0 24 24"><rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4V3h6v1"/><path d="M9 11h6M9 15h6M9 19h4"/></symbol>' +
    '<symbol id="ic-pin" viewBox="0 0 24 24"><path d="M12 21s7-6 7-11a7 7 0 1 0-14 0c0 5 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/></symbol>' +
    '<symbol id="ic-memo" viewBox="0 0 24 24"><rect x="5" y="4" width="14" height="16" rx="2"/><path d="M8 9h8M8 13h8M8 17h5"/></symbol>' +
    '<symbol id="ic-users" viewBox="0 0 24 24"><circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M16 6.4a3 3 0 0 1 0 5.8"/><path d="M21 20c0-2.4-1.2-4-3-4.8"/></symbol>' +
    '<symbol id="ic-grad" viewBox="0 0 24 24"><path d="M12 4l9 4-9 4-9-4z"/><path d="M7 9v5c0 1.7 2.2 3 5 3s5-1.3 5-3V9"/><path d="M21 8v4"/></symbol>' +
    '<symbol id="ic-card" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8" cy="11" r="2"/><path d="M5 16c0-1.5 1.5-2.5 3-2.5s3 1 3 2.5"/><path d="M14 9h5M14 13h5"/></symbol>' +
    '<symbol id="ic-calendar" viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 9h16M8 3v4M16 3v4"/></symbol>' +
    '<symbol id="ic-moon" viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 1 1 9.5 4 6.5 6.5 0 0 0 20 14.5Z"/></symbol>' +
    '<symbol id="ic-chart" viewBox="0 0 24 24"><path d="M4 20h16"/><path d="M7 20v-6M12 20V8M17 20v-9"/></symbol>' +
    '<symbol id="ic-mic" viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3M9 21h6"/></symbol>' +
    '<symbol id="ic-inbox" viewBox="0 0 24 24"><path d="M3 13l3-8h12l3 8v6H3z"/><path d="M3 13h5l1 3h6l1-3h5"/></symbol>' +
    '<symbol id="ic-megaphone" viewBox="0 0 24 24"><path d="M4 10v4a1 1 0 0 0 1 1h2l8 4V5L7 9H5a1 1 0 0 0-1 1Z"/><path d="M20 9a4 4 0 0 1 0 6"/></symbol>' +
    '<symbol id="ic-pulse" viewBox="0 0 24 24"><path d="M3 12h4l2-6 4 12 2-6h6"/></symbol>' +
    '<symbol id="ic-gear" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/></symbol>' +
    '<symbol id="ic-teacher" viewBox="0 0 24 24"><rect x="3" y="4" width="13" height="10" rx="1"/><path d="M6 8h7M6 11h5"/><circle cx="19" cy="17" r="2.2"/><path d="M17.5 21c0-1.8 1-3 1.5-3s1.5 1.2 1.5 3"/></symbol>' +
    '<symbol id="ic-clock" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></symbol>' +
    '<symbol id="ic-check" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7"/></symbol>' +
    '<symbol id="ic-export" viewBox="0 0 24 24"><path d="M12 3v9m0 0l-4-4m4 4l4-4"/><path d="M4 14h16v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/></symbol>' +
    '<symbol id="ic-hand" viewBox="0 0 24 24"><path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V11M12 11V4.5a1.5 1.5 0 0 1 3 0V11M15 11V6.5a1.5 1.5 0 0 1 3 0V13a6 6 0 0 1-6 6h-2a5 5 0 0 1-4-2l-3-4a1.6 1.6 0 0 1 2.5-2L9 12"/></symbol>' +
    '<symbol id="ic-plus" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></symbol>' +
    '<symbol id="ic-chevron" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></symbol>' +
    '<symbol id="ic-shield" viewBox="0 0 24 24"><path d="M12 3l7 3v6c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6z"/><path d="M9 12l2 2 4-4"/></symbol>' +
    '<symbol id="ic-download" viewBox="0 0 24 24"><path d="M12 3v11m0 0l-4-4m4 4l4-4"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></symbol>';

  function inject() {
    if (document.getElementById('ly-sprite')) return;
    var d = document.createElement('div');
    d.setAttribute('aria-hidden', 'true');
    d.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
    d.innerHTML = '<svg id="ly-sprite" xmlns="http://www.w3.org/2000/svg" focusable="false">' + SPRITE + '</svg>';
    document.body.insertBefore(d, document.body.firstChild);
  }
  window.Icons = { sprite: SPRITE, inject: inject };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inject);
  else inject();
})();
