import ExpoModulesCore
import Foundation
import UIKit

public final class VisualBubbleAttributionModule: Module {
  public func definition() -> ModuleDefinition {
    Name("VisualBubbleAttribution")

    AsyncFunction("sampleImageRegions") { (uri: String, regions: [[String: Any]]) throws -> [String: Any] in
      let totalStart = ProcessInfo.processInfo.systemUptime
      let loadStart = ProcessInfo.processInfo.systemUptime
      guard let url = URL(string: uri), let image = UIImage(contentsOfFile: url.path), let cgImage = image.cgImage else {
        throw NSError(domain: "VisualBubbleAttribution", code: 1, userInfo: [NSLocalizedDescriptionKey: "Unable to read the local screenshot."])
      }
      let loadMilliseconds = (ProcessInfo.processInfo.systemUptime - loadStart) * 1_000

      let width = cgImage.width
      let height = cgImage.height
      let contextDrawStart = ProcessInfo.processInfo.systemUptime
      guard let context = VisualBubbleAttributionSampling.makeRGBAContext(for: cgImage) else {
        throw NSError(domain: "VisualBubbleAttribution", code: 2, userInfo: [NSLocalizedDescriptionKey: "Unable to decode screenshot pixels."])
      }
      let contextDrawMilliseconds = (ProcessInfo.processInfo.systemUptime - contextDrawStart) * 1_000
      guard let data = context.data else {
        throw NSError(domain: "VisualBubbleAttribution", code: 3, userInfo: [NSLocalizedDescriptionKey: "Unable to access screenshot pixels."])
      }

      let pixels = data.bindMemory(to: UInt8.self, capacity: width * height * 4)
      var sampleMetadata: [[String: Any]] = []
      var clippedTopCount = 0
      var clippedBottomCount = 0
      var clippedLeftCount = 0
      var clippedRightCount = 0
      let regionLoopStart = ProcessInfo.processInfo.systemUptime
      let samples: [[String: Any]] = regions.compactMap { region in
        guard let id = region["id"] as? String, let xValue = region["x"] as? NSNumber, let yValue = region["y"] as? NSNumber, let radiusValue = region["radius"] as? NSNumber else { return nil }
        let requestedX = xValue.intValue
        let requestedY = yValue.intValue
        let x = max(0, min(width - 1, requestedX))
        let y = max(0, min(height - 1, requestedY))
        let radius = max(1, radiusValue.intValue)
        let sampleDiameter: Int = radius * 2 + 1
        let sampleArea: Int = sampleDiameter * sampleDiameter
        let requestedArea = Double(sampleArea)
        var red = 0.0; var green = 0.0; var blue = 0.0; var luminances: [Double] = []
        for sampleY in max(0, y - radius)...min(height - 1, y + radius) {
          for sampleX in max(0, x - radius)...min(width - 1, x + radius) {
            let offset = VisualBubbleAttributionSampling.pixelOffset(
              width: width,
              sampleX: sampleX,
              sampleY: sampleY,
            )
            let r = Double(pixels[offset]); let g = Double(pixels[offset + 1]); let b = Double(pixels[offset + 2])
            red += r; green += g; blue += b; luminances.append(r * 0.2126 + g * 0.7152 + b * 0.0722)
          }
        }
        let count = Double(max(luminances.count, 1)); let mean = luminances.reduce(0, +) / count
        let variance = luminances.reduce(0) { $0 + pow($1 - mean, 2) } / count
        let coverage = count / requestedArea
        let geometry = VisualBubbleAttributionSampling.sampleGeometry(
          width: width,
          height: height,
          requestedX: requestedX,
          requestedY: requestedY,
          radius: radius,
        )

        if geometry.clippedTop { clippedTopCount += 1 }
        if geometry.clippedBottom { clippedBottomCount += 1 }
        if geometry.clippedLeft { clippedLeftCount += 1 }
        if geometry.clippedRight { clippedRightCount += 1 }
        sampleMetadata.append([
          "id": id,
          "requestedNormalizedX": geometry.requestedNormalizedX,
          "requestedNormalizedY": geometry.requestedNormalizedY,
          "coverage": coverage,
          "clippedTop": geometry.clippedTop,
          "clippedBottom": geometry.clippedBottom,
          "clippedLeft": geometry.clippedLeft,
          "clippedRight": geometry.clippedRight,
        ])

        return ["id": id, "red": red / count, "green": green / count, "blue": blue / count, "variance": variance, "coverage": coverage]
      }
      let regionLoopMilliseconds = (ProcessInfo.processInfo.systemUptime - regionLoopStart) * 1_000
      let lowerProbeRequestedCount = regions.reduce(into: 0) { count, region in
        if let id = region["id"] as? String, id.contains(":lower:") {
          count += 1
        }
      }
      let lowerProbeReturnedCount = samples.reduce(into: 0) { count, sample in
        if let id = sample["id"] as? String, id.contains(":lower:") {
          count += 1
        }
      }
      let validRegionCount = samples.count
      let invalidRegionCount = regions.count - validRegionCount
      let estimatedRgbaBufferBytes = Int64(width) * Int64(height) * 4
      let totalMilliseconds = (ProcessInfo.processInfo.systemUptime - totalStart) * 1_000
      let timingDiagnostics: [String: Double] = [
        "load": loadMilliseconds,
        "contextDraw": contextDrawMilliseconds,
        "regionLoop": regionLoopMilliseconds,
        "total": totalMilliseconds,
      ]
      let imageDiagnostics: [String: Any] = [
        "pixelWidth": width,
        "pixelHeight": height,
        "logicalWidth": Double(image.size.width),
        "logicalHeight": Double(image.size.height),
        "scale": Double(image.scale),
        "orientation": String(describing: image.imageOrientation),
        "orientationRawValue": image.imageOrientation.rawValue,
        "orientationNormalized": image.imageOrientation == .up,
        "estimatedRgbaBufferBytes": estimatedRgbaBufferBytes,
      ]
      let regionDiagnostics: [String: Int] = [
        "requested": regions.count,
        "valid": validRegionCount,
        "invalid": invalidRegionCount,
        "returned": samples.count,
        "lowerProbeRequested": lowerProbeRequestedCount,
        "lowerProbeReturned": lowerProbeReturnedCount,
        "clippedTop": clippedTopCount,
        "clippedBottom": clippedBottomCount,
        "clippedLeft": clippedLeftCount,
        "clippedRight": clippedRightCount,
      ]
      let diagnostics: [String: Any] = [
        "timingsMs": timingDiagnostics,
        "image": imageDiagnostics,
        "regions": regionDiagnostics,
        "samples": sampleMetadata,
      ]

      return [
        "width": width,
        "height": height,
        "samples": samples,
        "diagnostics": diagnostics,
      ]
    }
  }
}
