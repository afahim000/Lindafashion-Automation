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
var outputDir = new Folder(projectDir + "/output/ai");
if (!outputDir.exists) {
    outputDir.create();
}

var pageWidth = 612;
var pageHeight = 792;
var artboardGap = 36;
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

var doc = app.documents.add(DocumentColorSpace.CMYK, pageWidth, pageHeight);
doc.artboards[0].name = records[0].itemNo + " - " + records[0].code + " - " + records[0].item;

for (var a = 1; a < records.length; a++) {
    var abLeft = a * (pageWidth + artboardGap);
    doc.artboards.add([abLeft, pageHeight, abLeft + pageWidth, 0]);
    doc.artboards[a].name = records[a].itemNo + " - " + records[a].code + " - " + records[a].item;
}

var contentLayer = doc.layers.add();
contentLayer.name = "Label Artwork - Arial";

var guideLayer = doc.layers.add();
guideLayer.name = "Locked Label Bounds - Nonprinting";
guideLayer.printable = false;

for (var s = 0; s < records.length; s++) {
    var artRect = doc.artboards[s].artboardRect;
    var artLeft = artRect[0];
    var artTop = artRect[1];

    for (var row = 0; row < 10; row++) {
        for (var col = 0; col < 5; col++) {
            var labelLeft = artLeft + gridLeft + col * colPitch;
            var labelTop = artTop - gridTopInset - row * labelHeight;

            var boundary = guideLayer.pathItems.roundedRectangle(
                labelTop,
                labelLeft,
                labelWidth,
                labelHeight,
                6.75,
                6.75
            );
            boundary.stroked = false;
            boundary.filled = false;
            boundary.locked = true;

            addLabel(contentLayer, records[s], labelLeft, labelTop);
        }
    }
}

guideLayer.visible = false;
guideLayer.locked = true;
contentLayer.locked = false;

var aiOptions = new IllustratorSaveOptions();
aiOptions.pdfCompatible = true;
aiOptions.compressed = true;
aiOptions.embedICCProfile = true;
aiOptions.saveMultipleArtboards = false;

var aiFile = new File(outputDir.fsName + "/OL1000_All_14_Item_Pages.ai");
doc.saveAs(aiFile, aiOptions);

var pdfOptions = new PDFSaveOptions();
pdfOptions.preserveEditability = true;
pdfOptions.generateThumbnails = true;
pdfOptions.artboardRange = "1-" + records.length;
pdfOptions.viewAfterSaving = false;

var pdfFile = new File(outputDir.fsName + "/OL1000_All_14_Item_Pages.pdf");
doc.saveAs(pdfFile, pdfOptions);

doc.close(SaveOptions.DONOTSAVECHANGES);
