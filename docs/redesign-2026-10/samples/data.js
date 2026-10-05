/* 砺蕴教务系统 · 样张 · data.js
   演示数据 + 角色→节点映射 + 印章状态机 + 对齐生产读取函数（§2.1.2 / §7.1）。
   全部为 demo 数据，形状对齐生产 index.html 的 Store / Schedule / Att / Home / News。 */
(function () {
  'use strict';

  /* ── 端口 ①②③（§1.4；F11：id 用 port1/2/3，避开与规格 ① 的角色名 admin 撞车）──
     映射（搬入生产时）：port1 = teacher / admin / both · port2 = student · port3 = super / office */
  var PORTS = [
    { id: 'port1', label: '教师·教务', hint: '我带的班' },
    { id: 'port2', label: '学生',      hint: '我的课表' },
    { id: 'port3', label: '管理',      hint: '全校 + 系统' }
  ];

  /* ── 导航（§3.1：Shell.mountChrome 依此渲染 .side/.tabbar）────────────── */
  var NAV = {
    port1: [
      { g: '今天', items: [
        { id: 'home', label: '今日', icon: 'ic-target' },
        { id: 'att', label: '考勤', icon: 'ic-clipboard' },
        { id: 'timetable', label: '课表', icon: 'ic-calendar', noop: 1 },
        { id: 'night', label: '晚自习', icon: 'ic-moon', noop: 1 } ] },
      { g: '档案', items: [
        { id: 'homework', label: '作业', icon: 'ic-memo' },
        { id: 'roster', label: '名册', icon: 'ic-users' },
        { id: 'students', label: '学员档案', icon: 'ic-card', noop: 1 },
        { id: 'quant', label: '量化', icon: 'ic-chart', noop: 1 },
        { id: 'exam', label: '模考', icon: 'ic-mic', noop: 1 } ] },
      { g: '设置', items: [
        { id: 'settings', label: '设置', icon: 'ic-gear' },
        { id: 'health', label: '巡检', icon: 'ic-pulse', noop: 1 } ] }
    ],
    port2: [
      { g: '今天', items: [
        { id: 'home', label: '今日', icon: 'ic-target' },
        { id: 'att', label: '我的考勤', icon: 'ic-clipboard' },
        { id: 'timetable', label: '课表', icon: 'ic-calendar', noop: 1 } ] },
      { g: '学习', items: [
        { id: 'homework', label: '作业', icon: 'ic-memo' },
        { id: 'night', label: '晚自习', icon: 'ic-moon', noop: 1 },
        { id: 'quant', label: '量化', icon: 'ic-chart', noop: 1 } ] },
      { g: '设置', items: [ { id: 'settings', label: '设置', icon: 'ic-gear' } ] }
    ],
    port3: [
      { g: '今天', items: [
        { id: 'home', label: '今日', icon: 'ic-target' },
        { id: 'att', label: '全校考勤', icon: 'ic-clipboard' },
        { id: 'timetable', label: '课表', icon: 'ic-calendar', noop: 1 },
        { id: 'night', label: '晚自习', icon: 'ic-moon', noop: 1 } ] },
      { g: '档案', items: [
        { id: 'homework', label: '作业', icon: 'ic-memo' },
        { id: 'roster', label: '名册', icon: 'ic-users' },
        { id: 'students', label: '学员档案', icon: 'ic-card', noop: 1 },
        { id: 'teachers', label: '老师管理', icon: 'ic-teacher', noop: 1 },
        { id: 'quant', label: '量化', icon: 'ic-chart', noop: 1 } ] },
      { g: '管理', items: [
        { id: 'settings', label: '设置', icon: 'ic-gear' },
        { id: 'health', label: '系统健康', icon: 'ic-pulse', noop: 1 },
        { id: 'patrol', label: '巡检', icon: 'ic-shield', noop: 1 } ] }
    ]
  };
  var TABBAR = ['home', 'att', 'roster', 'homework', 'settings'];

  /* ── 作息时间（用户数据，§7.1：不是全校固定值；有几节画几节）──────────
     ⚠️ 搬入生产：本常量对应生产 `Schedule.periods()`
        （= `Store.list('periods', (a,b)=>this._tmin(a.start)-this._tmin(b.start))`，已按 `_tmin` 排序；
         `_tmin` 处理「下午写成 12 小时制」的排序坑，见下方 `tmin`）。
        考勤时段对应生产 `Att.SLOTS()`（读 `att_slots`，默认上午/下午）。
        样张无 Store，用常量演示「形状」；换源即可，渲染侧（刻度数/排序/分桶/兜底）不动。 */
  var PERIODS = [
    { name: '早功',   start: '06:30', end: '07:30' },
    { name: '第1节',  start: '08:00', end: '09:40' },
    { name: '第2节',  start: '10:00', end: '11:40' },
    { name: '第3节',  start: '13:30', end: '15:10' },
    { name: '第4节',  start: '15:30', end: '17:10' },
    { name: '晚自习', start: '19:00', end: '21:30' }
  ];

  /* 考勤时段（对齐生产 `Att.SLOTS()`：读 `att_slots`；样张无 Store，用默认两条演示，§7.1.3 兜底用） */
  var ATT_SLOTS = [ { id: 'am', name: '上午' }, { id: 'pm', name: '下午' } ];

  /* ── 班级 / 学员 ─────────────────────────────────────────────────────── */
  var CLASSES = [
    { id: 'c1', name: '播音一班', teacher: '李蕴', count: 26 },
    { id: 'c2', name: '播音二班', teacher: '王越', count: 24 },
    { id: 'c3', name: '表演班',   teacher: '张泠', count: 18 }
  ];
  var NAMES = ['王梓涵','李昊','孙一诺','周雨桐','吴承宇','郑思远','冯乐瑶','陈嘉禾','褚亦辰','卫子轩',
               '蒋若彤','沈牧言','韩沐宸','杨诺言','朱清和','秦书瑶','许知遥','何星屹','吕安然','施亦然',
               '张梓萌','孔令仪','曹言蹊','严予安','华语桐','金泽宇'];
  /* 初始状态：多数正常，少量异常/未登记（对齐 Att.worst 的取最重语义） */
  var INIT_STATUS = { 10: '迟到', 16: '病假', 22: '事假', 24: 'none' };
  var STUDENTS = {};
  CLASSES.forEach(function (c, ci) {
    STUDENTS[c.id] = NAMES.slice(0, c.count).map(function (n, i) {
      return {
        id: c.id + '-' + (i + 1), name: n, idx: i + 1,
        status: (ci === 0 ? (INIT_STATUS[i] || '正常') : '正常'),
        am: ci === 0 && i === 10 ? '迟到' : '正常',
        pm: ci === 0 ? (INIT_STATUS[i] || '正常') : '正常'
      };
    });
  });

  /* ── 今日要闻（News.render 对齐）─────────────────────────────────────── */
  var NEWS = [
    { time: '07:12', title: '国内多家博物馆推出夜间开放，客流同比增长' },
    { time: '08:30', title: '教育部发布新学年校园安全提示' },
    { time: '10:05', title: '我国科研团队在语音合成领域取得新进展' },
    { time: '12:40', title: '多地进入汛期，水利部门启动应急响应' },
    { time: '15:20', title: '新一轮消费补贴政策落地' },
    { time: '18:45', title: '全国大学生艺术展演落幕，多所院校获奖' }
  ];

  /* ── 今日目标（Home.render 倒计时）───────────────────────────────────── */
  var EXAM = { label: '统考', date: '2027-02-08' };

  /* ── 作业（Homework 对齐）────────────────────────────────────────────── */
  var HOMEWORK = {
    date: today(),
    assigned: [
      { cls: '播音一班', text: '新闻播报 3 条（录音上传）', due: '今晚 22:00' },
      { cls: '播音二班', text: '话题评述 1 段（视频）',     due: '今晚 22:00' }
    ],
    checklist: ['王梓涵','李昊','孙一诺','周雨桐','吴承宇','郑思远','冯乐瑶','陈嘉禾',
                '褚亦辰','卫子轩','蒋若彤','沈牧言']
  };
  var HW_DONE_SEED = [0, 1, 2, 4, 6, 8, 10];   /* 已完成的索引，演示进度条 */

  /* ── 角色 → 节点集合（§2.1.2 + §7.1.4：节点带时间，按刻度分桶）────────
     每条节点：at（挂在哪个时刻）、kind、title、sub、state、body、done */
  var NODES_BY_ROLE = {
    port1: [
      { at: '06:40', kind: 'att',   title: '我班的早打卡窗口', sub: '播音一班 · 06:30–07:30', state: '已登记', done: 1, body: '应登记 26 人 · 已登记 26 人 · 迟到 1（李昊）' },
      { at: '08:00', kind: 'class', title: '作品朗读 · 播音一班', sub: '第1节 · 张老师', state: '已上', done: 1, body: '全班 26 人 · 已点名 · 出勤 25 · 迟到 1' },
      { at: '09:10', kind: 'hw',    title: '昨晚作业检查 · 播音一班', sub: '已完成 19 / 26', state: '进行中', done: 0, body: '点开可就地勾选未完成名单（复用 .box 勾选）。' },
      { at: '10:00', kind: 'class', title: '话题评述 · 播音二班', sub: '第2节 · 王老师', state: '已上', done: 1, body: '代课记录已同步。' },
      { at: '13:40', kind: 'att',   title: '我班的下午打卡窗口', sub: '播音一班 · 13:30–15:10', state: '进行中', done: 0, body: '应登记 26 · 已登记 23 · 异常 3 → 点开进考勤点印' },
      { at: '14:30', kind: 'todo',  title: '待批：1 条学生请假', sub: '赵敏 · 事假 · 15:00 前', state: '待处理', done: 0, body: '批准后自动写入当天考勤并同步量化。' },
      { at: '15:40', kind: 'class', title: '台词训练 · 表演班', sub: '第4节 · 张老师', state: '未开始', done: 0, body: '跨班授课，本班不在我名下。' },
      { at: '19:10', kind: 'night', title: '晚自习过关登记', sub: '播音一班 · 过关 23 / 26（昨日）', state: '未开始', done: 0, body: '19:00 开始后可逐人标记「过 / 未过」。' }
    ],
    port2: [
      { at: '06:40', kind: 'att',   title: '早打卡', sub: '06:30–07:30 · 已打卡', state: '已完成', done: 1, body: '打卡时间 06:52 · 正常' },
      { at: '08:00', kind: 'class', title: '作品朗读', sub: '第1节 · 张老师 · 教室 A302', state: '已上', done: 1, body: '本节课听讲记录已同步。' },
      { at: '10:00', kind: 'class', title: '话题评述', sub: '第2节 · 王老师 · 教室 A302', state: '已上', done: 1, body: '' },
      { at: '13:40', kind: 'att',   title: '下午打卡', sub: '13:30–15:10', state: '未打卡', done: 0, body: '点开即可打卡（demo 内就地示意）。' },
      { at: '14:00', kind: 'hw',    title: '今晚作业', sub: '新闻播报 3 条 · 截止今晚 22:00', state: '待完成', done: 0, body: '点开可就地标记完成。' },
      { at: '19:10', kind: 'night', title: '晚自习', sub: '19:00–21:30', state: '未开始', done: 0, body: '' }
    ],
    port3: [
      { at: '06:40', kind: 'att',   title: '全校早打卡窗口', sub: '3 个班 · 2 个班已登记', state: '未登记 1 班', done: 0, body: '表演班未登记 → 点开可催办。' },
      { at: '08:00', kind: 'class', title: '各班课程概览', sub: '第1节 · 3 个班在课', state: '进行中', done: 0, body: '播音一班 / 二班 / 表演班均已开课。' },
      { at: '09:10', kind: 'hw',    title: '作业布置覆盖', sub: '今日 2 / 3 个班已布置', state: '部分', done: 0, body: '表演班尚未布置。' },
      { at: '13:40', kind: 'att',   title: '全校下午打卡', sub: '已登记 50 / 68 · 异常 3', state: '进行中', done: 0, body: '异常 3（迟到 1 · 病假 1 · 事假 1）' },
      { at: '14:30', kind: 'todo',  title: '待批请假 1 条', sub: '赵敏 · 事假 · 播音一班', state: '待处理', done: 0, body: '批准后写入考勤并同步量化。' },
      { at: '18:30', kind: 'patrol',title: '教师到岗巡检', sub: '本周 3 次 · 全部到岗', state: '已完成', done: 1, body: '' },
      { at: '19:10', kind: 'night', title: '全校晚自习过关', sub: '3 个班 · 过关 61 / 68', state: '未开始', done: 0, body: '' }
    ]
  };

  /* ── 印章状态机（§2.2）───────────────────────────────────────────────── */
  var STAMP_CYCLE = ['正常', '迟到', '病假', '事假'];

  /* ── 工具（对齐生产 Schedule._tmin 的「下午 12 小时制」坑，§7.1）──────── */
  function tmin(t) {                     /* 'HH:MM' → 分钟；01:00–05:59 视为下午 */
    var h = parseInt(t.slice(0, 2), 10), m = parseInt(t.slice(3, 5), 10);
    if (h >= 1 && h <= 5) h += 12;
    return h * 60 + m;
  }
  function today() {
    var d = new Date(), p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function periodsSorted() {             /* 已按 _tmin 排序（复用 _tmin，不另写一套） */
    return PERIODS.slice().sort(function (a, b) { return tmin(a.start) - tmin(b.start); });
  }
  function dayRange() {                  /* DAY_START / DAY_END = 首末节次 */
    var p = periodsSorted();
    if (!p.length) return { start: 6 * 60 + 30, end: 21 * 60 + 30, empty: true };
    return { start: tmin(p[0].start), end: tmin(p[p.length - 1].end), empty: false };
  }
  function nowMin() { var d = new Date(); return d.getHours() * 60 + d.getMinutes(); }
  function daysTo(dateStr) {
    var t = new Date(dateStr + 'T00:00:00'), n = new Date(today() + 'T00:00:00');
    return Math.ceil((t - n) / 864e5);
  }

  window.D = {
    PORTS: PORTS, NAV: NAV, TABBAR: TABBAR, PERIODS: PERIODS, ATT_SLOTS: ATT_SLOTS, CLASSES: CLASSES,
    STUDENTS: STUDENTS, NEWS: NEWS, EXAM: EXAM, HOMEWORK: HOMEWORK,
    HW_DONE_SEED: HW_DONE_SEED, NODES_BY_ROLE: NODES_BY_ROLE, STAMP_CYCLE: STAMP_CYCLE,
    tmin: tmin, today: today, periodsSorted: periodsSorted, dayRange: dayRange,
    nowMin: nowMin, daysTo: daysTo
  };
})();
