import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const inputDir = path.resolve("csv_conversion_inputs");
const outputDir = path.resolve("csv_files");
const previewDir = path.resolve("csv_verification_previews");
await fs.mkdir(outputDir, { recursive: true });
await fs.mkdir(previewDir, { recursive: true });

const jobs = [
  {
    source: "26112R B2-3622 发尚秀 HB SC.converted.xlsx",
    output: "26112R B2-3622 发尚秀 HB SC.csv",
  },
  {
    source: "26072 D2-5212  EAR.xlsx",
    output: "26072 D2-5212  EAR.csv",
  },
  {
    source: "26093 D2-5212 NK EAR.xlsx",
    output: "26093 D2-5212 NK EAR.csv",
  },
];

function csvCell(value) {
  if (value === null || value === undefined) return "";
  const text = value instanceof Date ? value.toISOString() : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

for (const job of jobs) {
  const workbook = await SpreadsheetFile.importXlsx(
    await FileBlob.load(path.join(inputDir, job.source)),
  );
  const sheetSummary = await workbook.inspect({
    kind: "sheet",
    include: "id,name",
    maxChars: 3000,
  });
  const sheetRecords = sheetSummary.ndjson
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  for (let index = 0; index < sheetRecords.length; index += 1) {
    const sheetName = sheetRecords[index].name;
    const preview = await workbook.render({
      sheetName,
      autoCrop: "all",
      scale: 1,
      format: "png",
    });
    await fs.writeFile(
      path.join(previewDir, `${path.parse(job.output).name}-sheet-${index + 1}.png`),
      new Uint8Array(await preview.arrayBuffer()),
    );
  }

  const firstSheet = workbook.worksheets.getItemAt(0);
  const usedRange = firstSheet.getUsedRange(true);
  const values = usedRange.values;
  const csvText = values.map((row) => row.map(csvCell).join(",")).join("\r\n");
  const outputPath = path.join(outputDir, job.output);
  await fs.writeFile(outputPath, `\uFEFF${csvText}\r\n`, "utf8");

  const checkWorkbook = await Workbook.fromCSV(csvText, { sheetName: "CSV" });
  const check = await checkWorkbook.inspect({
    kind: "region",
    sheetId: "CSV",
    maxChars: 1600,
    tableMaxRows: 4,
    tableMaxCols: 12,
  });
  console.log(JSON.stringify({
    output: outputPath,
    sourceSheet: firstSheet.name,
    rows: values.length,
    columns: Math.max(...values.map((row) => row.length)),
    verified: check.ndjson.length > 0,
  }));
}
