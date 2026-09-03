import Foundation
import ImageIO

@main
struct VisualBubbleAttributionSamplingParityTests {
  static func main() {
    // This decoded PNG is visibly red on top and blue on the bottom. Exercising
    // the production draw helper catches both CGContext and offset regressions.
    let pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAACCAYAAACZgbYnAAAAAXNSR0IArs4c6QAAADhlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAAqACAAQAAAABAAAAAaADAAQAAAABAAAAAgAAAACdSsUUAAAAEUlEQVQIHWP4z8AARAz//wMAEfgD/eMjnF4AAAAASUVORK5CYII="
    guard
      let pngData = Data(base64Encoded: pngBase64),
      let source = CGImageSourceCreateWithData(pngData as CFData, nil),
      let image = CGImageSourceCreateImageAtIndex(source, 0, nil),
      let context = VisualBubbleAttributionSampling.makeRGBAContext(for: image),
      let data = context.data
    else {
      preconditionFailure("Unable to create the asymmetric image sampling fixture.")
    }

    let width = image.width
    let height = image.height
    let pixels = data.bindMemory(to: UInt8.self, capacity: width * height * 4)

    let topOffset = VisualBubbleAttributionSampling.pixelOffset(
      width: width,
      sampleX: width / 2,
      sampleY: height / 4,
    )
    let bottomOffset = VisualBubbleAttributionSampling.pixelOffset(
      width: width,
      sampleX: width / 2,
      sampleY: height * 3 / 4,
    )

    precondition(
      Array(UnsafeBufferPointer(start: pixels + topOffset, count: 3)) == [255, 0, 0],
      "Top-origin OCR sampling must read the red top row.",
    )
    precondition(
      Array(UnsafeBufferPointer(start: pixels + bottomOffset, count: 3)) == [0, 0, 255],
      "Top-origin OCR sampling must read the blue bottom row.",
    )
  }
}
