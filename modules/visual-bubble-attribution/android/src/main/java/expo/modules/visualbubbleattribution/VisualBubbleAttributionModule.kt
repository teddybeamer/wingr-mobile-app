package expo.modules.visualbubbleattribution

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.SystemClock
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlin.math.max
import kotlin.math.min

class VisualBubbleAttributionModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("VisualBubbleAttribution")
    AsyncFunction("sampleImageRegions") { uriString: String, regions: List<Map<String, Any>> -> Map<String, Any> {
      val totalStart = SystemClock.elapsedRealtimeNanos()
      val context = appContext.reactContext ?: throw IllegalStateException("React context is unavailable.")
      val loadStart = SystemClock.elapsedRealtimeNanos()
      val input = context.contentResolver.openInputStream(Uri.parse(uriString)) ?: throw IllegalArgumentException("Unable to read the local screenshot.")
      val bitmap = input.use { BitmapFactory.decodeStream(it) } ?: throw IllegalArgumentException("Unable to decode screenshot pixels.")
      val loadMilliseconds = elapsedMilliseconds(loadStart)
      val width = bitmap.width
      val height = bitmap.height
      val regionLoopStart = SystemClock.elapsedRealtimeNanos()
      val samples = regions.mapNotNull { region ->
        val id = region["id"] as? String ?: return@mapNotNull null
        val x = (region["x"] as? Number)?.toInt() ?: return@mapNotNull null
        val y = (region["y"] as? Number)?.toInt() ?: return@mapNotNull null
        val radiusValue = (region["radius"] as? Number)?.toInt() ?: return@mapNotNull null
        sampleRegion(bitmap, id, x, y, max(1, radiusValue))
      }
      val regionLoopMilliseconds = elapsedMilliseconds(regionLoopStart)
      val sampleMetadata = regions.mapNotNull { region ->
        val id = region["id"] as? String ?: return@mapNotNull null
        val requestedX = (region["x"] as? Number)?.toInt() ?: return@mapNotNull null
        val requestedY = (region["y"] as? Number)?.toInt() ?: return@mapNotNull null
        val radius = max(1, (region["radius"] as? Number)?.toInt() ?: return@mapNotNull null)

        mapOf(
          "id" to id,
          "requestedNormalizedX" to requestedX.toDouble() / max(width, 1),
          "requestedNormalizedY" to requestedY.toDouble() / max(height, 1),
          "coverage" to sampleCoverage(width, height, requestedX, requestedY, radius),
          "clippedTop" to (requestedY - radius < 0),
          "clippedBottom" to (requestedY + radius >= height),
          "clippedLeft" to (requestedX - radius < 0),
          "clippedRight" to (requestedX + radius >= width),
        )
      }
      val lowerProbeRequestedCount = regions.count {
        (it["id"] as? String)?.contains(":lower:") == true
      }
      val lowerProbeReturnedCount = samples.count {
        (it["id"] as? String)?.contains(":lower:") == true
      }
      val diagnostics = mapOf(
        "timingsMs" to mapOf(
          "load" to loadMilliseconds,
          "regionLoop" to regionLoopMilliseconds,
          "total" to elapsedMilliseconds(totalStart),
        ),
        "image" to mapOf(
          "pixelWidth" to width,
          "pixelHeight" to height,
          "estimatedRgbaBufferBytes" to width.toLong() * height.toLong() * 4L,
        ),
        "regions" to mapOf(
          "requested" to regions.size,
          "valid" to samples.size,
          "invalid" to regions.size - samples.size,
          "returned" to samples.size,
          "lowerProbeRequested" to lowerProbeRequestedCount,
          "lowerProbeReturned" to lowerProbeReturnedCount,
          "clippedTop" to sampleMetadata.count { it["clippedTop"] == true },
          "clippedBottom" to sampleMetadata.count { it["clippedBottom"] == true },
          "clippedLeft" to sampleMetadata.count { it["clippedLeft"] == true },
          "clippedRight" to sampleMetadata.count { it["clippedRight"] == true },
        ),
        "samples" to sampleMetadata,
      )
      bitmap.recycle()
      mapOf(
        "width" to width,
        "height" to height,
        "samples" to samples,
        "diagnostics" to diagnostics,
      )
    }
  }

  private fun elapsedMilliseconds(startedAt: Long): Double =
    (SystemClock.elapsedRealtimeNanos() - startedAt) / 1_000_000.0

  private fun sampleCoverage(
    width: Int,
    height: Int,
    requestedX: Int,
    requestedY: Int,
    radius: Int,
  ): Double {
    val x = requestedX.coerceIn(0, width - 1)
    val y = requestedY.coerceIn(0, height - 1)
    val sampledWidth = min(width - 1, x + radius) - max(0, x - radius) + 1
    val sampledHeight = min(height - 1, y + radius) - max(0, y - radius) + 1
    val requestedDiameter = radius * 2 + 1
    return sampledWidth.toDouble() * sampledHeight.toDouble() /
      (requestedDiameter * requestedDiameter).toDouble()
  }

  private fun sampleRegion(bitmap: Bitmap, id: String, requestedX: Int, requestedY: Int, radius: Int): Map<String, Any> {
    val x = requestedX.coerceIn(0, bitmap.width - 1); val y = requestedY.coerceIn(0, bitmap.height - 1)
    val requestedArea = (radius * 2 + 1) * (radius * 2 + 1)
    var red = 0.0; var green = 0.0; var blue = 0.0; val luminances = mutableListOf<Double>()
    for (sampleY in max(0, y - radius)..min(bitmap.height - 1, y + radius)) for (sampleX in max(0, x - radius)..min(bitmap.width - 1, x + radius)) {
      val pixel = bitmap.getPixel(sampleX, sampleY); val r = android.graphics.Color.red(pixel).toDouble(); val g = android.graphics.Color.green(pixel).toDouble(); val b = android.graphics.Color.blue(pixel).toDouble()
      red += r; green += g; blue += b; luminances.add(r * 0.2126 + g * 0.7152 + b * 0.0722)
    }
    val count = max(luminances.size, 1).toDouble(); val mean = luminances.sum() / count
    return mapOf("id" to id, "red" to red / count, "green" to green / count, "blue" to blue / count, "variance" to luminances.sumOf { (it - mean) * (it - mean) } / count, "coverage" to count / requestedArea)
  }
}
