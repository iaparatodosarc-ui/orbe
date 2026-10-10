package app.orbe.mobile

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.Image
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.text.InputType
import android.graphics.drawable.Icon
import android.util.Base64
import android.util.DisplayMetrics
import android.view.Gravity
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.util.Locale
import kotlin.math.abs
import kotlin.math.max

class OrbeService : Service() {

    companion object {
        const val EXTRA_CODE = "code"
        const val EXTRA_DATA = "data"
        const val ACTION_STOP = "app.orbe.mobile.STOP"
        const val CHANNEL = "orbe"
        @Volatile var running = false
    }

    private val ORANGE = Color.parseColor("#FF5A1F")
    private val BG = Color.parseColor("#121214")
    private val CARD = Color.parseColor("#1B1B1F")
    private val LINE = Color.parseColor("#2C2C32")
    private val FG = Color.parseColor("#F2F1EC")
    private val MUTE = Color.parseColor("#8E8E95")

    private lateinit var wm: WindowManager
    private val main = Handler(Looper.getMainLooper())
    private var bgThread: HandlerThread? = null
    private var bg: Handler? = null

    private var projection: MediaProjection? = null
    private var vDisplay: VirtualDisplay? = null
    private var reader: ImageReader? = null
    private var latest: Image? = null
    private val lock = Any()

    private var orb: OrbView? = null
    private var orbParams: WindowManager.LayoutParams? = null
    private var panel: View? = null
    private var panelParams: WindowManager.LayoutParams? = null
    private lateinit var msgList: LinearLayout
    private lateinit var msgScroll: ScrollView
    private lateinit var input: EditText
    private lateinit var sendBtn: Button
    private lateinit var seeScreen: CheckBox
    private lateinit var voiceBtn: Button

    private val history = JSONArray()
    private data class Proposal(val text: String, val created: Long, var decided: String? = null)
    private val proposals = HashMap<String, Proposal>()
    @Volatile private var busy = false
    @Volatile private var cancel = false
    private var tts: TextToSpeech? = null

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) { stopSelf(); return START_NOT_STICKY }
        if (projection != null) { showPanel(); return START_STICKY }
        wm = getSystemService(Context.WINDOW_SERVICE) as WindowManager
        startForegroundCompat()
        val code = intent?.getIntExtra(EXTRA_CODE, 0) ?: 0
        val data: Intent? = if (Build.VERSION.SDK_INT >= 33) {
            intent?.getParcelableExtra(EXTRA_DATA, Intent::class.java)
        } else {
            @Suppress("DEPRECATION") intent?.getParcelableExtra(EXTRA_DATA)
        }
        if (data == null) { stopSelf(); return START_NOT_STICKY }
        val mpm = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        projection = mpm.getMediaProjection(code, data)
        if (projection == null) { stopSelf(); return START_NOT_STICKY }
        projection?.registerCallback(object : MediaProjection.Callback() {
            override fun onStop() { main.post { stopSelf() } }
        }, main)
        setupCapture()
        showOrb()
        running = true
        tts = TextToSpeech(this) { s -> if (s == TextToSpeech.SUCCESS) tts?.setLanguage(Locale.getDefault()) }
        return START_STICKY
    }

    override fun onDestroy() {
        running = false
        cancel = true
        if (::wm.isInitialized) {
            try { orb?.let { wm.removeView(it) } } catch (_: Exception) {}
            if (panelAttached) {
                try { panel?.let { wm.removeView(it) } } catch (_: Exception) {}
            }
        }
        orb = null; panel = null
        synchronized(lock) { latest?.close(); latest = null }
        vDisplay?.release(); reader?.close()
        try { projection?.stop() } catch (_: Exception) {}
        projection = null
        bgThread?.quitSafely()
        tts?.shutdown()
        super.onDestroy()
    }

    // ---------------- notificación (obligatoria para capturar pantalla) ----------------
    private fun startForegroundCompat() {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.createNotificationChannel(NotificationChannel(CHANNEL, "Orbe", NotificationManager.IMPORTANCE_LOW))
        val stop = PendingIntent.getService(this, 1, Intent(this, OrbeService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val open = PendingIntent.getService(this, 2, Intent(this, OrbeService::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val n = Notification.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_menu_view)
            .setContentTitle("Orbe está activo")
            .setContentText("Toca el orbe para preguntar sobre tu pantalla")
            .setContentIntent(open)
            .setOngoing(true)
            .addAction(Notification.Action.Builder(Icon.createWithResource(this, android.R.drawable.ic_menu_close_clear_cancel), "Detener", stop).build())
            .build()
        if (Build.VERSION.SDK_INT >= 29) startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
        else startForeground(1, n)
    }

    // ---------------- captura de pantalla ----------------
    private fun realSize(): Pair<Int, Int> {
        return if (Build.VERSION.SDK_INT >= 30) {
            val b = wm.maximumWindowMetrics.bounds; Pair(b.width(), b.height())
        } else {
            val m = DisplayMetrics()
            @Suppress("DEPRECATION") wm.defaultDisplay.getRealMetrics(m)
            Pair(m.widthPixels, m.heightPixels)
        }
    }

    private fun setupCapture() {
        val (w, h) = realSize()
        val scale = if (max(w, h) > 1600) 1600f / max(w, h) else 1f
        val cw = ((w * scale).toInt() / 2) * 2
        val ch = ((h * scale).toInt() / 2) * 2
        val t = HandlerThread("orbe-capture"); t.start(); bgThread = t
        val handler = Handler(t.looper); bg = handler
        val r = ImageReader.newInstance(cw, ch, PixelFormat.RGBA_8888, 3)
        r.setOnImageAvailableListener({ rd ->
            val img = try { rd.acquireLatestImage() } catch (e: Exception) { null }
            if (img != null) {
                synchronized(lock) { latest?.close(); latest = img }
            }
        }, handler)
        reader = r
        vDisplay = projection?.createVirtualDisplay("orbe", cw, ch, resources.displayMetrics.densityDpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, r.surface, null, handler)
    }

    private fun grabBitmap(): Bitmap? {
      synchronized(lock) {
        val img = latest ?: return null
        val plane = img.planes[0]
        val buf = plane.buffer
        val ps = plane.pixelStride
        val rs = plane.rowStride
        val pad = rs - ps * img.width
        val full = Bitmap.createBitmap(img.width + pad / ps, img.height, Bitmap.Config.ARGB_8888)
        buf.rewind()
        full.copyPixelsFromBuffer(buf)
        return Bitmap.createBitmap(full, 0, 0, img.width, img.height)
      }
    }

    /** Oculta el orbe y el panel, toma la captura y los vuelve a mostrar. */
    private fun capture(done: (Bitmap?) -> Unit) {
        orb?.visibility = View.INVISIBLE
        panel?.visibility = View.INVISIBLE
        main.postDelayed({
            bg?.post {
                val b = try { grabBitmap() } catch (e: Exception) { null }
                main.post {
                    orb?.visibility = View.VISIBLE
                    panel?.visibility = View.VISIBLE
                    done(b)
                }
            }
        }, 450)
    }

    private fun toBase64(b: Bitmap): String {
        val maxSide = 1568f
        val big = max(b.width, b.height).toFloat()
        val k = if (big > maxSide) maxSide / big else 1f
        val s = if (k < 1f) Bitmap.createScaledBitmap(b, (b.width * k).toInt(), (b.height * k).toInt(), true) else b
        val out = ByteArrayOutputStream()
        s.compress(Bitmap.CompressFormat.JPEG, 80, out)
        return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
    }

    // ---------------- el orbe flotante ----------------
    private fun overlayType(): Int = WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY

    private fun showOrb() {
        val size = dp(92) // el orbe se ve de ~64dp; el resto es espacio para que salte y gire
        val v = OrbView(this).apply { soundsOn = { Prefs.sounds(this@OrbeService) } }
        val p = WindowManager.LayoutParams(size, size, overlayType(),
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT)
        p.gravity = Gravity.TOP or Gravity.START
        val (w, h) = realSize()
        p.x = w - size + dp(10); p.y = (h * 0.55).toInt()
        var downX = 0f; var downY = 0f; var startX = 0; var startY = 0; var moved = false
        v.setOnTouchListener { _, e ->
            when (e.action) {
                MotionEvent.ACTION_DOWN -> { downX = e.rawX; downY = e.rawY; startX = p.x; startY = p.y; moved = false; true }
                MotionEvent.ACTION_MOVE -> {
                    val dx = e.rawX - downX; val dy = e.rawY - downY
                    val th = dp(6).toFloat()
                    if (!moved && (abs(dx) > th || abs(dy) > th)) { moved = true; if (Prefs.sounds(this)) Sfx.play(this, "pickup") }
                    if (moved) { p.x = startX + dx.toInt(); p.y = startY + dy.toInt(); try { wm.updateViewLayout(v, p) } catch (_: Exception) {} }
                    true
                }
                MotionEvent.ACTION_UP -> {
                    if (!moved) { v.react(); togglePanel() }
                    else { // se pega al borde más cercano
                        if (Prefs.sounds(this)) Sfx.play(this, "plop")
                        val sw = realSize().first
                        p.x = if (p.x + size / 2 < sw / 2) -dp(10) else sw - size + dp(10)
                        try { wm.updateViewLayout(v, p) } catch (_: Exception) {}
                    }
                    true
                }
                else -> false
            }
        }
        wm.addView(v, p)
        orb = v; orbParams = p
    }

    // ---------------- panel de chat ----------------
    private fun rounded(color: Int, radius: Int, stroke: Int = 0): GradientDrawable =
        GradientDrawable().apply { setColor(color); cornerRadius = dp(radius).toFloat(); if (stroke != 0) setStroke(dp(1), stroke) }

    private fun smallBtn(label: String, onClick: () -> Unit): Button = Button(this).apply {
        text = label; setTextColor(FG); textSize = 15f; isAllCaps = false
        background = rounded(Color.TRANSPARENT, 10)
        minWidth = dp(40); minimumWidth = dp(40); minHeight = dp(36); minimumHeight = dp(36)
        setPadding(dp(6), 0, dp(6), 0)
        setOnClickListener { onClick() }
    }

    private var panelAttached = false

    private fun togglePanel() {
        if (panel == null) buildPanel() else if (panelAttached) hidePanel() else showPanel()
    }

    /** Quita el panel de la pantalla (si solo se ocultara, seguiría bloqueando los toques de la app de abajo). */
    private fun hidePanel() {
        val p = panel ?: return
        if (!panelAttached) return
        (getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager).hideSoftInputFromWindow(p.windowToken, 0)
        try { wm.removeView(p) } catch (_: Exception) {}
        panelAttached = false
    }

    private fun showPanel() {
        if (orb == null) return
        val p = panel
        if (p == null) { buildPanel(); return }
        if (!panelAttached) {
            try { wm.addView(p, panelParams!!); panelAttached = true } catch (_: Exception) {}
        }
    }

    private fun buildPanel() {
        val root = object : FrameLayout(this) {
            override fun dispatchKeyEvent(event: KeyEvent): Boolean {
                if (event.keyCode == KeyEvent.KEYCODE_BACK && event.action == KeyEvent.ACTION_UP) { hidePanel(); return true }
                return super.dispatchKeyEvent(event)
            }
        }
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = rounded(BG, 20, LINE)
            setPadding(dp(12), dp(10), dp(12), dp(12))
        }
        root.addView(card, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))

        // encabezado
        val header = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        val titleBox = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        titleBox.addView(TextView(this).apply { text = "Orbe"; setTextColor(FG); textSize = 17f; setTypeface(typeface, Typeface.BOLD) })
        titleBox.addView(TextView(this).apply { text = "● Claude · en vivo"; setTextColor(MUTE); textSize = 11f })
        header.addView(titleBox, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        voiceBtn = smallBtn(if (Prefs.voice(this)) "🔊" else "🔇") {
            val v = !Prefs.voice(this); Prefs.of(this).edit().putBoolean("voice", v).apply()
            voiceBtn.text = if (v) "🔊" else "🔇"; if (!v) tts?.stop()
        }
        header.addView(voiceBtn)
        header.addView(smallBtn("＋") { newChat() })
        header.addView(smallBtn("—") { hidePanel() })
        header.addView(smallBtn("✕") { stopSelf() })
        card.addView(header)

        // mensajes
        msgList = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(0, dp(6), 0, dp(6)) }
        msgScroll = ScrollView(this).apply { addView(msgList); isFillViewport = true }
        card.addView(msgScroll, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        addHint()

        // botones rápidos
        val chips = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        for (q in listOf("¿Qué ves aquí?", "Resúmelo", "Explícame este error", "Ayúdame a responder", "¿Qué hago ahora?")) {
            chips.addView(Button(this).apply {
                text = q; isAllCaps = false; textSize = 12f; setTextColor(FG)
                background = rounded(CARD, 18, LINE); setPadding(dp(12), 0, dp(12), 0)
                minHeight = dp(34); minimumHeight = dp(34)
                setOnClickListener { send(q) }
            }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(34)).apply { rightMargin = dp(6) })
        }
        card.addView(HorizontalScrollView(this).apply { isHorizontalScrollBarEnabled = false; addView(chips) })

        // entrada
        seeScreen = CheckBox(this).apply {
            text = "Ver mi pantalla"; setTextColor(MUTE); textSize = 12f; isChecked = true
            buttonTintList = android.content.res.ColorStateList.valueOf(ORANGE)
        }
        card.addView(seeScreen)
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.BOTTOM }
        input = EditText(this).apply {
            hint = "Pregúntale a Orbe…"; setHintTextColor(MUTE); setTextColor(FG); textSize = 15f
            background = rounded(CARD, 14, LINE); setPadding(dp(12), dp(10), dp(12), dp(10))
            maxLines = 4; imeOptions = EditorInfo.IME_ACTION_SEND
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES; setHorizontallyScrolling(false)
            setOnEditorActionListener { _, id, _ -> if (id == EditorInfo.IME_ACTION_SEND) { send(text.toString()); true } else false }
        }
        row.addView(input, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        sendBtn = Button(this).apply {
            text = "➤"; textSize = 18f; setTextColor(Color.parseColor("#111111"))
            background = rounded(ORANGE, 14)
            setOnClickListener { if (busy) { cancel = true } else send(input.text.toString()) }
        }
        row.addView(sendBtn, LinearLayout.LayoutParams(dp(52), dp(48)).apply { leftMargin = dp(8) })
        card.addView(row)

        val (w, h) = realSize()
        val p = WindowManager.LayoutParams(w - dp(16), (h * 0.62).toInt(), overlayType(),
            WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT)
        p.gravity = Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL
        p.y = dp(12)
        p.softInputMode = WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE
        wm.addView(root, p)
        panel = root; panelParams = p; panelAttached = true
    }

    private var hintView: View? = null
    private fun addHint() {
        hintView = TextView(this).apply {
            text = "Abre cualquier app, toca el orbe y pregúntame lo que quieras sobre lo que ves en pantalla.\n\nTip: usa el micrófono de tu teclado para dictar."
            setTextColor(MUTE); textSize = 13f; gravity = Gravity.CENTER; setPadding(dp(16), dp(30), dp(16), dp(10))
        }
        msgList.addView(hintView)
    }

    private fun newChat() {
        cancel = true
        while (history.length() > 0) history.remove(0)
        proposals.clear()
        msgList.removeAllViews(); addHint()
    }

    private fun bubble(fromUser: Boolean, text: String, image: Bitmap? = null): TextView {
        hintView?.let { msgList.removeView(it); hintView = null }
        val box = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        if (image != null) {
            box.addView(ImageView(this).apply {
                setImageBitmap(image); adjustViewBounds = true; maxHeight = dp(150); scaleType = ImageView.ScaleType.FIT_START
            }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(6) })
        }
        val tv = TextView(this).apply {
            this.text = text; setTextColor(FG); textSize = 15f
            setLineSpacing(0f, 1.15f)
        }
        box.addView(tv)
        if (fromUser) {
            box.background = rounded(Color.parseColor("#26262C"), 14)
            box.setPadding(dp(12), dp(9), dp(12), dp(9))
        } else {
            box.setPadding(dp(2), dp(4), dp(2), dp(4))
            tv.setOnLongClickListener {
                (getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("Orbe", tv.text))
                tv.alpha = 0.5f; tv.postDelayed({ tv.alpha = 1f }, 300); true
            }
        }
        val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
            topMargin = dp(8); gravity = if (fromUser) Gravity.END else Gravity.START
            if (fromUser) leftMargin = dp(40) else rightMargin = dp(8)
        }
        msgList.addView(box, lp)
        msgScroll.post { msgScroll.fullScroll(View.FOCUS_DOWN) }
        return tv
    }

    private fun clean(s: String): String = s.replace("**", "").replace(Regex("(?m)^#{1,4} "), "").replace("`", "")

    private fun send(raw: String) {
        val text = raw.trim()
        if (text.isEmpty() || busy) return
        val key = Prefs.apiKey(this)
        if (key.isBlank()) { bubble(false, "Falta tu API key. Abre la app Orbe y pégala en el paso 1."); return }
        input.setText("")
        busy = true; cancel = false
        sendBtn.text = "■"; orb?.state = OrbView.State.THINKING
        val go = { shot: Bitmap? ->
            bubble(true, text, shot)
            val content = pendingToolResults()
            if (shot != null) {
                content.put(JSONObject().put("type", "image").put("source",
                    JSONObject().put("type", "base64").put("media_type", "image/jpeg").put("data", toBase64(shot))))
            }
            content.put(JSONObject().put("type", "text").put("text", text))
            // las capturas antiguas se reemplazan por texto para ahorrar
            for (i in 0 until history.length()) {
                val m = history.getJSONObject(i)
                val c = m.opt("content")
                if (m.getString("role") == "user" && c is JSONArray) {
                    val nc = JSONArray()
                    for (k in 0 until c.length()) {
                        val part = c.getJSONObject(k)
                        nc.put(if (part.optString("type") == "image") JSONObject().put("type", "text").put("text", "[captura anterior omitida]") else part)
                    }
                    m.put("content", nc)
                }
            }
            history.put(JSONObject().put("role", "user").put("content", content))
            trimHistory()
            val out = bubble(false, "…")
            val model = Prefs.model(this)
            val allowReply = Prefs.allowReply(this)
            Thread {
                val sb = StringBuilder()
                try {
                    val res = Claude.stream(key, model, history, allowReply, { d ->
                        sb.append(d)
                        val now = clean(sb.toString())
                        main.post { orb?.state = OrbView.State.SPEAKING; out.text = now; msgScroll.fullScroll(View.FOCUS_DOWN) }
                    }, { cancel })
                    val full = res.text
                    val blocks = JSONArray()
                    if (full.isNotBlank()) blocks.put(JSONObject().put("type", "text").put("text", full))
                    val cards = ArrayList<Pair<String, JSONObject>>()
                    for (t in res.tools) {
                        blocks.put(JSONObject().put("type", "tool_use").put("id", t.id).put("name", t.name).put("input", t.input))
                        val draft = t.input.optString("texto")
                        if (t.name == Claude.REPLY_TOOL_NAME && draft.isNotBlank()) {
                            proposals[t.id] = Proposal(draft, System.currentTimeMillis()); cards.add(t.id to t.input)
                        }
                    }
                    if (blocks.length() == 0) blocks.put(JSONObject().put("type", "text").put("text", "…"))
                    history.put(JSONObject().put("role", "assistant").put("content", blocks))
                    main.post {
                        if (full.isBlank() && cards.isNotEmpty()) (out.parent as? View)?.let { msgList.removeView(it) }
                        else out.text = clean(full.ifBlank { "(detenido)" })
                        for ((id, input) in cards) draftCard(id, input.optString("texto"), input.optString("para"))
                        if (Prefs.voice(this) && full.isNotBlank()) tts?.speak(clean(full), TextToSpeech.QUEUE_FLUSH, null, "orbe")
                        if (Prefs.sounds(this) && !cancel) Sfx.play(this, "done")
                    }
                } catch (e: Exception) {
                    if (history.length() > 0 && history.getJSONObject(history.length() - 1).getString("role") == "user") history.remove(history.length() - 1)
                    main.post { out.text = if (sb.isNotEmpty()) clean(sb.toString()) else "⚠ " + (e.message ?: "Error de conexión"); out.setTextColor(if (sb.isNotEmpty()) FG else Color.parseColor("#FFB39A")) }
                } finally {
                    main.post { busy = false; sendBtn.text = "➤"; orb?.state = OrbView.State.IDLE }
                }
            }.start()
        }
        if (seeScreen.isChecked) capture { b -> go(b) } else go(null)
    }

    // ---------------- responder por ti ----------------

    /** Si la última respuesta de Claude usó la herramienta, la API exige devolver el resultado en el siguiente mensaje. */
    private fun pendingToolResults(): JSONArray {
        val out = JSONArray()
        if (history.length() == 0) return out
        val last = history.getJSONObject(history.length() - 1)
        val c = last.opt("content")
        if (last.getString("role") != "assistant" || c !is JSONArray) return out
        for (i in 0 until c.length()) {
            val b = c.getJSONObject(i)
            if (b.optString("type") != "tool_use") continue
            val st = when (proposals[b.getString("id")]?.decided) {
                "written" -> "The user authorized it and Orbe typed it into the text box (not sent; the user sends it)."
                "copied" -> "The user copied the draft to paste it themselves."
                "discarded" -> "The user discarded the draft."
                null -> if (proposals.containsKey(b.getString("id"))) "The draft card was shown; the user has not authorized it yet." else "The card could not be shown."
                else -> "The draft card was shown."
            }
            out.put(JSONObject().put("type", "tool_result").put("tool_use_id", b.getString("id")).put("content", st))
        }
        return out
    }

    /** Recorta el historial y se asegura de que empiece con una pregunta del usuario (no con un resultado de herramienta). */
    private fun trimHistory() {
        while (history.length() > 30) history.remove(0)
        while (history.length() > 0) {
            val m = history.getJSONObject(0)
            val c = m.opt("content")
            var isToolResult = false
            if (c is JSONArray) for (i in 0 until c.length()) if (c.getJSONObject(i).optString("type") == "tool_result") isToolResult = true
            if (m.getString("role") == "user" && !isToolResult) break
            history.remove(0)
        }
    }

    private fun note(text: String, ok: Boolean) {
        val tv = bubble(false, text)
        tv.setTextColor(if (ok) Color.parseColor("#9FF0C2") else Color.parseColor("#FFB39A")); tv.textSize = 13f
    }

    private fun copy(text: String) =
        (getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("Orbe", text))

    /** Tarjeta con el borrador. Nada se escribe hasta que el usuario toca Autorizar. */
    private fun draftCard(id: String, draft: String, para: String) {
        hintView?.let { msgList.removeView(it); hintView = null }
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; background = rounded(CARD, 14, ORANGE); setPadding(dp(12), dp(10), dp(12), dp(10))
        }
        card.addView(TextView(this).apply {
            text = if (para.isNotBlank()) "✍ Respuesta para: $para" else "✍ Borrador listo"
            setTextColor(FG); textSize = 13f; setTypeface(typeface, Typeface.BOLD)
        })
        val edit = EditText(this).apply {
            setText(draft); setTextColor(FG); textSize = 15f; background = rounded(BG, 10, LINE)
            setPadding(dp(10), dp(8), dp(10), dp(8)); maxLines = 8
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
        }
        card.addView(edit, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(6) })
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        val buttons = ArrayList<Button>()
        fun cardBtn(label: String, primary: Boolean, onClick: () -> Unit) = Button(this).apply {
            text = label; isAllCaps = false; textSize = 13f
            setTextColor(if (primary) Color.parseColor("#111111") else FG)
            background = rounded(if (primary) ORANGE else BG, 10, if (primary) 0 else LINE)
            minHeight = dp(38); minimumHeight = dp(38); setPadding(dp(10), 0, dp(10), 0)
            setOnClickListener { onClick() }
        }.also { buttons.add(it); row.addView(it, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(38)).apply { rightMargin = dp(6) }) }
        fun finish() { buttons.forEach { it.isEnabled = false }; edit.isEnabled = false; card.alpha = 0.7f }
        cardBtn("✅ Autorizar y escribir", true) {
            val p = proposals[id] ?: return@cardBtn
            val text = edit.text.toString().ifBlank { p.text }
            when {
                !Prefs.allowReply(this) -> note("Activa \"Orbe puede escribir respuestas por mí\" en la app Orbe (paso 4).", false)
                System.currentTimeMillis() - p.created > 15 * 60 * 1000 -> note("Este borrador es antiguo. Pídele a Orbe uno nuevo.", false)
                OrbeAccess.instance == null -> {
                    copy(text); p.decided = "copied"; finish()
                    note("Para escribir por ti, Orbe necesita el permiso de accesibilidad (paso 4 en la app Orbe). Por ahora la dejé copiada: mantén presionado el cuadro de texto y toca Pegar.", false)
                }
                else -> {
                    hidePanel()
                    main.postDelayed({
                        val r = OrbeAccess.instance?.writeInto(text) ?: OrbeAccess.Result.FAILED
                        when (r) {
                            OrbeAccess.Result.OK -> { p.decided = "written"; finish(); orb?.react(OrbView.Reaction.HAPPY)
                                note("Listo, la escribí en el cuadro de texto. Revísala y envíala tú.", true) }
                            OrbeAccess.Result.NOT_PRESENT -> { showPanel(); note("Solo escribo cuando estás usando el teléfono. Desbloquéalo y vuelve a tocar Autorizar.", false) }
                            else -> { copy(text); p.decided = "copied"; finish(); showPanel()
                                note("No encontré dónde escribir. Toca primero el cuadro de texto de la app y vuelve a autorizar, o pégala (ya está copiada).", false) }
                        }
                    }, 450)
                }
            }
        }
        cardBtn("Copiar", false) { proposals[id]?.decided = "copied"; copy(edit.text.toString()); finish(); note("Copiada. Mantén presionado el cuadro de texto y toca Pegar.", true) }
        cardBtn("✕", false) { proposals[id]?.decided = "discarded"; finish() }
        card.addView(HorizontalScrollView(this).apply { isHorizontalScrollBarEnabled = false; addView(row) },
            LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(8) })
        card.addView(TextView(this).apply {
            text = "Edítala si quieres. Al autorizar, Orbe la escribe en el cuadro de texto de la app; el botón Enviar lo tocas tú."
            setTextColor(MUTE); textSize = 11f; setPadding(0, dp(6), 0, 0)
        })
        msgList.addView(card, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(8) })
        msgScroll.post { msgScroll.fullScroll(View.FOCUS_DOWN) }
    }
}
