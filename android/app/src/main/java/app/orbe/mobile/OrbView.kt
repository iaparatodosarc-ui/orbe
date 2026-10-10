package app.orbe.mobile

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.BlurMaskFilter
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
 * El orbe (edición Claude): esfera de vidrio negro con un gran ojo naranja y una aureola flotante que cambia según el estado.
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
            if (reaction == null) { blink = 0.02f; invalidate(); postDelayed({ blink = 1f; invalidate() }, 140) }
            postDelayed(this, 3800L + (Math.random() * 1800).toLong())
        }
    }
    private val spinner = object : Runnable {
        override fun run() {
            angle = (angle + 12f) % 360f; invalidate()
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

    // ---------- dibujo "edición Claude": esfera de vidrio negro con aureola flotante ----------
    private val OR = Color.rgb(255, 122, 40)
    private val HOT = Color.rgb(255, 214, 160)
    private val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeCap = Paint.Cap.ROUND }
    private val fill = Paint(Paint.ANTI_ALIAS_FLAG)
    private val t0 = System.nanoTime()
    private class Light(val x: Float, val y: Float, val s: Float, val w: Float)
    private val lights = List(40) { i ->
        val f = frac(sin(i * 12.9898) * 43758.5453); val g = frac(sin(i * 78.233) * 12345.678)
        Light(f * 2 - 1, 0.42f + g * 0.55f, 0.008f + frac(f * 7.0) * 0.018f, frac(g * 13.0))
    }
    private fun frac(v: Double): Float = (v - kotlin.math.floor(v)).toFloat()
    private fun frac(v: Float): Float = v - kotlin.math.floor(v)

    init { setLayerType(LAYER_TYPE_SOFTWARE, null) } // necesario para el brillo (blur)

    private fun glow(color: Int, alpha: Float, width: Float, blur: Float): Paint = stroke.apply {
        this.color = color; this.alpha = (alpha.coerceIn(0f, 1f) * 255).toInt(); strokeWidth = width
        maskFilter = if (blur > 0.5f) BlurMaskFilter(blur, BlurMaskFilter.Blur.NORMAL) else null
        pathEffect = null
    }

    private fun drawHalo(c: Canvas, r: Float, time: Float, front: Boolean) {
        val bob = sin(time * 2.1f + 0.9f) * r * 0.05f
        val hy = -r * 1.42f + bob
        oval.set(-r * 0.78f, hy - r * 0.17f, r * 0.78f, hy + r * 0.17f)
        val a = when (state) { State.IDLE -> 0.85f; State.THINKING -> 1f; State.SPEAKING -> 1.05f + 0.35f * sin(time * 7f) }
        val start = if (front) 0f else 180f
        val dash = if (state == State.THINKING) DashPathEffect(floatArrayOf(r * 0.12f, r * 0.1f), -time * r * 2.2f) else null
        for ((col, al, wd, bl) in listOf(
            Quad(OR, 0.55f * a, r * 0.11f, r * 0.45f), Quad(OR, 0.95f * a, r * 0.075f, r * 0.15f), Quad(HOT, minOf(1f, a), r * 0.03f, 0f))) {
            val pnt = glow(col, al, wd, bl); pnt.pathEffect = dash
            c.drawArc(oval, start, 180f, false, pnt)
        }
        stroke.pathEffect = null
    }
    private data class Quad(val a: Int, val b: Float, val c: Float, val d: Float)

    override fun onDraw(c: Canvas) {
        val w = width.toFloat(); val h = height.toFloat()
        val time = (System.nanoTime() - t0) / 1e9f
        val r = minOf(w, h) * 0.27f
        val cx = w / 2; val cy = h * 0.6f + sin(time * 1.6f) * r * 0.06f

        // transformación de la reacción
        var sx = 1f; var sy = 1f; var rot = 0f; var tx = 0f; var ty = 0f; var rotY = 1f
        var eyeOpen = blink; var pupilDx = 0f; var pupilDy = 0f; var love = false; var blush = false; var wide = 1f; var happy = false
        val t = p
        when (reaction) {
            Reaction.BOING -> { val k = wave(t, 2.2f) * 0.2f; sx = 1 + k; sy = 1 - k }
            Reaction.GIGGLE -> { rot = wave(t, 3f) * 14f; blush = true; happy = true }
            Reaction.WHIRL -> { rot = 360f * (1 - (1 - t) * (1 - t)); val s = 1 - 0.12f * sin(t * PI).toFloat(); sx = s; sy = s }
            Reaction.HOP -> { ty = -r * 0.55f * sin(t * PI).toFloat(); val sq = if (t < 0.12f || t > 0.8f) 0.12f else -0.05f; sx = 1 + sq; sy = 1 - sq }
            Reaction.SHIVER -> { tx = r * 0.07f * sin(t * 40).toFloat() * (1 - t) }
            Reaction.JELLY -> { val k = wave(t, 2.5f) * 0.16f; sx = 1 - k; sy = 1 + k }
            Reaction.GASP -> { val s = 1 + 0.18f * sin(t * PI).toFloat(); sx = s; sy = s; wide = 1.12f; pupilDy = 0.3f }
            Reaction.WINK -> { rot = 14f * sin(t * PI).toFloat(); eyeOpen = if (t in 0.15f..0.6f) 0.05f else 1f }
            Reaction.LOVE -> { val s = 1 + 0.12f * (sin(t * 4 * PI).toFloat()).coerceAtLeast(0f); sx = s; sy = s; love = true; blush = true }
            Reaction.DIZZY -> { rot = wave(t, 2f) * 8f; pupilDx = cos(t * 14).toFloat() * 0.9f; pupilDy = sin(t * 14).toFloat() * 0.7f }
            Reaction.FLIP -> { rotY = cos(t * 2 * PI).toFloat() }
            Reaction.PEEK -> { pupilDx = when { t < 0.35f -> -1f; t < 0.7f -> 1f; else -> 0f }; tx = r * 0.08f * sin(t * 2 * PI).toFloat() }
            Reaction.SLEEPY -> { rot = 12f * sin(t * PI).toFloat(); eyeOpen = 0.25f + 0.75f * (if (t > 0.75f) (t - 0.75f) * 4 else 0f) }
            Reaction.HAPPY -> { ty = -r * 0.35f * kotlin.math.abs(sin(t * 2 * PI).toFloat()) * (1 - t); rot = 8f * sin(t * 2 * PI).toFloat(); happy = true; blush = true }
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

        drawHalo(c, r, time, false)

        // cuerpo de vidrio negro
        fill.maskFilter = null
        fill.shader = RadialGradient(-r * 0.35f, -r * 0.45f, r * 1.05f,
            intArrayOf(Color.rgb(43, 45, 54), Color.rgb(11, 12, 17), Color.rgb(2, 2, 3)), floatArrayOf(0f, 0.45f, 1f), Shader.TileMode.CLAMP)
        c.drawCircle(0f, 0f, r, fill); fill.shader = null
        c.save()
        path.reset(); path.addCircle(0f, 0f, r * 0.97f, Path.Direction.CW); c.clipPath(path)
        fill.shader = android.graphics.LinearGradient(0f, -r, 0f, r * 0.2f, Color.argb(90, 70, 100, 140), Color.argb(0, 70, 100, 140), Shader.TileMode.CLAMP)
        c.drawRect(-r, -r, r, r * 0.2f, fill); fill.shader = null
        for (L in lights) {
            val px = L.x * r * 0.95f * kotlin.math.sqrt(1 - minOf(1f, L.y * L.y) * 0.6f); val py = L.y * r
            val tw = 0.55f + 0.45f * sin(time * 1.7f + L.w * 20)
            fill.color = Color.argb((140 * tw).toInt(), 255, 180 + (L.w * 60).toInt(), 90 + (L.w * 80).toInt())
            c.drawCircle(px, py, maxOf(1f, r * L.s), fill)
        }
        // reflejo naranja de la aureola sobre la esfera
        oval.set(-r * 0.5f, -r * 0.93f, r * 0.5f, -r * 0.71f)
        c.drawOval(oval, glow(OR, 0.75f, r * 0.045f, r * 0.08f))
        c.restore()
        // borde de luz frío
        c.drawCircle(0f, 0f, r * 0.98f, glow(Color.rgb(200, 222, 255), 0.7f, maxOf(1.5f, r * 0.035f), 0f))

        if (rotY >= 0f) {
            if (blush) for (sxs in listOf(-1f, 1f)) {
                fill.shader = RadialGradient(sxs * r * 0.55f, r * 0.55f, r * 0.22f, Color.argb(140, 255, 90, 90), Color.argb(0, 255, 90, 90), Shader.TileMode.CLAMP)
                c.drawCircle(sxs * r * 0.55f, r * 0.55f, r * 0.22f, fill); fill.shader = null
            }
            drawEye(c, r, time, pupilDx, pupilDy, eyeOpen, wide, love, happy)
        }
        // brillos
        c.save(); c.translate(-r * 0.55f, -r * 0.42f); c.rotate(-34f)
        fill.shader = RadialGradient(0f, 0f, r * 0.2f, intArrayOf(Color.argb(242, 255, 255, 255), Color.argb(190, 255, 255, 255), Color.argb(0, 255, 255, 255)), floatArrayOf(0f, 0.6f, 1f), Shader.TileMode.CLAMP)
        oval.set(-r * 0.2f, -r * 0.13f, r * 0.2f, r * 0.13f); c.drawOval(oval, fill); fill.shader = null
        c.restore()
        c.save(); c.translate(r * 0.72f, -r * 0.38f); c.rotate(28f)
        fill.color = Color.argb(140, 255, 255, 255); oval.set(-r * 0.05f, -r * 0.1f, r * 0.05f, r * 0.1f); c.drawOval(oval, fill)
        c.restore()

        drawHalo(c, r, time, true)
        c.restore()
    }

    private fun drawEye(c: Canvas, r: Float, time: Float, lx0: Float, ly0: Float, open: Float, wide: Float, love: Boolean, happy: Boolean) {
        val lx = lx0.coerceIn(-1f, 1f); val ly = ly0.coerceIn(-1f, 1f)
        val ex = lx * r * 0.32f; val ey = r * 0.1f + ly * r * 0.2f
        val ew = r * 0.74f * (1 - kotlin.math.abs(lx) * 0.25f) * wide; val eh = r * 0.5f * (1 - kotlin.math.abs(ly) * 0.15f) * wide
        if (happy) {
            oval.set(ex - ew * 0.8f, ey + eh * 0.3f - eh * 0.8f, ex + ew * 0.8f, ey + eh * 0.3f + eh * 0.8f)
            c.drawArc(oval, 200f, 140f, false, glow(OR, 0.9f, r * 0.1f, r * 0.2f))
            c.drawArc(oval, 200f, 140f, false, glow(Color.rgb(255, 250, 240), 1f, r * 0.05f, 0f))
            return
        }
        // anillo naranja incandescente
        fill.color = OR; fill.maskFilter = BlurMaskFilter(r * 0.18f, BlurMaskFilter.Blur.OUTER)
        oval.set(ex - ew, ey - eh, ex + ew, ey + eh); c.drawOval(oval, fill)
        fill.maskFilter = null; c.drawOval(oval, fill)
        // esclerótica
        fill.shader = RadialGradient(ex - ew * 0.2f, ey - eh * 0.3f, ew, intArrayOf(Color.WHITE, Color.rgb(255, 246, 234), Color.rgb(255, 217, 176)), floatArrayOf(0f, 0.7f, 1f), Shader.TileMode.CLAMP)
        oval.set(ex - ew * 0.9f, ey - eh * 0.86f, ex + ew * 0.9f, ey + eh * 0.86f); c.drawOval(oval, fill); fill.shader = null
        if (love) {
            drawHeart(c, ex, ey, eh * 0.55f, heartPaint)
        } else {
            val px = ex + lx * ew * 0.28f; val py = ey + ly * eh * 0.22f; val pr = eh * (if (wide > 1f) 0.45f else 0.6f)
            fill.shader = android.graphics.LinearGradient(0f, py - pr, 0f, py + pr, intArrayOf(Color.rgb(10, 13, 20), Color.rgb(6, 7, 11), Color.rgb(27, 20, 8)), floatArrayOf(0f, 0.55f, 1f), Shader.TileMode.CLAMP)
            oval.set(px - pr * (1 - kotlin.math.abs(lx) * 0.15f), py - pr, px + pr * (1 - kotlin.math.abs(lx) * 0.15f), py + pr); c.drawOval(oval, fill); fill.shader = null
            for (i in 0 until 10) {
                val xx = px + (frac(i * 0.37f) * 2 - 1) * pr * 0.7f; val yy = py + pr * (0.25f + frac(i * 0.61f) * 0.5f)
                fill.color = Color.argb((150 + 90 * sin(time * 2 + i)).toInt().coerceIn(0, 255), 255, 200, 120)
                c.drawRect(xx, yy, xx + maxOf(1f, pr * 0.07f), yy + maxOf(1f, pr * 0.07f), fill)
            }
            fill.color = Color.argb(217, 255, 255, 255)
            oval.set(px - pr * 0.54f, py - pr * 0.55f, px - pr * 0.26f, py - pr * 0.35f); c.drawOval(oval, fill)
        }
        // párpado: el vidrio negro baja desde arriba
        if (open < 0.98f) {
            val shut = 1 - open.coerceIn(0f, 1f)
            val ly2 = ey - eh * 1.15f + 2.3f * eh * shut
            c.save()
            path.reset(); oval.set(ex - ew * 1.12f, ey - eh * 1.15f, ex + ew * 1.12f, ey + eh * 1.15f); path.addOval(oval, Path.Direction.CW); c.clipPath(path)
            fill.color = Color.rgb(13, 14, 19); c.drawRect(ex - ew * 1.2f, ey - eh * 1.3f, ex + ew * 1.2f, ly2, fill)
            path.reset(); path.moveTo(ex - ew * 1.2f, ly2); path.quadTo(ex, ly2 + eh * 0.25f, ex + ew * 1.2f, ly2)
            c.drawPath(path, glow(OR, 0.95f, r * 0.045f, r * 0.1f))
            c.restore()
        }
    }

    private fun drawHeart(c: Canvas, x: Float, y: Float, s: Float, paint: Paint) {
        path.reset()
        path.moveTo(x, y + s * 0.9f)
        path.cubicTo(x - s * 1.3f, y + s * 0.1f, x - s * 0.7f, y - s * 1.0f, x, y - s * 0.35f)
        path.cubicTo(x + s * 0.7f, y - s * 1.0f, x + s * 1.3f, y + s * 0.1f, x, y + s * 0.9f)
        c.drawPath(path, paint)
    }
}
