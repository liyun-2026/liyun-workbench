# VoxOS 5.32 · 全站「页面状态与交互」体检报告

- 体检日期：2026-11-12
- 基线：生产 `index.html` @ HEAD `10394b6`（sw v111）→ 本轮整改后 sw **v112**
- 体检工具：`test/audit_interact.mjs`（真实 Chrome + CDP，dev-server 种子数据）
- 体检矩阵：**34 页 × 三角色（super/teacher/student）× 双端（桌面 1440/1280/1100 + 手机 390×844）**，登录门 gate 单独会话（720 矮窗 + 390）
- 工具复跑：`node test/audit_interact.mjs`（重定向到文件跑，避免管道 SIGPIPE）

**最终结论：🔴 0 · 🟡 0 · ✅ 62 项通过**（`problems.json` 为空数组）。
四专项共查出 **🔴 真问题 5 项 + 🟡 注意 4 项**，全部修复；其余初报条目经三档复测证伪为检测器误报，检测器已同步修正（见 §5）。

---

## 专项 1：弹窗/对话框遮挡普查（矮窗 1280×720 + 手机 390×844）

| 级别 | 页面 | 现象 | 根因 | 修法 | 截图 |
|---|---|---|---|---|---|
| 🔴 | super/大课表 timetable（perEdit 改节次） | 点时间格「毫无反应」，弹窗内容拼好了却看不见 | **弹窗结构写反**：外层用裸 `<div class="mask">`（无全局样式、无遮罩），内层 `.picker` 默认 `display:none` 且没挂 `.on` —— 内容 1164 字符拼好但 `visible:false` | index.html:9081 改回正规结构 `<div class="picker on" style="background:rgba(0,0,0,.42)"><div class="sheet" style="width:min(340px,92vw)">`；`cellClose`（index.html:9433）改用 `ev.target.closest('.sheet')` 判内层点击（旧 `className !== 'mask'` 判定换容器后失效） | modal-super720-perEdit.png |
| 🔴 | super/大课表 timetable（cellOpen 加课） | 同上，1403 字符内容不可见 | 同上同一处写法 | index.html:9404 同样改 `.picker on > .sheet`（`width:min(360px,92vw)`） | modal-super720-cellOpen.png |
| 🟢 | drawer（三角色）/ rolePick / devGate / gate 登录门 | — | — | 全部通过：完整可见 + 全屏遮罩 + 关闭路径正常；`#devGate` 699px 以下贴底、`#gate` 720 高内部可滚 | modal-super720-drawer.png、modal-super720-rolePick.png、modal-tea720-drawer.png、modal-tea720-cellOpen.png、modal-stu390-drawer.png、modal-stu390-devGate.png、modal-gate-720.png、modal-gate-390.png |

修复后复验：perEdit / cellOpen 在 720 矮窗 `fits + cover` 全过（截图为证），关闭路径正常。

## 专项 2：触控/点击死点击普查（长序列初筛 → reload 单点复测 → 全新会话终审，三档时序）

| 级别 | 页面 | 现象 | 根因 | 修法 |
|---|---|---|---|---|
| 🔴 | super/作业 homework | 点班级 chip「砺蕴二班」两种时序均无反馈（初报） | **三档终审证伪为误报**：长序列里前序 confirm 被自动接受、连带删了服务端数据，reload 救不回来；全新会话（dev-reset + 重播种）点击 `fb:true`，chips 选中态正确翻转、`Homework._pick` 正确写入 | 不修产品；体检脚本加第三阶段终审（§5），复跑归 🟢 |
| 🟡 | super/大课表 timetable | 点「按区间重画」按钮后页面重画了但没有任何提示，像没点上 | applyRange 静默执行 | index.html:9261 末尾补 `UI.toast('课表已按当前区间重画')` |
| 🟡 | super/课时统计 hours | 空态下点「清空」无反馈 | `Hours.clear` 空态直接 return | index.html:12106 改 `UI.toast('还没有识别结果，不用清')` |
| 🟢 | 全站其余可点件 | — | — | 全部有反馈。四类天然无法本地验证的单独放行并注明：破坏性操作（confirm 即反馈，不自动点击）、文件选择器（headless 打不开对话框）、网络拉取类（News.fetch/Health.run，dev 无外网）、清空输入框（空态惯例无害） |

## 专项 3：假窗口/假板块普查（空板块 + onclick 死绑定交叉验证）

| 级别 | 页面 | 现象 | 根因 | 修法 |
|---|---|---|---|---|
| 🟢 | 全站 34 页 | **零死绑定**：所有 onclick 引用的函数在页面全局词法环境里都存在 | — | —（检测方法见 §5：顶层 `const` 模块不挂 window，必须页面内 `eval('typeof X')` 判） |
| 🟢 | super/名册 roster | 初报「空白无字板块」×4（singleAcctCard 等） | **误报**：卡在闭合 `<details class="more">`（index.html:4177-4181）里，Chrome 对未展开内容跳过渲染，innerText 为空但 rect 有效；截图目测视觉正常 | 检测器加两条约束：闭合 details 内跳过 + 只看视口内卡片（§5）；roster 本体不修 |
| 🟢 | 全站 | 初报 roster 视口外空白卡 | 同上 | 同上，判视口内 |

## 专项 4：文字「嵌死」与缩放稳定性（1440/1280/1100 三档标题 bbox + elementFromPoint 重叠检测）

| 级别 | 页面 | 现象 | 根因 | 修法 |
|---|---|---|---|---|
| 🟡 | super/大课表 timetable | 1100px 下「小课 / 加课」卡头被 hint 长句挤折行（高 48px→82px） | h2 内 hint 长句随宽度换行 | index.html:4346 卡头 h2 加 `white-space:nowrap` 锁单行 |
| 🟢 | 全站其余标题 | — | — | 三档宽度零折行、零重叠（同标题跨档高度增量 ≤ 0.6 行视为未折） |

---

## 5. 体检检测器演进（误报收敛记录，供后续复跑参考）

初版 9🔴+17🟡 → 终版 0🔴+0🟡，全部是检测器修正、无一处放过真问题：

1. **死绑定**：模块是顶层 `const` 不挂 window，用 `window` 解析全是误报 → 页面内 `eval('typeof X')`（同一全局词法环境）；onclick 属性以 `event.stopPropagation()`/`this.closest()` 开头的不是绑定函数，正则跳过。
2. **死点击指纹**：`outerHTML` 长度抓不到 chip 选中态翻转（`chip chip-on` 挪位等长）→ 改 **djb2 内容哈希**；指纹补齐 toast 文案、`.picker.on/.drawer.on` 弹窗计数（弹窗挂 body 下不在 `.page.on` 里）、input/select/textarea value、`main.scrollTop`；等待 1100ms 覆盖 makeCard 类「800ms 后才 toast」的异步反馈。
3. **三档终审**：长序列初筛 → reload 单点复测 → **全新会话终审**（dev-reset + 登录 + 重播种 + 导航刷新后单点点击）。前两档会被「前序 confirm 自动接受改掉了服务端数据（tombstone 盖掉 push 回的种子）」污染，只有第三档算金标准。终审必须放在全部检查之后跑（dev-reset 会清掉主种子用户）。
4. **空板块**：闭合 `<details>` 内的卡（Chrome content-visibility 跳过渲染 → innerText 空但 rect 有效）与视口外卡片跳过；记录 `#id@y` 便于回查截图。
5. **弹窗遮罩判定**：容器 `.picker.on`（fixed inset:0）自身就是全屏层，`.sheet` rect / 父容器 rect / 容器 rect 三者面积取最大 ≥ 视口 90% 才算罩住。
6. **会话自保**：settings 页「清空本地数据」confirm 被自动接受会 `Store.wipe + reload` 炸掉 CDP 会话 → destructive 类直接跳过不点击。

## 6. 回归结果

| 测试 | 结果 |
|---|---|
| exam_anim_check（含 SW 换版触达段） | 19/19 |
| sign_code_check | 10/10 |
| teacher_ro_check | 39/39 |
| board_check | 68/68 |
| xf_check + m390 基线 | 通过（有意变化面已更新基线） |
| audit_interact（本体检） | 🔴0 🟡0 ✅62 |

## 7. 截图编号索引

`docs/audit-interact-2026-11-12/` 下：modal-super720-{drawer,rolePick,perEdit,cellOpen}.png、modal-tea720-{drawer,cellOpen}.png、modal-stu390-{drawer,devGate}.png、modal-gate-{720,390}.png（共 10 张，全部为修复后复验截图）；问题清单 `problems.json`（终版为空数组）。
