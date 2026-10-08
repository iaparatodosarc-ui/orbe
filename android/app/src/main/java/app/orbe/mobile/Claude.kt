package app.orbe.mobile

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.URL
import javax.net.ssl.HttpsURLConnection

object Prefs {
    fun of(ctx: Context): SharedPreferences = ctx.getSharedPreferences("orbe", Context.MODE_PRIVATE)
    fun apiKey(ctx: Context): String = of(ctx).getString("apiKey", "") ?: ""
    fun model(ctx: Context): String = of(ctx).getString("model", DEFAULT_MODEL) ?: DEFAULT_MODEL
    fun voice(ctx: Context): Boolean = of(ctx).getBoolean("voice", false)
    const val DEFAULT_MODEL = "claude-opus-5-5"
}

object Claude {
    const val SYSTEM = """You are Orbe, a real-time assistant that floats over the user's Android phone screen as a small orb.
The user taps the orb while using any app and asks you something; you receive a screenshot of what is on their screen.
- Always reply in the same language the user writes in. Be clear, direct and brief (it is a phone: short paragraphs, numbered steps when something must be done).
- Base answers on what is actually visible in the screenshot; if something is unreadable or missing, say so and ask them to scroll or zoom.
- If you see an error, explain the likely cause and how to fix it. If you see a message, you may offer a ready-to-copy reply.
- You cannot tap or type on the phone; tell the user exactly where to do it.
- Do not use Markdown tables or headings. Never repeat sensitive data visible on screen (passwords, card numbers, codes)."""

    /** Llama a la API de Anthropic con streaming. Bloqueante: úsalo en un hilo de fondo. */
    fun stream(
        apiKey: String,
        model: String,
        messages: JSONArray,
        onDelta: (String) -> Unit,
        isCancelled: () -> Boolean
    ): String {
        val c = URL("https://api.anthropic.com/v1/messages").openConnection() as HttpsURLConnection
        c.requestMethod = "POST"
        c.doOutput = true
        c.connectTimeout = 20000
        c.readTimeout = 180000
        c.setRequestProperty("content-type", "application/json")
        c.setRequestProperty("x-api-key", apiKey)
        c.setRequestProperty("anthropic-version", "2023-06-01")
        val body = JSONObject()
            .put("model", model)
            .put("max_tokens", 1200)
            .put("system", SYSTEM)
            .put("messages", messages)
            .put("stream", true)
        c.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
        val code = c.responseCode
        if (code !in 200..299) {
            val err = c.errorStream?.bufferedReader()?.readText() ?: ""
            val msg = try {
                JSONObject(err).getJSONObject("error").getString("message")
            } catch (e: Exception) {
                err.take(300)
            }
            throw IOException("Error $code: $msg")
        }
        val sb = StringBuilder()
        c.inputStream.bufferedReader(Charsets.UTF_8).use { r ->
            while (true) {
                if (isCancelled()) {
                    c.disconnect(); break
                }
                val line = r.readLine() ?: break
                if (!line.startsWith("data:")) continue
                val j = try {
                    JSONObject(line.substring(5).trim())
                } catch (e: Exception) {
                    continue
                }
                when (j.optString("type")) {
                    "content_block_delta" -> {
                        val d = j.optJSONObject("delta")
                        if (d != null && d.optString("type") == "text_delta") {
                            val t = d.optString("text")
                            sb.append(t)
                            onDelta(t)
                        }
                    }
                    "error" -> throw IOException(j.optJSONObject("error")?.optString("message") ?: "stream error")
                }
            }
        }
        return sb.toString()
    }
}
