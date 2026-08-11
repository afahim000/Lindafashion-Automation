import fs from "node:fs/promises";
import path from "node:path";
import { Workbook } from "@oai/artifact-tool";

const sourceDir = path.resolve("backend", "ediUpload");
const outputDir = path.resolve("csv_files");
await fs.mkdir(outputDir, { recursive: true });

const jobs = [
  {
    source: "发尚秀饰品 2026-06-12 2026-07-10 26112R.csv",
    chineseVendor: "发尚秀饰品",
    englishVendor: "Yin Xinling",
    output: "Yin Xinling 2026-06-12 2026-07-10 26112R.csv",
  },
  {
    source: "春天饰品 2026-05-11 2026-06-30 26072.csv",
    chineseVendor: "春天饰品",
    englishVendor: "Li Chunde",
    output: "Li Chunde 2026-05-11 2026-06-30 26072.csv",
  },
  {
    source: "春天饰品 2026-05-15 2026-06-25 26093.csv",
    chineseVendor: "春天饰品",
    englishVendor: "Li Chunde",
    output: "Li Chunde 2026-05-15 2026-06-25 26093.csv",
  },
];

for (const job of jobs) {
  const sourceText = await fs.readFile(path.join(sourceDir, job.source), "utf8");
  const csvText = sourceText.replaceAll(job.chineseVendor, job.englishVendor);
  const workbook = await Workbook.fromCSV(csvText, { sheetName: "EDI" });
  const check = await workbook.inspect({
    kind: "region",
    sheetId: "EDI",
    maxChars: 1800,
    tableMaxRows: 3,
    tableMaxCols: 28,
  });
  if (!check.ndjson.includes(job.englishVendor) || check.ndjson.includes(job.chineseVendor)) {
    throw new Error(`Vendor verification failed for ${job.output}`);
  }
  const outputPath = path.join(outputDir, job.output);
  await fs.writeFile(outputPath, `\uFEFF${csvText}`, "utf8");
  console.log(JSON.stringify({ outputPath, vendor: job.englishVendor }));
}
