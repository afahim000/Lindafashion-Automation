import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const source = "C:/Users/ABRAR/AppData/Local/Temp/Items UPC.xlsx";
const outDir = "C:/Users/ABRAR/OneDrive/Desktop/Lindafashion-Automation/.codex-preview";
const input = await FileBlob.load(source);
const workbook = await SpreadsheetFile.importXlsx(input);
const sheets = await workbook.inspect({
  kind: "workbook,sheet,table",
  maxChars: 12000,
  tableMaxRows: 30,
  tableMaxCols: 10,
  tableMaxCellChars: 120,
});
console.log(sheets.ndjson);
const firstSheet = workbook.worksheets.getItemAt(0);
const preview = await workbook.render({
  sheetName: firstSheet.name,
  autoCrop: "all",
  scale: 1.5,
  format: "png",
});
await fs.writeFile(`${outDir}/items-upc-preview.png`, new Uint8Array(await preview.arrayBuffer()));
console.log(`PREVIEW=${outDir}/items-upc-preview.png`);
