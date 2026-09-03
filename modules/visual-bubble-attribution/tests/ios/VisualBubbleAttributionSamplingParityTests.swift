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

    let topLeftGeometry = VisualBubbleAttributionSampling.sampleGeometry(
      width: 100,
      height: 200,
      requestedX: 3,
      requestedY: 4,
      radius: 7,
    )
    precondition(topLeftGeometry.clippedTop, "The top edge must be reported as clipped.")
    precondition(topLeftGeometry.clippedLeft, "The left edge must be reported as clipped.")
    precondition(!topLeftGeometry.clippedBottom, "The bottom edge must remain unclipped.")
    precondition(!topLeftGeometry.clippedRight, "The right edge must remain unclipped.")
    precondition(topLeftGeometry.requestedNormalizedX == 0.03)
    precondition(topLeftGeometry.requestedNormalizedY == 0.02)

    let bottomRightGeometry = VisualBubbleAttributionSampling.sampleGeometry(
      width: 100,
      height: 200,
      requestedX: 96,
      requestedY: 195,
      radius: 7,
    )
    precondition(!bottomRightGeometry.clippedTop, "The top edge must remain unclipped.")
    precondition(!bottomRightGeometry.clippedLeft, "The left edge must remain unclipped.")
    precondition(bottomRightGeometry.clippedBottom, "The bottom edge must be reported as clipped.")
    precondition(bottomRightGeometry.clippedRight, "The right edge must be reported as clipped.")
    precondition(bottomRightGeometry.requestedNormalizedX == 0.96)
    precondition(bottomRightGeometry.requestedNormalizedY == 0.975)

    let centeredGeometry = VisualBubbleAttributionSampling.sampleGeometry(
      width: 100,
      height: 200,
      requestedX: 50,
      requestedY: 100,
      radius: 7,
    )
    precondition(!centeredGeometry.clippedTop)
    precondition(!centeredGeometry.clippedBottom)
    precondition(!centeredGeometry.clippedLeft)
    precondition(!centeredGeometry.clippedRight)
  }
}
