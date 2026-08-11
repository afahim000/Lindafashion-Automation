import fs from "node:fs/promises";
import path from "node:path";

const files = [
  "C:/Users/ABRAR/.codex/attachments/8bd54cc9-6fd8-4404-81fa-f1d774c9b56e/pasted-text.txt",
  "C:/Users/ABRAR/.codex/attachments/9010b3bb-1e1b-4bf8-bc27-fdca9d517c34/pasted-text.txt",
  "C:/Users/ABRAR/.codex/attachments/f8e15be8-7670-40ef-8794-7281359b907d/pasted-text.txt",
  "C:/Users/ABRAR/.codex/attachments/b7bce9fc-486c-4f81-adf6-ed6fd066c133/pasted-text.txt",
  "C:/Users/ABRAR/.codex/attachments/c2026e19-6995-44cc-981f-593c6c22f90e/pasted-text.txt",
];

function decode(text) {
  return text
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

const matches = [];
for (const [fileIndex, file] of files.entries()) {
  const html = await fs.readFile(file, "utf8");
  const rows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
  for (const rowMatch of rows) {
    const cells = [...rowMatch[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)]
      .map((match) => decode(match[1]));
    if (cells.length < 6 || cells[3] === "ITEM #" || !/[\u3400-\u9FFF]/u.test(cells[5])) continue;
    matches.push({
      source: fileIndex + 1,
      row: cells[0],
      item: cells[3],
      vendor: cells[5],
    });
  }
}

const unique = [...new Map(matches.map((entry) => [`${entry.item}\0${entry.vendor}`, entry])).values()];
console.log(JSON.stringify({
  totalMatches: matches.length,
  uniqueCount: unique.length,
  vendors: [...new Set(unique.map((entry) => entry.vendor))],
  items: unique,
}, null, 2));
