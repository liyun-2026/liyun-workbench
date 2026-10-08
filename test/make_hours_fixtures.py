#!/usr/bin/env python3
"""生成「课时统计 · 阶段一」测试用的 .docx / .csv / .xlsx 夹具（零第三方依赖）。

    python3 test/make_hours_fixtures.py <输出目录> <真值.json>

真值 JSON 形如：
    { "header": ["时间","周一","周二","周三"],
      "rows":   [["08:00-09:40","成人书法基础","少儿口才","播音发声"], ...] }

产出：
    hours_tt.docx           —— 由真值生成（表格，无合并）
    hours_tt.csv            —— 由真值生成
    hours_tt.xlsx           —— 由真值生成（最小 OOXML：走 _readXlsx 那条自解 zip 的通路）
    hours_tt_merged.docx    —— 内置的**带合并单元格**表格（数据行里一个跨 2 列 + 一个跨 2 行）
    hours_tt_realgeom.docx  —— 复刻真实登记表几何：27 行 × 6 列，首行首格 colspan=5、首行末格 rowspan=2

docx 是手写的最小 OOXML（zip + word/document.xml 里的 w:tbl），xlsx 同样是手写最小 OOXML ——
故意不用 python-docx / openpyxl：本机没装，而且「最小可用文件」正好能反过来验证
mammoth / _readXlsx 读的是标准结构（不是我们特制的格式）。
"""
import json
import os
import sys
import zipfile

CONTENT_TYPES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>"""

RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"""

DOC_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>"""

BORDERS = ("<w:tblBorders>"
           '<w:top w:val="single" w:sz="8" w:color="000000"/>'
           '<w:left w:val="single" w:sz="8" w:color="000000"/>'
           '<w:bottom w:val="single" w:sz="8" w:color="000000"/>'
           '<w:right w:val="single" w:sz="8" w:color="000000"/>'
           '<w:insideH w:val="single" w:sz="8" w:color="000000"/>'
           '<w:insideV w:val="single" w:sz="8" w:color="000000"/>'
           "</w:tblBorders>")


def esc(s):
    return (str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


def cell(spec):
    """spec 可以是字符串，也可以是 {text, colspan, rowspan, vmerge} 的合并单元格描述。

    · colspan=N  → <w:gridSpan w:val="N"/>（横向合并，占 N 列）
    · rowspan=N  → <w:vMerge w:val="restart"/>（纵向合并的**起始格**）
    · vmerge=True→ <w:vMerge/>（纵向合并的**延续格**，放在被合并的后续行同一列）
    """
    if isinstance(spec, dict):
        text = spec.get("text", "")
        pr = ""
        if spec.get("colspan"):
            pr += '<w:gridSpan w:val="%d"/>' % int(spec["colspan"])
        if spec.get("rowspan"):
            pr += '<w:vMerge w:val="restart"/>'
        if spec.get("vmerge"):
            pr += "<w:vMerge/>"
        tcpr = '<w:tcPr><w:tcW w:w="0" w:type="auto"/>%s</w:tcPr>' % pr
    else:
        text = spec
        tcpr = '<w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>'
    return ("<w:tc>" + tcpr +
            '<w:p><w:r><w:t xml:space="preserve">%s</w:t></w:r></w:p></w:tc>' % esc(text))


def make_docx(out_path, header, rows, cols=None):
    trs = []
    trs.append("<w:tr>" + "".join(cell(h) for h in header) + "</w:tr>")
    for r in rows:
        trs.append("<w:tr>" + "".join(cell(c) for c in r) + "</w:tr>")
    ncols = cols if cols else len(header)
    document = ("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n"
                "<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\">"
                "<w:body>"
                "<w:tbl><w:tblPr><w:tblW w:w=\"0\" w:type=\"auto\"/>" + BORDERS + "</w:tblPr>"
                "<w:tblGrid>" + "<w:gridCol w:w=\"2000\"/>" * ncols + "</w:tblGrid>"
                + "".join(trs) +
                "</w:tbl><w:p/></w:body></w:document>")
    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", CONTENT_TYPES)
        z.writestr("_rels/.rels", RELS)
        z.writestr("word/_rels/document.xml.rels", DOC_RELS)
        z.writestr("word/document.xml", document)


def make_csv(out_path, header, rows):
    def line(cells):
        return ",".join('"%s"' % str(c).replace('"', '""') for c in cells)
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(line(header) + "\n")
        for r in rows:
            f.write(line(r) + "\n")


# ── 最小 OOXML（xlsx）────────────────────────────────────────────────
XLSX_CONTENT_TYPES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
</Types>"""

XLSX_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>"""

XLSX_WORKBOOK = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="课表" sheetId="1" r:id="rId1"/></sheets>
</workbook>"""

XLSX_WORKBOOK_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
</Relationships>"""


def _col_letters(n):
    s = ""
    n += 1
    while n:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s


def make_xlsx(out_path, header, rows):
    shared, idx = [], {}

    def sid(t):
        t = str(t)
        if t not in idx:
            idx[t] = len(shared)
            shared.append(t)
        return idx[t]

    shex = []
    for ri, row in enumerate([header] + list(rows)):
        cs = "".join('<c r="%s%d" t="s"><v>%d</v></c>' % (_col_letters(ci), ri + 1, sid(v))
                     for ci, v in enumerate(row))
        shex.append('<row r="%d">%s</row>' % (ri + 1, cs))
    sheet = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
             '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
             "<sheetData>" + "".join(shex) + "</sheetData></worksheet>")
    sst = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
           '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
           'count="%d" uniqueCount="%d">%s</sst>'
           % (len(shared), len(shared),
              "".join('<si><t xml:space="preserve">%s</t></si>' % esc(t) for t in shared)))
    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", XLSX_CONTENT_TYPES)
        z.writestr("_rels/.rels", XLSX_RELS)
        z.writestr("xl/workbook.xml", XLSX_WORKBOOK)
        z.writestr("xl/_rels/workbook.xml.rels", XLSX_WORKBOOK_RELS)
        z.writestr("xl/worksheets/sheet1.xml", sheet)
        z.writestr("xl/sharedStrings.xml", sst)


# ── 内置的「带合并单元格」表格 ────────────────────────────────────────
# 表头 5 列：时间 + 周一~周四
MERGED_HEADER = ["时间", "周一", "周二", "周三", "周四"]
# 第 1 数据行：『少儿口才』跨 2 列 → 周二、周三各一份
# 第 2 数据行：『即兴评述』跨 2 行 → 第 2、3 数据行的周二各一份
# 第 3 数据行：周二位置放 vMerge 延续格（Word 规定），后面两格必须**不串列**地落到周三/周四
MERGED_ROWS = [
    ["08:00-09:40", "成人书法", {"text": "少儿口才", "colspan": 2}, "播音发声"],
    ["10:00-11:40", "形体训练", {"text": "即兴评述", "rowspan": 2}, "新闻播报", "文学朗读"],
    ["14:00-15:40", "模拟主持", {"vmerge": True}, "影视配音", "少儿口才"],
]

# ── 复刻真实「教师授课日志登记表」的几何（常驻夹具，取代对外接卷的依赖）──
# 27 行 × 6 列；第 1 行首格 colspan=5、第 1 行末格 rowspan=2（「时长」竖跨两行）。
# 第 2 行末列放 vMerge 延续格（Word 规定纵向合并必须占位），mammoth 会把它并进上一行的
# rowspan —— 于是 HTML 里第 1 行只有 2 个 <td>（colspan5 + rowspan2）、第 2 行 5 个 <td>，
# 剩下 25 行各 6 个 <td>，网格还原出来正好 27 行 × 6 列。
REAL_GEOM_HEADER = [{"text": "授课教师：", "colspan": 5}, {"text": "时长", "rowspan": 2}]
REAL_GEOM_ROWS = (
    [["", "班级", "教室", "授课时间", "授课内容", {"vmerge": True}]]
    + [["", "", "", "", "", ""] for _ in range(25)]
)   # 1（表头）+ 26 = 27 行

# ── 「像样的课表」：5 天 × 3 节（15 格），每格把「班级 / 教室 / 授课内容 / 老师」都写全 ──
#   · 前三行是节次（=第X节 + 起止时间），后六列里第 0 列是行头、1~5 列是周一~周五；
#   · 名字一律取**页面里真实存在的名册**（班级 Store 'classes' / 教室 Store 'rooms' /
#     老师 Staff.teachers()）—— 由 shot_hours_stage1_v2.mjs 在截图前先灌好，见下方 RICH_ROSTER；
#   · 有 3 格**故意写错**（班名「砺蕴九班」、老师「张老师」都不在名册里）→ 系统认不出 → 标黄；
#   · 「每周一练拓展」故意带「周X」字样当课程名 → 用来证明它**不会**被误当成星期；
#   · 第 1 节的周三+周四共用一格（colspan=2）→ 展示合并单元格被拆成两天 + 出「提醒」。
RICH_ROSTER = {
    "classes": ["少儿口才一班", "少儿口才二班", "播音主持班", "影视配音班", "新闻播报班"],
    "rooms": ["演播厅", "录音棚", "形体房", "一教室"],
    "teachers": ["王老师", "赵老师", "孙老师"],
}
RICH_HEADER = ["节次 / 时间", "周一", "周二", "周三", "周四", "周五"]
RICH_ROWS = [
    # 第 1 节 08:00-09:40
    ["第1节 08:00-09:40",
     "少儿口才一班 演播厅 普通话语音 王老师",       # ✔ 全部认得出
     "播音主持班 演播厅 新闻播报 赵老师",           # ✔
     {"text": "砺蕴九班 一教室 模拟主持 孙老师", "colspan": 2},  # ✘ 班名不在名册 → 黄；且横跨周三+周四
     "影视配音班 录音棚 影视配音 王老师"],          # ✔
    # 第 2 节 10:00-11:40
    ["第2节 10:00-11:40",
     "少儿口才二班 形体房 形体训练 孙老师",         # ✔
     "少儿口才一班 一教室 每周一练拓展 王老师",     # ✔ 课程名带「周一」但不会被当成星期
     "播音主持班 演播厅 模拟主持 张老师",           # ✘ 老师「张老师」不在名册 → 黄
     "新闻播报班 录音棚 新闻播报 赵老师",           # ✔
     "少儿口才二班 一教室 播音发声 孙老师"],        # ✔
    # 第 3 节 14:00-15:40
    ["第3节 14:00-15:40",
     "砺蕴九班 形体房 少儿口才 孙老师",             # ✘ 班名不在名册 → 黄
     "播音主持班 演播厅 模拟主持 赵老师",           # ✔
     "少儿口才二班 一教室 即兴评述 王老师",         # ✔
     "影视配音班 录音棚 文学作品朗读 王老师",       # ✔
     "新闻播报班 一教室 新闻播报 赵老师"],          # ✔
]
# CSV 版：合并格没法表达，把「砺蕴九班」只放周三一格，周四另给一节（其余同口径）
RICH_ROWS_CSV = [
    ["第1节 08:00-09:40", "少儿口才一班 演播厅 普通话语音 王老师", "播音主持班 演播厅 新闻播报 赵老师",
     "砺蕴九班 一教室 模拟主持 孙老师", "影视配音班 录音棚 影视配音 王老师", "新闻播报班 演播厅 即兴评述 赵老师"],
    RICH_ROWS[1],
    RICH_ROWS[2],
]


# ── 匿名合成夹具：复刻用户真实课表的四种形状（不依赖任何外部文件，永远能跑）──
#   ① 表头是「日期 + 星期」混写（7月27日  周一），行头 2 列（班级｜时段），格内塞了好几节；
#   ② 行头 **3 列**（BY08｜上午｜08:40-09:10），表头前 3 格是合并留下的空格；
#   ③ 3 列列表式（8月17日周一｜上午｜09:30-09:40…），首列合并跨上午/下午；
#   ④ 2 列列表式（8月22日周六上午｜09:30-09:40…），日期+星期+时段挤在一格。
DATEDAY_ROWS = [
    # 第 1 行：周一那一格塞了 2 节（下午 02:50 走 _tmin → 14:50）
    ["BY03", "下午",
     "02:50-03:10普通话发音[BY03]03:10-03:50余老师·声调调值1[BY03]",
     "休息",
     "04:00-04:40时事速递1[BY03]"],
    # 第 2 行：周一不排课、周二排一节、周三排一节
    ["BY05", "上午",
     "08:50-09:10科学发声[BY05]",
     "09:10-09:50新闻播报[BY05]",
     "休息"],
]
HEAD3_ROWS = [
    ["BY08", "上午", "08:40-09:10", "科学发声", "科学发声", "休息"],
    # 第 2 行「BY08」不重复写（合并续格，留空）→ 必须沿用上一行的值
    ["", "下午", "03:00-03:40", "即兴评述", "文稿朗读", "新闻播音"],
]
LIST3_ROWS = [
    ["8月16日周日", "全天", "休息"],
    ["8月17日周一", "上午", "09:30-09:40科学发声实训09:40-10:20播音发声胸腹式联合呼吸法"],
    ["8月17日周一", "下午", "03:30-03:40普通话发音实训03:40-04:20普通话语音---语音问题分析"],
]
LIST2_ROWS = [
    ["8月22日周六上午", "09:30-09:40科学发声实训09:40-10:20作品朗读---情感表达"],
    ["8月22日周六下午", "03:30-03:40普通话发音实训03:40-04:20电视新闻播报---热点新闻速递"],
]


def make_dateday_csv(out_path):
    header = ["班级", "时间", "7月27日  周一", "7月28日 周二", "7月29日周三"]
    make_csv(out_path, header, DATEDAY_ROWS)


def make_head3_csv(out_path):
    header = ["", "", "", "7月20日周六", "7月21日周日", "7月22日周一"]
    make_csv(out_path, header, HEAD3_ROWS)


def make_plain_csv(out_path, rows):
    with open(out_path, "w", encoding="utf-8") as f:
        for r in rows:
            f.write(",".join('"%s"' % str(c).replace('"', '""') for c in r) + "\n")


def main():
    if len(sys.argv) < 3:
        print("用法：python3 test/make_hours_fixtures.py <输出目录> <真值.json>", file=sys.stderr)
        return 1
    outdir, truth_path = sys.argv[1], sys.argv[2]
    with open(truth_path, encoding="utf-8") as f:
        truth = json.load(f)
    os.makedirs(outdir, exist_ok=True)
    make_docx(os.path.join(outdir, "hours_tt.docx"), truth["header"], truth["rows"])
    make_csv(os.path.join(outdir, "hours_tt.csv"), truth["header"], truth["rows"])
    make_xlsx(os.path.join(outdir, "hours_tt.xlsx"), truth["header"], truth["rows"])
    make_docx(os.path.join(outdir, "hours_tt_merged.docx"),
              MERGED_HEADER, MERGED_ROWS, cols=len(MERGED_HEADER))
    make_docx(os.path.join(outdir, "hours_tt_realgeom.docx"),
              REAL_GEOM_HEADER, REAL_GEOM_ROWS, cols=6)
    # 「像样的课表」：5 天 × 3 节，含合并格与故意写错的格子（供验收图 B / C 用）
    make_docx(os.path.join(outdir, "hours_tt_rich.docx"),
              RICH_HEADER, RICH_ROWS, cols=len(RICH_HEADER))
    make_csv(os.path.join(outdir, "hours_tt_rich.csv"), RICH_HEADER, RICH_ROWS_CSV)
    # 匿名合成夹具：复刻真实课表的四种形状
    make_dateday_csv(os.path.join(outdir, "hours_tt_dateday.csv"))
    make_head3_csv(os.path.join(outdir, "hours_tt_head3.csv"))
    make_plain_csv(os.path.join(outdir, "hours_tt_list3.csv"), LIST3_ROWS)
    make_plain_csv(os.path.join(outdir, "hours_tt_list2.csv"), LIST2_ROWS)
    print("已生成：%s（docx + csv + xlsx + 合并格 docx + 真实几何 docx + 像样课表 docx/csv + 真实形状 4 件）" % outdir)
    print("  像样课表用的名册：班级 %s / 教室 %s / 老师 %s"
          % (RICH_ROSTER["classes"], RICH_ROSTER["rooms"], RICH_ROSTER["teachers"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
