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
    print("已生成：%s（docx + csv + xlsx + 合并格 docx + 真实几何 docx）" % outdir)
    return 0


if __name__ == "__main__":
    sys.exit(main())
