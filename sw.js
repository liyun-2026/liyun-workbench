/* ══════════════════════════════════════════════════════════════════
   砺蕴工作系统 · App Shell 缓存（Service Worker）

   为什么需要它：
   这个站部署在境外节点（不备案路线），每次冷启动光跨境握手就要 ~1 秒。
   没有 SW 时，这 1 秒是白屏 —— 用户反馈的「开启页面有几秒停顿」就是它。
   有 SW 之后，从第二次打开起，index.html 直接从本地缓存出来，
   开屏动画立刻就能动，跨境那一秒被彻底盖掉。

   策略：
   · 页面导航（HTML）→ 缓存优先 + 后台悄悄取新；取到的新版本和缓存里的不一样
     就更新缓存 + postMessage('shell-updated')。activate 后客户端的 controller 也会
     切到新 SW → 浏览器自动派发 controllerchange → 主页 reload 一次拿到新版。
     这套双通道保证「页面开着也能自动升级」，用户**不再需要手刷**。
   · 其他同源静态资源 → 缓存优先 + 后台更新
   · /api/ 一律不插手 —— 数据必须实时，缓存了会出大事
   · 跨域资源（央视新闻、CDN）不插手
   · ocr/ 不预缓存（识别资源太大），交给浏览器自己的 HTTP 缓存

   ⚠️ 改了 sw.js 的缓存清单或策略，必须把 VERSION 加一，
      否则老 SW 不会重装、新清单永远不生效。
   ══════════════════════════════════════════════════════════════════ */

const VERSION = 'v25';  /* v25：super 端口松绿换朱砂红(#B23A2E)并整体重着朱砂色；浅底桌面图标改深墨圆底板；删除未用 icon.svg。v24：首位教务(super)独立松绿皮肤；侧栏/手机顶栏融合标缩至88px；登录门牌匾缩小(220/260) */     // v23：全系统换融合 Logo（横版并排透明）；登录页加朱砂红「砺」印、门头改融合标；开屏换融合标；新增四端皮肤（教师金/教务黛蓝/兼岗黛紫/学生水青）。v22：手机桌面图标换新品牌标（深墨底金字，icon.png/icon-192/apple-touch-icon 三件套）。v21：进群开场白改「哈喽，乖，欢迎加入博艺大家庭，下面是你的学生系统的账号和密码，注意查收哦」。v20：学生账号入口对三位教务开放(原先只有首位教务看得见)并从倒数第二挪到「名册」下面 + 名单可按班级排序/一键复制；名册里两个「＋新建班级」按钮和下拉里的「＋新建班级…」一并去掉（建班归页面上头的班级卡片）
const CACHE = 'liyun-shell-' + VERSION;

/* 开屏要用的东西全在这里 —— 预缓存后，第二次开就是本地读盘。 */
const SHELL = [
  './index.html',
  './manifest.json',
  './icon.png',
  './icon-192.png',
  './apple-touch-icon.png',
  './assets/brand-lock.png',
  './assets/brand-lock@sm.png',
  './assets/liyun-xingshu.woff2',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    /* ⚠️ 逐个 add、失败不抛出：某个图挂了不该让整个 SW 装不上 */
    await Promise.all(SHELL.map((u) =>
      cache.add(new Request(u, { cache: 'reload' })).catch(() => {})
    ));
    /* 取 index.html 的指纹——和上面那一次 cache.add 是同一份网络响应,
       这里只是为了算出 hash 用，不会重复下载 */
    await stamp(cache, await fetchAndHash('./index.html'));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    /* 清掉所有旧版本缓存（VERSION 变了会换名，旧的 liyun-shell-* 一律不要） */
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((k) => k.startsWith('liyun-shell-') && k !== CACHE)
      .map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

/* ── 取一份网络响应，顺手算出它的指纹（用来判断「变了没」） ── */
async function fetchAndHash(url) {
  try {
    const res = await fetch(new Request(url, { cache: 'reload' }));
    if (!res || !res.ok) return null;
    const buf = await res.arrayBuffer();
    let h = 5381;
    const v = new Uint8Array(buf);
    /* 隔 13 个字节采一次就足够区分两次部署，又几乎不花时间 */
    for (let i = 0; i < v.length; i += 13) h = ((h << 5) + h + v[i]) >>> 0;
    return { hash: h.toString(16) + ':' + v.length, bytes: v };
  } catch { return null; }
}

async function stamp(cache, info) {
  if (info) await cache.put('./__shellver', new Response(info.hash));
}
async function shellVer(cache) {
  const r = await cache.match('./__shellver');
  return r ? await r.text() : '';
}

/* ── 导航请求：缓存优先，后台比对；变了就叫页面刷一次 ── */
async function navStrategy(req, cache) {
  const cached = (await cache.match('./index.html')) || (await cache.match('./'));

  /* 后台取新版。注意它一定不能 await —— 页面先走，网络慢慢来 */
  const revalidate = (async () => {
    const info = await fetchAndHash('./index.html');
    if (!info) return;
    const old = await shellVer(cache);
    if (info.hash === old) return;               /* 没变，什么都不做 */
    await cache.put('./index.html', new Response(info.bytes, {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    }));
    await stamp(cache, info);
    /* 通知所有页面：壳子更新了。页面自己判断要不要立刻刷（只在开屏期刷） */
    const cs = await self.clients.matchAll({ type: 'window' });
    cs.forEach((c) => c.postMessage({ type: 'shell-updated' }));
  })();

  if (cached) {
    revalidate.catch(() => {});
    return cached;
  }
  /* 第一次访问还没有缓存：只能老老实实等网络 */
  const fresh = await fetch(req).catch(() => null);
  if (fresh && fresh.ok) {
    const copy = fresh.clone();
    cache.put('./index.html', copy).catch(() => {});
    stamp(cache, await fetchAndHash('./index.html')).catch(() => {});
  }
  return fresh || new Response('暂时打不开，请连上网络再试。', {
    status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

/* ── 静态资源：缓存优先，后台更新（下一次打开就是新版） ── */
async function assetStrategy(req, cache) {
  const cached = await cache.match(req);
  const net = fetch(req).then((res) => {
    if (res && res.ok && res.type === 'basic') cache.put(req, res.clone()).catch(() => {});
    return res;
  }).catch(() => null);

  if (cached) { net.catch(() => {}); return cached; }
  const fresh = await net;
  return fresh || new Response('', { status: 504 });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch { return; }
  if (url.origin !== self.location.origin) return;    /* 跨域：央视新闻、CDN 都不插手 */
  if (url.pathname.startsWith('/api/')) return;       /* 数据必须实时 */
  if (url.pathname.includes('/ocr/')) return;         /* 识别资源太大，不预缓存 */

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    return req.mode === 'navigate'
      ? navStrategy(req, cache)
      : assetStrategy(req, cache);
  })());
});

self.addEventListener('message', (e) => {
  const t = e.data && e.data.type;
  if (t === 'SKIP_WAITING') self.skipWaiting();
  /* 页面问「你现在跑的是第几版」—— 巡检页要显示本机存的是哪份 App Shell */
  if (t === 'PING'){
    const msg = { type:'PONG', version: VERSION };
    try {
      if (e.ports && e.ports[0]) e.ports[0].postMessage(msg);
      else if (e.source) e.source.postMessage(msg);
    } catch { /* 页面已经走了，没人听就算了 */ }
  }
});
