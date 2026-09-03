import CoreGraphics

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
}
