package expo.modules.visualbubbleattribution

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlin.math.max
import kotlin.math.min

class VisualBubbleAttributionModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("VisualBubbleAttribution")
    AsyncFunction("sampleImageRegions") { uriString: String, regions: List<Map<String, Any>> -> Map<String, Any> {
      val context = appContext.reactContext ?: throw IllegalStateException("React context is unavailable.")
      val input = context.contentResolver.openInputStream(Uri.parse(uriString)) ?: throw IllegalArgumentException("Unable to read the local screenshot.")
      val bitmap = input.use { BitmapFactory.decodeStream(it) } ?: throw IllegalArgumentException("Unable to decode screenshot pixels.")
      val samples = regions.mapNotNull { region ->
        val id = region["id"] as? String ?: return@mapNotNull null
        val x = (region["x"] as? Number)?.toInt() ?: return@mapNotNull null
        val y = (region["y"] as? Number)?.toInt() ?: return@mapNotNull null
        val radiusValue = (region["radius"] as? Number)?.toInt() ?: return@mapNotNull null
        sampleRegion(bitmap, id, x, y, max(1, radiusValue))
      }
      val width = bitmap.width; val height = bitmap.height; bitmap.recycle()
      mapOf("width" to width, "height" to height, "samples" to samples)
    }
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
