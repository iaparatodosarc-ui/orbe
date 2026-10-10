package app.orbe.mobile

import android.accessibilityservice.AccessibilityService
import android.app.KeyguardManager
import android.content.Context
import android.os.Bundle
import android.os.PowerManager
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.view.accessibility.AccessibilityWindowInfo

/**
 * Permite que Orbe escriba una respuesta en el cuadro de texto de la app de abajo.
 * - No lee ni hace nada por su cuenta: solo actúa cuando el usuario toca "Autorizar" en una tarjeta de Orbe.
 * - Solo escribe el texto: nunca toca "Enviar".
 * - Se niega si la pantalla está apagada o bloqueada (el usuario tiene que estar ahí).
 */
class OrbeAccess : AccessibilityService() {

    companion object {
        @Volatile var instance: OrbeAccess? = null
        val enabled: Boolean get() = instance != null
    }

    enum class Result { OK, NOT_PRESENT, NO_FIELD, FAILED }

    override fun onServiceConnected() { instance = this }
    override fun onUnbind(intent: android.content.Intent?): Boolean { instance = null; return super.onUnbind(intent) }
    override fun onDestroy() { instance = null; super.onDestroy() }
    override fun onAccessibilityEvent(event: AccessibilityEvent?) {}
    override fun onInterrupt() {}

    private fun userPresent(): Boolean {
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        val km = getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
        return pm.isInteractive && !km.isKeyguardLocked
    }

    /** Escribe [text] en el campo de texto con foco de la app que el usuario está usando (no en Orbe). */
    fun writeInto(text: String): Result {
        if (!userPresent()) return Result.NOT_PRESENT
        val node = findTarget() ?: return Result.NO_FIELD
        val args = Bundle().apply { putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text) }
        val ok = node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
        return if (ok) Result.OK else Result.FAILED
    }

    private fun findTarget(): AccessibilityNodeInfo? {
        val roots = windows
            .filter { it.type == AccessibilityWindowInfo.TYPE_APPLICATION }
            .sortedByDescending { if (it.isActive) 2 else if (it.isFocused) 1 else 0 }
            .mapNotNull { it.root }
            .filter { it.packageName?.toString() != packageName }
        for (root in roots) {
            val f = root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
            if (f != null && f.isEditable) return f
            // sin foco: el cuadro de texto más abajo en pantalla (en los chats, es donde se escribe el mensaje)
            val all = ArrayList<AccessibilityNodeInfo>(); collectEditables(root, all)
            all.maxByOrNull { val r = android.graphics.Rect(); it.getBoundsInScreen(r); r.bottom }?.let { return it }
        }
        return null
    }

    private fun collectEditables(n: AccessibilityNodeInfo, out: MutableList<AccessibilityNodeInfo>, depth: Int = 0) {
        if (depth > 40) return
        if (n.isEditable && n.isVisibleToUser && n.isEnabled) out.add(n)
        for (i in 0 until n.childCount) {
            val c = n.getChild(i) ?: continue
            collectEditables(c, out, depth + 1)
        }
    }
}
