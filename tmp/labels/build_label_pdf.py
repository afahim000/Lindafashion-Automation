from io import BytesIO
from pathlib import Path
from zipfile import ZipFile

from reportlab.lib.pagesizes import landscape, letter
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas


REFERENCE = Path(r"C:\Users\ABRAR\OneDrive\Desktop\Lindafashion-Automation\tmp\labels\LINDA-LABEL-reference.docx")
OUTPUT = Path(r"C:\Users\ABRAR\OneDrive\Desktop\Lindafashion-Automation\output\pdf\LABEL-15914-sample.pdf")
OUTPUT.parent.mkdir(parents=True, exist_ok=True)

ADDRESS = [
    ("AMAD LOGISTICS", 17),
    ("IMPORTACIONES MUNDO OFERTAS-SI CARG", 12.5),
    ("8274 N.W. 14TH STREET", 16),
    ("305 888-0344", 16),
    ("DORAL, FL 33126", 16),
    ("C/O BELLAS INTERNACIONAL LLC.", 14.5),
]

with ZipFile(REFERENCE) as archive:
    logo = ImageReader(BytesIO(archive.read("word/media/image1.jpeg")))

page_w, page_h = landscape(letter)
c = canvas.Canvas(str(OUTPUT), pagesize=landscape(letter))
c.setTitle("LABEL 15914 - UCL")

margin = 4
gutter = 6
cell_w = (page_w - 2 * margin - gutter) / 2
cell_h = (page_h - 2 * margin - gutter) / 2


def centered(text, x, y, width, font, size):
    c.setFont(font, size)
    c.drawCentredString(x + width / 2, y, text)


def draw_label(x, y):
    c.setLineWidth(0.6)
    c.rect(x, y, cell_w, cell_h)

    top = y + cell_h - 10
    c.drawImage(logo, x + 16, top - 39, width=78, height=38, preserveAspectRatio=True, mask="auto")

    hx = x + 88
    hw = cell_w - 96
    centered("LINDA FASHION ACCESSORIES CORP", hx, top - 2, hw, "Helvetica-Bold", 9.5)
    centered("2195 ELIZABETH AVE  1ST FL S-BLDG,", hx, top - 13, hw, "Helvetica-Bold", 8.2)
    centered("RAHWAY, NJ 07065", hx, top - 24, hw, "Helvetica-Bold", 8.2)
    centered("TEL: 732-669-7263  FAX: 732-540-8475", hx, top - 35, hw, "Helvetica-Bold", 7.8)
    centered("Website: www.lindafashionny.com  Email: info@lindafashionny.com", hx, top - 46, hw, "Helvetica-Bold", 6.8)

    divider_y = top - 55
    c.setDash(3, 1.5)
    c.setLineWidth(1)
    c.line(x + 14, divider_y, x + cell_w - 14, divider_y)
    c.setDash()

    centered("SHIP TO:", x, divider_y - 28, cell_w, "Times-Bold", 23)
    text_y = divider_y - 54
    for text, size in ADDRESS:
        centered(text, x + 8, text_y, cell_w - 16, "Times-Bold", size)
        text_y -= 23
    centered("UCL", x, text_y - 1, cell_w, "Times-Bold", 23)


draw_label(margin, margin + cell_h + gutter)
draw_label(margin + cell_w + gutter, margin + cell_h + gutter)
draw_label(margin, margin)
draw_label(margin + cell_w + gutter, margin)

c.showPage()
c.save()
print(OUTPUT)
