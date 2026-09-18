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
    const m700 = html.match(/@media\s*\(min-width:\s*700px\)\s*\{([\s\S]*?)\n\}/);
    assert(m700, '缺少 ≥700px 这一档媒体查询（平板上要能看到侧边栏）');
    assert(/\.side\{[^}]*display:flex/.test(m700[1]), '≥700px 时侧边栏应显示出来');
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

/** 用假身份启动一次工作台，返回窗口内的句柄 */
function boot(profile, seed = {}){
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'https://redesign.test/',
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
      throw new Error('页面抛出未捕获错误 → ' + e.message);
    })
  });
  const w = dom.window;
  const G = n => { try { return w.eval(n); } catch { return undefined; } };
  return { w, d: w.document, G };
}

const settle = () => new Promise(r => setTimeout(r, 100));

(async () => {
  console.log('\n=== 二、角色能看到的页面 ===');
  const expected = {
    super:   ['home','att','homework','roster','profile','timetable','night','quant','exam','coop','teachers','settings'],
    admin:   ['home','att','homework','roster','profile','timetable','night','quant','exam','coop','settings'],
    teacher: ['today','record','myclass','profile','tickets','settings'],
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

    t('输入框提示里写明可以用汉字', () => {
      const m = html.match(/id="gUser"[^>]*placeholder="([^"]+)"/);
      assert(m && /汉字/.test(m[1]), '登录框的提示应告诉用户汉字也行');
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

  console.log();
  if (fail.length){
    fail.forEach(x => console.log('  \x1b[31m✗\x1b[0m ' + x));
    console.log(`\n\x1b[31m${fail.length} 项失败\x1b[0m\n`);
    process.exit(1);
  }
  console.log(`\x1b[32m全部通过（${pass.length} 项）\x1b[0m\n`);
  process.exit(0);
})();
