package app.orbe.mobile

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.app.KeyguardManager
import android.content.Context
import android.graphics.Path
import android.os.PowerManager
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityWindowInfo

/**
 * Permiso opcional "Orbe · parpadeo".
 * - Solo consulta el NOMBRE de la app que está en primer plano (para encender la cámara
 *   únicamente en Instagram, Facebook, TikTok o YouTube). No lee textos ni contenido.
 * - Solo hace un gesto: deslizar hacia arriba para pasar al siguiente reel,
 *   cuando detecta tu parpadeo y el teléfono está desbloqueado.
 */
class BlinkAccess : AccessibilityService() {

    companion object {
        @Volatile var instance: BlinkAccess? = null
        val enabled: Boolean get() = instance != null
    }

    override fun onServiceConnected() { instance = this }
    override fun onUnbind(intent: android.content.Intent?): Boolean { instance = null; return super.onUnbind(intent) }
    override fun onDestroy() { instance = null; super.onDestroy() }
    override fun onAccessibilityEvent(event: AccessibilityEvent?) {}
    override fun onInterrupt() {}

    fun userPresent(): Boolean {
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        val km = getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
        return pm.isInteractive && !km.isKeyguardLocked
    }

    /** Nombre del paquete de la app que el usuario tiene abierta (null si no se sabe). */
    fun foregroundPackage(): String? = try {
        windows
            .filter { it.type == AccessibilityWindowInfo.TYPE_APPLICATION }
            .sortedByDescending { if (it.isActive) 2 else if (it.isFocused) 1 else 0 }
            .firstNotNullOfOrNull { w -> w.root?.packageName?.toString()?.takeIf { it != packageName } }
    } catch (_: Exception) { null }

    /** Desliza hacia arriba en el centro de la pantalla: siguiente reel. */
    fun nextReel(): Boolean {
        if (!userPresent()) return false
        val dm = resources.displayMetrics
        val x = dm.widthPixels / 2f
        val path = Path().apply {
            moveTo(x, dm.heightPixels * 0.72f)
            lineTo(x, dm.heightPixels * 0.26f)
        }
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, 230))
            .build()
        return dispatchGesture(gesture, null, null)
    }
}
