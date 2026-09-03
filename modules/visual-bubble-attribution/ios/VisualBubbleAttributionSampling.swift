import CoreGraphics

struct VisualBubbleAttributionSampleGeometry {
  let requestedNormalizedX: Double
  let requestedNormalizedY: Double
  let clippedTop: Bool
  let clippedBottom: Bool
  let clippedLeft: Bool
  let clippedRight: Bool
}

enum VisualBubbleAttributionSampling {
  static func makeRGBAContext(for image: CGImage) -> CGContext? {
    let width = image.width
    let height = image.height
    guard let context = CGContext(
      data: nil,
      width: width,
      height: height,
      bitsPerComponent: 8,
      bytesPerRow: width * 4,
      space: CGColorSpaceCreateDeviceRGB(),
      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ) else {
      return nil
    }

    context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
    return context
  }

  static func pixelOffset(
    width: Int,
    sampleX: Int,
    sampleY: Int,
  ) -> Int {
    return (sampleY * width + sampleX) * 4
  }

  static func sampleGeometry(
    width: Int,
    height: Int,
    requestedX: Int,
    requestedY: Int,
    radius: Int,
  ) -> VisualBubbleAttributionSampleGeometry {
    let normalizedWidth = Double(max(width, 1))
    let normalizedHeight = Double(max(height, 1))

    return VisualBubbleAttributionSampleGeometry(
      requestedNormalizedX: Double(requestedX) / normalizedWidth,
      requestedNormalizedY: Double(requestedY) / normalizedHeight,
      clippedTop: requestedY - radius < 0,
      clippedBottom: requestedY + radius >= height,
      clippedLeft: requestedX - radius < 0,
      clippedRight: requestedX + radius >= width,
    )
  }
}
