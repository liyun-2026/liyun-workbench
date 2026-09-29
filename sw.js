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

/* v40：**电脑端侧栏门头（左上那枚白牌）从「整块左对齐」改成「居中版」** —— 用户看截图时指出：融合标只有 118px 靠在约 190px 宽的牌面里，右边空出一大片，视觉重心整个偏到左上角；牌下那行问候语又贴着左边，三块各说各话。现在牌内**融合标 / 系统名 / 端口名一律居中、收在一条中轴**上，牌下的问候语也走同一条轴；牌面加一道 **1px 暖金描边**（中式册页的做法，比投影轻），标与字之间压一条「**短金线嵌金点**」的分隔（登录门那根长金线的缩小版）—— 上半是「标」、下半是「字」，一块小匾就立住了。⚠️ 别再改回 `.b-sys/.b-port{text-align:left}`，那是给「左对齐成一块」用的。② 顺手修掉一处**哑火**：`@media (min-width:1100px){.side .brand .brand-lock{max-width:148px}}` 原先写在 `.side .brand .brand-lock{max-width:118px}` **之前**，两个选择器特异性完全相同 → 148 从来没生效过，宽屏牌面上的融合标一直只有 118（这就是牌面看着空的另一半原因）。已把它挪到基础规则之后：宽屏 148 / 其余 118。③ 新增 test/side_brand_check.mjs（**14 项**）：量的是**文字**的水平中心而不是元素盒（`.b-sys` 上有 `::before` 伪元素那条金线，元素盒比文字宽，拿 getBoundingClientRect 会误判），五端 × 200/236 两档侧栏宽 × 深浅两套主题全部要求偏 ≤1.5px，实测 **0.00px**。 */
/* v39：看板端从 v38 的「深墨底 · 双通道」重做成**宣纸米白 · 三栏**，打卡码改成「二维码里只编那串数字」，学生走砺蕴自带的「扫一扫」—— 用户看过多版设计后定的稿：取 D 的气质、B 的编辑式排版（不用卡片），二维码放大摆中间、左栏课表、二维码下面直接「应到 / 实到」、量化榜最多 5 格、底要米白不要正白。① 版面：**宣纸米白底**（#FAF7F0，不是正白 —— 这块屏 24 小时亮着，正白刺眼；**不跟系统深浅色**），顶带（品牌 / 日期 / 大时钟 / 数据新鲜度）+ 三栏**左课表 / 中打卡码 / 右量化与未到**，栏与栏之间只走一条 1px 细线、**不用卡片**（一圈圆角白卡会把整块屏切碎，中式布告的做法是留白 + 栏线）；中间那栏给得最宽，二维码 min(44vh,30vw,540px) 且**摆正中**，下面「应到 / 实到」两个大数、迟到·请假·未到 收成一行小字；顶栏品牌换成 assets/brand-lock-alpha.png（原来的 brand-lock.png 砺蕴章带米黄底 #FFFDE4，贴在米白纸上会露一块淡黄方块），两份都进 SHELL；量化榜只留分最高的 5 个班、红涨绿跌；窄到 900px 以下三栏叠成一栏能滚着看。② **二维码里只编那串数字本身，不编网址**（v38 编的是 ?code= 链接）—— 编网址是绕远路：手机相机 / 微信扫出来是一段链接，还得从微信导进浏览器，多好几步，也丢了「把码摆在门上一扫就走」的意义；学生用的是砺蕴自带的「扫一扫」，所以码就是数字。配套删掉 Board.base/scanLink、App.scanCatch/scanCode/handOffScan（grep 确认零残留）与 Board.fillH（横向跑马灯不再需要）。③ 新写一份**零外部依赖的二维码解码器 QRDec**（内联在 QR-DECODER-START/END 标记区，与 v38 的编码器共用同一份「哪些格是功能格 / 掩码怎么算 / 版本表长什么样」）—— iPhone 的 Safari 根本没有 BarcodeDetector，指不上，自己带一份两台手机行为才一致：灰度 → Bradley 自适应二值化（积分图）→ 去孤立噪点 → 1:1:3:1:1 定位图案识别（横扫 + 纵核）→ 聚类 → 挑等腰直角三角形定向（叉积定左右手）→ 三点仿射变换逐格采样（一格 ≥5px 时取中心 3×3 投票）→ 读格式信息（BCH 反解 + 汉明距离兜底）→ 反走填数据路径去掩码 → 解交错 → RS 纠错。RS 四处坑记在这：Berlekamp-Massey 里两项相加必须**右对齐**（最高次在前、短的往左补零）、定位多项式的**前导零要清掉**（否则次数被高估）、Chien search 代入的是 **α^(−i)** 而不是 α^i（这才是当初「错一个码字都纠不回」的病根）、最后还要**再验一遍伴随式**，残余不为 0 就返回空 —— 宁可让学生重扫一次，也不报一个错的码。④ 学生端「扫一扫」：StuSign.scan() 开后置摄像头（每 1/4 秒抓一帧缩到 480 宽来解，不逐帧跑，免得把手机烤热也费电；扫码这件事四分之一秒一轮已经够跟手）、onScan() 只留数字、**定位已就绪就直接提交**（扫完还要再按一下圈，那这趟就白扫了）、扫来的码填进输入框但**不聚焦**（一聚焦就弹键盘，盖住上面那个大圈）、打完卡把 _scanned 清掉别留着下一轮又替他填上；取景窗在扫完 / 重绘（renderStep 会把取景框整个冲掉）/ 切页（App.go 里 id !== stuSign 就叫一声）三处都收干净 —— 摄像头指示灯不许一直亮。⑤ 两处写着容易踩的细节：右栏是「量化榜 + 未到名单」两块，名单**不能再居中**（v37 的 .fit 居中在只有名单时是对的，现在会把两块之间裂开一大段空 —— 纸色底上留白不难看、裂缝难看），改成靠上排、留白沉底；定位图案的分隔带**必须浅色**（按切比雪夫距离画，dist!==2&&dist!==4），以及 SVG 必须自带 4 格静默区。测试 board_check 31→40 项（新增「造 7 个班只显示 5 格」的量化榜上限、宣纸米白 / 品牌标真渲染、左栏课表、五屏宽三栏不叠、截屏 → OpenCV 真解码、内置扫一扫全链路 7 项），另新增 test/qr_dec_check.mjs（27 项：RS 纠错专项 + 自编自解 + 缩放 + 只占画面一角 + 光线画质 + 倾斜 + 读不出返空）。 */
const VERSION = 'v45'; /* v45：修「发版后第一次打开还是旧版」。用户 2026-09-29 问「桌面上的砺蕴系统，我怎么见没有更新呢？」—— 查下来线上和本机缓存都已是最新版（本机 SW CacheStorage 里 index.html 与三档 brand-plate 都已是 v44 内容），问题是**换版永远赶不上**：这壳子在境外节点，新 SW 装完要下 index.html(644KB) 外加十几个资源（含三档 brand-plate 共 670KB），跨境实测 5~10 秒；而页面端的老规矩是「只在开屏层还盖着时才静默换版」，开屏只有 1.2 秒 + 0.55 秒淡出 —— controllerchange 回来时开屏早收了，于是发版后第一次打开必然是旧版，得关掉再开一次才变新的；看板那块 24 小时常亮的屏更是永远换不了（它从不重开）。这次只动页面端的守门（本文件除版本号外没改）：现在三种情况都允许静默换版，共同前提是「用户还没开始用」—— ① 开屏期照旧；② 打开 30 秒内用户一次都没碰过；③ 看板屏(board-mode)空闲 2 分钟（只读屏没人操作）。用户一旦动过手（点/按/滚/输入）就一律不换，留到下次打开自然生效，不会把正在填的表单或正在看的页面刷掉。另外常亮的屏每 20 分钟主动调一次 registration.update() 去问有没有新版（浏览器默认只在导航时才去查 sw.js），看板从此不用人管。 */  /* v44：看板品牌标**两枚改成一样大**（用户：「这两个 logo 要一样大，不能你大我小，它俩是一样的，那就把博艺这个 logo 也放大，放成一样大」）。病根不在尺寸参数、在**量错了边**：test/make_brand_plate.py 原先拿「融合标左半画布的 bbox」当基准 —— 左半在博艺圆章右侧还留着一撮 alpha 60~120 的**淡色残影**（x 543..639，97px 宽），最长边被虚撑到 623px，而圆章实体只有 526px，于是圆章被缩成 76%、屏上 300px；砺蕴那枚（米黄圆底）是 414px，差 38%，用户一眼看出「你大我小」。现在新增 emblem()：用 alpha > 200 卡出圆章**实体**（526×526 正圆，代码里带断言，素材一变形就当场炸），再缩到与圆底**同一直径** —— 两枚都以 h=414（@3x 档）为直径，结构上就等大，不靠调参凑。拼装也改成「两块都取裁紧后的实体」再拼，所以中间的净空隙就是设计值（S×0.20 = 83px@3x ≈ 28px@1x，跟改版前的观感一致）。board_check 新增守卫「两枚一样大」：按列找中间那道空把标切成两块、比外接框宽高（容差 3%），实测左右各 414×414。原图 266×138 → 304×138；`.bd-lock` 的高度没动（高度本来就是两枚共同的直径），所以只宽了约 14%。 */  /* v43：看板品牌标从「整条套深墨底板」改成**只给砺蕴那半套暖米黄圆底**。v42 的深墨底板被用户否掉：「整体都是白色的，突然有一个黑色的很丑」「博艺的 logo 是白色跟蓝色的，你整体弄个黑色的很突兀」；同时明确「只给砺蕴的 logo 加个底色」（手机端、电脑端用的是米黄底版 brand-lock.png，用户说那两处很清晰、不动）。现在 test/make_brand_plate.py 的产出改成：左＝博艺圆章**原样裸摆、不加任何底色**（它本身就是蓝+白，浅纸上读得清）；右＝砺蕴印章换官方**暗金**版（logo_logo1_暗金.png，原来那版是「给深色底做的品牌金细线」，贴纸底整块化掉）并压在一块**暖米黄 #F3E7CD 圆底**上，底内一道品牌金细描边 + 极轻暖影。暗金 #9A7B45 压在米黄上对比度约 3.3:1，浅底上读得出；底色走暖米黄是跟看板宣纸 #FAF7F0 同族，不发暗、不抢眼。造型用**圆底**不用圆角方底 —— 砺蕴那枚本就是圆印，圆底跟左边博艺圆章并排成「一对印」，不是两块形状各异的贴纸。中间不再画分隔线（圆底自己把两块分开了）。文件名不变（assets/brand-plate.png/@2x/@3x），HTML 只改注释。board_check 的两条守卫跟着改：① 品牌标「左半没有板、右半有板」——拿**透明画布**读角像素 alpha（左上 <20、右上 >200），这条正是用户「只给砺蕴加底色」的要求；② 右半「板是暖米黄不是深墨」——不透明像素中位色 R>G>B 且较亮，同时章线明显暗于板底（亮暗跨距够）。桌面归档改存 砺蕴横版组合标_砺蕴章米黄圆底.png（深墨那版作废，不再使用）。 */  /* v41：打卡码收敛成**只有一种**（6 位、60 秒一换的动态码），并修掉四件用户点名的事。① 固定码整条路线拆除 —— 后端不再读 sign_rules.code（前端 Sign.rules() 里显式 delete out.code，老设备别把自设的 8866 一直认下去），Sign.saveCode/randCode/localCode 一并删掉。理由：固定码一节课不变，只要一个学生把码发到群里，别人在宿舍也能打。② 位数钉死 6 位（后端 CODE_LEN=6，前端 maxlength=6，二维码与数字同源同一枚），原先 4/6/8 位混用是「教务自设固定码」与「派生码」两条路并存留下的。③ 两处都加换码倒计时：看板 .bd-timer（进度条 + 大秒数，末 10 秒转朱砂 .soon）、打卡管理页 #signCodeQr/#signCodeBox/#signCodeBar/#signCodeLeft（Sign.tick 每秒走一格），秒数按服务端 left 算、客户端改表没用。④ 学生端「扫码」与「手输」改**二选一**（原来扫完还要再输一遍）：onScan 只写 _scanned 不落 DOM，而 confirm() 只读输入框 → 读到空 → 弹「输一下讲台上那个码」，怎么输都说不清。现在 confirm() 优先认 _scanned，路口一次只摆一条路（默认只有「扫面前的二维码」，点「手输动态码」才出输入框），码位数不对就直说「对错了码」、不猜不截断。⑤ 演示数据在**数据层**一次滤掉（isDemoEntity + demoFilter + Store.list 默认过滤 + listRaw 留给备份/彻底清理/建演示号）—— 演示班与它底下的演示学员不得进名册、人数、出勤、量化任何统计；Util.clsName/stuName 走 listRaw（按 id 查名字是具名取用，不是统计）。⑥ 看板「迟到/请假/未到」三格由 12~19px 放大到 38.4px（clamp 上限 50px）并各归其色（琥珀/蓝/朱砂）；整块版面同步精修：纸面色气 + 金线分栏 + 打卡码 475px + 进度条 + 榜首金底 + 课表「下一节」金边 + 量化榜加 01~05 名次。⑦ 文案「扫描黑板上的二维码或者讲台上二维码」→「对着面前屏幕上的二维码扫一下」（黑板/讲台是旧场景，看板才是现在的码位）。⑧ 踩坑第四次：系统通用类 .warn{background:#fff6e9;border:...;padding:10px;font-size:13px} 会吃掉看板的 .bd-m.warn（多出一圈淡黄底），改名 .bd-m.bd-warn，board_check 里加了守卫断言「.bd-m 一律无底色/无内边距/类名带 bd- 前缀」。回归 board_check 31→46、student_check 46→51，新增 test/sign_code_check.mjs（打卡管理页专项 9 项）。 */  /* v38：看板打卡码改成「上二维码 / 下数字」双通道 —— 学生想扫就扫、想输就输。① 自带一份 QR 编码器内联进 index.html（放在 /* QR-ENCODER-START *\/ 标记区里，便于测试直接抠上线代码来验），零外部依赖，字节模式 + 纠错等级 M + 版本 1~6，GF(256) 上跑 RS 纠错、标准分块交错、8 种掩码按四条罚则评分选优；② 二维码编的是本站 ?code=XXXXXX 链接，扫完直达打卡页且码已替他填好；③ 只在「码真的变了」时才重画（paintCode 每秒被 tick 叫一次，而重编码要跑 8 张掩码的评分，常开的屏不能每秒白烧 CPU）；④ 学生端：scanCatch() 在登录门还开着时就收下码（并 replaceState 抹掉地址栏里的码，不留在历史、不易被转发），登录后 handOffScan() 直接落到打卡页，输入框填好码且**不聚焦**（一聚焦就弹键盘盖住上面那个大圈）；⑤ 顺手修掉 v37 的一处哑火：右栏名单「装得下就居中」其实从没生效过（.bd-rows 压根没有高度，align-content:center 是空转），现改为把 .fit 挂到 .bd-miss 面板上整组居中。两处写错就扫不出的坑记在这：定位图案的分隔带**必须浅色**（按切比雪夫距离画，dist!==2&&dist!==4），以及 SVG 必须自带 4 格静默区。测试 board_check 21→31 项（二维码 6 项含「截屏→OpenCV 真解码」、学生扫码全链路 5 项），另新增 test/qr_check.py（逐格比对参考实现 + 真解码 + 缩放鲁棒）与 test/qr_decode.py。 */  /* v37：看板端版面重做 —— 从「上时钟下卡片」的仪表盘换成「航显分带」（像机场的航班显示屏）：顶带（品牌 / 大时钟 / 日期 /「已到 30 37」/ 数据新鲜度），中带（左＝今日打卡码，整屏最大的一块，学生站门口就该看清；右＝6 格数字矩阵 应到/已到/迟到/请假/未到/距上课 ＋ 未到名单），底带（今日课表横向跑马灯）。旧版最大的毛病是下半屏常年空着半块。配套三处：① 码字号按「码栏 ≈ 视口 58%」重推（13.5vw，上限 265px），clock 挪进顶带后重叠判据从「左不压右」改成「上不压下」；② 右栏名单装得下时挂 .fit 居中摆着、塞不下才复制一份上滚（居中与滚动不能同时上，会两头露不出来）；③ 新增「一键新建看板专用教务号」（Board.createAccount，只有首位教务看得见那个按钮）—— 每个账号只有 2 台设备额度，拿自己的号登看板电脑会把自己手机或常用的那台挤下线。test/board_check.mjs 的 21 项判据同步更新。 */  /* v36：新增「看板端」—— 办公室那台电脑挂着的只读副屏（当前时间 / 今日打卡码 / 来了多少人 / 谁还没到 / 今天上什么课）。有 route 但不进 NAV_ORDER，入口只有设置页那张卡，或网址带 ?board=1（Windows 桌面快捷方式写死这条，开机就落在看板上）；App.go 里 board 不写 _lastPage，不带参数重开仍回工作台。取数全走现成的 Store 与 Auth.call('code')，不新增接口、不新增文件（SHELL 不变）。落地上踩到两处：① 宽屏那条 .page.on{display:grid;grid-template-columns:repeat(2,1fr)} 会把看板切掉一半（1600 宽的窗里只剩 800），须在 board-mode 下掰回单列并放开 ≥1700px 的 max-width:1400px；② 系统里已有通用 .ok{background:#eafaf0}，「已到」那块被吃掉一片浅绿底，故统计色类名一律改 bd- 前缀。新增 test/board_check.mjs（真机 21 项）。 */  /* v35：修「一进站开场动画跳两三次」。根因是换版重载：新 SW activate+claim 会派发 controllerchange，页面收到就 location.reload()；而旧版的守门变量 window._swReloading 挺不过 reload，SW 又有 controllerchange 与 shell-updated 两条通知路径，部署窗口里缓存指纹还可能对不上 —— 实测首次访问 2 次文档加载，第二次落在 t+6.7s/t+18s，人已经在用了才重放，所以「像故障」。现在：① 只有开屏层还盖着时才借换版重载，且每个会话最多一次（sessionStorage），过了开屏期就不刷、留到下次打开自然生效（缓存已是新版，仍不用手刷）；② 重载那一趟写 liyun_quiet_reload 标记，新文档直接撤掉开屏层 —— 用户看到的永远是一整段连续动画；③ 开屏保底显示 700ms→1200ms、淡出 .4s→.55s、金环描绘 1.5s→1.1s（画得完），整体变成一次从容的入场而不是几次闪烁；④ 本文件 install 与 navStrategy 里 index.html 改为「取一次、正文与指纹同一份字节」——原先取两次，CDN 传播窗口里会正文/指纹不匹配，误判成「壳子更新了」再刷一次（开场动画跳第三次的来源）。新增实测脚本 test/splash_probe.mjs。 */  /* v34：量化细则从「设置」里拆成独立页 —— 那张表近 30 条、每条都是可编辑的「名目 + 分值」输入框，整块塞在设置里把设置页撑到 ~5300px（手机要滑好久），密集输入框还容易误触改错分值。现在：设置页只留一张「量化细则」入口卡（照「老师管理」那张卡的样子，卡上一句「共 N 条计分项」+「打开量化细则」按钮）；加减分 / 加新条目 / 传图识别全搬到新页 page-rules，底部有「返回设置」。新页有 route 但**不进 NAV_ORDER** —— 侧栏 / 底部标签栏 / 全部功能抽屉三处都不出现，只有教务端从设置页那张卡能进，老师与学生拿不到（App.can 与服务端角色都拦）。实测设置页 5300→3028px，细则卡由最大一块缩到 173px。回归新增 test/rules_page_check.mjs（真机 6 项）与 redesign 第七节（5 项）。 */  /* v33：五端皮肤换「云淡」版 —— ① 侧栏/底栏(----rail)由端口**深色面**改为**浅色面**，上面压深端口色字（师珊瑚/教霁蓝/兼铜绿/学石绿/首赤金），彻底去掉压屏的深色块；② 整页底 --bg 由「几乎和旧中性底 #f6f5f2 一样」改为**看得出来的浅端口色**（这就是「顶栏是端口色、底色还是老颜色」的根因）；③ 新增 --rail-art（桌面侧栏白描的线条色）——素材是纯白线条，浅栏上原本会消失，改用 CSS mask 着色；④ 手机底栏胶囊阴影改走 --shadow-lg、侧栏门头白牌去掉重投影。CSS 五端块由 test/gen_port_theme.py 生成，体检脚本 test/diag_ports.mjs。 */  /* v32：① 电脑端侧栏（≥700px）由「三层传统暗纹」换成「花鸟白描小品」——把用户上传的竹石/松鹤/兰花三张水墨图抽成白线蒙版(assets/sideart/{zhushi,songhe,lanhua}_lite.png，更淡一档)，按端口沉底一枚(82% 栏宽)：教师=竹石、兼岗=竹石、教务=兰花、学生=兰花、首位教务=松鹤；一张图五端通用、颜色走端口 --rail。② 手机端 .tabbar / .topbar 彻底去纹样，纯色面（用户要求「简单大方」）。旧的「五端复合暗纹」整块删除，index.html 注入块改为「五端·桌面侧栏白描画」；本文件 SHELL 新增上述 3 个 png。 */  /* v31：① 浏览器标签页小图标(favicon)由「深墨底 PWA 图标」换成「带米黄底 + 金纹」的砺蕴圆章 —— 新增 favicon.ico(16/32/48) 与 favicon-192.png，`<link rel="icon">` 改指它们并带 ?v=31 强制刷新；桌面/PWA 图标(icon*.png/apple-touch-icon)按用户要求不动。② 五端暗纹整体调淡一档（用户反馈「花纹还是太明显、太明显了容易挡着字」）：rail 面 0.32/0.55/0.70 → 0.18/0.30/0.34，顶栏面 0.12/0.18/0.22 → 0.07/0.10/0.12。③ 手机底部标签栏放大：图标 19→23px、文字 10→12px、胶囊内边距 7→8px、内容区底部留白 108→120px。 */  /* v30：砺蕴网页 logo 由「透明细金线版」换成「带米黄底 + 金纹加粗版」；重建 assets/brand-lock{,@sm}.png 并重出 28 张启动图。 */  /* v29：五端配色落地甲方案终版（师珊瑚/教霁蓝/兼铜绿/学石绿/首赤金，师↔首互换、兼岗定铜绿）；新增五端复合暗纹（地纹+藤蔓+花头三层传统纹样 data-URI 背景注入侧栏/手机顶栏/底栏，内容区保持干净；浅深底各异）；学生打卡圈配色同步石绿。 */  /* v28：全站 emoji 小标识统一替换为内联 SVG 线性图标（52 枚，跨平台像素一致）；删除旧 logo 资产(boyi-/li/yun/logo-liyun)与废弃的 icon-light-* 桌面图标，SW 预缓存清单不变。v27：① 修手机顶栏 Logo「缩不小」——根因是 .topbar 里没有宽度规则，图片落到 .brand-lock 的 width:auto 上按自身像素(384×162)铺开，顶栏被撑到 183px 高；现在显式钉 88px，顶栏降到 56px。② 四端整页主题化：新增 --tint(次级面)/--rail(侧栏·底栏深色面)/--rail-text/--rail-on 四个变量，手机顶栏+底部标签栏、电脑侧栏+画布全部走端口色；侧栏门头改浅色牌（保住博艺徽章的蓝白）。③ theme-color 跟着端口走（状态栏也变色）。④ 手机 .main 不再重复吃 safe-area-inset-top（原先顶部平白多 59px）。⑤ 清掉失效的 --sidebar/--sidebar-text 与旧 logo 资产。⑥ super 端口朱砂红(#B23A2E)换竹青(#4E7A53)（用户从中国传统色中选定，浅/深两套 --accent 与 --rail 一并协调）。v26：登录门改 D 方案（去朱砂「砺」落款→底部黑字「博艺教育·砺蕴2026」；加黑色「欢迎回来」）；开屏改动画2（金线描绘圆环+融合标落底板淡入，纹路更清晰）；重出 28 张启动图并修 Chrome 最小窗宽钳制导致的偏心。v25：super 端口松绿换朱砂红(#B23A2E)并整体重着朱砂色；浅底桌面图标改深墨圆底板；删除未用 icon.svg。v24：首位教务(super)独立松绿皮肤；侧栏/手机顶栏融合标缩至88px；登录门牌匾缩小(220/260) */     // v23：全系统换融合 Logo（横版并排透明）；登录页加朱砂红「砺」印、门头改融合标；开屏换融合标；新增四端皮肤（教师金/教务黛蓝/兼岗黛紫/学生水青）。v22：手机桌面图标换新品牌标（深墨底金字，icon.png/icon-192/apple-touch-icon 三件套）。v21：进群开场白改「哈喽，乖，欢迎加入博艺大家庭，下面是你的学生系统的账号和密码，注意查收哦」。v20：学生账号入口对三位教务开放(原先只有首位教务看得见)并从倒数第二挪到「名册」下面 + 名单可按班级排序/一键复制；名册里两个「＋新建班级」按钮和下拉里的「＋新建班级…」一并去掉（建班归页面上头的班级卡片）
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
  /* 看板顶带的品牌标：左＝博艺圆章裸摆、右＝砺蕴印 + 暖米黄圆底，**两枚等径**
     （v43 定色 / v44 改等大）。别再用 brand-lock-alpha.png —— 那是「给深色底做的
     米黄细线描」，没有底色，贴在米白纸上砺蕴章会整块化掉。
     三个文件都在 SHELL 里，常开的屏必须离线也显示得出来。 */
  './assets/brand-plate.png',
  './assets/brand-plate@2x.png',
  './assets/brand-plate@3x.png',
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
