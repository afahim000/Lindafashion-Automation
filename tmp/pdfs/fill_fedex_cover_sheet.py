from io import BytesIO
from pathlib import Path
import os

from pypdf import PdfReader, PdfWriter
from reportlab.pdfgen import canvas


def load_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


root = Path(__file__).resolve().parents[2]
env = load_env(root / "backend" / ".env")
source = root / "output" / "pdf" / "FedEx-Label-Cover-Sheet-blank.pdf"
destination = root / "output" / "pdf" / "FedEx-Label-Cover-Sheet-completed.pdf"

required = ["FEDEX_ACCOUNT_NUMBER", "FEDEX_CLIENT_ID", "FEDEX_SHIPPER_COMPANY"]
missing = [name for name in required if not env.get(name)]
if missing:
    raise RuntimeError("Missing required environment values: " + ", ".join(missing))

packet = BytesIO()
c = canvas.Canvas(packet, pagesize=(580.56, 792))
c.setFont("Helvetica", 8.5)

# Customer and project fields.
c.drawString(252, 499, env["FEDEX_ACCOUNT_NUMBER"])
c.drawString(252, 478, env["FEDEX_CLIENT_ID"])
c.drawString(252, 366, env["FEDEX_SHIPPER_COMPANY"])
c.drawString(252, 347, env.get("FEDEX_SHIPPER_NAME", "Abrar Fahim"))
c.drawString(252, 328, "abrarfahim100@gmail.com")
c.drawString(252, 309, "Brother HL-L6200DW series Printer")
c.drawString(252, 289, "1")

# Checkboxes: not third-party, laser PDF, Express and Ground.
c.setFont("Helvetica-Bold", 12)
c.drawString(286, 454, "X")
c.drawString(283, 257, "X")
c.drawString(249, 233, "X")
c.drawString(299, 233, "X")
c.save()

packet.seek(0)
base = PdfReader(str(source))
overlay = PdfReader(packet)
base.pages[0].merge_page(overlay.pages[0])
writer = PdfWriter()
writer.add_page(base.pages[0])
with destination.open("wb") as handle:
    writer.write(handle)

print(destination)
