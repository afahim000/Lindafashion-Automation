import argparse
import io
import json
import math
import re
from pathlib import Path

from pypdf import PdfReader, PdfWriter
from reportlab.pdfgen import canvas
from reportlab.pdfbase.pdfmetrics import stringWidth


DIMENSIONAL_DIVISOR = 139


def positive_number(value):
    try:
        number = float(value)
        return number if number > 0 else 0
    except (TypeError, ValueError):
        return 0


def billed_weight(cartons):
    total = 0
    details = []
    for carton in cartons:
        actual = positive_number(carton.get("actualWeight"))
        length = positive_number(carton.get("length"))
        width = positive_number(carton.get("width"))
        height = positive_number(carton.get("height"))
        dimensional = math.ceil(length * width * height / DIMENSIONAL_DIVISOR) if length and width and height else 0
        selected = max(actual, dimensional)
        total += selected
        details.append({"actual": actual, "dimensional": dimensional, "selected": selected})
    return math.ceil(total), details


def fit_lines(lines, max_lines=8):
    cleaned = [" ".join(str(line).split()) for line in lines if str(line).strip()]
    return cleaned[:max_lines]


def without_customer_code(lines):
    if lines and re.fullmatch(r"[A-Z]{2,}\d{2,}", lines[0], re.IGNORECASE):
        return lines[1:]
    return lines


def wrap_lines(lines, font_name, font_size, max_width, max_lines):
    wrapped = []
    for source_line in lines:
        words = source_line.split()
        current = ""
        for word in words:
            candidate = f"{current} {word}".strip()
            if current and stringWidth(candidate, font_name, font_size) > max_width:
                wrapped.append(current)
                current = word
            else:
                current = candidate
        if current:
            wrapped.append(current)
    return wrapped[:max_lines]


def draw_address(c, x, start_y, lines, clear_x, clear_y, clear_w, clear_h, max_width=180):
    c.setFillColorRGB(1, 1, 1)
    c.rect(clear_x, clear_y, clear_w, clear_h, stroke=0, fill=1)
    c.setFillColorRGB(0.12, 0.12, 0.12)
    font_size = 8.2
    leading = 9.8
    lines = wrap_lines(lines, "Helvetica", font_size, max_width, 9)
    c.setFont("Helvetica", font_size)
    for index, line in enumerate(lines):
        c.drawString(x, start_y - index * leading, line)


def draw_value(c, clear_box, x, y, text, font_size=10):
    c.setFillColorRGB(1, 1, 1)
    c.rect(*clear_box, stroke=0, fill=1)
    c.setFillColorRGB(0.08, 0.08, 0.08)
    c.setFont("Helvetica", font_size)
    c.drawString(x, y, text)


def restore_verticals(c, xs, bottom, top):
    c.setStrokeColorRGB(0.08, 0.08, 0.08)
    c.setLineWidth(0.45)
    for x in xs:
        c.line(x, bottom, x, top)


def overlay_for_page(page_number, width, height, address_lines, pieces_text, weight_text):
    stream = io.BytesIO()
    c = canvas.Canvas(stream, pagesize=(width, height))

    if page_number == 0:
        draw_address(c, 381, 706, address_lines, 379, 631, 196, 86, 180)
        draw_value(c, (37, 541, 47, 48), 37, 562, pieces_text, 10)
        draw_value(c, (86.2, 535, 54, 66), 87, 573, weight_text, 10)
        draw_value(c, (263, 445, 47, 18), 265, 453, pieces_text, 10)
        restore_verticals(c, (36, 85, 140), 507, 600)
    else:
        # Upper driver-copy block.
        draw_address(c, 381, 707, address_lines, 370, 632, 205, 85, 180)
        draw_value(c, (37, 545, 47, 48), 37, 570, pieces_text, 10)
        draw_value(c, (91, 535, 52, 66), 93, 560, weight_text, 10)
        draw_value(c, (263, 445, 47, 18), 264, 453, pieces_text, 10)
        restore_verticals(c, (36, 85, 140), 507, 600)

        # Lower driver-copy block.
        draw_address(c, 395, 332, address_lines, 393, 254, 182, 91, 170)
        draw_value(c, (37, 177, 47, 48), 37, 201, pieces_text, 10)
        draw_value(c, (91, 168, 52, 66), 93, 198, weight_text, 10)
        draw_value(c, (263, 73, 47, 17), 263, 81, pieces_text, 10)
        restore_verticals(c, (36, 85, 140), 131, 225)

    c.save()
    stream.seek(0)
    return PdfReader(stream).pages[0]


def create_form(template_path, output_path, payload):
    cartons = payload.get("cartons") or []
    carton_count = int(payload.get("totalCartons") or len(cartons) or 0)
    if carton_count <= 0:
        raise ValueError("At least one carton is required")

    sold_to = without_customer_code(fit_lines(payload.get("soldTo") or []))
    ship_to = without_customer_code(fit_lines(payload.get("shipTo") or []))
    customer_name = sold_to[0] if sold_to else ""
    consignee = fit_lines(ship_to + ([f"C/O {customer_name}"] if customer_name else []))
    total_weight, weight_details = billed_weight(cartons)
    pieces_text = f"{carton_count} BOX" if carton_count == 1 else f"{carton_count} BOXES"
    weight_text = f"{total_weight} LBS"

    source = PdfReader(str(template_path))
    writer = PdfWriter()
    for page_number, page in enumerate(source.pages):
        overlay = overlay_for_page(
            page_number,
            float(page.mediabox.width),
            float(page.mediabox.height),
            consignee,
            pieces_text,
            weight_text,
        )
        page.merge_page(overlay)
        writer.add_page(page)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("wb") as output_file:
        writer.write(output_file)
    return {"output": str(output_path), "totalWeight": total_weight, "cartons": weight_details}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--template", required=True)
    parser.add_argument("--data", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    payload = json.loads(Path(args.data).read_text(encoding="utf-8"))
    result = create_form(Path(args.template), Path(args.output), payload)
    print(json.dumps(result))


if __name__ == "__main__":
    main()
