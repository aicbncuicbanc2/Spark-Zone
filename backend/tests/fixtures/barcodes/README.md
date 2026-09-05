# Barcode fixtures

Photos of product barcodes, for the decode + product-lookup work (Days 8-9).

These are a **separate concern from the expiry date**. Retail barcodes
(EAN-13/UPC) encode only a product identifier. They contain no expiry date, so
these images test a different path:

    barcode photo -> pyzbar decode -> digits -> Open Food Facts -> name/brand

The expiry date always comes from OCR of printed text, in `../labels/`.

## Adding one

1. Save as `<brand>-<product>.jpg` into this folder.
2. Add a row to `manifest.csv`:

   | column | meaning |
   |---|---|
   | `filename` | the image file |
   | `barcode_digits` | the digits printed under the bars, typed by hand |
   | `product_name` | what it actually is |
   | `brand` | manufacturer |
   | `category` | one of the seeded category ids |
   | `notes` | glare, curved, partially obscured, damaged |

`barcode_digits` is the ground truth: it is what the decoder must return. Type it
from the numbers printed beneath the bars.

## Worth capturing

- a curved surface (bottle, tube) - bars distort and often fail to decode
- one with glare from a phone flash
- a small barcode on a medicine box
- one partially creased or damaged

A photo showing **both the barcode and the printed expiry date** is worth twice
as much: it belongs in `../labels/` as well, and it is exactly what a real user
will capture.
