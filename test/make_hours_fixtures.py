#!/usr/bin/env python3
"""生成「课时统计 · 阶段一」测试用的 .docx / .csv 夹具（零第三方依赖）。

    python3 test/make_hours_fixtures.py <输出目录> <真值.json>

真值 JSON 形如：
    { "header": ["时间","周一","周二","周三"],
      "rows":   [["08:00-09:40","成人书法基础","少儿口才","播音发声"], ...] }

docx 是手写的最小 OOXML（zip + word/document.xml 里的 w:tbl）——
故意不用 python-docx：本机没装它，而且「最小可用 docx」正好能反过来验证
mammoth 读的是标准表格结构（不是我们特制的格式）。
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


def cell(text):
    return ("<w:tc><w:tcPr><w:tcW w:w=\"0\" w:type=\"auto\"/></w:tcPr>"
            "<w:p><w:r><w:t xml:space=\"preserve\">%s</w:t></w:r></w:p></w:tc>" % esc(text))


def make_docx(out_path, header, rows):
    trs = []
    trs.append("<w:tr>" + "".join(cell(h) for h in header) + "</w:tr>")
    for r in rows:
        trs.append("<w:tr>" + "".join(cell(c) for c in r) + "</w:tr>")
    document = ("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n"
                "<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\">"
                "<w:body>"
                "<w:tbl><w:tblPr><w:tblW w:w=\"0\" w:type=\"auto\"/>" + BORDERS + "</w:tblPr>"
                "<w:tblGrid>" + "<w:gridCol w:w=\"2000\"/>" * len(header) + "</w:tblGrid>"
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
    print("已生成：%s（docx + csv）" % outdir)
    return 0


if __name__ == "__main__":
    sys.exit(main())
