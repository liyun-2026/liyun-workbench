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

const VERSION = 'v37';  /* v37：看板端版面重做 —— 从「上时钟下卡片」的仪表盘换成「航显分带」（像机场的航班显示屏）：顶带（品牌 / 大时钟 / 日期 /「已到 30 37」/ 数据新鲜度），中带（左＝今日打卡码，整屏最大的一块，学生站门口就该看清；右＝6 格数字矩阵 应到/已到/迟到/请假/未到/距上课 ＋ 未到名单），底带（今日课表横向跑马灯）。旧版最大的毛病是下半屏常年空着半块。配套三处：① 码字号按「码栏 ≈ 视口 58%」重推（13.5vw，上限 265px），clock 挪进顶带后重叠判据从「左不压右」改成「上不压下」；② 右栏名单装得下时挂 .fit 居中摆着、塞不下才复制一份上滚（居中与滚动不能同时上，会两头露不出来）；③ 新增「一键新建看板专用教务号」（Board.createAccount，只有首位教务看得见那个按钮）—— 每个账号只有 2 台设备额度，拿自己的号登看板电脑会把自己手机或常用的那台挤下线。test/board_check.mjs 的 21 项判据同步更新。 */  /* v36：新增「看板端」—— 办公室那台电脑挂着的只读副屏（当前时间 / 今日打卡码 / 来了多少人 / 谁还没到 / 今天上什么课）。有 route 但不进 NAV_ORDER，入口只有设置页那张卡，或网址带 ?board=1（Windows 桌面快捷方式写死这条，开机就落在看板上）；App.go 里 board 不写 _lastPage，不带参数重开仍回工作台。取数全走现成的 Store 与 Auth.call('code')，不新增接口、不新增文件（SHELL 不变）。落地上踩到两处：① 宽屏那条 .page.on{display:grid;grid-template-columns:repeat(2,1fr)} 会把看板切掉一半（1600 宽的窗里只剩 800），须在 board-mode 下掰回单列并放开 ≥1700px 的 max-width:1400px；② 系统里已有通用 .ok{background:#eafaf0}，「已到」那块被吃掉一片浅绿底，故统计色类名一律改 bd- 前缀。新增 test/board_check.mjs（真机 21 项）。 */  /* v35：修「一进站开场动画跳两三次」。根因是换版重载：新 SW activate+claim 会派发 controllerchange，页面收到就 location.reload()；而旧版的守门变量 window._swReloading 挺不过 reload，SW 又有 controllerchange 与 shell-updated 两条通知路径，部署窗口里缓存指纹还可能对不上 —— 实测首次访问 2 次文档加载，第二次落在 t+6.7s/t+18s，人已经在用了才重放，所以「像故障」。现在：① 只有开屏层还盖着时才借换版重载，且每个会话最多一次（sessionStorage），过了开屏期就不刷、留到下次打开自然生效（缓存已是新版，仍不用手刷）；② 重载那一趟写 liyun_quiet_reload 标记，新文档直接撤掉开屏层 —— 用户看到的永远是一整段连续动画；③ 开屏保底显示 700ms→1200ms、淡出 .4s→.55s、金环描绘 1.5s→1.1s（画得完），整体变成一次从容的入场而不是几次闪烁；④ 本文件 install 与 navStrategy 里 index.html 改为「取一次、正文与指纹同一份字节」——原先取两次，CDN 传播窗口里会正文/指纹不匹配，误判成「壳子更新了」再刷一次（开场动画跳第三次的来源）。新增实测脚本 test/splash_probe.mjs。 */  /* v34：量化细则从「设置」里拆成独立页 —— 那张表近 30 条、每条都是可编辑的「名目 + 分值」输入框，整块塞在设置里把设置页撑到 ~5300px（手机要滑好久），密集输入框还容易误触改错分值。现在：设置页只留一张「量化细则」入口卡（照「老师管理」那张卡的样子，卡上一句「共 N 条计分项」+「打开量化细则」按钮）；加减分 / 加新条目 / 传图识别全搬到新页 page-rules，底部有「返回设置」。新页有 route 但**不进 NAV_ORDER** —— 侧栏 / 底部标签栏 / 全部功能抽屉三处都不出现，只有教务端从设置页那张卡能进，老师与学生拿不到（App.can 与服务端角色都拦）。实测设置页 5300→3028px，细则卡由最大一块缩到 173px。回归新增 test/rules_page_check.mjs（真机 6 项）与 redesign 第七节（5 项）。 */  /* v33：五端皮肤换「云淡」版 —— ① 侧栏/底栏(----rail)由端口**深色面**改为**浅色面**，上面压深端口色字（师珊瑚/教霁蓝/兼铜绿/学石绿/首赤金），彻底去掉压屏的深色块；② 整页底 --bg 由「几乎和旧中性底 #f6f5f2 一样」改为**看得出来的浅端口色**（这就是「顶栏是端口色、底色还是老颜色」的根因）；③ 新增 --rail-art（桌面侧栏白描的线条色）——素材是纯白线条，浅栏上原本会消失，改用 CSS mask 着色；④ 手机底栏胶囊阴影改走 --shadow-lg、侧栏门头白牌去掉重投影。CSS 五端块由 test/gen_port_theme.py 生成，体检脚本 test/diag_ports.mjs。 */  /* v32：① 电脑端侧栏（≥700px）由「三层传统暗纹」换成「花鸟白描小品」——把用户上传的竹石/松鹤/兰花三张水墨图抽成白线蒙版(assets/sideart/{zhushi,songhe,lanhua}_lite.png，更淡一档)，按端口沉底一枚(82% 栏宽)：教师=竹石、兼岗=竹石、教务=兰花、学生=兰花、首位教务=松鹤；一张图五端通用、颜色走端口 --rail。② 手机端 .tabbar / .topbar 彻底去纹样，纯色面（用户要求「简单大方」）。旧的「五端复合暗纹」整块删除，index.html 注入块改为「五端·桌面侧栏白描画」；本文件 SHELL 新增上述 3 个 png。 */  /* v31：① 浏览器标签页小图标(favicon)由「深墨底 PWA 图标」换成「带米黄底 + 金纹」的砺蕴圆章 —— 新增 favicon.ico(16/32/48) 与 favicon-192.png，`<link rel="icon">` 改指它们并带 ?v=31 强制刷新；桌面/PWA 图标(icon*.png/apple-touch-icon)按用户要求不动。② 五端暗纹整体调淡一档（用户反馈「花纹还是太明显、太明显了容易挡着字」）：rail 面 0.32/0.55/0.70 → 0.18/0.30/0.34，顶栏面 0.12/0.18/0.22 → 0.07/0.10/0.12。③ 手机底部标签栏放大：图标 19→23px、文字 10→12px、胶囊内边距 7→8px、内容区底部留白 108→120px。 */  /* v30：砺蕴网页 logo 由「透明细金线版」换成「带米黄底 + 金纹加粗版」；重建 assets/brand-lock{,@sm}.png 并重出 28 张启动图。 */  /* v29：五端配色落地甲方案终版（师珊瑚/教霁蓝/兼铜绿/学石绿/首赤金，师↔首互换、兼岗定铜绿）；新增五端复合暗纹（地纹+藤蔓+花头三层传统纹样 data-URI 背景注入侧栏/手机顶栏/底栏，内容区保持干净；浅深底各异）；学生打卡圈配色同步石绿。 */  /* v28：全站 emoji 小标识统一替换为内联 SVG 线性图标（52 枚，跨平台像素一致）；删除旧 logo 资产(boyi-/li/yun/logo-liyun)与废弃的 icon-light-* 桌面图标，SW 预缓存清单不变。v27：① 修手机顶栏 Logo「缩不小」——根因是 .topbar 里没有宽度规则，图片落到 .brand-lock 的 width:auto 上按自身像素(384×162)铺开，顶栏被撑到 183px 高；现在显式钉 88px，顶栏降到 56px。② 四端整页主题化：新增 --tint(次级面)/--rail(侧栏·底栏深色面)/--rail-text/--rail-on 四个变量，手机顶栏+底部标签栏、电脑侧栏+画布全部走端口色；侧栏门头改浅色牌（保住博艺徽章的蓝白）。③ theme-color 跟着端口走（状态栏也变色）。④ 手机 .main 不再重复吃 safe-area-inset-top（原先顶部平白多 59px）。⑤ 清掉失效的 --sidebar/--sidebar-text 与旧 logo 资产。⑥ super 端口朱砂红(#B23A2E)换竹青(#4E7A53)（用户从中国传统色中选定，浅/深两套 --accent 与 --rail 一并协调）。v26：登录门改 D 方案（去朱砂「砺」落款→底部黑字「博艺教育·砺蕴2026」；加黑色「欢迎回来」）；开屏改动画2（金线描绘圆环+融合标落底板淡入，纹路更清晰）；重出 28 张启动图并修 Chrome 最小窗宽钳制导致的偏心。v25：super 端口松绿换朱砂红(#B23A2E)并整体重着朱砂色；浅底桌面图标改深墨圆底板；删除未用 icon.svg。v24：首位教务(super)独立松绿皮肤；侧栏/手机顶栏融合标缩至88px；登录门牌匾缩小(220/260) */     // v23：全系统换融合 Logo（横版并排透明）；登录页加朱砂红「砺」印、门头改融合标；开屏换融合标；新增四端皮肤（教师金/教务黛蓝/兼岗黛紫/学生水青）。v22：手机桌面图标换新品牌标（深墨底金字，icon.png/icon-192/apple-touch-icon 三件套）。v21：进群开场白改「哈喽，乖，欢迎加入博艺大家庭，下面是你的学生系统的账号和密码，注意查收哦」。v20：学生账号入口对三位教务开放(原先只有首位教务看得见)并从倒数第二挪到「名册」下面 + 名单可按班级排序/一键复制；名册里两个「＋新建班级」按钮和下拉里的「＋新建班级…」一并去掉（建班归页面上头的班级卡片）
const CACHE = 'liyun-shell-' + VERSION;

/* 开屏要用的东西全在这里 —— 预缓存后，第二次开就是本地读盘。 */
const SHELL = [
  './index.html',
  './manifest.json',
  './icon.png',
  './icon-192.png',
  './apple-touch-icon.png',
  './favicon.ico',
  './favicon-192.png',
  './assets/brand-lock.png',
  './assets/brand-lock@sm.png',
  './assets/liyun-xingshu.woff2',
  './assets/sideart/zhushi_lite.png',
  './assets/sideart/lanhua_lite.png',
  './assets/sideart/songhe_lite.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    /* index.html 单独取：正文和指纹都用**同一份字节**（原因见 fetchShell 上的注释）。
       其余静态资源照旧逐个 add、失败不抛出：某个图挂了不该让整个 SW 装不上。 */
    const info = await fetchShell();
    if (info) {
      await cache.put('./index.html', new Response(info.bytes, {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })).catch(() => {});
      await stamp(cache, info);
    }
    await Promise.all(SHELL.filter((u) => u !== './index.html').map((u) =>
      cache.add(new Request(u, { cache: 'reload' })).catch(() => {})
    ));
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

/* ── 取一份网络响应，顺手算出它的指纹（用来判断「变了没」） ──
   ⚠️ 正文和指纹必须来自**同一次** fetch。
   早先 install 里对 index.html 取了两次（cache.add 一次、算指纹再一次），
   部署刚推上 CDN 的 30~75 秒里边缘节点可能一次给旧版、一次给新版，于是
   「缓存里的正文」和「__shellver 指纹」对不上 → 下次导航被误判成「壳子更新了」
   → 又发一次 shell-updated 让页面重载。实测那是开场动画跳第三次的来源。 */
function hashOf(buf) {
  let h = 5381;
  const v = new Uint8Array(buf);
  /* 隔 13 个字节采一次就足够区分两次部署，又几乎不花时间 */
  for (let i = 0; i < v.length; i += 13) h = ((h << 5) + h + v[i]) >>> 0;
  return h.toString(16) + ':' + v.length;
}

async function fetchShell() {
  try {
    const res = await fetch(new Request('./index.html', { cache: 'reload' }));
    if (!res || !res.ok) return null;
    const bytes = await res.arrayBuffer();
    return { bytes: bytes, hash: hashOf(bytes) };
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
    const info = await fetchShell();
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
  /* 第一次访问还没有缓存：只能老老实实等网络。
     正文和指纹用同一份字节（见 fetchShell 上的注释）。 */
  const fresh = await fetch(req).catch(() => null);
  if (fresh && fresh.ok) {
    try {
      const bytes = await fresh.clone().arrayBuffer();
      const info = { bytes: bytes, hash: hashOf(bytes) };
      await cache.put('./index.html', new Response(bytes, {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }));
      await stamp(cache, info);
    } catch { /* 缓存写失败不该影响这次访问 */ }
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
