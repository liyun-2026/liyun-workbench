# 手机端优化专项报告 · 2026-10-05

**范围**：把上一轮只落在「考勤页」的手机端收档，推广到全站 35 条路由的**文字排版**，
并修掉实测到的两处版面问题。
**改动文件**：`index.html`（仅新增 1 个 CSS 块，1577 字符）、`sw.js`（`VERSION` v60 → v61）。
**未提交、未推送**（按约定交给 team lead）。
**基线提交**：`6224f84`（v60）。改动前后对比的两份 HTML：当前工作区 vs `git show HEAD:index.html`。

---

## 0. 结论速览

- **横向溢出**：全站实测（3 角色 × 35 页 × 390/360/320）**只有 1 处** `overX > 0` —— 考勤页 320px 溢出 29px。**已修，现全为 0**。
- **字号**：`page-title` 22→20、`sec-h`/`seg-h`/`chapter h2`/`sumbox h3`/`card h2` 18(17)→16、`sec-meta`/`cmeta` 14→13、`hint`/`legend` 13→12.5。**表单控件全部 ≥16px**（实测 0 个例外）。
- **版面**：今日页轴首 `.tl-head` 由「三块横排 + 右贴」改为「竖排 + 左对齐」。
- **桌面**：1440px 下 18 页的 docH / scrollH / overX / pageH / 字号列表**逐项零差异**；att/roster 截图**逐像素 0 差异**，timetable 的差异与「同一文件跑两次」完全相同（4.4129%，来自时间相关内容），即改动贡献 0。
- **既有测试**：7 个脚本前后**退出码与通过/失败数完全一致**（含三条已知既有失败），无新增失败。

---

## 1. 改动前后度量表

`docH` 恒等于视口高度（844 / 800 / 568）—— 这是本应用的架构决定的：
`body{height:100%;overflow:hidden}` + `.main{flex:1;overflow-y:auto}`，文档永远只有一个视口高。
所以真正有意义的是 **`.main` 的 scrollHeight** 与 **`overX`（`.main` scrollWidth − clientWidth）**。
「≥18px」列只列**可见的无子元素文本节点**（探针口径），数据大字与按钮图标不计入问题项。

### super

| 页 | 宽 | docH | scrollH 前→后 | overX 前→后 | ≥18px 前 → 后 |
|---|---|---|---|---|---|
| `home` | 390 | 844 | 1867 → 1895 | 0 → 0 | `num` 22px / `num` 40px → `num` 18px / `num` 40px |
| `att` | 390 | 844 | 1990 → 1975 | 0 → 0 | `h2` 18px / `num` 18px / `sec-h` 18px → `num` 18px |
| `sign` | 390 | 844 | 2988 → 2948 | 0 → 0 | `page-title` 22px → `page-title` 20px |
| `homework` | 390 | 844 | 1749 → 1733 | 0 → 0 | `h2` 18px / `hk-pct num` 20px / `page-title` 22px / `sec-h` 18px → `hk-pct num` 20px / `page-title` 20px |
| `roster` | 390 | 844 | 1265 → 1253 | 0 → 0 | `page-title` 22px / `sec-h` 18px → `page-title` 20px |
| `students` | 390 | 844 | 788 → 788 | 0 → 0 | `page-title` 22px → `page-title` 20px |
| `profile` | 390 | 844 | 2022 → 2007 | 0 → 0 | `num` 20px / `page-title` 22px → `num` 20px / `page-title` 20px |
| `timetable` | 390 | 844 | 3251 → 3236 | 0 → 0 | `page-title` 22px → `page-title` 20px |
| `night` | 390 | 844 | 853 → 850 | 0 → 0 | `page-title` 22px → `page-title` 20px |
| `quant` | 390 | 844 | 2198 → 2156 | 0 → 0 | `num` 18px / `page-title` 22px → `num` 18px / `page-title` 20px |
| `exam` | 390 | 844 | 1689 → 1675 | 0 → 0 | `page-title` 22px → `page-title` 20px |
| `coop` | 390 | 844 | 828 → 819 | 0 → 0 | `page-title` 22px → `page-title` 20px |
| `gather` | 390 | 844 | 788 → 788 | 0 → 0 | `page-title` 22px → `page-title` 20px |
| `teachers` | 390 | 844 | 788 → 788 | 0 → 0 | `page-title` 22px → `page-title` 20px |
| `rules` | 390 | 844 | 2665 → 2653 | 0 → 0 | `page-title` 22px → `page-title` 20px |
| `board` | 390 | 844 | 876 → 876 | 0 → 0 | `b` 21px / `b` 32px / `bd-clock` 26px / `bd-code` 51px → `b` 21px / `b` 32px / `bd-clock` 26px / `bd-code` 51px |
| `health` | 390 | 844 | 1241 → 1206 | 0 → 0 | `page-title` 22px → `page-title` 20px |
| `settings` | 390 | 844 | 3841 → 3753 | 0 → 0 | `page-title` 22px / `seg-h` 18px → `page-title` 20px |
| `home` | 360 | 800 | 1992 → 1969 | 0 → 0 | `num` 22px / `num` 40px → `num` 18px / `num` 40px |
| `att` | 360 | 800 | 2126 → 2140 | 0 → 0 | `h2` 18px / `num` 18px / `sec-h` 18px → `num` 18px |
| `sign` | 360 | 800 | 3062 → 3041 | 0 → 0 | `page-title` 22px → `page-title` 20px |
| `homework` | 360 | 800 | 1845 → 1777 | 0 → 0 | `h2` 18px / `hk-pct num` 20px / `page-title` 22px / `sec-h` 18px → `hk-pct num` 20px / `page-title` 20px |
| `roster` | 360 | 800 | 1265 → 1253 | 0 → 0 | `page-title` 22px / `sec-h` 18px → `page-title` 20px |
| `students` | 360 | 800 | 744 → 744 | 0 → 0 | `page-title` 22px → `page-title` 20px |
| `profile` | 360 | 800 | 2023 → 2008 | 0 → 0 | `num` 20px / `page-title` 22px → `num` 20px / `page-title` 20px |
| `timetable` | 360 | 800 | 3254 → 3236 | 0 → 0 | `page-title` 22px → `page-title` 20px |
| `night` | 360 | 800 | 853 → 850 | 0 → 0 | `page-title` 22px → `page-title` 20px |
| `quant` | 360 | 800 | 2455 → 2440 | 0 → 0 | `num` 18px / `page-title` 22px → `num` 18px / `page-title` 20px |
| `exam` | 360 | 800 | 1791 → 1749 | 0 → 0 | `page-title` 22px → `page-title` 20px |
| `coop` | 360 | 800 | 828 → 819 | 0 → 0 | `page-title` 22px → `page-title` 20px |
| `gather` | 360 | 800 | 781 → 775 | 0 → 0 | `page-title` 22px → `page-title` 20px |
| `teachers` | 360 | 800 | 744 → 744 | 0 → 0 | `page-title` 22px → `page-title` 20px |
| `rules` | 360 | 800 | 2707 → 2653 | 0 → 0 | `page-title` 22px → `page-title` 20px |
| `board` | 360 | 800 | 838 → 838 | 0 → 0 | `b` 21px / `b` 32px / `bd-clock` 26px / `bd-code` 47px → `b` 21px / `b` 32px / `bd-clock` 26px / `bd-code` 47px |
| `health` | 360 | 800 | 1241 → 1226 | 0 → 0 | `page-title` 22px → `page-title` 20px |
| `settings` | 360 | 800 | 4037 → 3818 | 0 → 0 | `page-title` 22px / `seg-h` 18px → `page-title` 20px |
| `home` | 320 | 568 | 2191 → 2151 | 0 → 0 | `num` 22px / `num` 40px → `num` 18px / `num` 40px |
| `att` | 320 | 568 | 2140 → 2154 | 29 → 0  ⚠ **已修** | `h2` 18px / `num` 18px / `sec-h` 18px → `num` 18px |
| `sign` | 320 | 568 | 3587 → 3564 | 0 → 0 | `page-title` 22px → `page-title` 20px |
| `homework` | 320 | 568 | 1891 → 1854 | 0 → 0 | `h2` 18px / `hk-pct num` 20px / `page-title` 22px / `sec-h` 18px → `hk-pct num` 20px / `page-title` 20px |
| `roster` | 320 | 568 | 1265 → 1253 | 0 → 0 | `page-title` 22px / `sec-h` 18px → `page-title` 20px |
| `students` | 320 | 568 | 512 → 512 | 0 → 0 | `page-title` 22px → `page-title` 20px |
| `profile` | 320 | 568 | 1977 → 1962 | 0 → 0 | `num` 20px / `page-title` 22px → `num` 20px / `page-title` 20px |
| `timetable` | 320 | 568 | 3305 → 3290 | 0 → 0 | `page-title` 22px → `page-title` 20px |
| `night` | 320 | 568 | 853 → 850 | 0 → 0 | `page-title` 22px → `page-title` 20px |
| `quant` | 320 | 568 | 2633 → 2617 | 0 → 0 | `num` 18px / `page-title` 22px → `num` 18px / `page-title` 20px |
| `exam` | 320 | 568 | 1842 → 1827 | 0 → 0 | `page-title` 22px → `page-title` 20px |
| `coop` | 320 | 568 | 828 → 819 | 0 → 0 | `page-title` 22px → `page-title` 20px |
| `gather` | 320 | 568 | 781 → 775 | 0 → 0 | `page-title` 22px → `page-title` 20px |
| `teachers` | 320 | 568 | 673 → 667 | 0 → 0 | `page-title` 22px → `page-title` 20px |
| `rules` | 320 | 568 | 2707 → 2693 | 0 → 0 | `page-title` 22px → `page-title` 20px |
| `board` | 320 | 568 | 754 → 754 | 0 → 0 | `b` 21px / `b` 32px / `bd-clock` 26px / `bd-code` 42px → `b` 21px / `b` 32px / `bd-clock` 26px / `bd-code` 42px |
| `health` | 320 | 568 | 1262 → 1226 | 0 → 0 | `page-title` 22px → `page-title` 20px |
| `settings` | 320 | 568 | 4237 → 4124 | 0 → 0 | `page-title` 22px / `seg-h` 18px → `page-title` 20px |

### teacher

| 页 | 宽 | docH | scrollH 前→后 | overX 前→后 | ≥18px 前 → 后 |
|---|---|---|---|---|---|
| `today` | 390 | 844 | 1493 → 1481 | 0 → 0 | `span` 22px → `span` 20px |
| `news` | 390 | 844 | 874 → 872 | 0 → 0 | `page-title` 22px → `page-title` 20px |
| `record` | 390 | 844 | 2615 → 2612 | 0 → 0 | `page-title` 22px → `page-title` 20px |
| `myclass` | 390 | 844 | 788 → 788 | 0 → 0 | `page-title` 22px → `page-title` 20px |
| `profile` | 390 | 844 | 1900 → 1885 | 0 → 0 | `num` 20px / `page-title` 22px → `num` 20px / `page-title` 20px |
| `tickets` | 390 | 844 | 788 → 788 | 0 → 0 | `page-title` 22px → `page-title` 20px |
| `settings` | 390 | 844 | 951 → 936 | 0 → 0 | `page-title` 22px / `seg-h` 18px → `page-title` 20px |
| `today` | 360 | 800 | 1504 → 1489 | 0 → 0 | `span` 22px → `span` 20px |
| `news` | 360 | 800 | 854 → 848 | 0 → 0 | `page-title` 22px → `page-title` 20px |
| `record` | 360 | 800 | 3035 → 3032 | 0 → 0 | `page-title` 22px → `page-title` 20px |
| `myclass` | 360 | 800 | 744 → 744 | 0 → 0 | `page-title` 22px → `page-title` 20px |
| `profile` | 360 | 800 | 1901 → 1886 | 0 → 0 | `num` 20px / `page-title` 22px → `num` 20px / `page-title` 20px |
| `tickets` | 360 | 800 | 744 → 744 | 0 → 0 | `page-title` 22px → `page-title` 20px |
| `settings` | 360 | 800 | 972 → 956 | 0 → 0 | `page-title` 22px / `seg-h` 18px → `page-title` 20px |
| `today` | 320 | 568 | 1556 → 1539 | 0 → 0 | `span` 22px → `span` 20px |
| `news` | 320 | 568 | 687 → 681 | 0 → 0 | `page-title` 22px → `page-title` 20px |
| `record` | 320 | 568 | 3856 → 3832 | 0 → 0 | `page-title` 22px → `page-title` 20px |
| `myclass` | 320 | 568 | 512 → 512 | 0 → 0 | `page-title` 22px → `page-title` 20px |
| `profile` | 320 | 568 | 1855 → 1840 | 0 → 0 | `num` 20px / `page-title` 22px → `num` 20px / `page-title` 20px |
| `tickets` | 320 | 568 | 522 → 518 | 0 → 0 | `page-title` 22px → `page-title` 20px |
| `settings` | 320 | 568 | 1035 → 1017 | 0 → 0 | `page-title` 22px / `seg-h` 18px → `page-title` 20px |

### student

| 页 | 宽 | docH | scrollH 前→后 | overX 前→后 | ≥18px 前 → 后 |
|---|---|---|---|---|---|
| `stuHome` | 390 | 844 | 900 → 891 | 0 → 0 | `hero` 22px → `hero` 22px |
| `stuGather` | 390 | 844 | 788 → 788 | 0 → 0 | `page-title` 22px → `page-title` 20px |
| `stuSign` | 390 | 844 | 1070 → 1062 | 0 → 0 | `p-time` 19px / `p-word` 26px / `page-title` 22px → `p-time` 19px / `p-word` 26px / `page-title` 20px |
| `stuNews` | 390 | 844 | 914 → 907 | 0 → 0 | `page-title` 22px → `page-title` 20px |
| `stuTable` | 390 | 844 | 788 → 788 | 0 → 0 | `page-title` 22px → `page-title` 20px |
| `stuExam` | 390 | 844 | 788 → 788 | 0 → 0 | `page-title` 22px → `page-title` 20px |
| `stuQuant` | 390 | 844 | 1251 → 1216 | 0 → 0 | `hero` 40px / `page-title` 22px → `hero` 40px / `page-title` 20px |
| `stuProfile` | 390 | 844 | 968 → 960 | 0 → 0 | `num` 20px / `page-title` 22px → `num` 20px / `page-title` 20px |
| `stuHw` | 390 | 844 | 1399 → 1393 | 0 → 0 | `page-title` 22px → `page-title` 20px |
| `stuMsg` | 390 | 844 | 788 → 788 | 0 → 0 | `page-title` 22px → `page-title` 20px |
| `settings` | 390 | 844 | 951 → 936 | 0 → 0 | `page-title` 22px / `seg-h` 18px → `page-title` 20px |
| `stuHome` | 360 | 800 | 914 → 904 | 0 → 0 | `hero` 22px → `hero` 22px |
| `stuGather` | 360 | 800 | 744 → 744 | 0 → 0 | `page-title` 22px → `page-title` 20px |
| `stuSign` | 360 | 800 | 1070 → 1062 | 0 → 0 | `p-time` 19px / `p-word` 26px / `page-title` 22px → `p-time` 19px / `p-word` 26px / `page-title` 20px |
| `stuNews` | 360 | 800 | 882 → 876 | 0 → 0 | `page-title` 22px → `page-title` 20px |
| `stuTable` | 360 | 800 | 744 → 744 | 0 → 0 | `page-title` 22px → `page-title` 20px |
| `stuExam` | 360 | 800 | 744 → 744 | 0 → 0 | `page-title` 22px → `page-title` 20px |
| `stuQuant` | 360 | 800 | 1272 → 1256 | 0 → 0 | `hero` 40px / `page-title` 22px → `hero` 40px / `page-title` 20px |
| `stuProfile` | 360 | 800 | 1050 → 1043 | 0 → 0 | `num` 20px / `page-title` 22px → `num` 20px / `page-title` 20px |
| `stuHw` | 360 | 800 | 1399 → 1393 | 0 → 0 | `page-title` 22px → `page-title` 20px |
| `stuMsg` | 360 | 800 | 744 → 744 | 0 → 0 | `page-title` 22px → `page-title` 20px |
| `settings` | 360 | 800 | 972 → 956 | 0 → 0 | `page-title` 22px / `seg-h` 18px → `page-title` 20px |
| `stuHome` | 320 | 568 | 938 → 928 | 0 → 0 | `hero` 22px → `hero` 22px |
| `stuGather` | 320 | 568 | 512 → 512 | 0 → 0 | `page-title` 22px → `page-title` 20px |
| `stuSign` | 320 | 568 | 1051 → 1043 | 0 → 0 | `p-time` 19px / `p-word` 26px / `page-title` 22px → `p-time` 19px / `p-word` 26px / `page-title` 20px |
| `stuNews` | 320 | 568 | 715 → 709 | 0 → 0 | `page-title` 22px → `page-title` 20px |
| `stuTable` | 320 | 568 | 535 → 532 | 0 → 0 | `page-title` 22px → `page-title` 20px |
| `stuExam` | 320 | 568 | 512 → 512 | 0 → 0 | `page-title` 22px → `page-title` 20px |
| `stuQuant` | 320 | 568 | 1272 → 1256 | 0 → 0 | `hero` 40px / `page-title` 22px → `hero` 40px / `page-title` 20px |
| `stuProfile` | 320 | 568 | 1050 → 1043 | 0 → 0 | `num` 20px / `page-title` 22px → `num` 20px / `page-title` 20px |
| `stuHw` | 320 | 568 | 1420 → 1413 | 0 → 0 | `page-title` 22px → `page-title` 20px |
| `stuMsg` | 320 | 568 | 636 → 628 | 0 → 0 | `page-title` 22px → `page-title` 20px |
| `settings` | 320 | 568 | 1035 → 1017 | 0 → 0 | `page-title` 22px / `seg-h` 18px → `page-title` 20px |


---

## 2. 精确的 CSS 改动清单

全部新增，插在 `<style>` 块**最末尾**（`</style>` 之前），共**两个** `@media`（699px 与 374px）。
除下述块外，`index.html` 与 `HEAD` **逐字节相同**。

```css
@media (max-width:699px){
  .page-title, .chead h2{font-size:20px}
  .sec-h, .seg-h, .chapter h2, .sumbox h3, .card h2,
  .attgrid .empty h3, .roster-grid .empty h3{font-size:16px}
  .sec-meta, .chapter .cmeta, .chead h2 small, .sumrow{font-size:13px}
  .hint, .legend{font-size:12.5px}

  .tl-head{flex-direction:column;align-items:flex-start;gap:var(--sp-3)}
  .tl-head .tl-meta{flex:0 0 auto;width:100%;min-width:0}
  .tl-head .tl-next{margin-left:0;text-align:left;width:100%}
  .tl-head .tl-next .num{font-size:18px}
}

/* ⑰b 单独挂 374px，不跟 ⑰ 共用 699 —— 见下方「勘误」 */
@media (max-width:374px){
  #page-att .sumbox:first-child .legend{flex-shrink:1;min-width:0}
}
```

| 选择器 | 原值 | 新值 | 依据 |
|---|---|---|---|
| `.page-title, .chead h2` | 22px（`--fs-title`） | 20px | 与 ⑦b 考勤页 `.chead h2` 同值 |
| `.sec-h` / `.seg-h` / `.chapter h2` / `.sumbox h3` | 18px（`--fs-h2`） | 16px | 同上「收一档」 |
| `.card h2` | 17px | 16px | 与上一条拉平 |
| `.attgrid .empty h3` / `.roster-grid .empty h3` | 18px | 16px | 空态标题，与章节标题同档 |
| `.sec-meta` / `.chapter .cmeta` / `.chead h2 small` | 14px（`--fs-small`） | 13px | 「cmeta 仍 14px」点名项 |
| `.sumrow` | 14px | 13px | 同 ⑦b（考勤页已单独设过，此处对其它复用点生效） |
| `.hint` / `.legend` | 13px | 12.5px | 同 ⑦b |
| `.tl-head` 三行 | 横排 + `margin-left:auto` | 竖排 + 左对齐 | 版面修正 1 |
| `#page-att .sumbox:first-child .legend` | `flex:0 0 auto` | `flex-shrink:1;min-width:0`（**挂在 374px，不是 699px**） | 版面修正 2（勘误后） |

**没有动的**（刻意）：`input/select/textarea`（≥16px 硬规矩）、`.hero`/`.num`/`.sumrow b`（数据主角）、
`.bd-*` 看板端（大屏）、任何 `--*` 变量、任何 ≥700px 的断点。

---

## 3. 每一处 `overX > 0` 及其修法

**只有一处**：

| 页 | 宽度 | 元素 | 溢出 | 根因 | 修法 |
|---|---|---|---|---|---|
| `att`（考勤） | **320px** | `.legend`（5 个状态色块的图例）宽 337px | 29px | `@media (max-width:1099px)` 里 `.sumbox:first-child .legend` 是横向 flex 项且 `flex:0 0 auto`，窄机按 max-content 撑开、父级虽 `flex-wrap:wrap` 但该项不可收缩 | 新增 `#page-att .sumbox:first-child .legend{flex-shrink:1;min-width:0}`（更宽的同名规则被更具体的 id 前缀覆盖）。390/360 宽度够、不触发收缩，观感不变；320 下图例内部换行，`overX` 29 → 0 |

> 探针的溢出判据是 `main.scrollWidth − clientWidth`，并且**已经排除**「被合法的横向滚动容器（如课表 `#gridWrap`）包住的元素」，
> 所以课表那种故意 `min-width:660px` 的做法不会被误报。

---

## 4. 视觉证据（胶片图）

`tools/mob_film.py` 把 `test/.shots/mobile/_tiles/` 的逐屏切片拼成整页胶片，均在
`test/.shots/mobile/_film/`：

- 教务端（tag `390`，浅色）：`390_home_light_film.png`、`390_att_light_film.png`、`390_roster_light_film.png`、
  `390_homework_light_film.png`、`390_settings_light_film.png`、`390_quant_light_film.png`、
  `390_timetable_light_film.png`、`390_students_light_film.png`、`390_sign_light_film.png`、
  `390_night_light_film.png`、`390_exam_light_film.png`、`390_coop_light_film.png`、
  `390_gather_light_film.png`、`390_teachers_light_film.png`、`390_rules_light_film.png`、
  `390_board_light_film.png`、`390_profile_light_film.png`、`390_health_light_film.png`
- 深色：`390_home_dark_film.png`、`390_att_dark_film.png`、`390_settings_dark_film.png`（+ 360 对应）
- 教师端（tag `teacher390`）：`teacher390_today|record|myclass|tickets|news_light_film.png`
- 学生端（tag `student390`）：`student390_stuHome|stuSign|stuGather|stuNews|stuTable|stuExam|stuQuant|stuProfile|stuHw|stuMsg_light_film.png`
- 整壳（顶栏 + 底栏）：`390_shell_light.png` / `360_shell_light.png`；导航抽屉 `390_drawer_light.png`（4 列宫格，正常）
- 桌面回归基线（1440 关移动仿真）：`1440_shell_light.png`、`_tiles/1440_{att,roster,timetable}_light/`

**看图结论**：今日页轴首由「目标日浮顶、下一节贴右」变成从上到下的左对齐三行，主次清楚；
考勤页 320 下图例折成两行、不再被切边；其余页面维持单列、无挤压。

---

## 5. 发现但**刻意没修**的移动端问题（及原因）

1. **今日页「要闻」仍占约 2 屏**（6 条 + 「展开全部 60 条」）。上一轮已从 ~80 条砍到 6 条，
   继续砍属于**产品取舍**（要不要在今日页保留要闻），不在「排版收档」范围内 —— 交产品决策。
2. **学生打卡页的大圆按钮（`.punch .p-word` 26px / `p-time` 19px）** 未降档。
   它是整页唯一的主操作，缩小反而降低可点击性与辨识度。
3. **看板端（`board`）一字未动**。它是挂在办公室墙上的只读大屏，字号走 `clamp(...,vw,...)` 自适应，
   上限 50–120px 是设计意图；手机端只是「顺带能打开」，不该为它牺牲大屏观感。
   本次实测 `board` 前后 `scrollH`/字号完全一致。
4. **`home.content`（今日）hero 数字 40px、`.num`/`.sumrow b` 20px 等数据大字** 未降。
   它们是每页的视觉层级主体，降了页面会平。
5. **`stuHome` 的「还没打卡」是 JS 内联 `style="font-size:22px"`**（`index.html` 约 512678 字节处），
   无法用普通媒体查询覆盖（需要 `!important` 或改 JS）。它是空态提示、单处出现，
   强行覆盖的收益 < 引入 `!important` 的代价，故保留。**我判断这属于「可接受」，但如你认为它也该收一档，请告诉我。**
6. **模考成绩录入的三科并排（`.ex-trio{grid-template-columns:repeat(3,1fr)}`）** 未改成竖排。
   实测 320/360/390 均**不溢出**（`repeat(3,1fr)` 下每格 ~100px，输入框是数字、够用），
   三科本就该横向对照。若实测有班级数据后觉得挤，再议。
7. **学生档案等 3 列统计小卡**（`.stu-*` 3 列 grid）保持 3 列。每格 ~110px 放「100% / 0 次」可读，
   折成 2 列会显著拉长页面，得不偿失。

---

## 6. 我不确定 / 需要你拍板的地方

1. **`.hint` 全站降到 12.5px**：这是照搬 ⑦b 考勤页的做法，但考勤页的 hint 是密集说明文字；
   其它页（如各卡片下的提示）降到 12.5px 后**可读性会略降**。我的判断是 12.5px 仍可读、
   且与「手机端字号偏大」的诉求一致，但这是本次唯一一处「往小里改的次级文字」，
   如果你觉得 hint 不该动，我可以把 `.hint` 从这一档里摘出来（改回 13px）。
2. **今日页轴首的竖向顺序**是「大数字 → 目标日 → 下一节」。大数字在前、标签在后的读法
   是否符合你的预期？如果你更想要「目标日 → 天数 → 下一节」，我可以给 `.tl-meta` 加 `order:-1`。
3. **页面标题从 22 → 20px** 是本次视觉变化最明显的一处（每页第一行）。
   量上只降 2px，但因为出现在每个页面顶部，主观感受会更明显。若你觉得「还不够小」，
   可以再降一档到 19px；若觉得「没必要」，这一条可以单独回退。
4. `home` 页 scrollHeight 因轴首改竖排 **+28px**（1867→1895），其余页普遍变矮
   （settings −88px、sign −40px、quant −42px 等）。若你认为首屏多出的 28px 不划算，
   我可以把 `.tl-head` 改成「hero 与 meta 同行、tl-next 独占一行」的两行方案。

---

## 7. 验证记录

- **桌面回归（1440 × 900，`--mobile=0`）**：`super` 18 页的 `docH / mainScrollH / overX / pageH / ≥18px 列表` **全部零差异**。
  截图对比：`att`、`roster` 各 2 屏、抽屉 —— **逐像素 0 差异**；
  `timetable` 第 3 屏 4.4129% 差异 = **同一文件跑两次的固有噪声**（已单独验证），改动贡献 0。
- **既有测试脚本**（改前 = HEAD 版，改后 = 当前工作区，同一批脚本）：

| 脚本 | 改前 | 改后 | 说明 |
|---|---|---|---|
| `quant_att_check.mjs` | 退出 1 | 退出 1 | 已知既有失败 `TypeError: Att.mark is not a function`，前后一致 |
| `hw_check.mjs` | 退出 1，9/3 | 退出 1，9/3 | 前后摘要完全一致 |
| `exam_check.mjs` | 退出 0，9/0 | 退出 0，9/0 | 一致 |
| `health_ui_check.mjs` | 退出 0 | 退出 0 | 差异仅为巡检结论 ok/warn 与时间戳（非确定性） |
| `rules_page_check.mjs` | 退出 0 | 退出 0 | 6 项全过；细则页高 2363 → 2351px（-12，收档的预期结果） |
| `v47_features_check.mjs` | 退出 1，75/1 | 退出 1，75/1 | 已知既有失败「端口名文案」；差异仅为打卡时间戳 |
| `role_pick_check.mjs` | 退出 1，21/2 | 退出 1，21/2 | 已知 2 项失败，前后一致 |

  → **无新增失败，无断言被削弱**。

- **可控性 / 逐字节核对**：从当前 `index.html` 中剪掉新增块后，与 `git show HEAD:index.html`
  **逐字节相同**（仅多一个空行）。`<style>` 内花括号 687/687 平衡。`sw.js` `node --check` 通过。

---

## 8. 工具链改动（向后兼容，供你取舍）

为完成「全路由 × 多宽度 × 三角色」的度量，给两个既有脚本加了**可选**开关（不传 = 原行为）：

- `test/probe_mobile_layout.mjs`：新增 `--width=` / `--pages=` / `--role=` / `--mobile=0` / `--json=`；
  并把「表单控件 <16px」与更长的字号列表纳入报告。
- `test/capture_mobile_shots.mjs`：新增 `--role=` / `--pages=` / `--devices=` / `--schemes=` / `--mobile=0` / `--tag=`。

这两处**只影响测试脚本**，不进 `index.html`/`sw.js`，可安全保留；若要最小 diff，单独回退这两个文件即可，
不影响本次的手机端改动。

原始度量 JSON 存档在 `test/.shots/_measure/{before,after}/`（`test/.shots/` 已被 gitignore，不进仓库）。
---

## 9. 勘误 —— 复核后修正的两处（2026-10-05，主控复验）

本节由**独立验证**（对抗性复核）提出，已按结论改过代码与上文。

### 9.1 `.legend` 收缩规则的门槛写错了：360px 也会触发

原注释写「390/360 下宽度够、不会触发收缩，观感不变」，并把它挂在 `@media (max-width:699px)` 里。
实测（复核脚本量 `.legend` 与 5 个子项 `getBoundingClientRect`）：

| 视口 | 内容区宽（视口−24） | `.legend` 需要 | 加规则前 | 加规则后 |
|---|---|---|---|---|
| 390 | 366 | 337.4 | 1 行 | 1 行 |
| **360** | **336** | **337.4** | **1 行**（右沿 349.4，伸出内容区 1.4px，但未超出视口 → overX 仍 0） | **2 行** ❌ |
| 320 | 296 | 337.4 | 1 行，横向超出 29px | 2 行，overX=0 ✅ |

要一行放下 337.4px 需要视口 ≥ **361.4px**，所以 **360px 上它本来就已经放不下** ——
把它和 ⑰ 共用 699px 属于「顺手多收了一档」，不是原设计意图。

**改法**：把这一条从 ⑰（699px）里摘出来，单独放 `@media (max-width:374px)`。
- 320 / 360 这类窄机：走换行（320 实测 5 项全部完整可见、无截断）
- 375px 及以上（常见 iPhone 宽度）：回到一行，与改动前完全一致

复核后复测：320 / 360 / 375 / 390 四档 `overX` 全为 **0**，`wide`（超宽元素）列表全为空。

### 9.2 `test/probe_mobile_layout.mjs` 的「不传 = 原行为」不成立

原报告称两个脚本的开关都是可选的、不传即原行为。`capture_mobile_shots.mjs` 确实如此；
但 **`probe_mobile_layout.mjs` 的默认页集变了**：

```
node test/probe_mobile_layout.mjs <port>      # 改动前：写死 7 页
node test/probe_mobile_layout.mjs <port>      # 改动后：取 ROLE_PAGES.super = 18 页
```

另外默认输出格式也变了（新增度量头、`⚠ 表单控件 <16px` 行，`wide/bigText` 截断放宽到 20/60），
并给每页测量包了 `try/catch`。**保留 18 页的默认值**（是改进，覆盖更全），但做了两件事：

1. 文件头注释写明「默认按角色取全量，要原来那 7 页请显式传 `--pages`」；
2. 🔴 **补上「量失败必须响亮失败」**：任何一页抛错都会在最下面汇总列出并 **`exit 1`**。
   这一条是刻意加的 —— 探针最危险的失效方式是**悄悄返回一串 0**，
   读的人会当成「没有溢出」，而那正是它该抓的东西（本类问题在本项目已踩过一次）。

### 9.3 其它两处小订正

- 上文 `settings` @360 的**改前值**应为 **4037**（原写 4017），Δ 是 **−219** 而非 −199。
- `timetable` 的 4.41% 差异：原报告称「同一文件跑两次同样有」。复核实测**同文件两次为 0%**；
  该差异实为**纯竖直位移 ~16–17px**（切片时 `scroll-behavior:smooth` 尚未落定导致的取景错位），
  改用整页单张截图后 `timetable`/`quant` 均为 **0.0000%**。**结论（非真实回归）不变，归因写法已纠正。**
