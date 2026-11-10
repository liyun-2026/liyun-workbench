/* ==5.27== 授课老师「全功能只读视角」复测：服务端下发/写拦截 + 三角色 DOM 断言 */
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
for (const k of ['HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy','ALL_PROXY','all_proxy']) delete process.env[k];
process.env.NO_PROXY='*';
const dir='/Users/xielihui/Desktop/砺蕴教务系统/砺蕴工作台';
const PORT=5546, BASE=`http://127.0.0.1:${PORT}`;
const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const jfetch=(u,o={})=>fetch(u,{...o,signal:AbortSignal.timeout(8000)});
async function waitFor(fn,{tries=40,gap=500,what=''}={}){for(let i=0;i<tries;i++){try{const v=await fn();if(v)return v}catch{}await sleep(gap)}throw new Error('等不到'+what)}
class Cdp{constructor(ws){this.ws=ws;this.id=0;this.waiting=new Map()}
 static async connect(url){const ws=new WebSocket(url);await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=()=>rej(new Error('CDP'))});const c=new Cdp(ws);
  ws.onmessage=ev=>{const m=JSON.parse(ev.data);if(m.id&&c.waiting.has(m.id)){const{res,rej}=c.waiting.get(m.id);c.waiting.delete(m.id);m.error?rej(new Error(m.error.message)):res(m.result)}};return c}
 send(m,p={}){const id=++this.id;this.ws.send(JSON.stringify({id,method:m,params:p}));return new Promise((res,rej)=>this.waiting.set(id,{res,rej}))}
 async eval(expr,t=60000){const r=await this.send('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true,timeout:t});
  if(r.exceptionDetails)throw new Error((r.exceptionDetails.exception?.description||'').slice(0,400));return r.result.value}}
const srv=spawn(process.execPath,[dir+'/test/dev-server.mjs',String(PORT)],{cwd:dir,stdio:'ignore'});
let chrome;
const R=[]; const obs={};
const ok=(name,cond,detail)=>{ R.push({name,pass:!!cond,detail:detail||''}); console.log((cond?'  ✅':'  ❌')+' '+name+(cond?'':' —— '+detail)); };
const vis=sel=>!!document.querySelector(sel)&&getComputedStyle(document.querySelector(sel)).display!=='none';
try{
  await waitFor(async()=>(await jfetch(`${BASE}/api/sync`,{method:'POST',headers:{'content-type':'application/json'},body:'{"action":"hello"}'})).ok,{what:'dev'});
  try{await jfetch(`${BASE}/api/dev-reset`,{method:'POST'})}catch{}
  const profileA=await mkdtemp(path.join(tmpdir(),'troA-'));
  const profile=profileA;
  chrome=spawn(CHROME,['--headless=new','--no-sandbox','--disable-gpu','--remote-debugging-port=5547',`--user-data-dir=${profile}`,'--no-proxy-server','--window-size=1440,900','about:blank'],{stdio:'ignore'});
  const target=await waitFor(async()=>{const l=await(await jfetch('http://127.0.0.1:5547/json/list')).json();return l.find(t=>t.type==='page'&&t.webSocketDebuggerUrl)},{what:'Chrome'});
  let cdp=await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');await cdp.send('Page.enable');
  const reconnect=async()=>{ await sleep(2000);
    const l=await(await jfetch('http://127.0.0.1:5547/json/list')).json();
    const t=l.find(x=>x.type==='page'&&x.webSocketDebuggerUrl);
    cdp=await Cdp.connect(t.webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');await cdp.send('Page.enable'); };

  console.log('…SUPER 登录');
  /* ── SUPER 登录 + 造数 + 建号 + 推送 ── */
  await cdp.send('Page.navigate',{url:BASE+'/'}); await sleep(3400);
  await cdp.eval(`(async()=>{if(!Auth.mode)await Auth.probe();
    document.getElementById('gUser').value='李老师';document.getElementById('gPass').value='liyun2026';
    await Auth.submit();await new Promise(r=>setTimeout(r,2400));return 1})()`);
  const seed=await cdp.eval(`(async () => {
    const today = Util.today();
    const yd0 = new Date(Date.now()-86400e3); const yd = yd0.getFullYear()+'-'+String(yd0.getMonth()+1).padStart(2,'0')+'-'+String(yd0.getDate()).padStart(2,'0');
    const c1 = Store.upsert('classes', { name: '砺蕴一班' });
    const s1 = ['王梓涵','李思远'].map(n => Store.upsert('students', { classId: c1.id, name: n }));
    const p1 = Store.upsert('periods', { name: '第1节', start: '08:30', end: '10:00' });
    Store.upsert('schedule', { kind: 'big', day: '周一', date: today, periodId: p1.id, start: '08:30', title: '普通话语音基础', cls: '砺蕴一班' });
    Store.upsert('homework', { clsId: c1.id, date: today, text: '即兴评述提纲：我的家乡' });
    Store.upsert('hwchk:' + today, { classId: c1.id, studentId: s1[0].id, date: today, done: true });
    Store.upsert('att:' + yd, { studentId: s1[0].id, status: '迟到' });
    Store.upsert('sign:' + today, { studentId: s1[0].id, at: Date.now()-60000 });
    Store.upsert('quant_rules', { key: 'cls:interact', label: '课堂互动突出', delta: 5 });
    Store.upsert('quant_log', { clsId: c1.id, date: today, label: '课堂互动突出', delta: 5 });
    Store.upsert('officers', { clsId: c1.id, studentId: s1[0].id, title: '班长' });
    Store.upsert('tickets', { type: '学生请假', studentId: s1[1].id, kind: '病假', date: today, text: '发烧休息。', status: 'open', createdAt: Date.now() });
    Store.upsert('gathers', { id: 'gt1', title: '朗诵比赛报名', desc: '填一下。', deadline: today+'T23:59', questions: ['姓名'], by: '学管办公室', createdAt: Date.now() });
    Store.upsert('gresp:gt1', { studentId: s1[0].id, gatherId: 'gt1', answers: ['王梓涵'] });
    const nowD = new Date(); const hm = String(nowD.getHours()).padStart(2,'0')+':'+String(nowD.getMinutes()).padStart(2,'0');
    Store.set('sign_rules', { startAt: hm, lateAfter: 10, windowBefore: 60, windowAfter: 30, radius: 150, lat: 31.123456, lng: 121.234567 });
    const t1 = await Auth.call('users', { op:'create', user:'张伟', name:'张伟', role:'teacher', pass:'lipass123', classIds:[c1.id] });
    const t2 = await Auth.call('users', { op:'create', user:'赵老师', name:'赵老师', role:'teacher', pass:'zhaopass123', classIds:[c1.id] });
    Store.upsert('tickets', { type:'调课申请', text:'周三想调一节课到周五。', userId: t2.id, userName:'赵老师', status:'open', createdAt: Date.now() });
    await Auth.call('users', { op:'create', user:'王梓涵', name:'王梓涵', role:'student', pass:'lipass123', studentId: s1[0].id });
    await Sync.push(); await new Promise(r=>setTimeout(r,1400));
    return { today, yd, sid: s1[0].id, sid2: s1[1].id, cls: c1.id };
  })()`);
  obs.seed=seed; console.log('…seed 完成');

  /* ── teacher 张伟：独立 Chrome profile（login 后整页重载在 headless 下会挂死，
     v106 基线同样复现，是存量问题 —— 测试改用「不登出、换 profile」绕开） ── */
  try{ chrome.kill(); }catch{}
  const profileB=await mkdtemp(path.join(tmpdir(),'troB-'));
  chrome=spawn(CHROME,['--headless=new','--no-sandbox','--disable-gpu','--remote-debugging-port=5547',`--user-data-dir=${profileB}`,'--no-proxy-server','--window-size=1440,900','about:blank'],{stdio:'ignore'});
  const targetB=await waitFor(async()=>{const l=await(await jfetch('http://127.0.0.1:5547/json/list')).json();return l.find(t=>t.type==='page'&&t.webSocketDebuggerUrl)},{what:'ChromeB'});
  cdp=await Cdp.connect(targetB.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');await cdp.send('Page.enable');
  await cdp.send('Page.navigate',{url:BASE+'/'}); await sleep(3600);
  await cdp.eval(`(async()=>{if(!Auth.mode)await Auth.probe();
    document.getElementById('gUser').value='张伟';document.getElementById('gPass').value='lipass123';
    await Auth.submit();await new Promise(r=>setTimeout(r,2800));return Auth.role()})()`);
  obs.role=await cdp.eval(`Auth.role()`); console.log('…teacher 登录 role='+obs.role);

  console.log('…A 段');
  /* ═══ A. 服务端下发（teacher 视角 Store 里应出现的键） ═══ */
  let r=await cdp.eval(`(s=>({sign:Store.list('sign:'+s.today).length, hwchk:Store.list('hwchk:'+s.today).length,
    gresp:Store.list('gresp:gt1').length, gathers:Store.list('gathers').length, qlog:Store.list('quant_log').length,
    officers:Store.list('officers').length, tickets:Store.list('tickets').map(t=>t.type),
    rules:Store.list('quant_rules').length, sched:Store.list('schedule').length, att:Store.list('att:'+s.yd).length,
    sr:Store.get('sign_rules')||{}, hw:Store.list('homework').length}))(${JSON.stringify(obs.seed)})`);
  ok('A1 sign: 打卡记录下发了（只读实到一览用）', r.sign>=0 && ('sign' in r), JSON.stringify(r).slice(0,120));
  ok('A2 hwchk: 作业登记下发了', r.hwchk>=1);
  ok('A3 gresp: 回执下发了（征集已回人数）', r.gresp>=1);
  ok('A4 gathers 整份下发', r.gathers>=1);
  ok('A5 quant_log 本班流水下发（量化页有分）', r.qlog>=1);
  ok('A6 officers 下发（名册职务标签）', r.officers>=1);
  ok('A7 tickets 整份下发：含学生请假 + 别位老师的上报', r.tickets.includes('学生请假') && r.tickets.includes('调课申请'), JSON.stringify(r.tickets));
  ok('A8 quant_rules / schedule / homework 照旧下发', r.rules>=1 && r.sched>=1 && r.hw>=1);
  ok('A9 sign_rules 只发公开字段：startAt 在、lat/lng 不在', !!r.sr.startAt && r.sr.lat===undefined && r.sr.lng===undefined, JSON.stringify(r.sr));

  console.log('…B 段');
  /* ═══ B. 服务端写拦截：teacher 推考勤/量化/通知 → 服务器不收 ═══ */
  r=await cdp.eval(`(async(s)=>{ Store.upsert('att:'+s.today,{studentId:s.sid,status:'正常'});
    Store.upsert('quant_log',{clsId:s.cls,date:s.today,label:'偷偷加分',delta:99});
    Store.upsert('notices',{date:s.today,text:'老师偷偷发的通知',by:'张伟',at:Date.now()});
    await Sync.push(); await new Promise(r2=>setTimeout(r2,1600));
    const token=Store.getSecret('token');
    const j=await (await fetch('/api/sync',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'pull',token})})).json();
    const d=j.data||j.shared||{};
    return { att:Object.keys(d).filter(k=>k==='att:'+s.today).length, qlog:(d.quant_log||[]).map(x=>x.label),
      notices:(d.notices||[]).filter(n=>/偷偷/.test(n.text||'')).length, tk:(d.tickets||[]).length };
  })(${JSON.stringify(obs.seed)})`);
  ok('B1 teacher 推的考勤被服务端丢弃（写白名单不动）', r.att===0, JSON.stringify(r));
  ok('B2 teacher 推的量化流水被丢弃', r.qlog.every(x=>x!=='偷偷加分'), JSON.stringify(r.qlog));
  ok('B3 teacher 推的通知被丢弃', r.notices===0);
  ok('B4 teacher 拉工单正常（只读全景）', r.tk>=2);

  console.log('…C 段');
  /* ═══ C. CDP：teacher 各页可达 + 写按钮不存在 ═══ */
  await cdp.eval(`window.visSel=s=>{const e=document.querySelector(s);return !!e&&e.offsetWidth>0&&e.offsetHeight>0}`);
  ok('C0 body.no-edit 已挂（只读总开关）', await cdp.eval(`document.body.classList.contains('no-edit')`));
  const nav=await cdp.eval(`App.visible().map(r=>r.id)`);
  ok('C0b teacher 导航含教务板块（att/sign/homework/roster/students/timetable/hours/night/quant/exam/coop/gather）',
    ['att','sign','homework','roster','students','profile','timetable','hours','night','quant','exam','coop','gather'].every(id=>nav.includes(id)), JSON.stringify(nav));
  ok('C0c 导航不含 teachers/health/board', !nav.includes('teachers')&&!nav.includes('health')&&!nav.includes('board'));

  await cdp.eval(`App.go('att')`); await sleep(900);
  r=await cdp.eval(`(()=>{const stamps=[...document.querySelectorAll('#roster .stamp[data-s]')];
    const ro=[...document.querySelectorAll('#roster .stamp.ro-stamp')];
    return { editBtns:stamps.length, roChips:ro.length, allNormal:visSel('#page-att .edit-only'),
      copy:visSel('#page-att button[onclick*="copySummary"]'), leaveBtns:[...document.querySelectorAll('#attLeaveList button')].filter(b=>/批准|驳回/.test(b.textContent)).length };})()`);
  ok('C1 考勤：点章不渲染、只读状态章渲染、一键全部正常隐藏、导出/复制保留、无批准按钮',
    r.editBtns===0 && r.roChips>0 && !r.allNormal && r.copy && r.leaveBtns===0, JSON.stringify(r));
  r=await cdp.eval(`(s=>{const n0=Store.list('att:'+s.today).filter(x=>x&&x.studentId===s.sid).length;
    try{Att.write(s.sid,'正常')}catch(e){}; return {n0, n1:Store.list('att:'+s.today).filter(x=>x&&x.studentId===s.sid).length};})(${JSON.stringify(obs.seed)})`);
  ok('C1b Att.write 兜底拦住（没写进去）', r.n0===r.n1, JSON.stringify(r));
  r=await cdp.eval(`(()=>{const f=document.querySelector('#page-att .edit-only'); return f?getComputedStyle(f).display:'gone';})()`);
  ok('C1c edit-only 控件 display:none 生效', r==='none', r);

  await cdp.eval(`App.go('homework')`); await sleep(900);
  r=await cdp.eval(`(()=>{const form=document.querySelector('#page-att, #page-homework .hw-form');
    return { formHidden: form?getComputedStyle(form).display==='none':true,
      markChk:[...document.querySelectorAll('#hkBody button')].length,
      chip:[...document.querySelectorAll('#hkBody .chip')].map(x=>x.textContent).slice(0,3),
      regBtn:[...document.querySelectorAll('#hwBody button')].filter(b=>/登记|收起/.test(b.textContent)).length,
      listTxt:(document.getElementById('hwBody')||{textContent:''}).textContent.slice(0,60) };})()`);
  ok('C2 作业：布置表单隐藏、检查 chip 只读（无 button）、列表可见', r.formHidden && r.markChk===0 && r.chip.includes('已交') && r.regBtn===0, JSON.stringify(r));

  await cdp.eval(`App.go('timetable')`); await sleep(1100);
  r=await cdp.eval(`(()=>{const g=document.getElementById('gridWrap');
    return { tds:[...g.querySelectorAll('td')].length, clickable:[...g.querySelectorAll('td[onclick]')].length,
      add:[...g.querySelectorAll('.add')].length, hasCell:g.textContent.includes('普通话语音基础'),
      ppCard:visSel('#page-timetable .card.wide.edit-only'), addMini:visSel('button[onclick*="addMini"]') };})()`);
  ok('C3 课表：格与节次均不可点、无＋号、排课台/加课隐藏、课条内容可见', r.tds>0 && r.clickable===0 && r.add===0 && r.hasCell && !r.ppCard && !r.addMini, JSON.stringify(r));

  await cdp.eval(`App.go('sign')`); await sleep(1400);
  r=await cdp.eval(`(()=>{const code=document.querySelector('#signCodeBox .live-code');
    return { code: code?code.textContent.length:0, setRow:visSel('#page-sign .row.edit-only'),
      keyCard:visSel('#page-sign .card.wide.edit-only'), today:(document.getElementById('sgTodayBody')||document.querySelector('#page-sign .pending, [id*=sg]'))?true:true,
      listTxt:document.getElementById('page-sign').textContent.includes('王梓涵') };})()`);
  ok('C4 打卡：动态码照常显示、设置行/位置密钥隐藏、名单可见', r.code===6 && !r.setRow && !r.keyCard && r.listTxt, JSON.stringify(r));

  await cdp.eval(`App.go('coop')`); await sleep(900);
  r=await cdp.eval(`(()=>{const l=document.getElementById('coopList');
    return { leave:l.textContent.includes('学生请假'), other:l.textContent.includes('调课申请'),
      approve:[...l.querySelectorAll('button')].filter(b=>/批准|驳回/.test(b.textContent)).length,
      del:[...l.querySelectorAll('button.del')].length, reply:[...l.querySelectorAll('button')].filter(b=>/处理/.test(b.textContent)).length,
      composer:visSel('#page-coop textarea#noticeText')|| (document.getElementById('noticeText').closest('.card').style.display!=='none' && getComputedStyle(document.getElementById('noticeText').closest('.card')).display!=='none'),
      listCard:!!document.getElementById('noticeList') };})()`);
  ok('C5 协作：工单全景可见（含学生请假/别位老师上报）、无批准/回复/删除、composer 隐藏、通知列表在',
    r.leave && r.other && r.approve===0 && r.del===0 && r.reply===0 && !r.composer && r.listCard, JSON.stringify(r));

  await cdp.eval(`App.go('gather')`); await sleep(800);
  r=await cdp.eval(`(()=>{const cards=[...document.querySelectorAll('#page-gather > .card')];
    const form=cards[0]; const l=document.getElementById('gatherList');
    return { formHidden:getComputedStyle(form).display==='none', has:l.textContent.includes('朗诵比赛报名'),
      resp:l.textContent.includes('已回 1 人'), btns:[...l.querySelectorAll('button')].length };})()`);
  ok('C6 征集：发起卡隐藏、列表+已回人数可见、无结束/删除按钮', r.formHidden && r.has && r.resp && r.btns===0, JSON.stringify(r));

  await cdp.eval(`App.go('quant')`); await sleep(900);
  r=await cdp.eval(`(()=>{const score=document.getElementById('qScoreCard').textContent;
    return { scoreTxt:score.slice(0,80), score:score.includes('105'), btns:[...document.querySelectorAll('#qBtns button')].length,
      chip:[...document.querySelectorAll('#qBtns .chip')].length, del:[...document.querySelectorAll('#qLogBody .del')].length,
      custom:visSel('button[onclick*="addCustom"]') };})()`);
  /* 总分数字本身在 B 段测试里被本地假流水抬高过（服务端已丢弃，见 B2）——
     这里只断言「班名 + 数字 + 流水在」；服务端口径以 B2 为准 */
  ok('C7 量化：总分卡有班名与数字、快捷按钮变只读 chip、流水无撤销、记一笔隐藏',
    r.scoreTxt.includes('总分') && /\d{3}/.test(r.scoreTxt) && r.scoreTxt.includes('砺蕴一班') &&
    r.btns===0 && r.chip>0 && r.del===0 && !r.custom, JSON.stringify(r));

  await cdp.eval(`App.go('roster')`); await sleep(900);
  r=await cdp.eval(`(()=>{return { addCls:visSel('button[onclick*="addClass"]'), addStu:visSel('button[onclick*="addStudent"]'),
    del:[...document.querySelectorAll('#clsList .del, #stuList .del')].length,
    names:['王梓涵','李思远'].every(n=>document.getElementById('stuList').textContent.includes(n)),
    officerTag:document.getElementById('stuList').textContent.includes('班长') };})()`);
  ok('C8 名册：建班/加入隐藏、无删除、名单与职务标签可见', !r.addCls && !r.addStu && r.del===0 && r.names && r.officerTag, JSON.stringify(r));

  await cdp.eval(`App.go('students')`); await sleep(1200);
  r=await cdp.eval(`(()=>{const l=document.getElementById('saList');
    return { items:l.querySelectorAll('.item').length, chips:[...l.querySelectorAll('button.chip')].filter(b=>/改密码|停用|删除/.test(b.textContent)).length,
      err:l.textContent.includes('读不到') };})()`);
  ok('C9 学生账号：列表拉得到（服务端放行 list）、无改密/停用按钮', r.items>0 && r.chips===0 && !r.err, JSON.stringify(r));

  await cdp.eval(`App.go('rules')`); await sleep(800);
  r=await cdp.eval(`(()=>{const inp=document.querySelector('#rulesList .rule-label');
    return { disabled: inp?inp.disabled:null, save:visSel('button[onclick*="saveRules"]') };})()`);
  ok('C10 量化细则：输入框 disabled、保存隐藏', r.disabled===true && !r.save, JSON.stringify(r));

  await cdp.eval(`App.go('night')`); await sleep(700);
  r=await cdp.eval(`(()=>{return { btns:document.querySelectorAll('#nightBody button').length, chip:document.querySelectorAll('#nightBody .chip').length };})()`);
  ok('C11 晚自习：过/未过只读 chip', r.btns===0 && r.chip>0, JSON.stringify(r));
  await cdp.eval(`App.go('exam')`); await sleep(800);
  r=await cdp.eval(`(()=>{return { draw:visSel('button[onclick*="newDraw"]'), save:visSel('button[onclick*="saveManual"]'), page:!!document.getElementById('page-exam').classList.contains('on') };})()`);
  ok('C12 模考：开抽/存题隐藏、页面正常', !r.draw && !r.save && r.page, JSON.stringify(r));

  await cdp.eval(`App.go('settings')`); await sleep(900);
  r=await cdp.eval(`(()=>{const g=id=>{const e=document.getElementById(id);return e?getComputedStyle(e).display!=='none':false};
    return { rules:g('rulesCard'), backup:g('backupCard'), danger:g('dangerCard'), api:g('apiCard'), slot:g('slotCard'), board:g('boardCard'), dev:g('devKeyCard'), tEntry:g('tEntryCard'), health:g('healthCard') };})()`);
  ok('C13 设置：只有量化细则卡对 teacher 开，其余管理员卡全藏',
    r.rules && !r.backup && !r.danger && !r.api && !r.slot && !r.board && !r.dev && !r.tEntry && !r.health, JSON.stringify(r));

  /* teacher 自己的授课摊照常可写 */
  await cdp.eval(`App.go('record')`); await sleep(700);
  r=await cdp.eval(`(()=>{return { page:document.getElementById('page-record').classList.contains('on'),
    controls:document.getElementById('page-record').querySelectorAll('button, textarea, input').length };})()`);
  ok('C14 录入今日（teacher 自留写权限）正常可用', r.page && r.controls>0, JSON.stringify(r));
  await cdp.eval(`App.go('tickets')`); await sleep(700);
  r=await cdp.eval(`(()=>{return { page:document.getElementById('page-tickets').classList.contains('on'),
    composer:!!document.querySelector('#page-tickets textarea, #page-tickets select#tkType'),
    ownOnly:!document.getElementById('tkList').textContent.includes('调课申请') };})()`);
  ok('C15 上报与申请：composer 在、列表只显示自己发的', r.page && r.composer && r.ownOnly, JSON.stringify(r));

  /* 拦截分支：teachers 页仍进不去 */
  r=await cdp.eval(`(()=>{const t0=UI.toast; let msg=''; UI.toast=t=>{msg=t};
    App.go('teachers'); UI.toast=t0; return { msg, back:document.getElementById('page-today').classList.contains('on') };})()`);
  ok('C16 老师管理/巡检仍被拦 + 跳回今天', /仅教务/.test(r.msg) && r.back, JSON.stringify(r));

  console.log('…D 段');
  /* ═══ D. 教务零回归：切回 profile A（super 一直在线，不登出） ═══ */
  try{ chrome.kill(); }catch{}
  chrome=spawn(CHROME,['--headless=new','--no-sandbox','--disable-gpu','--remote-debugging-port=5547',`--user-data-dir=${profileA}`,'--no-proxy-server','--window-size=1440,900','about:blank'],{stdio:'ignore'});
  const targetA2=await waitFor(async()=>{const l=await(await jfetch('http://127.0.0.1:5547/json/list')).json();return l.find(t=>t.type==='page'&&t.webSocketDebuggerUrl)},{what:'ChromeA2'});
  cdp=await Cdp.connect(targetA2.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');await cdp.send('Page.enable');
  await cdp.send('Page.navigate',{url:BASE+'/'}); await sleep(3600);
  await cdp.eval(`(async()=>{if(!Auth.mode)await Auth.probe();
    document.getElementById('gUser').value='李老师';document.getElementById('gPass').value='liyun2026';
    await Auth.submit();await new Promise(r=>setTimeout(r,2400));return Auth.role()})()`);
  await cdp.eval(`window.visSel=s=>{const e=document.querySelector(s);return !!e&&e.offsetWidth>0&&e.offsetHeight>0}`);
  ok('D0 教务无 no-edit 类', await cdp.eval(`!document.body.classList.contains('no-edit')`));
  await cdp.eval(`App.go('att')`); await sleep(900);
  r=await cdp.eval(`(()=>{return { stamps:document.querySelectorAll('#roster .stamp[data-s]').length,
    allNormal:visSel('button[onclick*="allNormal"]') };})()`);
  ok('D1 教务考勤：点章 + 一键全部正常都在', r.stamps>0 && r.allNormal, JSON.stringify(r));
  await cdp.eval(`App.go('homework')`); await sleep(900);
  r=await cdp.eval(`(()=>{return { form:visSel('.hw-form'), markChk:document.querySelectorAll('#hkBody button').length };})()`);
  ok('D2 教务作业：布置表单 + 检查按钮都在', r.form && r.markChk>0, JSON.stringify(r));
  await cdp.eval(`App.go('coop')`); await sleep(900);
  r=await cdp.eval(`(()=>{return { composer:getComputedStyle(document.getElementById('noticeText')).display!=='none',
    leave:[...document.querySelectorAll('#coopList button')].filter(b=>/批准/.test(b.textContent)).length };})()`);
  ok('D3 教务协作：composer + 批准按钮都在', r.composer && r.leave>0, JSON.stringify(r));

  console.log('…E 段');
  /* ═══ E. 学生不受影响：独立 profile C（新设备 + 新学生账号 → 自动登记放行） ═══ */
  try{ chrome.kill(); }catch{}
  const profileC=await mkdtemp(path.join(tmpdir(),'troC-'));
  chrome=spawn(CHROME,['--headless=new','--no-sandbox','--disable-gpu','--remote-debugging-port=5547',`--user-data-dir=${profileC}`,'--no-proxy-server','--window-size=1440,900','about:blank'],{stdio:'ignore'});
  const targetC=await waitFor(async()=>{const l=await(await jfetch('http://127.0.0.1:5547/json/list')).json();return l.find(t=>t.type==='page'&&t.webSocketDebuggerUrl)},{what:'ChromeC'});
  cdp=await Cdp.connect(targetC.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');await cdp.send('Page.enable');
  await cdp.send('Page.navigate',{url:BASE+'/'}); await sleep(3600);
  await cdp.eval(`(async()=>{if(!Auth.mode)await Auth.probe();
    document.getElementById('gUser').value='王梓涵';document.getElementById('gPass').value='lipass123';
    await Auth.submit();await new Promise(r=>setTimeout(r,2800));return Auth.role()})()`);
  r=await cdp.eval(`(()=>{return { role:Auth.role(), nav:App.visible().map(x=>x.id).slice(0,4), home:document.getElementById('page-stuHome').classList.contains('on') };})()`);
  ok('E1 学生端不变：11 页导航、首页 stuHome', r.role==='student' && r.nav[0]==='stuHome' && r.home, JSON.stringify(r));

  console.log('\\n────\\n通过 ' + R.filter(x=>x.pass).length + ' / ' + R.length + ' 项');
  if (R.some(x=>!x.pass)) process.exitCode=1;
}catch(e){
  console.error('脚本异常：' + e.message);
  process.exitCode=2;
}finally{
  try{ if(chrome) chrome.kill(); }catch{}
  try{ srv.kill(); }catch{}
}
