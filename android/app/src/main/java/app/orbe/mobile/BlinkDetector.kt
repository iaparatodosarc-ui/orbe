package app.orbe.mobile

/**
 * Distingue un parpadeo voluntario de los parpadeos normales (unos 15 por minuto).
 * Recibe, cuadro a cuadro, qué tan cerrado está cada ojo (0 = abierto, 1 = cerrado).
 *
 * Gestos:
 *  - LARGO: cerrar ambos ojos entre 0,4 y 1,8 segundos y abrirlos.
 *  - DOBLE: dos parpadeos rápidos seguidos (en menos de 0,7 s).
 *
 * Se adapta a cada persona: aprende cómo se ven sus ojos abiertos y ajusta los umbrales.
 */
class BlinkDetector(var mode: Mode = Mode.LARGO, private val onGesture: () -> Unit) {

    enum class Mode { LARGO, DOBLE }

    private var baseline = 0.15f        // nivel típico con los ojos abiertos (se aprende)
    private var closed = false
    private var closedAt = 0L
    private var lastShortBlinkEnd = -10_000L
    private var cooldownUntil = 0L

    private val closeThreshold get() = (baseline + 0.35f).coerceIn(0.45f, 0.75f)
    private val openThreshold get() = closeThreshold - 0.2f

    fun reset() {
        closed = false
        lastShortBlinkEnd = -10_000L
    }

    /** [left] y [right]: puntaje de ojo cerrado de 0 a 1. [t]: tiempo en milisegundos. */
    fun update(left: Float, right: Float, t: Long) {
        val both = minOf(left, right)       // los dos ojos tienen que cerrarse (un guiño no cuenta)
        val avg = (left + right) / 2f

        if (!closed && avg < 0.4f) baseline = baseline * 0.98f + avg * 0.02f

        if (!closed) {
            if (both > closeThreshold - 0.1f && avg > closeThreshold) {
                closed = true
                closedAt = t
            }
            return
        }

        if (maxOf(left, right) < openThreshold) {
            closed = false
            val dur = t - closedAt
            if (t < cooldownUntil) return
            when (mode) {
                Mode.LARGO -> if (dur in 400..1800) fire(t)
                Mode.DOBLE -> if (dur in 40..350) {
                    if (closedAt - lastShortBlinkEnd in 0..700) {
                        lastShortBlinkEnd = -10_000L
                        fire(t)
                    } else {
                        lastShortBlinkEnd = t
                    }
                }
            }
        }
    }

    private fun fire(t: Long) {
        cooldownUntil = t + 900
        onGesture()
    }
}
