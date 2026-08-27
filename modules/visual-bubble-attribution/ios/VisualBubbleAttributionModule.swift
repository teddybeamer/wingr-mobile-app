import ExpoModulesCore
import UIKit

public final class VisualBubbleAttributionModule: Module {
  public func definition() -> ModuleDefinition {
    Name("VisualBubbleAttribution")

    AsyncFunction("sampleImageRegions") { (uri: String, regions: [[String: Any]]) throws -> [String: Any] in
      guard let url = URL(string: uri), let image = UIImage(contentsOfFile: url.path), let cgImage = image.cgImage else {
        throw NSError(domain: "VisualBubbleAttribution", code: 1, userInfo: [NSLocalizedDescriptionKey: "Unable to read the local screenshot."])
      }

      let width = cgImage.width
      let height = cgImage.height
      guard let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
        throw NSError(domain: "VisualBubbleAttribution", code: 2, userInfo: [NSLocalizedDescriptionKey: "Unable to decode screenshot pixels."])
      }
      context.draw(cgImage, in: CGRect(x: 0, y: 0, width: width, height: height))
      guard let data = context.data else {
        throw NSError(domain: "VisualBubbleAttribution", code: 3, userInfo: [NSLocalizedDescriptionKey: "Unable to access screenshot pixels."])
      }

      let pixels = data.bindMemory(to: UInt8.self, capacity: width * height * 4)
      let samples: [[String: Any]] = regions.compactMap { region in
        guard let id = region["id"] as? String, let xValue = region["x"] as? NSNumber, let yValue = region["y"] as? NSNumber, let radiusValue = region["radius"] as? NSNumber else { return nil }
        let x = max(0, min(width - 1, xValue.intValue))
        let y = max(0, min(height - 1, yValue.intValue))
        let radius = max(1, radiusValue.intValue)
        var red = 0.0; var green = 0.0; var blue = 0.0; var luminances: [Double] = []
        for sampleY in max(0, y - radius)...min(height - 1, y + radius) {
          for sampleX in max(0, x - radius)...min(width - 1, x + radius) {
            let offset = (sampleY * width + sampleX) * 4
            let r = Double(pixels[offset]); let g = Double(pixels[offset + 1]); let b = Double(pixels[offset + 2])
            red += r; green += g; blue += b; luminances.append(r * 0.2126 + g * 0.7152 + b * 0.0722)
          }
        }
        let count = Double(max(luminances.count, 1)); let mean = luminances.reduce(0, +) / count
        let variance = luminances.reduce(0) { $0 + pow($1 - mean, 2) } / count
        return ["id": id, "red": red / count, "green": green / count, "blue": blue / count, "variance": variance]
      }
      return ["width": width, "height": height, "samples": samples]
    }
  }
}
