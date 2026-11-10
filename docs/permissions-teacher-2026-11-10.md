# 教师权限矩阵与差距清单（只查不改 · 2026-11-10 · HEAD 44f9a63 · v106）

依据：主理人口径「**授课老师可以看、教务老师可以改**」。本文件只查不改，供拍板。

## 一、角色定位与导航可见页

| 角色 | 定位（ROLE_KIND） | NAV_ORDER 可见页 |
|---|---|---|
| super 首位教务 | 站长，全功能 | 今日·考勤·打卡·作业·名册·学生账号·学员档案·课表·课时·晚自习·量化·模考·协作·征集·老师管理·巡检·设置 |
| office 总教务 | 同上 + 账号管理，无演示/看板/AI密钥 | 与 super 完全一致 |
| admin 教务老师 | 管全班那一摊，不能建删账号 | 同 super 去掉「老师管理」「巡检」 |
| both 教务兼授课 | 教务那摊 + 自己班的授课那摊 | 教务全套 + 每日新闻·录入今日·我带的班·上报与申请 |
| **teacher 授课老师** | 只管自己带的班 | **今天·每日新闻·录入今日·我带的班·学员档案·上报与申请·设置**（7 页） |
| student 学生 | 只看自己的 | 今日·征集·打卡·新闻·课表·考试·量化·档案·作业·消息·设置（11 页） |

## 二、teacher vs admin 操作差异矩阵

| 模块（route） | teacher | admin | 说明 |
|---|---|---|---|
| 考勤 att | ✗ 进不去 | ✓ 点章/换天/导出 | teacher 点入口被拦（5.26 起跳回「今天」并说明只读视角） |
| 作业 homework | ✗ | ✓ 布置/登记交没交 | |
| 课表 timetable | ✗ | ✓ 大课/小课/教室 | |
| 打卡管理 sign | ✗ | ✓ 动态码/规则/一览 | |
| 协作 coop | ✗ | ✓ 工单/请假批/通知 | teacher 的上报走自己的「上报与申请」页 |
| 量化 quant | ✗ | ✓ 手动加减分 | |
| 模考 exam / 晚自习 night / 课时 hours / 名册 roster / 学生账号 / 征集 gather | ✗ | ✓ | |
| **学员档案 profile** | **✓（只读）** | ✓ | 唯一共享的业务页（index.html:6900 roles 含 teacher） |
| teacher 独有 | 今天 today · 每日新闻 · **录入今日**（写 records）· 我带的班 · **上报与申请**（写 tickets own） | — | teacher 可写：records、tickets（服务端 TEACHER_WRITE） |

## 三、关键事实：服务端早就把「看」的数据发给老师了

`edge-functions/api/sync.js` TEACHER_READ（125-146 行）对 teacher 角色下发：
`classes(self) · students(classId) · **homework(clsId)** · exam_scores · exam_sheets · weights · records · tickets(own) · periods · **schedule（全量）** · schedule_archive · rooms · exams · quant_rules · notices · **att:/night:/hw: 前缀（本班学员）**`

→ **考勤、作业、课表、量化细则的数据服务端本来就发到老师设备上，前端只是没给页面**。差距是纯前端的路由/入口问题（除下述三项需服务端补发）。

## 四、按主理人口径的差距清单（授课老师现在连「看」都看不了的）

| # | 内容 | 服务端数据 | 差距性质 |
|---|---|---|---|
| 1 | 本班考勤记录 | att: 前缀已下发 | 纯前端：route 加 teacher + 页面写按钮按角色隐藏 |
| 2 | 作业布置与交没交 | homework + hw: 已下发 | 纯前端 |
| 3 | 课表全表（myclass 只有与自己相关的） | schedule 全量已下发 | 纯前端 |
| 4 | 打卡记录（谁打了/待核） | **sign: 不在 TEACHER_PREFIX_READ** | **需服务端加前缀**（学生隐私敏感度低：打卡记录本人可见） |
| 5 | 班级量化流水（谁被扣分） | **quant_log 不在 TEACHER_READ**（注释明说按班下发不含姓名是给学生的；给老师要看明细） | **需服务端决策**：老师看全班明细 or 只看班分——隐私口径要主理人拍板 |
| 6 | 协作工单全景（其他老师上报了什么） | tickets 服务端只发 own | **需服务端扩**；学生消息类涉及学生隐私，建议只放开「老师上报」类 |
| 7 | 限时征集 | gathers 不在 TEACHER_READ | 需服务端加（null 整份下发即可，无个人隐私） |

## 五、若给授课老师加只读入口，涉及面（清单，未动手）

**前端 index.html**
1. `App.routes` 中 att / homework / timetable / quant / sign（/gather）的 `roles` 数组加 `'teacher'`（6950、6896-6909 区）
2. `NAV_ORDER.teacher`（6992）插入对应 id（建议排在 profile 前）
3. 各页写操作按 `Auth.role()==='teacher'` 隐藏：考勤点章 chips 与「一键全部正常」、作业布置表单与交没交按钮、打卡规则表单与「采集位置」（动态码区本就是只读可留）、量化「记一笔」快捷按钮、协作回复/批准按钮
4. TAB_ORDER.teacher 不动（底栏仍 5 个；新增页走「全部功能」抽屉）
5. 只读先例：profile 页（6900）已对 teacher 开放——各页隐藏写按钮时可参考其做法

**服务端 edge-functions/api/sync.js**
1. TEACHER_PREFIX_READ 加 `'sign:'`
2. TEACHER_READ 加 `quant_log`（口径待拍板）与 `gathers: null`
3. tickets 过滤如需放开「老师上报」类，改 own 逻辑（注意不把学生消息放出去）

**测试**
1. test/permissions.test.mjs 断言同步
2. board_check 中涉及路由角色的项
3. xf_check m390 基线不受影响（teacher 桌面端变化）

**建议顺序**：先做纯前端三项（考勤/作业/课表只读）——零服务端改动、零隐私口径问题；打卡记录（#4）加一个前缀即可；#5/#6 需主理人对「老师能看到谁被扣分 / 看到别人的工单吗」表态后再动。
