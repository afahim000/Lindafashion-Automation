import argparse
import io
import json
import math
import re
from pathlib import Path

from pypdf import PdfReader, PdfWriter
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas

DIMENSIONAL_DIVISOR = 139


def number(value):
    try:
        result = float(value)
        return result if result > 0 else 0
    except (TypeError, ValueError):
        return 0


def calculate_weight(cartons):
    total = 0
    details = []
    for carton in cartons:
        actual = number(carton.get("actualWeight"))
        length = number(carton.get("length"))
        width = number(carton.get("width"))
        height = number(carton.get("height"))
        dimensional = math.ceil(length * width * height / DIMENSIONAL_DIVISOR) if length and width and height else 0
        selected = max(actual, dimensional)
        total += selected
        details.append({"actual": actual, "dimensional": dimensional, "selected": selected})
    return math.ceil(total), details


def clean_lines(lines):
    return [" ".join(str(line).split()) for line in lines if str(line).strip()]


def without_customer_code(lines):
    if lines and re.fullmatch(r"[A-Z]{2,}\d{2,}", lines[0], re.IGNORECASE):
        return lines[1:]
    return lines


def wrap_lines(lines, font_name, font_size, max_width, max_lines=9):
    wrapped = []
    for source in lines:
        current = ""
        for word in source.split():
            candidate = f"{current} {word}".strip()
            if current and stringWidth(candidate, font_name, font_size) > max_width:
                wrapped.append(current)
                current = word
            else:
                current = candidate
        if current:
            wrapped.append(current)
    return wrapped[:max_lines]


def address(c, x, y, lines, clear_box, max_width):
    c.setFillColorRGB(1, 1, 1)
    c.rect(*clear_box, stroke=0, fill=1)
    c.setFillColorRGB(0.12, 0.12, 0.12)
    c.setFont("Helvetica", 8.2)
    for index, line in enumerate(wrap_lines(lines, "Helvetica", 8.2, max_width)):
        c.drawString(x, y - index * 9.8, line)


def value(c, clear_box, x, y, text):
    c.setFillColorRGB(1, 1, 1)
    c.rect(*clear_box, stroke=0, fill=1)
    c.setFillColorRGB(0.08, 0.08, 0.08)
    c.setFont("Helvetica", 10)
    c.drawString(x, y, text)


def verticals(c, xs, bottom, top):
    c.setStrokeColorRGB(0.08, 0.08, 0.08)
    c.setLineWidth(0.45)
    for x in xs:
        c.line(x, bottom, x, top)


def make_overlay(page_number, width, height, consignee, pieces, weight):
    stream = io.BytesIO()
    c = canvas.Canvas(stream, pagesize=(width, height))
    if page_number == 0:
        address(c, 381, 706, consignee, (379, 631, 196, 86), 180)
        value(c, (37, 541, 47, 48), 37, 562, pieces)
        value(c, (86.2, 535, 54, 66), 87, 573, weight)
        value(c, (263, 445, 47, 18), 265, 453, pieces)
        verticals(c, (36, 85, 140), 507, 600)
    else:
        address(c, 381, 707, consignee, (370, 632, 205, 85), 180)
        value(c, (37, 545, 47, 48), 37, 570, pieces)
        value(c, (91, 535, 52, 66), 93, 560, weight)
        value(c, (263, 445, 47, 18), 264, 453, pieces)
        verticals(c, (36, 85, 140), 507, 600)

        address(c, 395, 332, consignee, (393, 254, 182, 91), 170)
        value(c, (37, 177, 47, 48), 37, 201, pieces)
        value(c, (91, 168, 52, 66), 93, 198, weight)
        value(c, (263, 73, 47, 17), 263, 81, pieces)
        verticals(c, (36, 85, 140), 131, 225)
    c.save()
    stream.seek(0)
    return PdfReader(stream).pages[0]


def create_form(template, output, payload):
    cartons = payload.get("cartons") or []
    count = int(payload.get("totalCartons") or len(cartons) or 0)
    if count <= 0:
        raise ValueError("At least one carton is required")
    sold_to = without_customer_code(clean_lines(payload.get("soldTo") or []))
    ship_to = without_customer_code(clean_lines(payload.get("shipTo") or []))
    customer = sold_to[0] if sold_to else ""
    consignee = ship_to + ([f"C/O {customer}"] if customer else [])
    total_weight, details = calculate_weight(cartons)
    pieces = f"{count} BOX" if count == 1 else f"{count} BOXES"
    weight = f"{total_weight} LBS"

    source = PdfReader(str(template))
    writer = PdfWriter()
    for page_number, page in enumerate(source.pages):
        page.merge_page(make_overlay(page_number, float(page.mediabox.width), float(page.mediabox.height), consignee, pieces, weight))
        writer.add_page(page)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("wb") as output_file:
        writer.write(output_file)
    return {"output": str(output), "totalWeight": total_weight, "cartons": details}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--template", required=True)
    parser.add_argument("--data", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    payload = json.loads(Path(args.data).read_text(encoding="utf-8"))
    print(json.dumps(create_form(Path(args.template), Path(args.output), payload)))


if __name__ == "__main__":
    main()
