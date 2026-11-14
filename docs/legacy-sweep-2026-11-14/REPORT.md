# 旧版本彻底迭代删除 · 大检查报告

- 日期：2026-11-14
- 工程基线：HEAD `0344f8a` · sw v115 → 本轮 `v116`
- 范围：`砺蕴工作台/` 工程目录 + `~/Desktop/砺蕴教务系统/` 根目录
- 结论先行：**旧版本痕迹已彻底清零**（代码内零死 CSS/死 JS/死令牌/深色残留；工程外死工具与旧设计稿入废纸篓；git 历史未动，全部删除走 trash）

---

## 1. 「旧版/legacy」13 处命中甄别 —— 全留，零死代码

| 行号 | 内容 | 定性 |
|---|---|---|
| L53 / L468 / L12079 / L12740 / L18446 / L20156 | 改版说明注释（「旧版把侧栏做成深色面」「旧版两个毛病」等） | 注释，留 |
| L5887 | `/* ── 旧版数据迁移 ──` | Store.migrate 区块注释，migrate 被 L7043 活调用，留 |
| L6443 / L6570 | `name:'旧版本缓存'` / `'清掉了 N 份旧版本缓存'` | SW 体检 UI 用户文案，活代码，留 |
| L7043 | `Store.migrate(); // 旧版数据补齐 id` | 活调用，留 |
| L15235 / L15238 | `const legacy = rules.filter(...)` | **活变量**：语义是「非班级名目（自动计分）规则分组」，与「旧版」无关，留 |
| L20178 | `if (!hadController) return; // 没有「旧版」要换掉` | SW controller 逻辑 + 注释，留 |

证据：`grep -n "旧版|legacy"` 全部 13 处逐一读上下文定性。

## 2. 死 CSS 静态审计 —— 删 27 条规则 + 10 个死令牌

方法：提取 `<style>` 块 536 个类名选择器，与全文 token（HTML class / JS 字符串 / classList / 模板）交叉比对 → 24 个零引用候选 → 剔除 3 个注释误报（.css/.woff2/.tl-）→ 21 个死类剥注释精确判定 + 动态拼接排查（classList/className 全字面量，无 `'m2-s-'` 型拼接）+ 跨文件扫描（edge-functions/sw.js/test 零引用，仅注释与文档提及）。

**删除的 27 条规则**（净删约 2000B）：
- `.gate .whoami` ×2（L454/458）——登录门旧元素
- `.sgrid .phead`（L861）、`.sgrid td.slotv`（L868）——大课表旧结构
- `.imptbl` 全家 12 条（L914-927 外层 + L3285-3288 手机层）——**5.35 删旧文字导入链后遗留的孤儿样式**
- `#page-stuHome.on > .m2-s-sign/.m2-s-cls/.m2-s-hw/.m2-s-notice`（L1803-1810 @media 内 4 条）——旧 stuHome 排版
- `.cd-input`（L2794）、`.stu-meta`（L2943）、`.more .mrow`（L2947）、`.s-card`（L2975）

**删除的 10 个零引用令牌**（净删 214B）：`--brand-deco` `--brand-ink` `--dur-page` `--ease-page` `--r-lg` `--sh-2` `--sp-1` `--sp-12` `--sp-18` `--sp-28`——var() 引用与 JS 字符串引用（getPropertyValue 等）双查零命中；同行的活令牌（--sp-2/3/4/6/8、--sh-1、--dur-quick/base/slow、--ease-quick/base/slow 等）原样保留。

补充审计：@keyframes 7 个全部有 animation 引用，零死。

复验：21 类名全文 grep 归零、CSS 花括号配平 OK、删除后九套件回归全绿。

## 3. 死 JS 函数审计 —— 删 9 函数 + 1 孤儿注释

方法：5 个内联 script 块提取 706 个函数定义（对象方法 + function 声明 + const 箭头函数三模式），全文 token 词频比对，出现次数 ≤ 定义次数即疑死 → 9 个疑死 → 逐个读上下文定性：

**删除**（净删约 2513B）：
- Store 按天封装七件套：`getDaily` / `setDaily` / `listDaily` / `upsertDaily` / `incrDaily` / `decrDaily` / `countDaily`（L5835-5841）——零调用死封装（含「按天」注释行）
- Schedule 旧文字导入底层解析残留：`_textDate`（L9589）、`parseCell`（L9611）——5.35 删 13 方法时漏网的底层解析器；孤儿注释「/** 课表文字 → 条目数组 */」一并清

**标活保留**：
- `_textTime`——被 `matchPeriod` 调用，matchPeriod 被 **impImport** 调用，impImport 被 Hours.toSchedule 复用（5.35 定案的活链）
- `_impRows` 属性——impImport 尾部就地清状态仍在引用

复验：9 函数名全文 grep 归零、5 个 script 块 `new Function` 编译全 OK。

## 4. 文件系统清扫 —— trash 9 项，备份保留

**删除（trash，git 历史未动）**：
| 项 | 大小 | 定性证据 |
|---|---|---|
| `砺蕴工作台/tools/`（mob_evidence.py / mob_film.py / mock_overflow_check.mjs） | ~13KB | 2026-10-05 手机版一次性出图工具，仅被 report-2026-10-05-mobile.md 文档提及，零运行时引用 |
| `redesign-fresh/`（A-F 六版旧视觉提案 HTML+PNG） | 27M | 2026-10-19 提案期产物，index.html 仅历史注释提及（像素标杆来源），零运行时依赖 |
| 根目录 5 张旧导出图（导出-VoxOS4.19-学生版/老师版、课表-VoxOS4.16/17/18-预览.png） | ~950KB | VoxOS 4.1x 时代导出/预览图，旧版本痕迹 |

**保留（附理由）**：
- `启动预览.command`——活工具：双击启动本机预览（test/dev-server.mjs 入口），数据持久逻辑完整
- `ocr/`（6.5MB tesseract wasm）——活资源：`OCR_BASE = './ocr/'` 同源识别引擎，sw.js 明确不预缓存但运行时必需
- **6 个备份文件夹均保留**：`备份-启动器-20261111`、`备份-旧启动器-20261020`、`备份-旧桌面启动脚本-20261010`、`备份-砺蕴.app-20261023` —— **保留是主理人 11-13 的决定（未勾删）**；另 `_备份_搬生产前_20261005_0235`、`砺蕴删除备份_20261004` 两个命名不同的备份同样未获主理人拍板，如实保留待定
- `启动器-原生壳/`（11-11 近期）、`品牌运营/`、`砺蕴素材/`、`砺蕴工作系统-使用手册/`——非代码资产
- 工作台内 16 份 `report-*.md`——git 内近期报告

**docs/ 剩余目录逐个定性**（全部合规，无旧版本痕迹）：
- 近期交付物：acceptance-2026-11-13 / boss-ppt-2026-11-13 / handbook-boss-2026-11-13 / cards-2026-11 / light-switch-2026-11-13（本轮对比图）/ anim-fix / audit-interact-2026-11-12 / backup-drill / xf-production-shots（回归截图，health 链重建）/ reports
- 方案文档 ×7：学生端建设方案 / 学生端综合方案-v2 / 打卡-NFC / 打卡-实体卡与打卡机 / 打卡-空白NFC标签 / 不备案路线 / permissions-teacher-2026-11-10 / sign-load-report

## 5. 深色模式残留复核 —— 全零

- `prefers-color-scheme`：index.html **0**；sw.js 1 处 = v115 版本注释文字（非代码）
- `matchMedia`：仅剩 `__desk()` 宽度锁版判定（min-width），无任何深色监听
- 暗色系十六进制（#18211E / #121A16 / #0F1713 / #1A2420 等）：**零命中**
- #1x 深色值抽查 3 处全为活色：#1a1815（登录门浅底深字）×2、#141d31（学府影像板固定深蓝底）、#1f2937（JS 浮动提示按钮底、白字）

## 6. sw.js 缓存清单复核 —— 全过

- `VERSION = 'v116'` 赋值行唯一（grep `^\s*VERSION\s*=` 计数 1）；358 行 `const` 声明 + 巨型历史注释横跨、424 行收尾赋值的结构未破坏（**曾两次险些重蹈 v115 双赋值覆辙，均已当场自纠**）
- vm worker 求值：OK，install/activate/fetch/message 四 listener 注册正常
- `CACHE = 'liyun-shell-' + VERSION` 单一版本源；activate 时 `k !== CACHE` 清旧缓存链在位
- SHELL 清单 25 项文件存在性核验：**缺失 0**；assets/ 目录与 SHELL 完全对齐，无孤儿资源（sideart 3 张 lite 图一致）

## 7. 全量九套件回归（本轮删除动作后）

| 套件 | 结果 |
|---|---|
| board_check | ✅ 68/68 |
| teacher_ro_check | ✅ 39/39 |
| teacher_cls_check --fix | ✅ 8/8 |
| sign_code_check | ✅ 10/10 |
| exam_anim_check | ✅ 19/19 |
| desk_lock_check | ✅ 53/53 |
| audit_interact | ✅ 63 项 · 严重 0 · 注意 0 |
| xf_check | ✅ 全过 + m390 home/stuHome 逐像素 0 差异；settings 97px（0.0074%）在该页已知 ≤400px 豁免额度内（历史实测 ~350px 阈值） |
| sign_load 10 并发 | ✅ 12/12 双通道落账 |

## 8. 部署链（补录）

- commit：`923163c`（6 文件：index.html + sw.js + REPORT.md + tools/ 3 文件删除；+127/-365 行）
- sw：**v116**（赋值唯一 + vm worker 求值 OK + 4 listener 正常注册）
- push：`0344f8a..923163c` ✅（IP 直连 20.247.166.64 一次成功）
- **md5 双验**：
  - index.html `88be41eb…22fa` ✅ 第 2 轮命中（第 1 轮 CDN 未刷新）
  - sw.js `138e5740…bf79` ✅ 首验命中
- health_check：服务本体健康（后端探活 2.6s / 标题 / CNAME 正常）。两条与昨日同源的外部因素：
  1. 首页耗时警告（3.8-11.5s 波动）——curl 分解：TLS 0.67s / 首字节 1.67s 正常，耗时全在 1.43MB 内容下载（链路带宽 ~330KB/s），出口链路问题非服务回归（本轮删除死代码体积还净减 ~0.4KB）
  2. 当日打卡检查跳过——`.health-credentials.json` 口令变更待主理人更新（login 接口探针返回结构化错误，服务活着）

---

## 最终结论

**旧版本已彻底清零**：代码内死 CSS 27 规则 + 10 死令牌 + 死 JS 9 函数全删且复验归零；「旧版/legacy」13 处全部为注释/文案/活代码；深色残留全零；工程外死工具/旧设计稿/旧导出图入废纸篓；保留项均有明确定性与理由（6 个备份文件夹按主理人 11-13 决定保留）。
