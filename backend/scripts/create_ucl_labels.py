import argparse
import io
import json
import re
from pathlib import Path

from reportlab.lib.pagesizes import landscape, letter
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas


def clean_lines(lines):
    return [" ".join(str(line).split()) for line in lines if str(line).strip()]


def without_customer_code(lines):
    if lines and re.fullmatch(r"[A-Z]{2,}\d{2,}", lines[0], re.IGNORECASE):
        return lines[1:]
    return lines


def wrap_line(text, font_name, font_size, max_width):
    words = text.split()
    if not words:
        return []
    result = []
    current = words[0]
    for word in words[1:]:
        candidate = f"{current} {word}"
        if stringWidth(candidate, font_name, font_size) <= max_width:
            current = candidate
        else:
            result.append(current)
            current = word
    result.append(current)
    return result


def fit_address(lines, max_width, max_height):
    for size in (18, 17, 16, 15, 14, 13, 12, 11, 10):
        wrapped = []
        for line in lines:
            wrapped.extend(wrap_line(line, "Times-Bold", size, max_width))
        leading = size + 4
        if wrapped and len(wrapped) * leading <= max_height:
            return wrapped, size, leading
    wrapped = []
    for line in lines:
        wrapped.extend(wrap_line(line, "Times-Bold", 9, max_width))
    return wrapped[:9], 9, 12


def centered(c, text, x, y, width, font, size):
    c.setFont(font, size)
    c.drawCentredString(x + width / 2, y, text)


def draw_label(c, logo, x, y, cell_width, cell_height, consignee):
    c.setLineWidth(0.6)
    c.rect(x, y, cell_width, cell_height)

    top = y + cell_height - 10
    c.drawImage(logo, x + 16, top - 39, width=78, height=38, preserveAspectRatio=True, mask="auto")

    header_x = x + 88
    header_width = cell_width - 96
    centered(c, "LINDA FASHION ACCESSORIES CORP", header_x, top - 2, header_width, "Helvetica-Bold", 9.5)
    centered(c, "2195 ELIZABETH AVE  1ST FL S-BLDG,", header_x, top - 13, header_width, "Helvetica-Bold", 8.2)
    centered(c, "RAHWAY, NJ 07065", header_x, top - 24, header_width, "Helvetica-Bold", 8.2)
    centered(c, "TEL: 732-669-7263  FAX: 732-540-8475", header_x, top - 35, header_width, "Helvetica-Bold", 7.8)
    centered(c, "Website: www.lindafashionny.com  Email: info@lindafashionny.com", header_x, top - 46, header_width, "Helvetica-Bold", 6.8)

    divider_y = top - 55
    c.setDash(3, 1.5)
    c.setLineWidth(1)
    c.line(x + 14, divider_y, x + cell_width - 14, divider_y)
    c.setDash()

    centered(c, "SHIP TO:", x, divider_y - 28, cell_width, "Times-Bold", 23)
    address_top = divider_y - 54
    available_height = 178
    address_lines, font_size, leading = fit_address(consignee, cell_width - 32, available_height)
    text_y = address_top
    for line in address_lines:
        centered(c, line, x + 16, text_y, cell_width - 32, "Times-Bold", font_size)
        text_y -= leading
    centered(c, "UCL", x, text_y - 2, cell_width, "Times-Bold", 23)


def create_labels(output, logo_path, payload):
    sold_to = without_customer_code(clean_lines(payload.get("soldTo") or []))
    ship_to = without_customer_code(clean_lines(payload.get("shipTo") or []))
    customer_name = sold_to[0] if sold_to else ""
    consignee = ship_to + ([f"C/O {customer_name}"] if customer_name else [])
    if not consignee:
        raise ValueError("Ship To address is required")

    page_width, page_height = landscape(letter)
    output.parent.mkdir(parents=True, exist_ok=True)
    stream = io.BytesIO()
    pdf = canvas.Canvas(stream, pagesize=(page_width, page_height))
    pdf.setTitle(f"UCL Labels - Order {payload.get('orderNo', '')}")
    logo = ImageReader(str(logo_path))
    margin = 4
    gutter = 6
    cell_width = (page_width - 2 * margin - gutter) / 2
    cell_height = (page_height - 2 * margin - gutter) / 2
    positions = (
        (margin, margin + cell_height + gutter),
        (margin + cell_width + gutter, margin + cell_height + gutter),
        (margin, margin),
        (margin + cell_width + gutter, margin),
    )
    for x, y in positions:
        draw_label(pdf, logo, x, y, cell_width, cell_height, consignee)
    pdf.showPage()
    pdf.save()
    output.write_bytes(stream.getvalue())
    return {"output": str(output), "orderNo": str(payload.get("orderNo") or ""), "consignee": consignee}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", required=True)
    parser.add_argument("--logo", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    payload = json.loads(Path(args.data).read_text(encoding="utf-8"))
    result = create_labels(Path(args.output), Path(args.logo), payload)
    print(json.dumps(result))


if __name__ == "__main__":
    main()
