import fs from "node:fs/promises";
import path from "node:path";
import { Workbook } from "@oai/artifact-tool";

const source = path.resolve(
  "single_edi_output",
  "梦娜饰品 2026-07-25 2026-08-11 S00181.csv",
);
const outputDir = path.resolve("csv_files");
const output = path.join(
  outputDir,
  "Meng Na 2026-07-25 2026-08-11 S00181.csv",
);

const lines = (await fs.readFile(source, "utf8"))
  .split(/\r?\n/)
  .filter(Boolean);
const header = lines[0];
const firstItem = lines[1].replaceAll("梦娜饰品", "Meng Na");
const csvText = `${header}\n${firstItem}\n`;

const workbook = await Workbook.fromCSV(csvText, { sheetName: "EDI" });
const check = await workbook.inspect({
  kind: "region",
  sheetId: "EDI",
  maxChars: 2500,
  tableMaxRows: 4,
  tableMaxCols: 28,
});
if (!check.ndjson.includes("Meng Na") || !check.ndjson.includes("T10122")) {
  throw new Error("S00181 CSV verification failed");
}

await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(output, `\uFEFF${csvText}`, "utf8");
console.log(output);
