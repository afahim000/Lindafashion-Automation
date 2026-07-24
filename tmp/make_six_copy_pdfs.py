from pathlib import Path
from pypdf import PdfReader, PdfWriter

root = Path(r"C:\Users\ABRAR\OneDrive\Desktop\Lindafashion-Automation\output\ai\items")

for item_dir in sorted(p for p in root.iterdir() if p.is_dir()):
    item_no = item_dir.name
    source = item_dir / f"{item_no}_Labels_1_Page.pdf"
    target = item_dir / f"{item_no}_Labels_Print_6_Copies.pdf"
    reader = PdfReader(str(source))
    if len(reader.pages) != 1:
        raise RuntimeError(f"{source} should contain exactly one page")
    writer = PdfWriter()
    for _ in range(6):
        writer.add_page(reader.pages[0])
    with target.open("wb") as handle:
        writer.write(handle)
    print(f"{item_no}: {len(PdfReader(str(target)).pages)} pages")
