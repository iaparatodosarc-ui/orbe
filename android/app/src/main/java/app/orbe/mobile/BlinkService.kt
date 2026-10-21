package app.orbe.mobile

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.drawable.Icon
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.util.Size
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleService
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.core.Delegate
import com.google.mediapipe.tasks.vision.core.ImageProcessingOptions
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.facelandmarker.FaceLandmarker
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.Executors

/**
 * Bajar reels con un parpadeo.
 * - La cámara frontal se enciende SOLO mientras Instagram, Facebook, TikTok o YouTube están en pantalla.
 * - Las imágenes se analizan en el teléfono, en memoria: nunca se guardan ni se envían a internet.
 * - Una notificación visible indica que está activo y permite detenerlo.
 */
class BlinkService : LifecycleService() {

    companion object {
        const val ACTION_STOP = "app.orbe.mobile.BLINK_STOP"
        private const val CHANNEL = "orbe_blink"
        private const val NOTIF_ID = 2
        private const val MODEL_URL =
            "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"
        @Volatile var running = false
        val TARGETS = setOf(
            "com.instagram.android",
            "com.instagram.lite",
            "com.facebook.katana",
            "com.facebook.lite",
            "com.zhiliaoapp.musically",
            "com.ss.android.ugc.trill",
            "com.google.android.youtube",
        )
    }

    private val main = Handler(Looper.getMainLooper())
    private val analysisExec = Executors.newSingleThreadExecutor()
    private var provider: ProcessCameraProvider? = null
    @Volatile private var landmarker: FaceLandmarker? = null
    @Volatile private var cameraOn = false
    private var status = ""
    private val detector = BlinkDetector { main.post { onGesture() } }

    private val watcher = object : Runnable {
        override fun run() {
            if (!running) return
            val access = BlinkAccess.instance
            val want = landmarker != null && access != null && access.userPresent() &&
                access.foregroundPackage() in TARGETS
            if (want && !cameraOn) startCamera()
            if (!want && cameraOn) stopCamera()
            val s = when {
                access == null -> "Falta el permiso de accesibilidad «Orbe · parpadeo»"
                landmarker == null -> "Preparando el detector de ojos..."
                cameraOn -> "Mirando tus ojos · parpadea para pasar"
                else -> "En espera · se activa en Instagram, Facebook, TikTok o YouTube"
            }
            if (s != status) { status = s; notifyStatus() }
            main.postDelayed(this, 700)
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        super.onStartCommand(intent, flags, startId)
        if (intent?.action == ACTION_STOP) { stopSelf(); return START_NOT_STICKY }
        detector.mode = Prefs.blinkMode(this)
        if (!running) {
            running = true
            startForegroundCompat()
            Thread { prepareModel() }.start()
            main.post(watcher)
        }
        return START_STICKY
    }

    override fun onDestroy() {
        running = false
        main.removeCallbacksAndMessages(null)
        stopCamera()
        analysisExec.execute { landmarker?.close(); landmarker = null }
        analysisExec.shutdown()
        super.onDestroy()
    }

    // ---------------------------------------------------------------- Modelo
    private fun prepareModel() {
        try {
            val file = File(filesDir, "face_landmarker.task")
            if (!file.exists() || file.length() < 1_000_000) {
                status = "Descargando el detector de ojos (solo la primera vez, ~4 MB)..."
                main.post { notifyStatus() }
                val tmp = File(filesDir, "face_landmarker.tmp")
                val con = URL(MODEL_URL).openConnection() as HttpURLConnection
                con.connectTimeout = 15000; con.readTimeout = 30000
                con.inputStream.use { input -> tmp.outputStream().use { input.copyTo(it) } }
                tmp.renameTo(file)
            }
            val bytes = file.readBytes()
            val buffer = ByteBuffer.allocateDirect(bytes.size).order(ByteOrder.nativeOrder()).put(bytes)
            buffer.rewind()
            val options = FaceLandmarker.FaceLandmarkerOptions.builder()
                .setBaseOptions(BaseOptions.builder().setModelAssetBuffer(buffer).setDelegate(Delegate.CPU).build())
                .setRunningMode(RunningMode.VIDEO)
                .setNumFaces(1)
                .setOutputFaceBlendshapes(true)
                .setMinFaceDetectionConfidence(0.5f)
                .setMinTrackingConfidence(0.5f)
                .build()
            landmarker = FaceLandmarker.createFromOptions(this, options)
        } catch (e: Exception) {
            status = "No pude preparar el detector: revisa tu conexión y vuelve a encenderlo"
            main.post { notifyStatus() }
        }
    }

    // ---------------------------------------------------------------- Cámara
    private fun startCamera() {
        cameraOn = true
        detector.reset()
        val future = ProcessCameraProvider.getInstance(this)
        future.addListener({
            if (!cameraOn || !running) return@addListener
            val p = future.get().also { provider = it }
            val analysis = ImageAnalysis.Builder()
                .setResolutionSelector(
                    ResolutionSelector.Builder().setResolutionStrategy(
                        ResolutionStrategy(Size(640, 480), ResolutionStrategy.FALLBACK_RULE_CLOSEST_LOWER_THEN_HIGHER)
                    ).build()
                )
                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888)
                .build()
            analysis.setAnalyzer(analysisExec) { analyze(it) }
            try {
                p.unbindAll()
                p.bindToLifecycle(this, CameraSelector.DEFAULT_FRONT_CAMERA, analysis)
            } catch (e: Exception) {
                cameraOn = false
            }
        }, ContextCompat.getMainExecutor(this))
    }

    private fun stopCamera() {
        cameraOn = false
        try { provider?.unbindAll() } catch (_: Exception) {}
        detector.reset()
    }

    private var lastTs = 0L

    private fun analyze(proxy: ImageProxy) {
        try {
            val lm = landmarker ?: return
            val bitmap = proxy.toBitmap()
            val image = BitmapImageBuilder(bitmap).build()
            val opts = ImageProcessingOptions.builder().setRotationDegrees(proxy.imageInfo.rotationDegrees).build()
            val ts = maxOf(System.currentTimeMillis(), lastTs + 1).also { lastTs = it }
            val result = lm.detectForVideo(image, opts, ts)
            val shapes = result.faceBlendshapes()
            if (!shapes.isPresent || shapes.get().isEmpty()) { detector.reset(); return }
            var left = 0f; var right = 0f
            for (c in shapes.get()[0]) {
                when (c.categoryName()) {
                    "eyeBlinkLeft" -> left = c.score()
                    "eyeBlinkRight" -> right = c.score()
                }
            }
            detector.update(left, right, ts)
        } catch (_: Exception) {
        } finally {
            proxy.close()
        }
    }

    // ---------------------------------------------------------------- Acción
    private fun onGesture() {
        val access = BlinkAccess.instance ?: return
        if (access.foregroundPackage() !in TARGETS) return
        if (access.nextReel()) vibrate()
    }

    private fun vibrate() {
        try {
            @Suppress("DEPRECATION")
            val v = getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
            v.vibrate(VibrationEffect.createOneShot(25, VibrationEffect.DEFAULT_AMPLITUDE))
        } catch (_: Exception) {}
    }

    // ---------------------------------------------------------------- Notificación
    private fun buildNotification(): Notification {
        val stop = PendingIntent.getService(
            this, 2, Intent(this, BlinkService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val open = PendingIntent.getActivity(
            this, 3, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE
        )
        return Notification.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_menu_view)
            .setContentTitle("Orbe · parpadeo")
            .setContentText(status.ifBlank { "Activo" })
            .setContentIntent(open)
            .setOngoing(true)
            .addAction(Notification.Action.Builder(
                Icon.createWithResource(this, android.R.drawable.ic_menu_close_clear_cancel), "Detener", stop).build())
            .build()
    }

    private fun startForegroundCompat() {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.createNotificationChannel(NotificationChannel(CHANNEL, "Orbe · parpadeo", NotificationManager.IMPORTANCE_LOW))
        val n = buildNotification()
        if (Build.VERSION.SDK_INT >= 30) startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA)
        else startForeground(NOTIF_ID, n)
    }

    private fun notifyStatus() {
        if (!running) return
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(NOTIF_ID, buildNotification())
    }
}
