"""
Orbe Motion - Prototipo 0.2 (calibración refinada)
Controla el PC con gestos de la mano usando solo la cámara web.
Todo se procesa localmente: ninguna imagen sale de tu computador.

Gestos:
  - Solo el índice arriba ........... mover el cursor
  - Juntar pulgar + índice (rápido) . clic
  - Juntar pulgar + índice (mantener) arrastrar
  - Índice + medio arriba ........... desplazar (sube/baja la mano)
  - Índice + medio + anular arriba .. volumen (sube/baja la mano)
  - Puño cerrado (mantener) ......... pausa / reproducir
  - Mano abierta (mantener) ......... activar Orbe (atajo de teclado)

Teclas en la ventana de vista previa:
  C = calibrar   P = pausar / reanudar   Q o ESC = salir
"""

import json
import math
import os
import platform
import sys
import time
import urllib.request

import cv2
import mediapipe as mp
import pyautogui
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision

# ---------------------------------------------------------------- Ajustes
CAMARA = 0
ANCHO_CAM, ALTO_CAM = 640, 480

# Filtro antitemblor (One Euro). Menos MIN_CUTOFF = más estable; más BETA = más ágil.
FILTRO_MIN_CUTOFF = 1.2
FILTRO_BETA = 0.015

FRAMES_CONFIRMAR = 3           # frames seguidos para aceptar un cambio de gesto
TIEMPO_ARRASTRE = 0.45         # segundos de pinza para empezar a arrastrar
ZONA_MUERTA = 0.05             # en scroll/volumen
TIEMPO_PUNO = 0.6
TIEMPO_MANO_ABIERTA = 1.0
ATAJO_ORBE = ("ctrl", "alt", "o")
VELOCIDAD_SCROLL = 900 if platform.system() == "Windows" else 12

CARPETA = os.path.dirname(os.path.abspath(__file__))
MODELO_URL = ("https://storage.googleapis.com/mediapipe-models/hand_landmarker/"
              "hand_landmarker/float16/1/hand_landmarker.task")
MODELO = os.path.join(CARPETA, "hand_landmarker.task")
ARCHIVO_CALIB = os.path.join(CARPETA, "calibracion.json")

CALIB_DEFECTO = {
    "x_min": 0.20, "x_max": 0.80, "y_min": 0.18, "y_max": 0.72,
    "pinza_cerrar": 0.30, "pinza_abrir": 0.45,
}

CONEXIONES = [(0, 1), (1, 2), (2, 3), (3, 4), (0, 5), (5, 6), (6, 7), (7, 8),
              (5, 9), (9, 10), (10, 11), (11, 12), (9, 13), (13, 14), (14, 15),
              (15, 16), (13, 17), (17, 18), (18, 19), (19, 20), (0, 17)]

pyautogui.PAUSE = 0
pyautogui.FAILSAFE = False


# ---------------------------------------------------------------- Utilidades
def descargar_modelo():
    if os.path.exists(MODELO):
        return
    print("Descargando el modelo de manos (solo la primera vez, ~8 MB)...")
    urllib.request.urlretrieve(MODELO_URL, MODELO)
    print("Listo.")


def cargar_calibracion():
    try:
        with open(ARCHIVO_CALIB, encoding="utf-8") as f:
            datos = json.load(f)
        return {**CALIB_DEFECTO, **datos}, True
    except Exception:
        return dict(CALIB_DEFECTO), False


def guardar_calibracion(calib):
    try:
        with open(ARCHIVO_CALIB, "w", encoding="utf-8") as f:
            json.dump(calib, f, indent=2)
    except Exception as e:
        print("No pude guardar la calibración:", e)


def percentil(valores, p):
    v = sorted(valores)
    if not v:
        return 0.0
    k = (len(v) - 1) * p
    i = int(k)
    j = min(i + 1, len(v) - 1)
    return v[i] + (v[j] - v[i]) * (k - i)


class Geometria:
    """Medidas de la mano corrigiendo la proporción de la imagen (4:3)."""

    def __init__(self, aspecto):
        self.aspecto = aspecto  # ancho / alto

    def d(self, a, b):
        return math.sqrt(((a.x - b.x) * self.aspecto) ** 2 + (a.y - b.y) ** 2
                         + ((a.z - b.z) * self.aspecto) ** 2)

    def palma(self, lm):
        # Promedio de tres lados de la palma: estable aunque la mano gire.
        return (self.d(lm[0], lm[5]) + self.d(lm[0], lm[17]) + self.d(lm[5], lm[17])) / 3 or 1e-6

    def pinza(self, lm):
        return self.d(lm[4], lm[8]) / self.palma(lm)

    def dedos_arriba(self, lm):
        """[pulgar, índice, medio, anular, meñique]. Funciona con la mano inclinada."""
        muneca = lm[0]
        otros = []
        for punta, art_media, base in ((8, 6, 5), (12, 10, 9), (16, 14, 13), (20, 18, 17)):
            extendido = self.d(muneca, lm[punta]) > self.d(muneca, lm[art_media]) * 1.12
            recto = self.d(lm[base], lm[punta]) > self.d(lm[base], lm[art_media]) * 1.5
            otros.append(extendido and recto)
        pulgar = self.d(lm[4], lm[17]) > self.d(lm[3], lm[17]) * 1.08 and \
            self.d(lm[4], lm[5]) > self.palma(lm) * 0.45
        return [pulgar] + otros


class OneEuro:
    """Filtro adaptativo: muy estable con la mano quieta, rápido al moverla."""

    def __init__(self, min_cutoff, beta, d_cutoff=1.0):
        self.min_cutoff, self.beta, self.d_cutoff = min_cutoff, beta, d_cutoff
        self.x_prev = self.dx_prev = self.t_prev = None

    @staticmethod
    def _alpha(cutoff, dt):
        tau = 1.0 / (2 * math.pi * cutoff)
        return 1.0 / (1.0 + tau / dt)

    def reset(self):
        self.x_prev = self.dx_prev = self.t_prev = None

    def __call__(self, x, t):
        if self.t_prev is None:
            self.x_prev, self.dx_prev, self.t_prev = x, 0.0, t
            return x
        dt = max(t - self.t_prev, 1e-3)
        dx = (x - self.x_prev) / dt
        a_d = self._alpha(self.d_cutoff, dt)
        dx_hat = a_d * dx + (1 - a_d) * self.dx_prev
        cutoff = self.min_cutoff + self.beta * abs(dx_hat)
        a = self._alpha(cutoff, dt)
        x_hat = a * x + (1 - a) * self.x_prev
        self.x_prev, self.dx_prev, self.t_prev = x_hat, dx_hat, t
        return x_hat


# ---------------------------------------------------------------- Calibración
class Calibrador:
    PASOS = [
        ("zona", 5.0, "1/3  Con SOLO el indice, recorre la zona comoda (bordes)"),
        ("abierta", 2.5, "2/3  Separa bien pulgar e indice y quedate quieto"),
        ("cerrada", 2.5, "3/3  Junta la punta del pulgar con la del indice"),
    ]

    def __init__(self):
        self.activo = False

    def iniciar(self, ahora):
        self.activo = True
        self.paso = 0
        self.inicio_paso = ahora + 1.5  # cuenta regresiva inicial
        self.xs, self.ys, self.abiertas, self.cerradas = [], [], [], []

    def texto(self, ahora):
        nombre, dur, msg = self.PASOS[self.paso]
        if ahora < self.inicio_paso:
            return f"Preparate... {msg}"
        resta = max(0.0, dur - (ahora - self.inicio_paso))
        return f"{msg}  ({resta:.1f}s)"

    def procesar(self, lm, geo, ahora, calib):
        """Devuelve la nueva calibración al terminar, o None."""
        if ahora < self.inicio_paso:
            return None
        nombre, dur, _ = self.PASOS[self.paso]
        if lm is not None:
            if nombre == "zona":
                self.xs.append(lm[8].x)
                self.ys.append(lm[8].y)
            elif nombre == "abierta":
                self.abiertas.append(geo.pinza(lm))
            else:
                self.cerradas.append(geo.pinza(lm))
        if ahora - self.inicio_paso < dur:
            return None
        self.paso += 1
        self.inicio_paso = ahora + 1.0
        if self.paso < len(self.PASOS):
            return None
        return self._terminar(calib)

    def _terminar(self, calib):
        self.activo = False
        nueva = dict(calib)
        if len(self.xs) > 20:
            x0, x1 = percentil(self.xs, 0.04), percentil(self.xs, 0.96)
            y0, y1 = percentil(self.ys, 0.04), percentil(self.ys, 0.96)
            # Se encoge un poco para que llegar a los bordes de la pantalla sea fácil.
            mx, my = (x1 - x0) * 0.06, (y1 - y0) * 0.06
            if x1 - x0 > 0.12 and y1 - y0 > 0.10:
                nueva.update(x_min=x0 + mx, x_max=x1 - mx, y_min=y0 + my, y_max=y1 - my)
        if len(self.abiertas) > 10 and len(self.cerradas) > 10:
            ab = percentil(self.abiertas, 0.5)
            ce = percentil(self.cerradas, 0.5)
            if ab - ce > 0.15:
                nueva["pinza_cerrar"] = ce + (ab - ce) * 0.35
                nueva["pinza_abrir"] = ce + (ab - ce) * 0.55
        guardar_calibracion(nueva)
        return nueva


# ---------------------------------------------------------------- Lógica de gestos
class ControlGestos:
    def __init__(self, geo, calib):
        self.geo = geo
        self.calib = calib
        self.ancho, self.alto = pyautogui.size()
        self.fx = OneEuro(FILTRO_MIN_CUTOFF, FILTRO_BETA)
        self.fy = OneEuro(FILTRO_MIN_CUTOFF, FILTRO_BETA)
        self.pinza = False
        self.pinza_inicio = 0.0
        self.arrastrando = False
        self.ref_y = None
        self.modo_ref = None
        self.ultimo_vol = 0.0
        self.gesto_desde = {}
        self.enfriado_hasta = 0.0
        self.candidato, self.cuenta, self.gesto = None, 0, None
        self.ultimo_cursor = None
        self.valor_pinza = 1.0

    def a_pantalla(self, x, y):
        c = self.calib
        x = (x - c["x_min"]) / max(c["x_max"] - c["x_min"], 1e-3)
        y = (y - c["y_min"]) / max(c["y_max"] - c["y_min"], 1e-3)
        return min(max(x, 0.0), 1.0) * (self.ancho - 1), min(max(y, 0.0), 1.0) * (self.alto - 1)

    def mover(self, lm, ahora):
        # Punto de control: punta del índice mezclada con su base, más estable.
        x = lm[8].x * 0.7 + lm[5].x * 0.3
        y = lm[8].y * 0.7 + lm[5].y * 0.3
        tx, ty = self.a_pantalla(x, y)
        cx, cy = self.fx(tx, ahora), self.fy(ty, ahora)
        self.ultimo_cursor = (cx, cy)
        pyautogui.moveTo(int(cx), int(cy))

    def _sostenido(self, nombre, activo, segundos, ahora):
        if not activo:
            self.gesto_desde.pop(nombre, None)
            return False
        inicio = self.gesto_desde.setdefault(nombre, ahora)
        if ahora - inicio >= segundos and ahora > self.enfriado_hasta:
            self.gesto_desde.pop(nombre, None)
            self.enfriado_hasta = ahora + 1.5
            return True
        return False

    def _clasificar(self, d):
        _, ind, med, anu, men = d
        if all(d):
            return "ABIERTA"
        if not any(d[1:]):
            return "PUNO"
        if ind and med and anu and not men:
            return "VOLUMEN"
        if ind and med and not anu and not men:
            return "SCROLL"
        if ind and not med and not anu and not men:
            return "CURSOR"
        return "MANO"

    def _confirmar(self, gesto):
        if gesto == self.candidato:
            self.cuenta += 1
        else:
            self.candidato, self.cuenta = gesto, 1
        if self.cuenta >= FRAMES_CONFIRMAR or self.gesto is None:
            self.gesto = gesto
        return self.gesto

    def soltar_todo(self):
        if self.arrastrando:
            pyautogui.mouseUp()
        self.arrastrando = False
        self.pinza = False
        self.ref_y = None
        self.modo_ref = None
        self.gesto_desde.clear()
        self.candidato, self.cuenta, self.gesto = None, 0, None
        self.fx.reset()
        self.fy.reset()

    def procesar(self, lm, ahora):
        c = self.calib
        p = self.geo.pinza(lm)
        self.valor_pinza = p

        # --- Pinza (con histéresis): clic o arrastrar
        if not self.pinza and p < c["pinza_cerrar"]:
            self.pinza, self.pinza_inicio = True, ahora
        elif self.pinza and p > c["pinza_abrir"]:
            era_arrastre = self.arrastrando
            if self.arrastrando:
                pyautogui.mouseUp()
                self.arrastrando = False
            elif ahora - self.pinza_inicio < TIEMPO_ARRASTRE:
                pyautogui.click()
            self.pinza = False
            return "SOLTAR" if era_arrastre else "CLIC"

        if self.pinza:
            if not self.arrastrando and ahora - self.pinza_inicio >= TIEMPO_ARRASTRE:
                pyautogui.mouseDown()
                self.arrastrando = True
            if self.arrastrando:
                self.mover(lm, ahora)
                return "ARRASTRAR"
            return "PINZA"  # cursor congelado: el clic cae donde apuntabas

        gesto = self._confirmar(self._clasificar(self.geo.dedos_arriba(lm)))

        if self._sostenido("abierta", gesto == "ABIERTA", TIEMPO_MANO_ABIERTA, ahora):
            pyautogui.hotkey(*ATAJO_ORBE)
            return "ORBE ACTIVADO"
        if self._sostenido("puno", gesto == "PUNO", TIEMPO_PUNO, ahora):
            pyautogui.press("playpause")
            return "PAUSA/PLAY"

        if gesto in ("SCROLL", "VOLUMEN"):
            y = lm[9].y
            if self.modo_ref != gesto:
                self.modo_ref, self.ref_y = gesto, y
            desplaz = self.ref_y - y
            if abs(desplaz) > ZONA_MUERTA:
                if gesto == "SCROLL":
                    pyautogui.scroll(int((desplaz - math.copysign(ZONA_MUERTA, desplaz))
                                         * VELOCIDAD_SCROLL))
                elif ahora - self.ultimo_vol > 0.12:
                    pyautogui.press("volumeup" if desplaz > 0 else "volumedown")
                    self.ultimo_vol = ahora
            return gesto
        self.modo_ref = None

        if gesto == "CURSOR":
            # Si la pinza se está cerrando, se congela el cursor para no desviar el clic.
            if p > c["pinza_cerrar"] * 1.35 or self.ultimo_cursor is None:
                self.mover(lm, ahora)
            return "CURSOR"
        return gesto


# ---------------------------------------------------------------- Dibujo
def dibujar(frame, lm, modo, activo, fps, calib, control, calibrador, ahora):
    h, w = frame.shape[:2]
    pts = [(int(p.x * w), int(p.y * h)) for p in lm] if lm else []
    for a, b in CONEXIONES:
        if pts:
            cv2.line(frame, pts[a], pts[b], (60, 160, 255), 2)
    for p in pts:
        cv2.circle(frame, p, 4, (255, 255, 255), -1)
    if pts:
        cv2.circle(frame, pts[8], 9, (0, 220, 255), 2)

    x0, y0 = int(calib["x_min"] * w), int(calib["y_min"] * h)
    x1, y1 = int(calib["x_max"] * w), int(calib["y_max"] * h)
    cv2.rectangle(frame, (x0, y0), (x1, y1), (0, 140, 255) if activo else (80, 80, 80), 1)

    # Barra de pinza: muestra qué tan cerca está el clic.
    if lm and not calibrador.activo:
        bx, by, bw = w - 30, 60, 14
        bh = h - 120
        v = min(control.valor_pinza / max(calib["pinza_abrir"] * 1.6, 1e-3), 1.0)
        cv2.rectangle(frame, (bx, by), (bx + bw, by + bh), (60, 60, 60), 1)
        lleno = int(bh * (1 - v))
        col = (0, 255, 120) if control.pinza else (0, 180, 255)
        cv2.rectangle(frame, (bx, by + bh - lleno), (bx + bw, by + bh), col, -1)
        for umbral, colu in ((calib["pinza_cerrar"], (0, 255, 120)), (calib["pinza_abrir"], (0, 120, 255))):
            yy = by + bh - int(bh * (1 - min(umbral / max(calib["pinza_abrir"] * 1.6, 1e-3), 1.0)))
            cv2.line(frame, (bx - 4, yy), (bx + bw + 4, yy), colu, 1)

    cv2.rectangle(frame, (0, 0), (w, 34), (20, 20, 20), -1)
    if calibrador.activo:
        texto, color = calibrador.texto(ahora), (0, 255, 255)
    else:
        texto = f"Orbe Motion | {modo}" if activo else "PAUSADO (P para reanudar)"
        color = (0, 200, 255) if activo else (0, 0, 255)
    cv2.putText(frame, texto, (10, 23), cv2.FONT_HERSHEY_SIMPLEX, 0.52, color, 2)
    cv2.rectangle(frame, (0, h - 26), (w, h), (20, 20, 20), -1)
    cv2.putText(frame, f"C calibrar  P pausa  Q salir   {fps:.0f} fps", (10, h - 8),
                cv2.FONT_HERSHEY_SIMPLEX, 0.45, (180, 180, 180), 1)


# ---------------------------------------------------------------- Programa
def main():
    descargar_modelo()
    opciones = vision.HandLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=MODELO),
        running_mode=vision.RunningMode.VIDEO,
        num_hands=1,
        min_hand_detection_confidence=0.7,
        min_hand_presence_confidence=0.6,
        min_tracking_confidence=0.6,
    )
    backend = cv2.CAP_DSHOW if platform.system() == "Windows" else cv2.CAP_ANY
    cam = cv2.VideoCapture(CAMARA, backend)
    cam.set(cv2.CAP_PROP_FRAME_WIDTH, ANCHO_CAM)
    cam.set(cv2.CAP_PROP_FRAME_HEIGHT, ALTO_CAM)
    cam.set(cv2.CAP_PROP_FPS, 30)
    if not cam.isOpened():
        print("No se pudo abrir la cámara. Revisa que no la esté usando otra app.")
        sys.exit(1)

    ok, frame = cam.read()
    alto, ancho = (frame.shape[:2] if ok else (ALTO_CAM, ANCHO_CAM))
    geo = Geometria(ancho / alto)
    calib, existia = cargar_calibracion()
    control = ControlGestos(geo, calib)
    calibrador = Calibrador()
    if not existia:
        calibrador.iniciar(time.time())

    activo, modo, ultimo_ts, fps, t_prev = True, "", 0, 0.0, time.time()
    perdida_desde = None
    print("Orbe Motion en marcha. C = calibrar, P = pausar, Q/ESC = salir.")

    with vision.HandLandmarker.create_from_options(opciones) as detector:
        while True:
            ok, frame = cam.read()
            if not ok:
                continue
            frame = cv2.flip(frame, 1)
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            ts = max(int(time.monotonic() * 1000), ultimo_ts + 1)
            ultimo_ts = ts
            res = detector.detect_for_video(
                mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb), ts)

            ahora = time.time()
            lm = res.hand_landmarks[0] if res.hand_landmarks else None

            if calibrador.activo:
                nueva = calibrador.procesar(lm, geo, ahora, calib)
                if nueva:
                    calib = nueva
                    control.calib = calib
                    control.soltar_todo()
                    print("Calibración guardada:", calib)
                modo = "CALIBRANDO"
            elif lm and activo:
                perdida_desde = None
                modo = control.procesar(lm, ahora)
            else:
                # Tolera perder la mano unos instantes sin soltar el arrastre.
                if perdida_desde is None:
                    perdida_desde = ahora
                if ahora - perdida_desde > 0.3 or not activo:
                    control.soltar_todo()
                modo = "SIN MANO" if not lm else modo

            fps = 0.9 * fps + 0.1 / max(ahora - t_prev, 1e-6)
            t_prev = ahora
            dibujar(frame, lm, modo, activo, fps, calib, control, calibrador, ahora)
            cv2.imshow("Orbe Motion", frame)

            tecla = cv2.waitKey(1) & 0xFF
            if tecla in (ord("q"), 27):
                break
            if tecla == ord("p"):
                activo = not activo
                control.soltar_todo()
            if tecla == ord("c"):
                control.soltar_todo()
                calibrador.iniciar(ahora)

    control.soltar_todo()
    cam.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
