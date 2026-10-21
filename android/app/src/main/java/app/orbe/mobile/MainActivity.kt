package app.orbe.mobile

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.text.InputType
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast

/** Pantalla de configuración: API key, permiso para flotar y botón para iniciar el orbe. */
class MainActivity : Activity() {

    private val ORANGE = Color.parseColor("#FF5A1F")
    private val BG = Color.parseColor("#0C0C0E")
    private val CARD = Color.parseColor("#1B1B1F")
    private val LINE = Color.parseColor("#2C2C32")
    private val FG = Color.parseColor("#F2F1EC")
    private val MUTE = Color.parseColor("#8E8E95")
    private val REQ_CAPTURE = 41

    private lateinit var keyInput: EditText
    private lateinit var modelInput: EditText
    private lateinit var overlayBtn: Button
    private lateinit var startBtn: Button
    private lateinit var accessBtn: Button
    private lateinit var replyBox: CheckBox
    private lateinit var blinkModeBtn: Button
    private lateinit var blinkAccessBtn: Button
    private lateinit var blinkStartBtn: Button
    private val REQ_CAMERA = 42

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()
    private fun rounded(color: Int, r: Int, stroke: Int = 0) = GradientDrawable().apply {
        setColor(color); cornerRadius = dp(r).toFloat(); if (stroke != 0) setStroke(dp(1), stroke)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = BG
        window.navigationBarColor = BG
        val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(22), dp(28), dp(22), dp(28)) }
        val scroll = ScrollView(this).apply { setBackgroundColor(BG); addView(col) }

        val orbDemo = OrbView(this).apply { soundsOn = { Prefs.sounds(this@MainActivity) } }
        orbDemo.setOnClickListener { orbDemo.react() }
        col.addView(orbDemo, LinearLayout.LayoutParams(dp(124), dp(124)).apply { gravity = Gravity.CENTER_HORIZONTAL; bottomMargin = dp(4) })
        col.addView(TextView(this).apply { text = "Orbe"; textSize = 34f; setTextColor(FG); setTypeface(typeface, Typeface.BOLD); gravity = Gravity.CENTER })
        col.addView(TextView(this).apply {
            text = "Tu asistente de IA flotante, hecho para Claude. Aparece encima de cualquier app y ve lo que tienes en pantalla para ayudarte en tiempo real. Tócalo: cada vez reacciona distinto."
            textSize = 14f; setTextColor(MUTE); gravity = Gravity.CENTER; setPadding(0, dp(6), 0, dp(22))
        })

        // Paso 1
        col.addView(step("1", "Tu API key de Claude (Anthropic)"))
        keyInput = field("sk-ant-...", true).also { col.addView(it, fieldLp()) }
        if (Prefs.apiKey(this).isNotBlank()) keyInput.hint = "Guardada •••• " + Prefs.apiKey(this).takeLast(4)
        col.addView(link("Crear una API key en console.anthropic.com →") {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://console.anthropic.com/settings/keys")))
        })
        col.addView(TextView(this).apply {
            text = "Modelo de Claude: " + Prefs.MODELS.joinToString("  ·  ") { "${it.first} (${it.second.substringAfter("· ")})" }
            setTextColor(MUTE); textSize = 12f; setPadding(0, dp(10), 0, 0)
        })
        modelInput = field(Prefs.DEFAULT_MODEL, false).also { it.setText(Prefs.model(this)); col.addView(it, fieldLp()) }
        col.addView(button("Guardar", false) { save() }, btnLp())

        // Paso 2
        col.addView(step("2", "Permitir que Orbe flote sobre otras apps"))
        overlayBtn = button("Dar permiso", false) {
            startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName")))
        }
        col.addView(overlayBtn, btnLp())

        // Paso 3
        col.addView(step("3", "Encender Orbe"))
        col.addView(TextView(this).apply {
            text = "Android te pedirá permiso para ver tu pantalla. Orbe solo envía una captura cuando tú le preguntas algo con \"Ver mi pantalla\" activado."
            setTextColor(MUTE); textSize = 12f; setPadding(0, 0, 0, dp(8))
        })
        startBtn = button("▶  Iniciar Orbe", true) { start() }
        col.addView(startBtn, btnLp())
        col.addView(button("Detener Orbe", false) {
            startService(Intent(this, OrbeService::class.java).setAction(OrbeService.ACTION_STOP))
            refresh()
        }, btnLp())

        // Paso 4 (opcional)
        col.addView(step("4", "Opciones"))
        col.addView(CheckBox(this).apply {
            text = "Sonidos del orbe"; setTextColor(FG); textSize = 14f; isChecked = Prefs.sounds(this@MainActivity)
            buttonTintList = android.content.res.ColorStateList.valueOf(ORANGE)
            setOnCheckedChangeListener { _, v -> Prefs.of(this@MainActivity).edit().putBoolean("sounds", v).apply() }
        })
        replyBox = CheckBox(this).apply {
            text = "Orbe puede escribir respuestas por mí"; setTextColor(FG); textSize = 14f; isChecked = Prefs.allowReply(this@MainActivity)
            buttonTintList = android.content.res.ColorStateList.valueOf(ORANGE)
            setOnCheckedChangeListener { _, v -> Prefs.of(this@MainActivity).edit().putBoolean("allowReply", v).apply(); refresh() }
        }
        col.addView(replyBox)
        col.addView(TextView(this).apply {
            text = "Cuando le pidas responder un mensaje, Orbe te muestra el borrador. Solo lo escribe en la app si tú tocas \"Autorizar\" con el teléfono desbloqueado, y nunca toca Enviar: eso lo haces tú. Para escribir necesita el permiso de accesibilidad (Ajustes → Accesibilidad → Apps instaladas → Orbe · escribir respuestas)."
            setTextColor(MUTE); textSize = 12f; setPadding(0, dp(4), 0, 0)
        })
        accessBtn = button("Dar permiso para escribir", false) {
            startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
        }
        col.addView(accessBtn, btnLp())
        // Paso 5 (opcional): bajar reels con un parpadeo
        col.addView(step("5", "Bajar reels con un parpadeo"))
        col.addView(TextView(this).apply {
            text = "En Instagram, Facebook, TikTok o YouTube, cierra los ojos un momento y Orbe pasa al siguiente reel. La cámara frontal solo se enciende mientras una de esas apps está en pantalla, y las imágenes se analizan en tu teléfono: nunca se guardan ni se envían. Los parpadeos normales no cuentan."
            setTextColor(MUTE); textSize = 12f; setPadding(0, 0, 0, dp(4))
        })
        blinkModeBtn = button("", false) {
            val next = if (Prefs.blinkMode(this) == BlinkDetector.Mode.LARGO) "DOBLE" else "LARGO"
            Prefs.of(this).edit().putString("blinkMode", next).apply()
            if (BlinkService.running) startService(Intent(this, BlinkService::class.java))
            refresh()
        }
        col.addView(blinkModeBtn, btnLp())
        blinkAccessBtn = button("Dar permiso «Orbe · parpadeo»", false) {
            toast("Busca «Orbe · parpadeo» en Accesibilidad y actívalo")
            startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
        }
        col.addView(blinkAccessBtn, btnLp())
        blinkStartBtn = button("", true) { toggleBlink() }
        col.addView(blinkStartBtn, btnLp())

        col.addView(TextView(this).apply {
            text = "Orbe es código abierto (MIT). El uso de la API de Claude se cobra según tu consumo, aparte de tu plan de Claude."
            setTextColor(MUTE); textSize = 11f; gravity = Gravity.CENTER; setPadding(0, dp(24), 0, 0)
        })
        setContentView(scroll)

        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 7)
        }
    }

    override fun onResume() { super.onResume(); refresh() }

    private fun refresh() {
        val ok = Settings.canDrawOverlays(this)
        overlayBtn.text = if (ok) "✓ Permiso concedido" else "Dar permiso"
        overlayBtn.isEnabled = !ok
        startBtn.text = if (OrbeService.running) "✓ Orbe está activo (abrir chat)" else "▶  Iniciar Orbe"
        accessBtn.visibility = if (replyBox.isChecked) android.view.View.VISIBLE else android.view.View.GONE
        accessBtn.text = if (OrbeAccess.enabled) "✓ Permiso para escribir activo" else "Dar permiso para escribir"
        blinkModeBtn.text = if (Prefs.blinkMode(this) == BlinkDetector.Mode.LARGO)
            "Gesto: ojos cerrados medio segundo (tocar para cambiar)" else "Gesto: doble parpadeo rápido (tocar para cambiar)"
        blinkAccessBtn.text = if (BlinkAccess.enabled) "✓ Permiso «Orbe · parpadeo» activo" else "Dar permiso «Orbe · parpadeo»"
        blinkStartBtn.text = if (BlinkService.running) "■  Apagar control por parpadeo" else "👁  Encender control por parpadeo"
    }

    private fun save(): Boolean {
        val k = keyInput.text.toString().trim()
        val e = Prefs.of(this).edit()
        if (k.isNotEmpty()) e.putString("apiKey", k)
        val m = modelInput.text.toString().trim()
        if (m.isNotEmpty()) e.putString("model", m)
        e.apply()
        if (k.isNotEmpty()) { keyInput.setText(""); keyInput.hint = "Guardada •••• " + k.takeLast(4) }
        Toast.makeText(this, "Guardado", Toast.LENGTH_SHORT).show()
        return true
    }

    private fun start() {
        if (keyInput.text.isNotBlank()) save()
        if (Prefs.apiKey(this).isBlank()) { toast("Primero pega tu API key (paso 1)"); return }
        if (!Settings.canDrawOverlays(this)) { toast("Falta el permiso para flotar (paso 2)"); return }
        if (OrbeService.running) { startService(Intent(this, OrbeService::class.java)); moveTaskToBack(true); return }
        val mpm = getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        @Suppress("DEPRECATION")
        startActivityForResult(mpm.createScreenCaptureIntent(), REQ_CAPTURE)
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        @Suppress("DEPRECATION")
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQ_CAPTURE) return
        if (resultCode != RESULT_OK || data == null) { toast("Sin permiso de pantalla, Orbe no puede ver."); return }
        val i = Intent(this, OrbeService::class.java)
            .putExtra(OrbeService.EXTRA_CODE, resultCode)
            .putExtra(OrbeService.EXTRA_DATA, data)
        startForegroundService(i)
        toast("Orbe activo. Abre cualquier app y toca el orbe.")
        moveTaskToBack(true)
    }

    private fun toggleBlink() {
        if (BlinkService.running) {
            startService(Intent(this, BlinkService::class.java).setAction(BlinkService.ACTION_STOP))
            blinkStartBtn.postDelayed({ refresh() }, 300)
            return
        }
        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.CAMERA), REQ_CAMERA)
            return
        }
        if (!BlinkAccess.enabled) { toast("Falta el permiso «Orbe · parpadeo» (botón de arriba)"); return }
        startForegroundService(Intent(this, BlinkService::class.java))
        toast("Listo. Abre Instagram o Facebook y cierra los ojos un momento para pasar de reel.")
        blinkStartBtn.postDelayed({ refresh() }, 300)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQ_CAMERA) {
            if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) toggleBlink()
            else toast("Sin permiso de cámara no puedo ver tus parpadeos.")
        }
    }

    private fun toast(s: String) = Toast.makeText(this, s, Toast.LENGTH_LONG).show()

    private fun step(n: String, title: String) = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setPadding(0, dp(18), 0, dp(8))
        addView(TextView(this@MainActivity).apply {
            text = n; setTextColor(Color.parseColor("#111111")); textSize = 14f; setTypeface(typeface, Typeface.BOLD)
            gravity = Gravity.CENTER; background = rounded(ORANGE, 8)
        }, LinearLayout.LayoutParams(dp(28), dp(28)).apply { rightMargin = dp(10) })
        addView(TextView(this@MainActivity).apply { text = title; setTextColor(FG); textSize = 16f; setTypeface(typeface, Typeface.BOLD) })
    }

    private fun field(hintText: String, secret: Boolean) = EditText(this).apply {
        hint = hintText; setHintTextColor(MUTE); setTextColor(FG); textSize = 15f; setSingleLine(true)
        background = rounded(CARD, 12, LINE); setPadding(dp(12), dp(12), dp(12), dp(12))
        inputType = if (secret) InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD else InputType.TYPE_CLASS_TEXT
    }

    private fun fieldLp() = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)

    private fun btnLp() = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(50)).apply { topMargin = dp(10) }

    private fun button(label: String, primary: Boolean, onClick: () -> Unit) = Button(this).apply {
        text = label; isAllCaps = false; textSize = 15f
        setTextColor(if (primary) Color.parseColor("#111111") else FG)
        background = rounded(if (primary) ORANGE else CARD, 12, if (primary) 0 else LINE)
        setOnClickListener { onClick() }
    }

    private fun link(label: String, onClick: () -> Unit) = TextView(this).apply {
        text = label; setTextColor(ORANGE); textSize = 13f; setPadding(0, dp(8), 0, 0)
        setOnClickListener { onClick() }
    }
}
