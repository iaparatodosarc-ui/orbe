package app.orbe.mobile

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import java.util.concurrent.Executors
import kotlin.math.PI
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sin
import kotlin.random.Random

/**
 * Sonidos del orbe, sintetizados al momento (sin archivos de audio).
 * Cada sonido usa tono y ritmo al azar, así nunca suena exactamente igual dos veces.
 */
object Sfx {
    private const val RATE = 22050
    private val pool = Executors.newCachedThreadPool()

    fun play(ctx: Context, name: String) {
        val vol = Prefs.volume(ctx)
        if (vol <= 0f) return
        pool.execute { try { render(name, vol) } catch (_: Exception) {} }
    }

    private class Mix(seconds: Float) {
        val buf = FloatArray((seconds * RATE).toInt() + 1)

        /** Tono con barrido de frecuencia (exponencial), vibrato y envolvente. */
        fun tone(f1: Float, f2: Float, dur: Float, at: Float = 0f, gain: Float = 0.5f, wave: Char = 's',
                 vib: Float = 0f, vibRate: Float = 18f, attack: Float = 0.01f) {
            val start = (at * RATE).toInt(); val n = (dur * RATE).toInt()
            var phase = 0.0
            for (i in 0 until n) {
                val k = start + i; if (k >= buf.size) break
                val x = i.toFloat() / n
                var f = f1 * (f2 / f1).pow(x)
                if (vib > 0f) f += vib * sin(2 * PI * vibRate * i / RATE).toFloat()
                phase += 2 * PI * max(30f, f) / RATE
                val s = when (wave) {
                    'q' -> if (sin(phase) >= 0) 1f else -1f                      // cuadrada
                    't' -> (2 / PI * kotlin.math.asin(sin(phase))).toFloat()      // triangular
                    'w' -> (((phase / (2 * PI)) % 1.0) * 2 - 1).toFloat()         // sierra
                    else -> sin(phase).toFloat()
                }
                val tSec = i.toFloat() / RATE
                val env = min(1f, tSec / attack) * exp(-4f * x) * (1 - x * x)
                buf[k] += s * env * gain
            }
        }

        /** Ruido suavizado (para el "whoosh" y los tics). */
        fun noise(dur: Float, at: Float = 0f, gain: Float = 0.3f, smooth: Float = 0.6f) {
            val start = (at * RATE).toInt(); val n = (dur * RATE).toInt()
            var y = 0f
            for (i in 0 until n) {
                val k = start + i; if (k >= buf.size) break
                val x = i.toFloat() / n
                y = y * smooth + (Random.nextFloat() * 2 - 1) * (1 - smooth)
                val env = min(1f, x * 4) * (1 - x)
                buf[k] += y * env * gain * 3
            }
        }
    }

    private fun r(a: Float, b: Float) = a + Random.nextFloat() * (b - a)
    private fun note(root: Float, semi: Int) = root * 2f.pow(semi / 12f)
    private val SCALES = listOf(intArrayOf(0, 2, 4, 7, 9, 12, 14, 16), intArrayOf(0, 3, 5, 7, 10, 12, 15), intArrayOf(0, 2, 4, 5, 7, 9, 11, 12))

    private fun render(name: String, vol: Float) {
        val k = r(0.85f, 1.25f)
        val m = Mix(1.4f)
        when (name) {
            "boing" -> m.tone(180 * k, 640 * k, 0.38f, vib = r(30f, 70f) * k, vibRate = r(14f, 24f))
            "giggle" -> { val sc = SCALES.random(); val root = r(500f, 700f) * k
                for (i in 0 until 5) { val f = note(root, sc[Random.nextInt(sc.size)]); m.tone(f, f * r(1.02f, 1.12f), 0.07f, at = i * r(0.06f, 0.085f), gain = 0.35f, wave = 't') } }
            "whirl" -> { m.noise(0.5f, gain = 0.25f, smooth = 0.3f); m.tone(260 * k, 900 * k, 0.45f, gain = 0.2f) }
            "hop" -> { m.tone(220 * k, 880 * k, 0.17f, gain = 0.15f, wave = 'q'); m.tone(320 * k, 110 * k, 0.14f, at = 0.5f, gain = 0.45f) }
            "shiver" -> m.tone(520 * k, 480 * k, 0.45f, gain = 0.1f, wave = 'q', vib = 40f, vibRate = r(26f, 40f))
            "jelly" -> { m.tone(700 * k, 280 * k, 0.16f); m.tone(560 * k, 220 * k, 0.16f, at = 0.17f, gain = 0.4f); m.tone(640 * k, 250 * k, 0.14f, at = 0.32f, gain = 0.25f) }
            "gasp" -> { m.tone(300 * k, 1250 * k, 0.16f, gain = 0.45f, wave = 't'); m.noise(0.15f, at = 0.02f, gain = 0.05f, smooth = 0.1f) }
            "wink" -> { m.tone(900 * k, 1200 * k, 0.07f, gain = 0.35f, wave = 't'); m.tone(1300 * k, 1700 * k, 0.09f, at = 0.11f, gain = 0.35f, wave = 't') }
            "love" -> { val root = r(380f, 520f) * k; intArrayOf(0, 4, 7, 12).forEachIndexed { i, s -> m.tone(note(root, s), note(root, s), 0.32f, at = i * 0.09f, gain = 0.28f, attack = 0.03f) } }
            "dizzy" -> m.tone(820 * k, 180 * k, 0.75f, vib = 70 * k, vibRate = r(7f, 11f), gain = 0.32f)
            "flip" -> { m.tone(300 * k, 1300 * k, 0.3f, gain = 0.07f, wave = 'w'); m.tone(1300 * k, 350 * k, 0.3f, at = 0.3f, gain = 0.25f) }
            "peek" -> { m.noise(0.03f, gain = 0.4f, smooth = 0.05f); m.noise(0.03f, at = 0.33f, gain = 0.4f, smooth = 0.05f); m.tone(1500 * k, 1500 * k, 0.05f, at = 0.66f, gain = 0.2f, wave = 't') }
            "sleepy" -> { m.tone(330 * k, 240 * k, 0.6f, gain = 0.25f, attack = 0.15f); m.tone(250 * k, 200 * k, 0.7f, at = 0.55f, gain = 0.18f, attack = 0.2f) }
            "happy" -> { val root = r(420f, 560f) * k; intArrayOf(0, 4, 7, 12, 16).forEachIndexed { i, s -> m.tone(note(root, s), note(root, s) * 1.01f, 0.18f, at = i * 0.07f, gain = 0.3f, wave = 't') } }
            "done" -> { val root = r(880f, 1046f) * k; m.tone(root, root, 0.4f, gain = 0.18f, attack = 0.005f); m.tone(root * 1.5f, root * 1.5f, 0.5f, at = 0.08f, gain = 0.12f, attack = 0.005f) }
            "pickup" -> m.tone(400 * k, 700 * k, 0.08f, gain = 0.25f, wave = 't')
            "plop" -> m.tone(500 * k, 140 * k, 0.14f, gain = 0.45f)
            else -> return
        }
        // recortar silencio final y convertir a 16 bits
        var end = m.buf.size - 1
        while (end > 0 && kotlin.math.abs(m.buf[end]) < 1e-4f) end--
        val n = end + 1
        val pcm = ShortArray(n) { i -> (m.buf[i] * vol * 0.7f).coerceIn(-1f, 1f).times(32767).toInt().toShort() }
        val track = AudioTrack.Builder()
            .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
            .setAudioFormat(AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT).setSampleRate(RATE)
                .setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build())
            .setTransferMode(AudioTrack.MODE_STATIC)
            .setBufferSizeInBytes(n * 2)
            .build()
        track.write(pcm, 0, n)
        track.play()
        Thread.sleep((n * 1000L / RATE) + 120)
        track.release()
    }
}
