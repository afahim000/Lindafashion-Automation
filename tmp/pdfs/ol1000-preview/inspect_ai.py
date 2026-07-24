import json
import pdfplumber

path = r"C:\Users\ABRAR\OneDrive\Desktop\Lindafashion-Automation\OL1000.ai"
with pdfplumber.open(path) as pdf:
    page = pdf.pages[0]
    char_summary = []
    seen = set()
    for ch in page.chars:
        key = (ch.get("fontname"), ch.get("size"))
        if key not in seen:
            seen.add(key)
            char_summary.append({
                "fontname": ch.get("fontname"),
                "size": ch.get("size"),
                "sample": ch.get("text"),
            })
    print(json.dumps({
        "width": page.width,
        "height": page.height,
        "rects_count": len(page.rects),
        "curves_count": len(page.curves),
        "lines_count": len(page.lines),
        "images_count": len(page.images),
        "images": page.images[:12],
        "fonts": char_summary,
        "text": page.extract_text(),
        "words": page.extract_words()[:40],
    }, default=str, indent=2))
