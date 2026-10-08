package app.orbe.mobile

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.DashPathEffect
import android.graphics.Paint
import android.graphics.RadialGradient
import android.graphics.RectF
import android.graphics.Shader
import android.view.View

/** El orbe: una esfera oscura con un ojo que parpadea y un anillo que cambia según el estado. */
class OrbView(ctx: Context) : View(ctx) {
    enum class State { IDLE, THINKING, SPEAKING }

    var state: State = State.IDLE
        set(v) { field = v; invalidate() }

    private val orange = Color.parseColor("#FF5A1F")
    private val body = Paint(Paint.ANTI_ALIAS_FLAG)
    private val ring = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE }
    private val white = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.parseColor("#F4F2EC") }
    private val pupil = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.parseColor("#111111") }
    private val iris = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = orange; style = Paint.Style.STROKE }
    private val shine = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE }
    private var blink = 1f
    private var angle = 0f
    private val oval = RectF()

    private val blinker = object : Runnable {
        override fun run() {
            blink = 0.12f; invalidate()
            postDelayed({ blink = 1f; invalidate() }, 130)
            postDelayed(this, 3800L + (Math.random() * 1800).toLong())
        }
    }
    private val spinner = object : Runnable {
        override fun run() {
            if (state != State.IDLE) { angle = (angle + 12f) % 360f; invalidate() }
            postDelayed(this, 33)
        }
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        postDelayed(blinker, 2500); post(spinner)
    }

    override fun onDetachedFromWindow() {
        removeCallbacks(blinker); removeCallbacks(spinner)
        super.onDetachedFromWindow()
    }

    override fun onDraw(c: Canvas) {
        val w = width.toFloat(); val h = height.toFloat()
        val cx = w / 2; val cy = h / 2; val r = minOf(w, h) / 2 - w * 0.08f
        body.shader = RadialGradient(cx - r * 0.3f, cy - r * 0.4f, r * 1.4f,
            intArrayOf(Color.parseColor("#3A3A40"), Color.parseColor("#16161A"), Color.parseColor("#050506")),
            floatArrayOf(0f, 0.55f, 1f), Shader.TileMode.CLAMP)
        c.drawCircle(cx, cy, r, body)

        ring.strokeWidth = w * 0.045f
        oval.set(cx - r - w * 0.04f, cy - r - w * 0.04f, cx + r + w * 0.04f, cy + r + w * 0.04f)
        when (state) {
            State.IDLE -> {
                ring.color = orange; ring.pathEffect = null; ring.alpha = 255
                c.drawOval(oval, ring)
            }
            State.THINKING -> {
                ring.color = Color.parseColor("#55555C"); ring.pathEffect = DashPathEffect(floatArrayOf(10f, 10f), 0f)
                c.drawOval(oval, ring)
                ring.color = orange; ring.pathEffect = null
                c.drawArc(oval, angle, 90f, false, ring)
            }
            State.SPEAKING -> {
                ring.color = orange; ring.pathEffect = null
                ring.alpha = (150 + 105 * Math.sin(Math.toRadians(angle.toDouble() * 2))).toInt().coerceIn(60, 255)
                c.drawOval(oval, ring); ring.alpha = 255
            }
        }
        // ojo
        val ew = r * 0.95f; val eh = r * 0.62f * blink
        oval.set(cx - ew / 2, cy - eh / 2, cx + ew / 2, cy + eh / 2)
        c.drawOval(oval, white)
        if (blink > 0.5f) {
            val pr = r * 0.2f
            c.drawCircle(cx, cy, pr, pupil)
            iris.strokeWidth = pr * 0.35f
            c.drawCircle(cx, cy, pr, iris)
            c.drawCircle(cx - pr * 0.35f, cy - pr * 0.35f, pr * 0.25f, shine)
        }
    }
}
