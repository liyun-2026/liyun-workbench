# DESIGN.md · 砺蕴教务系统 产品汇报（12 页）

## 需求对齐（Step 1）
- 主题：砺蕴教务系统产品汇报（快速看懂怎么用 + 亮点宣传）
- 受众：机构主理人/老板；目标：看懂产品价值与质量背书，认可验收
- 页数：12（用户指定逐页大纲）；场合：对外汇报；调性：稳重暖金、品牌一致
- 硬约束：不用深色大面积底；品牌令牌统一；不动生产代码

## 全局视觉约定
### 画布与安全区
- 1280×720；padding 上下 60 / 左右 60（硬下限）；内容页底部 padding 30（让出页尾带 y670–700）
- 内容区 1160×(630−页脚)；页脚：左「砺蕴教务系统 · 让教务回到教育」右页码，14px，全篇位置固定；封面/结尾页无页脚

### 配色（品牌令牌，一套不换）
| 槽位 | Hex | 用途 |
|---|---|---|
| 主色 | #c9ab7c | 编号圆、金线、强调条 |
| 深金（强调） | #a8895a | 巨型数字、锚点 |
| 辅色 | #f3ecdd（浅金底）/ #dccdb0（细线） | 结论条底、分隔线 |
| 底色 | #f6f5f2 | 页面背景 |
| 卡片 | #ffffff | 白卡（描边 #dccdb0） |
| 正文 | #2a2a2a / muted #8d877b / faint #b3ab9c | 文字三级 |
- 面积纪律：金 ≤10%、浅金辅 ≤25%、白/暖纸主导；无深色大面积底；禁阴影

### 字体
- 标题：'Songti SC'（衬线）；正文：'PingFang SC'
- 字号阶梯：封面主标 72 / 巨型数字 96–120 / 页面主标 34 / 卡片小标 22 / 正文 18 / 注释 14
- 全篇只此两族；数字随正文，锚点数字才放大换衬线

### 视觉母题
- 内容页页首：品牌小字（12px 金、字距 6）+ 页面主标题（34 衬线）+ 标题下 1px 金色贯通细线
- 亮点页统一「金色实心圆白字编号」（44×44，#c9ab7c）
- 结论条：浅金底 #f3ecdd + 1px #e2d5b8 描边 + 左侧 4px 金条，整页唯一 takeaway

### 配图清单（全部 P0 材料图，已逐张 Read 核对）
| 文件 | 内容 | 等级 | 使用页 |
|---|---|---|---|
| assets/seal.png | 金磬印章（深圆金线，512²） | L3/L1 封面 | P1、P12 |
| assets/sign_manage.png | 打卡管理页（动态码+二维码+位置围栏）2880×1800 | L1 | P3 |
| assets/sign_code.png | 动态码特写（781736·5 秒后换码）4912×2668 | L2 | P3 |
| assets/attendance.png | 考勤册页（点章+本节小结）2880×1800 | L1 | P4 |
| assets/news.png | 每日新闻（央视新闻 80 条）2880×1800 | L1 | P5 |
| assets/quant.png | 量化页（总分 99+快捷加减分）2880×1800 | L1 | P6 |
| assets/homework.png | 作业页（71% 交齐+布置表单）2880×1800 | L1 | P7 |
| assets/health.png | 系统巡检页 2880×1800 | L1 | P8 |
| assets/backup.png | 数据备份卡（导出/恢复）3984×1188 | L2 | P8 |
| assets/card_student/office/teacher.png | 三张上手卡 1190×1684 | L1×3 | P9 |

## 逐页字段
| 页 | title | type/role/rhythm | layout | visual / visual_role | density | anti_pattern |
|---|---|---|---|---|---|---|
| 1 | 砺蕴教务系统·产品汇报 | cover/hero/peak | 纯文字极简+金印居中 | seal.png L1 anchor | 字数约 40 / 图 1 / 留白 45% | 封面禁数据指标；禁页脚 |
| 2 | 一个系统，三端协同 | content/supporting/valley | 非等宽三卡+结论条 | 无图，文字卡 evidence | 220 字 / 0 图 / 15% | 禁等宽三栏 |
| 3 | 智能化打卡 | content/supporting/valley | 左图右文+结论条 | sign_manage L1 + sign_code L2 evidence | 180 字 / 2 图 / 18% | 禁 50:50 对分 |
| 4 | 考勤数字化 | content/supporting/valley | 右图左文+结论条 | attendance L1 evidence | 170 字 / 1 图 / 20% | 禁镜像页版式全同 |
| 5 | 每日新闻 | content/supporting/valley | 左图右文（45% 图）+来源标签条 | news L1 evidence | 160 字 / 1 图 / 22% | 禁图上压字 |
| 6 | 量化管理 | content/supporting/valley | 巨型数字 99 + 右图 | quant L1 + 大数字 anchor | 150 字 / 1 图 / 20% | 禁数字塞图表卡角落 |
| 7 | 作业闭环 | content/supporting/valley | 左图右文+结论条 | homework L1 evidence | 160 字 / 1 图 / 18% | 禁等宽分栏 |
| 8 | 数据安全 | content/supporting/valley | 左浅金标题栏+右双图叠放 | health L1 + backup L2 evidence | 190 字 / 2 图 / 15% | 禁深色大块；禁图叠字 |
| 9 | 快速上手 | content/supporting/valley | 三竖版卡并排+结论条 | 三上手卡 L1×3 anchor | 90 字 / 3 图 / 18% | 卡下必挂角色标签 |
| 10 | 关键数字 | content/hero/peak | 锚点数字 251 + 双排数据 | 大数字 anchor | 120 字 / 0 图 / 25% | 禁等宽均分；数字带判断 |
| 11 | 已知限制与二期规划 | content/supporting/valley | 同层清单两行（1px 行线）+结论条 | 无图 | 200 字 / 0 图 / 30% | 禁短板措辞；行高一致 |
| 12 | 让教务回到教育 | ending/hero/peak | 收束金句+落款 | seal.png L1 anchor | 字数约 60 / 图 1 / 45% | 禁致谢占页；禁页脚 |
