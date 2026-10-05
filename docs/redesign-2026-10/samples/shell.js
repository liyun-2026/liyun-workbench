/* 砺蕴教务系统 · 样张 · shell.js
   共享逻辑：壳渲染 / 路由 / 端口切换 / 时钟 / 时间轴游标 / 就地展开 / 印章 / 占比。
   IIFE + window.Shell（classic script，file:// 下可用，§3.2）。 */
(function () {
  'use strict';
  var D = window.D;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function p2(n) { return String(n).padStart(2, '0'); }
  function hhmm(min) { return p2(Math.floor(min / 60)) + ':' + p2(min % 60); }
  function ic(id) { return '<svg class="ic" aria-hidden="true"><use href="#' + id + '"></use></svg>'; }

  var state = { port: 'port1', page: 'home' };   /* F11：port1=教师·教务 / port2=学生 / port3=管理 */

  /* ── 壳：侧栏 / 顶栏 / 标签栏 ─────────────────────────────────────────── */
  function mountChrome() {
    var nav = $('#nav');
    if (nav) {
      var navData = D.NAV[state.port] || D.NAV.port1;
      nav.innerHTML = '<div class="brand">砺蕴</div>' +
        '<div class="greet">' + (state.port === 'port2' ? '同学你好' : '李蕴老师，下午好') + '</div>' +
        '<div class="nav"></div>' +
        '<div class="side-foot"><div class="hint" style="color:inherit">端口</div>' +
        '<div class="portsw">' + D.PORTS.map(function (p) {
          return '<button type="button" data-port="' + p.id + '" aria-pressed="' + (p.id === state.port) + '">' + p.label.replace('·教务', '') + '</button>';
        }).join('') + '</div></div>';
      var list = $('.nav', nav);
      navData.forEach(function (grp) {
        list.appendChild(el('div', 'gcap', grp.g));
        grp.items.forEach(function (it) {
          var b = el('button', null, ic(it.icon) + '<span>' + it.label + '</span>');
          b.type = 'button';
          if (it.noop) b.setAttribute('data-noop', '1');
          else b.setAttribute('data-go', it.id);
          list.appendChild(b);
        });
      });
      nav.addEventListener('click', function (e) {
        var pb = e.target.closest('.portsw button');
        if (pb) { setPort(pb.getAttribute('data-port')); return; }
      });
    }

    var tb = $('#topbar');
    if (tb) {
      var titles = { home: '今日', att: '考勤', roster: '名册', homework: '作业', settings: '设置' };
      tb.innerHTML = '<span class="t-title">' + (titles[state.page] || '今日') + '</span>' +
        '<span class="t-right num">' + D.today() + ' · <span data-clock>--:--:--</span></span>';
    }

    var tab = $('#tabbar');
    if (tab) {
      var all = {};
      Object.keys(D.NAV).forEach(function (r) { D.NAV[r].forEach(function (g) { g.items.forEach(function (i) { all[i.id] = i; }); }); });
      tab.innerHTML = D.TABBAR.map(function (id) {
        var it = all[id] || { label: id, icon: 'ic-target' };
        return '<button type="button" data-go="' + id + '">' + ic(it.icon) + '<span>' + it.label + '</span></button>';
      }).join('');
    }
  }

  /* ── 路由 ─────────────────────────────────────────────────────────────── */
  function go(page) {
    if (!$('#page-' + page)) {              /* 多文件样张：本页没有该 section → 切到另一份 HTML */
      if ($('.page')) location.href = page + '.html';
      return;
    }
    state.page = page;
    document.body.setAttribute('data-page', page);
    $$('.page').forEach(function (p) { p.classList.toggle('on', p.id === 'page-' + page); });
    $$('[data-go]').forEach(function (b) {
      var on = b.getAttribute('data-go') === page;
      if (b.closest('.side') || b.closest('.tabbar') || b.closest('.anchor-nav')) {
        if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
      }
    });
    var titles = { home: '今日', att: '考勤', roster: '名册', homework: '作业', settings: '设置' };
    var t = $('.topbar .t-title'); if (t) t.textContent = titles[page] || page;
    try { history.replaceState(null, '', '#' + page); } catch (e) {}   /* F8：异常 origin 下不中断整页 init */
    updateCursor();
  }

  function setPort(port) {
    state.port = port;
    document.documentElement.setAttribute('data-port', port);
    try { localStorage.setItem('ly_sample_port', port); } catch (e) {}
    var oldNav = $('#nav'); if (oldNav) oldNav.innerHTML = '';
    mountChrome();
    go(state.page);
    if (window.PAGE_PORT_CHANGED) window.PAGE_PORT_CHANGED(port);   /* 页面按端口重绘节点 */
    toast('端口：' + ((D.PORTS.find(function (p) { return p.id === port; }) || {}).label || port));
  }

  /* ── 时钟 + 时间轴游标（§2.1.3：随分钟走，不每秒写样式）────────────────── */
  function clock() {
    var d = new Date(), s = p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds());
    $$('[data-clock]').forEach(function (e) { if (e.textContent !== s) e.textContent = s; });
  }
  var lastMin = -1;
  function updateCursor() {
    var rng = D.dayRange(), now = D.nowMin();
    var at = Math.max(0, Math.min(1, (now - rng.start) / Math.max(1, rng.end - rng.start))) * 100;
    $$('.tl-now').forEach(function (e) {
      e.style.setProperty('--at', at.toFixed(2) + '%');
      var lab = $('.tl-now-t', e); if (lab) lab.textContent = '现在 ' + hhmm(now);
    });
    $$('.tl-tick').forEach(function (li) {
      var s = +li.getAttribute('data-start'), e2 = +li.getAttribute('data-end');
      li.classList.toggle('is-now', now >= s && now < e2);
      li.classList.toggle('is-past', now >= e2);
      li.classList.toggle('is-future', now < s);
    });
    var nxt = null, ps = D.periodsSorted();
    for (var i = 0; i < ps.length; i++) { if (D.tmin(ps[i].start) > now) { nxt = ps[i]; break; } }
    $$('[data-next]').forEach(function (e) {
      if (!nxt) { e.textContent = '今日课节已结束'; return; }
      e.textContent = '距「' + nxt.name + '」' + (D.tmin(nxt.start) - now) + ' 分钟';
    });
    window.dispatchEvent(new Event('shell:cursor'));   /* 页面可据真实 DOM 位置微调游标 */
  }

  /* ── 就地展开（§2.1.4）────────────────────────────────────────────────── */
  function bindExpand(scope) {
    (scope || document).addEventListener('click', function (e) {
      var b = e.target.closest('.tl-node');
      if (!b) return;
      var open = b.getAttribute('data-open') === '1';
      b.setAttribute('data-open', open ? '0' : '1');
      b.setAttribute('aria-expanded', String(!open));
      var body = b.parentElement.querySelector('.tl-body');
      if (body) body.hidden = open;
    });
  }

  /* ── 印章状态机（§2.2）────────────────────────────────────────────────── */
  var Stamp = {
    cycle: function (btn) {
      if (btn.getAttribute('aria-disabled') === 'true') return;
      var cur = btn.getAttribute('data-s');
      var k = D.STAMP_CYCLE.indexOf(cur);
      var next = k < 0 ? D.STAMP_CYCLE[0] : D.STAMP_CYCLE[(k + 1) % D.STAMP_CYCLE.length];
      Stamp.set(btn, next);
    },
    set: function (btn, st) {
      btn.setAttribute('data-s', st);
      btn.textContent = st === 'none' ? '未登记' : st;
      var name = btn.getAttribute('data-name') || '';
      btn.setAttribute('aria-label', name + ' 当前状态 ' + (st === 'none' ? '未登记' : st) + '，点击修改');
      btn.classList.remove('flash'); void btn.offsetWidth; btn.classList.add('flash');
    }
  };

  /* ── 占比条 + 小结（§2.2）─────────────────────────────────────────────── */
  function refreshSummary() {
    var stamps = $$('#roster .stamp');
    if (!stamps.length) return;
    var c = { '正常': 0, '迟到': 0, '病假': 0, '事假': 0, 'none': 0 };
    stamps.forEach(function (s) { var v = s.getAttribute('data-s'); if (c[v] != null) c[v]++; });
    var total = stamps.length, ok = c['正常'], bad = c['迟到'] + c['病假'] + c['事假'], none = c.none;
    var map = { '[data-sum=total]': total, '[data-sum=ok]': ok, '[data-sum=bad]': bad, '[data-sum=none]': none };
    Object.keys(map).forEach(function (sel) { var e = $(sel); if (e) e.textContent = map[sel]; });
    var bars = { ok: ok, late: c['迟到'], sick: c['病假'], leave: c['事假'] };
    Object.keys(bars).forEach(function (k) {
      var e = $('.ratio .' + k); if (e) e.style.flex = String(bars[k]);
    });
    [['ok', '正常'], ['late', '迟到'], ['sick', '病假'], ['leave', '事假']].forEach(function (p) {
      var e = $('[data-leg=' + p[0] + ']'); if (e) e.textContent = p[1] + ' ' + c[p[1]];
    });
  }

  /* ── toast ────────────────────────────────────────────────────────────── */
  var toastEl, toastTimer;
  function toast(msg) {
    if (!toastEl) {
      toastEl = el('div', null, '');
      toastEl.style.cssText = 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:60;' +
        'background:var(--text);color:var(--bg);font-size:14px;padding:9px 18px;border-radius:var(--r-pill);' +
        'box-shadow:var(--sh-2);opacity:0;transition:opacity var(--dur-base) var(--ease-base);pointer-events:none';
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.style.opacity = '0'; }, 1600);
  }

  /* ── 通用初始化 ───────────────────────────────────────────────────────── */
  function init() {
    if (window.Icons) Icons.inject();
    try { var saved = localStorage.getItem('ly_sample_port'); if (saved) state.port = saved; } catch (e) {}
    var sec = document.querySelector('.page');
    var own = sec ? sec.id.replace('page-', '') : 'home';
    var hs = (location.hash || '').replace('#', '');
    state.page = (hs && hs === own) ? hs : own;      /* 以本文档实际页面为准 */
    document.body.setAttribute('data-page', state.page);
    document.documentElement.setAttribute('data-port', state.port);
    mountChrome();

    document.addEventListener('click', function (e) {
      var nb = e.target.closest('[data-noop]');
      if (nb) { e.preventDefault(); toast('本轮 5 页样张：' + (nb.textContent || '').trim() + ' 不在范围内'); return; }
      var gb = e.target.closest('[data-go]');
      if (gb) { e.preventDefault(); go(gb.getAttribute('data-go')); return; }
      var sb = e.target.closest('.stamp');
      if (sb) { Stamp.cycle(sb); refreshSummary(); }
    });
    bindExpand(document);

    go(state.page);
    clock(); setInterval(clock, 1000);
    updateCursor(); setInterval(function () { var m = D.nowMin(); if (m !== lastMin) { lastMin = m; updateCursor(); } }, 5000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) { clock(); updateCursor(); } });
    window.addEventListener('hashchange', function () { go((location.hash || '#home').replace('#', '')); });
    window.addEventListener('resize', function () { updateCursor(); });

    if (typeof window.PAGE_INIT === 'function') window.PAGE_INIT();
    window.dispatchEvent(new Event('shell:ready'));
  }

  window.Shell = {
    state: state, go: go, setPort: setPort, clock: clock, updateCursor: updateCursor,
    mountChrome: mountChrome, refreshSummary: refreshSummary, toast: toast,
    Stamp: Stamp, ic: ic, el: el, $: $, $$: $$, p2: p2, hhmm: hhmm
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
