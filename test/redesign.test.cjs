/**
 * 改版专项测试 —— 检验「手机 / 电脑各自一套版式」+「三种角色的功能分配」
 *
 *   用法（先指到装了 jsdom 的地方）：
 *     NODE_PATH=/Users/xielihui/.workbuddy/skills/bys-personal-dashboard/node_modules \
 *       node test/redesign.test.cjs
 *
 * 为什么单独一个文件：这两件事是这次改版的需求本身，光靠通用冒烟测试守不住。
 *   · 版式：手机骨架（顶栏+底部标签栏+抽屉）默认在、电脑的侧边栏和 .split 只在 ≥700/1100px 出现。
 *   · 角色：教务端 / 老师端各自能看到的页面、能不能切过去，以及老师录入的数据写到哪儿。
 */
const fs = require('fs');
const path = require('path');

let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch {
  console.error('需要 jsdom。用这个跑：\n  NODE_PATH=<装了jsdom的node_modules> node test/redesign.test.cjs');
  process.exit(2);
}

const dir = path.join(__dirname, '..');
const file = path.join(dir, 'index.html');
const html = fs.readFileSync(file, 'utf8');

const pass = [], fail = [];
const t = (name, fn) => {
  try { fn(); pass.push(name); console.log('  \x1b[32m✓\x1b[0m ' + name); }
  catch (e) { fail.push(name + ' → ' + e.message); console.log('  \x1b[31m✗\x1b[0m ' + name + ' → ' + e.message); }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b), `${m || ''} 期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}`);

/* ───────────────── 一、版式骨架（不依赖角色） ───────────────── */
console.log('\n=== 一、双端版式骨架 ===');
{
  t('手机骨架齐活：顶栏 / 底部标签栏 / 抽屉 / 登录门', () => {
    ['class="topbar"', 'id="topName"', 'class="tabbar"', 'id="tabs"',
     'class="drawer"', 'id="dgrid"', 'id="gate"', 'id="gUser"', 'id="gPass"']
      .forEach(sig => assert(html.includes(sig), '缺了 ' + sig));
  });

  t('电脑侧边栏存在，且 nav 在里面', () => {
    const side = html.match(/<aside class="side">([\s\S]*?)<\/aside>/);
    assert(side, '找不到 aside.side（电脑端侧边栏）');
    assert(side[1].includes('id="nav"'), '导航没放进侧边栏里');
  });

  t('默认（手机）侧边栏是收起的', () => {
    // 手机不带媒体查询那条 .side{display:none}
    const mobile = html.match(/\.side\{[^}]*display:none[^}]*\}/);
    assert(mobile, '手机下侧边栏应默认 display:none，否则窄屏会挤爆');
  });

  t('≥700px 展开侧边栏，≥1100px 走三栏 .split', () => {
    /* ⚠️ index.html 里 ≥700px 的媒体查询不止一条（最早一条是学生端水印），
       直接 .*?\}\n 这种非贪婪写法会立刻在第一条块内 `}` 处停下来抓个空 body 回来。
       正确写法：直接让正则把「.side{display:flex}」作为锚点，匹配到它就证明这个 ≥700px 块存在。*/
    const m700 = html.match(/@media\s*\(min-width:\s*700px\)\s*\{[\s\S]*?\.side\{[^}]*display:flex[\s\S]*?\n\s*\}/);
    assert(m700, '≥700px 这一档媒体查询里应有 .side{display:flex}（平板上要能看到侧边栏）');
    assert(html.includes('@media (min-width:1100px)') || html.includes('@media (min-width: 1100px)'),
      '缺少 ≥1100px 这一档（电脑上要能多列）');
    assert(/\.split\{/.test(html), '缺少 .split 三栏布局');
  });

  t('手机底部标签栏最多 5 个（再多就挤成一团了）', () => {
    const m = html.match(/renderChrome\(\)\{[\s\S]*?\n  \},/);
    assert(m, '找不到 renderChrome');
    assert(/slice\(0,\s*5\)/.test(m[0]), '底部标签栏要限制在 5 个以内');
  });
}

/* ───────────────── 二、按角色启动 ───────────────── */
const ROLES = {
  super:   { id:'u_super',  user:'owner', name:'首位教务', role:'super',   isStaff:true,  isSuper:true,  classIds:[] },
  admin:   { id:'u_admin',  user:'jiao2', name:'王教务',   role:'admin',   isStaff:true,  isSuper:false, classIds:[] },
  teacher: { id:'u_teach',  user:'t1',    name:'张老师',   role:'teacher', isStaff:false, isSuper:false, classIds:['c1'] },
};

/** 用假身份启动一次工作台，返回窗口内的句柄。
    url 可换 —— 「本机预览」和「正式网址」的界面差别就靠它验（见第七节）。 */
function boot(profile, seed = {}, url = 'https://redesign.test/'){
  const nav = { count: 0 };          // 有几处代码尝试跳转/刷新（见下）
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url,
    beforeParse(window){
      window.localStorage.setItem('bysdash$secret:token', JSON.stringify('test-token'));
      for (const [k, v] of Object.entries(seed))
        window.localStorage.setItem('bysdash:' + k, JSON.stringify(v));
      window.fetch = async (url, opt) => {
        let body = {};
        try { body = JSON.parse((opt && opt.body) || '{}'); } catch {}
        const payload = body.action === 'users'
          ? { ok:true, users:[profile], ownerId:profile.id }
          : { ok:true, profile, shared:{}, personal:{}, token:'test-token' };
        return { ok:true, status:200, json: async () => payload };
      };
    },
    virtualConsole: new (require('jsdom').VirtualConsole)().on('jsdomError', e => {
      if (/Could not parse CSS/i.test(e.message)) return;
      /* jsdom 没法真跳转。代码里 logout / resetLocal 结尾都会 location.reload()，
         那不是页面出错，记一笔就行（location.reload 是访问器属性，补不掉） */
      if (/Not implemented: navigation/i.test(e.message)) { nav.count++; return; }
      throw new Error('页面抛出未捕获错误 → ' + e.message);
    })
  });
  const w = dom.window;
  const G = n => { try { return w.eval(n); } catch { return undefined; } };
  return { w, d: w.document, G, nav };
}

const settle = () => new Promise(r => setTimeout(r, 100));

/** 启动一个「没有后台」的窗口：fetch 一律失败。
    url 决定这是本机入口（localhost / file://）还是正式网址 —— 两者行为刻意不同，
    所以 url 是必传的观察点，别用默认值糊过去。 */
function bootNoBackend(seed = {}, url = 'http://localhost:5173/'){
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url,
    beforeParse(window){
      for (const [k, v] of Object.entries(seed))
        window.localStorage.setItem(k.includes(':') ? k : 'bysdash:' + k, JSON.stringify(v));
      window.fetch = async () => { throw new TypeError('Failed to fetch'); };
    },
    virtualConsole: new (require('jsdom').VirtualConsole)().on('jsdomError', e => {
      if (/Could not parse CSS/i.test(e.message)) return;
      if (/Not implemented: navigation/i.test(e.message)) return;
      throw new Error('页面抛出未捕获错误 → ' + e.message);
    })
  });
  const w = dom.window;
  const G = n => { try { return w.eval(n); } catch { return undefined; } };
  return { w, G };
}

(async () => {
  console.log('\n=== 二、角色能看到的页面 ===');
  const expected = {
    /* sign(打卡管理) / students(学生账号) / health(巡检) 是 v15+ 后来加的;
       gather(限时征集) 是教务端给学生发起限时征集用的入口。 */
    super:   ['home','att','sign','homework','roster','profile','timetable','night','quant','exam','coop','gather','teachers','students','health','settings'],
    admin:   ['home','att','sign','homework','roster','profile','timetable','night','quant','exam','coop','gather','settings'],
    teacher: ['today','news','record','myclass','profile','tickets','settings'],
  };

  for (const [role, want] of Object.entries(expected)){
    const { d, G } = boot(ROLES[role]);
    await settle();
    const App = G('App');

    t(`【${role}】功能表正确（${want.length} 项）`, () => {
      assert(App, 'App 没起来');
      eq(App.visible().map(r => r.id), want, role + ' 的功能表');
    });

    t(`【${role}】侧边栏与底部标签栏都画出来了`, () => {
      eq(d.querySelectorAll('#nav button').length, want.length, '侧边栏数量');
      const tabs = d.querySelectorAll('#tabs button').length;
      assert(tabs > 0 && tabs <= 5, `底部标签栏应是 1~5 个，实际 ${tabs}`);
      eq(d.querySelectorAll('#dgrid button').length, want.length, '抽屉里的数量');
    });

    t(`【${role}】每个功能都能切过去`, () => {
      want.forEach(id => {
        App.go(id);
        const cur = d.querySelector('.page.on');
        assert(cur && cur.id === 'page-' + id, `切到「${id}」失败`);
      });
    });
  }

  /* 教务看得见的，老师绝不能看见 */
  console.log('\n=== 三、角色隔离 ===');
  {
    const { G } = boot(ROLES.teacher);
    await settle();
    const App = G('App');
    t('老师看不到考勤 / 名册 / 课表 / 模考 / 老师管理', () => {
      ['att','roster','timetable','exam','teachers','homework','night','quant','coop','home']
        .forEach(id => assert(!App.can(id), '老师不该能进「' + id + '」'));
    });
    t('老师能进学员档案（这次改版特意加的）', () => {
      assert(App.can('profile'), '老师应该能看学员档案');
      assert(App.can('record'), '老师应该能录入今日情况');
    });
    t('老师没有「资料」这一项', () => {
      assert(!App.routes.some(r => r.name === '资料'), '老师端不该再出现「资料」');
      assert(!App.routes.some(r => r.id === 'materials'), '不该有 materials 页面');
    });
  }

  /* 教务端：排课已改名课表、模考在列、体重不再是独立功能 */
  {
    const { G } = boot(ROLES.admin);
    await settle();
    const App = G('App');
    t('教务端：排课已改名为「课表」', () => {
      const r = App.routes.find(x => x.id === 'timetable');
      assert(r && r.name === '课表', '应有一条 timetable 且名为「课表」');
      assert(!App.routes.some(x => x.id === 'schedule'), '旧的 schedule 应该没了');
    });
    t('教务端：模考在功能表里', () => assert(App.can('exam'), '教务端应有「模考」'));
    t('体重不再是独立功能（折叠进学员档案）', () => {
      assert(!App.routes.some(x => x.id === 'weight'), '不该再有独立的体重页');
      const W = G('Weight');
      assert(W && typeof W.block === 'function', 'Weight 应该只留一个给档案用的 block()');
    });
  }

  /* ───────── 四、老师录入的数据写到哪儿 ───────── */
  console.log('\n=== 四、老师「录入今日」的数据契约 ===');
  {
    const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
    const { G } = boot(ROLES.teacher, {
      classes:  [{ id:'c1', name:'播音一班', _u:1 }],
      students: [{ id:'s1', classId:'c1', name:'张三', _u:1 }],
      homework: [{ id:'h1', clsId:'c1', date:today, title:'绕口令', _u:1 }],
      _rcCls: 'c1',
      _rcDate: today,
    });
    await settle();
    const Store = G('Store'), Record = G('Record');

    t('课堂表现 / 最近状态 → 写进 records，带班级和记录人', () => {
      Record.save('s1', { state: '状态好', perf: '气息稳了' });
      const recs = Store.list('records');
      eq(recs.length, 1, 'records 条数');
      eq(recs[0].studentId, 's1', 'studentId');
      eq(recs[0].classId, 'c1', 'classId（服务端据此做隔离）');
      eq(recs[0].state, '状态好', 'state');
      eq(recs[0].perf, '气息稳了', 'perf');
      eq(recs[0].byId, 'u_teach', 'byId（谁记的）');
      eq(recs[0].date, today, 'date');
    });

    t('作业完成情况 → 写进 hw:{作业id}', () => {
      Record.markHw('h1', 's1', 1);
      const done = Store.list('hw:h1');
      eq(done.length, 1, 'hw 条数');
      eq(done[0].studentId, 's1', 'studentId');
      eq(done[0].done, 1, 'done');
    });

    t('再点一下能取消（同一人同一天只留一条）', () => {
      Record.setState('s1', '状态好');          // 已是「状态好」，再点应清掉
      const recs = Store.list('records');
      eq(recs.length, 1, 'records 不该多出来');
      eq(recs[0].state, '', 'state 应被清掉');
      eq(recs[0].perf, '气息稳了', 'perf 不该被连坐清掉');
    });

    t('老师端不碰考勤（考的登记是教务的事）', () => {
      Object.keys(Store.dump()).forEach(k =>
        assert(!k.startsWith('att:'), '老师端不该写考勤，出现了 ' + k));
    });
  }

  /* ── 用户名：汉字能用，但前后端必须是同一套规则 ── */
  console.log('\n=== 五、用户名规则（汉字可用） ===');
  {
    const { G } = boot(ROLES.admin);
    await settle();
    const canon = G('canonUser'), err = G('userErr');

    t('汉字用户名合法（不用再记拼音）', () => {
      assert(typeof err === 'function', '页面里找不到 userErr');
      eq(err('王磊'), '');
      eq(err('李老师'), '');
      eq(err('欧阳娜娜'), '');
    });

    t('全角字母折成半角，不然输入法一抖就多出个账号', () => {
      eq(canon('ｅｄｇｅ'), 'edge');
      eq(canon('ＷＡＮＧ'), 'wang');
      eq(canon('王　磊'), '王磊', '全角空格应被去掉');
    });

    t('大小写与空格统一口径', () => {
      eq(canon('  LiYun2026 '), 'liyun2026');
    });

    t('空 / 太短 / 怪字符仍然挡住', () => {
      assert(err('') !== '', '空用户名应被拒');
      assert(err('王') !== '', '单个字太短');
      assert(err('   ') !== '', '全是空格等于空');
      assert(err('王磊😀') !== '', '表情符号');
      assert(err('аdmin') !== '', '西里尔同形字（长得像 a 但要挡住）');
    });

    t('登录门干净：标题就是书法「砺蕴」，提示只写「用户名」，按钮下不放说明文字', () => {
      const m = html.match(/id="gUser"[^>]*placeholder="([^"]+)"/);
      assert(m && m[1] === '用户名', '提示应只写「用户名」（2026-09-18 用户要求删掉括号说明）：' + (m && m[1]));
      assert(html.includes('id="gBrand"') && /assets\/logo-liyun\.png/.test(html),
        '登录门头该由 Brand 装配书法字标（砺蕴字标走 CSS 遮罩上色）');
      assert(!/第一次使用：填一个用户名/.test(html), '「第一次使用…首位教务」这句该删掉');
      assert(!/账号由教务创建，没有自助注册。<br>/.test(html), '登录按钮下的两行说明该删掉');
    });

    t('品牌门头：博艺徽章 + 砺蕴字标，只此一套（B/C/D 均已去掉）', () => {
      assert(/const Brand = \{/.test(html), 'Brand 模块该在');
      assert(/classList\.add\('brand-a'\)/.test(html), '门头该挂 brand-a');
      ['brand-b', 'brand-c', 'brand-d', 'gCorner', 'pickbar'].forEach(x =>
        assert(!new RegExp(x).test(html), x + ' 已删除，不该再残留'));
      assert(!/ALL:\s*\[/.test(html) && !/picker\s*\(\)\s*\{/.test(html) &&
             !/q\.get\('pick'\)/.test(html), '多套切换机制该一并撤掉');
      assert(/@media\s*\(min-width:900px\)[\s\S]{0,900}?\.gate::after/.test(html),
        '宽屏登录页该单独有一版（放大的牌匾 + 暖金晕）');
      assert(/@media\s*\(min-width:900px\)[\s\S]{0,1500}?scrollbar-gutter:stable/.test(html),
        '宽屏登录门该有 scrollbar-gutter，否则滚动条一出现整块牌匾就左偏');
      assert(!/boyi-512\.png[^)]*\)[^;]*opacity:\s*\.0[4-9]/i.test(html),
        '背景那枚虚化徽章印记已按用户意见去掉，不该再压回屏幕');
      assert(/'assets\/boyi-' \+ f \+ '\.png'/.test(html),
        '徽章该按显示尺寸就近取图（Brand.pic）');
      fs.readdirSync(path.join(dir, 'assets')).forEach(f => {
        if (/^boyi-\d+\.png$/.test(f))
          assert(fs.statSync(path.join(dir, 'assets', f)).size > 1000, '徽章素材是空的：' + f);
      });
      assert(!/filter:\s*(brightness|hue-rotate)\(/.test(html), '徽章不许加滤镜改色（那是机构的资产）');
    });

    t('前后端是同一套规则：正则与长度上限逐字比对', () => {
      const sync = fs.readFileSync(path.join(dir, 'edge-functions', 'api', 'sync.js'), 'utf8');
      const grab = (text, label) => {
        const m = text.match(/USER_RE = (\/\^\[[\s\S]*?\/u)/);
        assert(m, label + ' 里找不到 USER_RE 定义');
        return m[1];
      };
      eq(grab(html, 'index.html'), grab(sync, 'sync.js'), 'USER_RE 两边不一致');
      ['USER_MIN = 2', 'USER_MAX = 32'].forEach(s =>
        assert(html.includes(s) && sync.includes(s), '长度上限两边不一致：' + s));
    });
  }

  /* ── 连不上后台时，提示必须说人话 ── */
  console.log('\n=== 六、连不上后台时的提示 ===');
  {
    t('资料库删干净了（界面 + 代码 + 后端白名单）', () => {
      ['matTitle', 'matList', 'addMaterial', 'renderMaterials', 'delMaterial', '资料']
        .forEach(s => assert(!html.includes(s), 'index.html 里还留着 ' + s));
      const sync = fs.readFileSync(path.join(dir, 'edge-functions', 'api', 'sync.js'), 'utf8');
      assert(!/materials/.test(sync), '后端白名单里还留着 materials');
      assert(!/materials/.test(html), '前端还引用着 materials');
    });

    const { w, G } = boot(ROLES.admin);
    await settle();

    // 换掉 fetch，模拟「这个地址只有页面、没有后端」：404 + 一段非 JSON
    w.fetch = async () => ({ ok: false, status: 404, json: async () => { throw new Error('not json'); } });
    let msg = '';
    try { await G('Auth').call('me'); } catch (e) { msg = e.message; }

    t('别说「返回格式不对」——那听着像是用户自己填错了', () => {
      assert(msg, '没有抛出错误');
      assert(!/返回格式不对/.test(msg), '还在把锅甩给用户：' + msg);
      assert(/只有页面|没有后台/.test(msg), '该点明是地址/后台的问题：' + msg);
      assert(/localhost:5173/.test(msg), '该给出一个能用的地址：' + msg);
    });

    t('登录门直接写出断连原因，不让人先白填一遍密码', () => {
      G('Auth').show();
      const note = w.document.getElementById('gNote').textContent;
      assert(/只有页面|没有后台/.test(note), '登录门没把断连原因写出来，现在写的是：' + note);
    });

    t('确认没有后台后，登录表单要收起来（别让人对着死表单反复试）', () => {
      G('Auth').show();
      eq(w.document.querySelector('.g-form').style.display, 'none', '表单应隐藏');
    });

    t('在死表单里点了登录，也会换成横幅（你截图里那条路径）', async () => {
      w.document.getElementById('gUser').value = '谢一鸣';
      w.document.getElementById('gPass').value = 'whatever123';
      await G('Auth').submit();
      const note = w.document.getElementById('gNote').textContent;
      assert(/登不进去/.test(note), '应显示「登不进去」横幅，现在显示：' + note);
      eq(w.document.querySelector('.g-form').style.display, 'none', '表单应隐藏');
    });

    t('整个工程里不该再有「返回格式不对」这句话', () => {
      assert(!html.includes('返回格式不对'), 'index.html 里还有');
    });
  }

  /* ───────────────── 七、本地预览的「重置」入口 ─────────────────
     起因：做端到端验证时随手 curl 建了个账号，它当场成了「首位教务」，
     真正的人再来登录就一直「密码不对」—— 而且没有任何办法看见已有账号。
     现在给了复位接口，但这是开发后门，必须保证它只在本地出现。 */
  console.log('\n=== 七、本地预览的「重置」入口 ===');
  {
    const { w, G } = boot(ROLES.super, {}, 'https://liyun2026.top/');
    await settle();

    t('正式网址上不出现「重置本地数据」', () => {
      G('Auth').show();
      const note = w.document.getElementById('gNote').textContent;
      assert(!/重置本地数据/.test(note), '开发后门跑到正式网址上了，现在写着：' + note);
    });

    t('正式后端 sync.js 里没有 /api/dev-reset', () => {
      const sync = fs.readFileSync(path.join(dir, 'edge-functions', 'api', 'sync.js'), 'utf8');
      assert(!/dev-reset/.test(sync), 'sync.js 里出现了 dev-reset —— 后门不能打进线上代码');
    });

    t('开发后门确实在 dev-server 里（免得上面两条变成空断言）', () => {
      const dev = fs.readFileSync(path.join(dir, 'test', 'dev-server.mjs'), 'utf8');
      assert(/dev-reset/.test(dev) && /dev-state/.test(dev), 'dev-server 里没找到重置/状态接口');
    });
  }

  {
    const { w, G, nav } = boot(ROLES.super, { classes: [{ id: 'c1' }] }, 'http://localhost:5173/');
    await settle();
    const Auth = G('Auth');

    t('本机预览里显示「重置本地数据」', () => {
      Auth.show();
      const note = w.document.getElementById('gNote').textContent;
      assert(/重置本地数据/.test(note), '本机预览该给一个重来的入口，现在写着：' + note);
    });

    /* 点它：确认 → 调 /api/dev-reset → 清掉本机缓存 → 刷新 */
    let hit = '';
    const navBefore = nav.count;
    w.confirm = () => true;
    w.fetch = async url => { hit = String(url); return { ok: true, status: 200, json: async () => ({ ok: true }) }; };
    await Auth.resetLocal();

    t('点「重置本地数据」会调 /api/dev-reset', () => {
      assert(/dev-reset/.test(hit), '没调到重置接口，实际调的是：' + hit);
    });

    t('点重置会清掉本机缓存并刷新（否则旧令牌还在，等于没重置）', () => {
      eq(w.localStorage.getItem('bysdash:classes'), null, '本机缓存的班级没清掉');
      eq(w.localStorage.getItem('bysdash$secret:token'), null, '登录令牌没清掉');
      assert(nav.count > navBefore, '重置完没有刷新页面');
    });

    /* 上面那条一开始是红的：我给 Store 加的 wipe() 撞上了已有的同名方法，
       对象字面量里后写的静默覆盖前面的，新方法根本没生效。
       这种错编译器不报、肉眼也看不出，加个守门断言。 */
    t('Store 里没有重名方法（重名会静默覆盖）', () => {
      const body = html.match(/const S = \{([\s\S]*?)\n  \};\n  return S;/);
      assert(body, '找不到 Store 的方法区');
      const names = [...body[1].matchAll(/^ {4}([A-Za-z_$][\w$]*)\(/gm)].map(x => x[1]);
      assert(names.length > 20, '只认出 ' + names.length + ' 个方法，正则可能没匹配对');
      const dup = [...new Set(names.filter((n, i) => names.indexOf(n) !== i))];
      assert(dup.length === 0, 'Store 里重名的方法：' + dup.join('、'));
    });

    t('wipe 与 wipeAll 分工明确：前者不碰登录令牌，后者碰', () => {
      const body = html.match(/const S = \{([\s\S]*?)\n  \};\n  return S;/)[1];
      const wipe = body.match(/\n {4}wipe\(\)\{([\s\S]*?)\n {4}\},/);
      const wipeAll = body.match(/\n {4}wipeAll\(\)\{([\s\S]*?)\n {4}\}/);
      assert(wipe, '找不到 wipe()');
      assert(wipeAll, '找不到 wipeAll()');
      assert(!/SEC/.test(wipe[1]), 'wipe() 不该动登录令牌（它是「清数据但保持登录」）');
      assert(/SEC/.test(wipeAll[1]), 'wipeAll() 必须连登录令牌一起清');
    });
  }

  /* ───────────────── 八、本机模式（没有后台也能用） ─────────────────
     起因：用户连着几轮卡在「进不去」—— 静态窗口没后台、预览进程被回收、
     代理拦 localhost、账号又被我的测试占掉。每一次提示都像在怪他填错，
     而他没有任何办法自查。根子是：工作台把「能不能用」和「后台可不可达」绑死了。
     现在开页面先探一声，没有后台就转本机模式，照样完整可用。 */
  console.log('\n=== 八、本机模式（没有后台也能用） ===');
  {
    const { w, G } = bootNoBackend();
    await settle();

    t('探不到后台就转「本机模式」，不再把人挡在登录门外', () => {
      eq(G('Auth').mode, 'local', '模式判断错了');
      const note = w.document.getElementById('gNote').textContent;
      assert(/本机模式/.test(note), '登录门没说明现在是本机模式：' + note);
      assert(/数据只存在这台电脑/.test(note), '该讲明白数据留在哪：' + note);
      eq(w.document.querySelector('.g-form').style.display, '', '本机模式必须让人能填表');
    });

    w.document.getElementById('gUser').value = '谢一鸣';
    w.document.getElementById('gPass').value = 'liyun2026pass';
    await G('Auth').submit();

    t('第一次填用户名密码就能进，自动成为首位教务', () => {
      const me = G('Auth').me();
      assert(me, '没能进本机模式');
      eq(me.user, '谢一鸣', '用户名不对');
      eq(me.role, 'super', '第一个账号该是首位教务');
    });

    const acct = JSON.parse(w.localStorage.getItem('bysdash$secret:acct') || 'null');

    t('本机账号连同密码散列一起存在浏览器里，不留明文', () => {
      assert(acct && acct[0], '没存下账号');
      eq(acct[0].user, '谢一鸣');
      assert(acct[0].hash, '没存密码散列');
      assert(!JSON.stringify(acct).includes('liyun2026pass'), '明文密码不该出现在本地');
    });

    t('本机模式下藏掉「老师管理」与「立即同步」（没有账号服务，也没有云端）', () => {
      G('Settings').render();
      eq(w.document.getElementById('tEntryCard').style.display, 'none', '老师管理该藏起来');
      eq(w.document.getElementById('syncNowBtn').style.display, 'none', '立即同步该藏起来');
    });

    /* 关掉再打开：拿同一份本地账号 + 令牌重开一个窗口 */
    const { w: w2, G: G2 } = bootNoBackend({
      'bysdash$secret:acct': acct,
      'bysdash$secret:token': 'local:谢一鸣',
    }, 'http://127.0.0.1:5173/');
    await settle();

    t('关掉再打开还在，不用重新建号', () => {
      const me = G2('Auth').me();
      assert(me, '第二次打开没自动进去');
      eq(me.user, '谢一鸣');
    });

    const { w: w3, G: G3 } = bootNoBackend({ 'bysdash$secret:acct': acct }, 'http://127.0.0.1:5173/');
    await settle();
    w3.document.getElementById('gUser').value = '谢一鸣';
    w3.document.getElementById('gPass').value = 'wrongpass123';
    await G3('Auth').submit();

    t('密码不对就不让进（本机模式也不是随便进）', () => {
      assert(!G3('Auth').me(), '错误密码竟然放进去了');
      assert(/密码不对/.test(w3.document.getElementById('gErr').textContent), '没提示密码不对');
    });

    const { w: w4, G: G4 } = bootNoBackend({ 'bysdash$secret:acct': acct }, 'http://127.0.0.1:5173/');
    await settle();
    w4.document.getElementById('gUser').value = '另一个名字';
    w4.document.getElementById('gPass').value = 'whatever12345';
    await G4('Auth').submit();

    t('本机模式里换个用户名登录，会直接报出这台电脑上的账号是谁', () => {
      const err = w4.document.getElementById('gErr').textContent;
      assert(/谢一鸣/.test(err), '该把已有账号名报出来，现在写的是：' + err);
    });

    const { w: wf, G: Gf } = bootNoBackend({}, 'file:///tmp/liyun/index.html');
    await settle();

    t('双击 index.html（file://）也进本机模式 —— 「永远进得去」的兜底', () => {
      eq(Gf('Auth').mode, 'local', 'file:// 打开也该转本机模式');
    });

    const { w: wp, G: Gp } = bootNoBackend({}, 'https://liyun2026.top/');
    await settle();

    t('正式网址没有后台时不转本机模式（影子账号比进不去更糟）', () => {
      eq(Gp('Auth').mode, 'cloud', '正式网址不该偷偷转本机模式');
      const note = wp.document.getElementById('gNote').textContent;
      assert(/连不上/.test(note), '该如实说明连不上：' + note);
      assert(!/本机模式/.test(note), '不该在正式网址上引导本机模式');
    });
  }

  /* ───────────────── 六、量化板块：班级制 + 快捷按钮 ───────────────── */
  console.log('\n=== 六、量化板块：班级制 + 快捷按钮 ===');
  {
    t('页面骨架：总分卡 / 快捷按钮 / 记录 / 公示，旧的「学员排行」已删', () => {
      ['id="qScoreCard"', 'id="qBtns"', 'id="qLogBody"', '快捷加减分', '公示文案', '起始 100 分']
        .forEach(sig => assert(html.includes(sig), '缺了 ' + sig));
      assert(!html.includes('id="qBody"'), '旧的按学员排行的 #qBody 应该删掉（量化页不显示学生姓名）');
      assert(!html.includes('复制本班公布文案'), '旧公示按钮文案应该已经换掉');
    });

    const { w, G } = boot(
      { id: 'u1', name: '测试教务', role: 'super', isStaff: true, isSuper: true },
      {
        classes:  [{ id: 'c1', name: 'BY05' }, { id: 'c2', name: 'BY06' }],
        students: [{ id: 's1', name: '张三', classId: 'c1' }],
      }
    );
    w.eval('window.prompt = () => "3"');   // jsdom 的 prompt 没实现，先钉住
    await settle();

    t('initRules 补种 20 条「考前集训量化管理细则」的班级名目（老数据也能升级）', () => {
      G('Settings.initRules()');
      const cls = G(`Store.list('quant_rules').filter(r => (r.key||'').indexOf('cls:') === 0).length`);
      eq(cls, 20, '班级名目条数');
      const late = G(`Store.list('quant_rules').find(r => r.key === 'cls:late')`);
      eq(late.delta, -2, '迟到每分钟 -2');
      const water = G(`Store.list('quant_rules').find(r => r.key === 'cls:water')`);
      eq(water.delta, 10, '换水 +10（公示里出现过）');
    });

    t('班级总分 = 100 起始分 + 流水合计，加扣分方向都算对', () => {
      G(`Store.upsert('quant_log', { id:'q1', clsId:'c1', date: Util.today(), label:'换水', delta:10, _u:1 })`);
      G(`Store.upsert('quant_log', { id:'q2', clsId:'c1', date: Util.today(), label:'迟到3分钟', delta:-6, _u:2 })`);
      eq(G(`Quant.score('c1')`), 104, '100 + 10 - 6');
      eq(G(`Quant.score('c2')`), 100, '没有流水的班就是起始分');
    });

    t('公示文案照「班名：总分 + 加扣分原因」出，整段没有学生姓名', () => {
      const b = G(`Quant.block('c1', '1970-01-01', '2999-12-31')`);
      assert(/BY05：104/.test(b), '该有班名和总分：' + b);
      assert(/加扣分原因：换水\+10分，迟到3分钟-6分/.test(b), '原因聚合不对：' + b);
      assert(!/张三/.test(b), '公示里不该出现学生姓名');
    });

    t('快捷按钮由 cls: 细则驱动，页面渲染不含学员姓名', () => {
      G(`Store.set('_qCls','c1'); Quant.render()`);
      const btns = G(`document.getElementById('qBtns').innerHTML`);
      assert(/换水/.test(btns) && /\+10/.test(btns), '按钮该带名目和分值');
      const page = G(`(document.getElementById('qScoreCard').textContent + document.getElementById('qBtns').textContent + document.getElementById('qLogBody').textContent)`);
      assert(!/张三/.test(page), '量化页面任何地方都不该出现学生姓名');
    });

    t('点带数量的按钮先问数量：迟到 3 分钟 → 记 -6 分', () => {
      const before = G(`Quant.score('c1')`);
      G(`Quant.quick('r_cls:late')`);
      eq(G(`Quant.score('c1')`), before - 6, '3 分钟 × 2 分');
      const last = G(`Store.list('quant_log').filter(x => x.clsId === 'c1').sort((a,b) => (a._u||0) - (b._u||0)).pop()`);
      eq(last.label, '迟到3分钟', '名目要带上数量');
    });

    t('撤销：软删一笔，总分跟着回退', () => {
      const before = G(`Quant.score('c1')`);
      const id = G(`Store.list('quant_log').filter(x => x.clsId === 'c1').sort((a,b) => (a._u||0) - (b._u||0)).pop().id`);
      G(`Quant.del('${id}')`);
      eq(G(`Quant.score('c1')`), before + 6, '删掉迟到那笔后回退 6 分');
    });
  }

  console.log();
  if (fail.length){
    fail.forEach(x => console.log('  \x1b[31m✗\x1b[0m ' + x));
    console.log(`\n\x1b[31m${fail.length} 项失败\x1b[0m\n`);
    process.exit(1);
  }
  console.log(`\x1b[32m全部通过（${pass.length} 项）\x1b[0m\n`);
  process.exit(0);
})();
