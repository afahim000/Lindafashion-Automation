#target illustrator

app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;

var records = [
    { itemNo: "JW6893007", code: "T10118", item: "Claw Clips", upc: "810140750587", price: "3.99" },
    { itemNo: "JW6893008", code: "T10118", item: "Claw Clips", upc: "810140750587", price: "3.99" },
    { itemNo: "JW6893009", code: "T10118", item: "Claw Clips", upc: "810140750587", price: "3.99" },
    { itemNo: "JW6893013", code: "T10118", item: "Claw Clips", upc: "810140750587", price: "3.99" },
    { itemNo: "PT6875001", code: "T10104", item: "Black ponytail holders", upc: "810140750389", price: "3.99" },
    { itemNo: "HB5795096", code: "T10119", item: "Headband", upc: "810140750594", price: "3.99" },
    { itemNo: "HB5795108", code: "T10119", item: "Headband", upc: "810140750594", price: "3.99" },
    { itemNo: "HB6095070", code: "T10119", item: "Headband", upc: "810140750594", price: "3.99" },
    { itemNo: "HWP5777003", code: "T10120", item: "Headwrap", upc: "810140750600", price: "3.99" },
    { itemNo: "JW5693038", code: "T10118", item: "Claw Clip", upc: "810140750587", price: "3.99" },
    { itemNo: "JW5693045", code: "T10118", item: "Claw Clip", upc: "810140750587", price: "3.99" },
    { itemNo: "PT6075019", code: "T10121", item: "Ponytail Holder", upc: "810140750617", price: "3.99" },
    { itemNo: "PT6075087R", code: "T10121", item: "Ponytail Holder", upc: "810140750617", price: "3.99" },
    { itemNo: "PT6075089", code: "T10121", item: "Ponytail Holder", upc: "810140750617", price: "3.99" }
];

var projectDir = "C:/Users/ABRAR/OneDrive/Desktop/Lindafashion-Automation";
var barcodeDir = projectDir + "/output/ai/barcodes";
var outputRoot = new Folder(projectDir + "/output/ai/items");
if (!outputRoot.exists) outputRoot.create();

var progressFile = new File(projectDir + "/output/ai/build-progress.txt");
progressFile.open("w");
progressFile.writeln("Starting 14 separate Item # files");
progressFile.close();

var pageWidth = 612;
var pageHeight = 792;
var labelWidth = 108;
var labelHeight = 72;
var gridLeft = 18;
var gridTopInset = 36;
var colPitch = 117;
var barcodeWidth = 86.4705859;
var barcodeHeight = 38.2613212;
var barcodeTopInset = 6.35;
var codeBaselineInset = 53.5;
var itemBaselineInset = 64.5;
var lineGap = 4;

function appendProgress(text) {
    progressFile.open("a");
    progressFile.writeln(text);
    progressFile.close();
}

function getArial() {
    try {
        return app.textFonts.getByName("ArialMT");
    } catch (e1) {
        try {
            return app.textFonts.getByName("Arial");
        } catch (e2) {
            return app.textFonts[0];
        }
    }
}

var arial = getArial();
var black = new CMYKColor();
black.cyan = 0;
black.magenta = 0;
black.yellow = 0;
black.black = 100;

function styleText(frame, size) {
    frame.textRange.characterAttributes.textFont = arial;
    frame.textRange.characterAttributes.size = size;
    frame.textRange.characterAttributes.fillColor = black;
    frame.textRange.paragraphAttributes.justification = Justification.LEFT;
}

function addPointText(layer, contents, size, left, baseline) {
    var frame = layer.textFrames.pointText([left, baseline]);
    frame.contents = contents;
    styleText(frame, size);
    return frame;
}

function addLabel(layer, record, labelLeft, labelTop) {
    var barcode = layer.placedItems.add();
    barcode.file = new File(barcodeDir + "/" + record.upc + ".gif");
    barcode.width = barcodeWidth;
    barcode.height = barcodeHeight;
    barcode.left = labelLeft + (labelWidth - barcodeWidth) / 2;
    barcode.top = labelTop - barcodeTopInset;
    barcode.embed();

    var codeFrame = addPointText(layer, record.code, 8, 0, labelTop - codeBaselineInset);
    var itemSize = 8;
    var itemFrame = addPointText(layer, record.item, itemSize, 0, labelTop - itemBaselineInset);
    var priceFrame = addPointText(layer, "$ " + record.price, 11, 0, labelTop - itemBaselineInset);

    var usableWidth = labelWidth - 10;
    while ((itemFrame.width + lineGap + priceFrame.width) > usableWidth && itemSize > 5) {
        itemSize -= 0.25;
        itemFrame.textRange.characterAttributes.size = itemSize;
    }

    var secondLineWidth = itemFrame.width + lineGap + priceFrame.width;
    var blockWidth = Math.max(codeFrame.width, secondLineWidth);
    var blockLeft = labelLeft + (labelWidth - blockWidth) / 2;
    codeFrame.left = blockLeft;
    itemFrame.left = blockLeft;
    priceFrame.left = blockLeft + itemFrame.width + lineGap;
}

for (var r = 0; r < records.length; r++) {
    var record = records[r];
    var itemFolder = new Folder(outputRoot.fsName + "/" + record.itemNo);
    if (!itemFolder.exists) itemFolder.create();

    var doc = app.documents.add(DocumentColorSpace.CMYK, pageWidth, pageHeight);
    doc.artboards[0].name = record.itemNo + " - " + record.code + " - " + record.item;

    var contentLayer = doc.layers.add();
    contentLayer.name = "Label Artwork - Arial";
    var guideLayer = doc.layers.add();
    guideLayer.name = "Locked Label Bounds - Nonprinting";
    guideLayer.printable = false;

    for (var row = 0; row < 10; row++) {
        for (var col = 0; col < 5; col++) {
            var labelLeft = gridLeft + col * colPitch;
            var labelTop = pageHeight - gridTopInset - row * labelHeight;
            var boundary = guideLayer.pathItems.roundedRectangle(
                labelTop, labelLeft, labelWidth, labelHeight, 6.75, 6.75
            );
            boundary.stroked = false;
            boundary.filled = false;
            boundary.locked = true;
            addLabel(contentLayer, record, labelLeft, labelTop);
        }
    }

    guideLayer.visible = false;
    guideLayer.locked = true;

    var aiOptions = new IllustratorSaveOptions();
    aiOptions.pdfCompatible = true;
    aiOptions.compressed = true;
    aiOptions.embedICCProfile = true;
    doc.saveAs(new File(itemFolder.fsName + "/" + record.itemNo + "_Labels.ai"), aiOptions);

    var pdfOptions = new PDFSaveOptions();
    pdfOptions.preserveEditability = true;
    pdfOptions.generateThumbnails = true;
    pdfOptions.viewAfterSaving = false;
    doc.saveAs(new File(itemFolder.fsName + "/" + record.itemNo + "_Labels_1_Page.pdf"), pdfOptions);

    doc.close(SaveOptions.DONOTSAVECHANGES);
    appendProgress((r + 1) + "/14 complete: " + record.itemNo);
}

appendProgress("DONE");
