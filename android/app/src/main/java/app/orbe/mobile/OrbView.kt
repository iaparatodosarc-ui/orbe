package app.orbe.mobile

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.DashPathEffect
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RadialGradient
import android.graphics.RectF
import android.graphics.Shader
import android.view.View
import android.view.animation.LinearInterpolator
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.sin
import kotlin.random.Random

/**
 * El orbe: una esfera oscura con un ojo que parpadea y un anillo que cambia según el estado.
 * Al tocarlo hace una reacción distinta cada vez (movimiento + sonido, ver Sfx).
 * La vista es más grande que el orbe para que tenga espacio al saltar o girar.
 */
class OrbView(ctx: Context) : View(ctx) {
    enum class State { IDLE, THINKING, SPEAKING }
    enum class Reaction { BOING, GIGGLE, WHIRL, HOP, SHIVER, JELLY, GASP, WINK, LOVE, DIZZY, FLIP, PEEK, SLEEPY, HAPPY }

    var state: State = State.IDLE
        set(v) { field = v; invalidate() }

    private val orange = Color.parseColor("#FF5A1F")
    private val body = Paint(Paint.ANTI_ALIAS_FLAG)
    private val ring = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE }
    private val white = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.parseColor("#F4F2EC") }
    private val pupil = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.parseColor("#111111") }
    private val iris = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = orange; style = Paint.Style.STROKE }
    private val shine = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE }
    private val heartPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.parseColor("#FF3D6E") }
    private val blushPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = orange; alpha = 140 }
    private val sparkPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private var blink = 1f
    private var angle = 0f
    private val oval = RectF()
    private val path = Path()

    // reacción en curso
    private var reaction: Reaction? = null
    private var p = 0f
    private var anim: ValueAnimator? = null
    private val recent = ArrayDeque<Reaction>()
    private data class Spark(val ang: Float, val dist: Float, val color: Int, val heart: Boolean)
    private var sparks: List<Spark> = emptyList()

    var soundsOn: () -> Boolean = { true }

    private val blinker = object : Runnable {
        override fun run() {
            if (reaction == null) { blink = 0.12f; invalidate(); postDelayed({ blink = 1f; invalidate() }, 130) }
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
        removeCallbacks(blinker); removeCallbacks(spinner); anim?.cancel()
        super.onDetachedFromWindow()
    }

    /** Elige una reacción que no se haya visto en las últimas 4, la anima y la hace sonar. */
    fun react(force: Reaction? = null) {
        val r = force ?: run {
            val opts = Reaction.values().filter { it != Reaction.HAPPY && it !in recent }
            opts[Random.nextInt(opts.size)]
        }
        if (force == null) { recent.addLast(r); if (recent.size > 4) recent.removeFirst() }
        reaction = r
        val colors = intArrayOf(orange, Color.parseColor("#FFD166"), Color.parseColor("#F4F2EC"), Color.parseColor("#FF3D6E"))
        sparks = when (r) {
            Reaction.LOVE, Reaction.HAPPY, Reaction.WHIRL, Reaction.FLIP, Reaction.HOP ->
                List(if (r == Reaction.HOP) 3 else 6) {
                    Spark((PI + Random.nextDouble() * PI).toFloat(), 0.6f + Random.nextFloat() * 0.5f,
                        colors[Random.nextInt(colors.size)], r == Reaction.LOVE || (r == Reaction.HAPPY && Random.nextBoolean()))
                }
            else -> emptyList()
        }
        anim?.cancel()
        anim = ValueAnimator.ofFloat(0f, 1f).apply {
            duration = when (r) { Reaction.SLEEPY -> 1400L; Reaction.LOVE, Reaction.HAPPY, Reaction.PEEK -> 1000L; else -> 800L }
            interpolator = LinearInterpolator()
            addUpdateListener { p = it.animatedValue as Float; invalidate() }
            addListener(object : android.animation.AnimatorListenerAdapter() {
                override fun onAnimationEnd(a: android.animation.Animator) { reaction = null; p = 0f; invalidate() }
            })
            start()
        }
        if (soundsOn()) Sfx.play(context, r.name.lowercase())
    }

    private fun wave(t: Float, cycles: Float) = sin(t * cycles * 2 * PI).toFloat() * exp(-3f * t)

    override fun onDraw(c: Canvas) {
        val w = width.toFloat(); val h = height.toFloat()
        val cx = w / 2; val cy = h / 2 + h * 0.05f
        val r = minOf(w, h) * 0.34f

        // transformación de la reacción
        var sx = 1f; var sy = 1f; var rot = 0f; var tx = 0f; var ty = 0f; var rotY = 1f
        var eyeOpen = blink; var pupilDx = 0f; var pupilDy = 0f; var love = false; var blush = false; var wide = 1f
        val t = p
        when (reaction) {
            Reaction.BOING -> { val k = wave(t, 2.2f) * 0.2f; sx = 1 + k; sy = 1 - k }
            Reaction.GIGGLE -> { rot = wave(t, 3f) * 14f; blush = true; eyeOpen = 0.3f }
            Reaction.WHIRL -> { rot = 360f * (1 - (1 - t) * (1 - t)); val s = 1 - 0.12f * sin(t * PI).toFloat(); sx = s; sy = s }
            Reaction.HOP -> { ty = -r * 0.55f * sin(t * PI).toFloat(); val sq = if (t < 0.12f || t > 0.8f) 0.12f else -0.05f; sx = 1 + sq; sy = 1 - sq }
            Reaction.SHIVER -> { tx = r * 0.07f * sin(t * 40).toFloat() * (1 - t) }
            Reaction.JELLY -> { val k = wave(t, 2.5f) * 0.16f; sx = 1 - k; sy = 1 + k }
            Reaction.GASP -> { val s = 1 + 0.18f * sin(t * PI).toFloat(); sx = s; sy = s; wide = 1.25f; pupilDy = 0.1f }
            Reaction.WINK -> { rot = 14f * sin(t * PI).toFloat(); eyeOpen = if (t in 0.15f..0.6f) 0.15f else 1f }
            Reaction.LOVE -> { val s = 1 + 0.12f * (sin(t * 4 * PI).toFloat()).coerceAtLeast(0f); sx = s; sy = s; love = true; blush = true }
            Reaction.DIZZY -> { rot = wave(t, 2f) * 8f; pupilDx = cos(t * 14).toFloat() * 0.5f; pupilDy = sin(t * 14).toFloat() * 0.4f }
            Reaction.FLIP -> { rotY = cos(t * 2 * PI).toFloat() }
            Reaction.PEEK -> { pupilDx = when { t < 0.35f -> -0.6f; t < 0.7f -> 0.6f; else -> 0f }; tx = r * 0.08f * sin(t * 2 * PI).toFloat() }
            Reaction.SLEEPY -> { rot = 12f * sin(t * PI).toFloat(); eyeOpen = 0.15f + 0.85f * (if (t > 0.75f) (t - 0.75f) * 4 else 0f) }
            Reaction.HAPPY -> { ty = -r * 0.35f * kotlin.math.abs(sin(t * 2 * PI).toFloat()) * (1 - t); rot = 8f * sin(t * 2 * PI).toFloat(); eyeOpen = 0.3f; blush = true }
            null -> {}
        }

        // chispas / corazones
        if (sparks.isNotEmpty() && reaction != null) {
            for (s in sparks) {
                val d = r * (0.4f + 1.1f * s.dist * t)
                val px = cx + cos(s.ang) * d; val py = cy + sin(s.ang) * d
                sparkPaint.color = s.color; sparkPaint.alpha = ((1 - t) * 255).toInt().coerceIn(0, 255)
                if (s.heart) drawHeart(c, px, py, r * 0.16f, sparkPaint) else c.drawCircle(px, py, r * 0.06f, sparkPaint)
            }
        }

        c.save()
        c.translate(cx + tx, cy + ty)
        c.rotate(rot)
        c.scale(sx * rotY, sy)

        body.shader = RadialGradient(-r * 0.3f, -r * 0.4f, r * 1.4f,
            intArrayOf(Color.parseColor("#3A3A40"), Color.parseColor("#16161A"), Color.parseColor("#050506")),
            floatArrayOf(0f, 0.55f, 1f), Shader.TileMode.CLAMP)
        c.drawCircle(0f, 0f, r, body)

        ring.strokeWidth = r * 0.13f
        val ro = r + r * 0.12f
        oval.set(-ro, -ro, ro, ro)
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
        if (rotY < 0f) { c.restore(); return } // de espaldas en el giro: sin ojo

        if (blush) {
            c.drawOval(RectF(-r * 0.62f, r * 0.32f, -r * 0.3f, r * 0.46f), blushPaint)
            c.drawOval(RectF(r * 0.3f, r * 0.32f, r * 0.62f, r * 0.46f), blushPaint)
        }
        // ojo
        val ew = r * 0.95f * (if (wide > 1f) 1.1f else 1f); val eh = r * 0.62f * eyeOpen * wide
        oval.set(-ew / 2, -eh / 2, ew / 2, eh / 2)
        c.drawOval(oval, white)
        if (love) {
            drawHeart(c, 0f, 0f, r * 0.28f, heartPaint)
        } else if (eyeOpen > 0.5f) {
            val pr = r * 0.2f
            val px = pupilDx * ew * 0.35f; val py = pupilDy * eh * 0.5f
            c.drawCircle(px, py, pr, pupil)
            iris.strokeWidth = pr * 0.35f
            c.drawCircle(px, py, pr, iris)
            c.drawCircle(px - pr * 0.35f, py - pr * 0.35f, pr * 0.25f, shine)
        }
        c.restore()
    }

    private fun drawHeart(c: Canvas, x: Float, y: Float, s: Float, paint: Paint) {
        path.reset()
        path.moveTo(x, y + s * 0.9f)
        path.cubicTo(x - s * 1.3f, y + s * 0.1f, x - s * 0.7f, y - s * 1.0f, x, y - s * 0.35f)
        path.cubicTo(x + s * 0.7f, y - s * 1.0f, x + s * 1.3f, y + s * 0.1f, x, y + s * 0.9f)
        c.drawPath(path, paint)
    }
}
