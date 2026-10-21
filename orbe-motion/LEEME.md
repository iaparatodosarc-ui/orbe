# Orbe Motion — prototipo 0.1

Controla tu PC con gestos de la mano usando solo la cámara web. Todo se procesa en tu computador: ninguna imagen se envía a internet.

## Cómo usarlo (Windows)

1. Instala **Python 3.11** desde python.org y marca **"Add Python to PATH"**.
2. Haz doble clic en **INICIAR_ORBE_MOTION.bat**.
   La primera vez instala todo y descarga el modelo de manos (unos minutos). Las siguientes veces abre al tiro.
3. Se abre una ventana con tu cámara. Pon la mano dentro del recuadro gris.

## Gestos

| Gesto | Acción |
|---|---|
| ☝️ Solo el índice arriba | Mover el cursor |
| 🤏 Juntar pulgar e índice (rápido) | Clic |
| 🤏 Juntar pulgar e índice (mantener) | Arrastrar |
| ✌️ Índice + medio arriba, subir/bajar la mano | Desplazar la página |
| 🤟 Índice + medio + anular, subir/bajar la mano | Volumen |
| ✊ Puño cerrado (mantener) | Pausa / reproducir |
| 🖐️ Mano abierta (mantener 1 s) | Activar Orbe (atajo Ctrl+Alt+O) |

Teclas: **C** calibrar, **P** pausa o reanuda el control, **Q** o **ESC** cierra.

## Ajustes

Al inicio de `orbe_motion.py` están los valores que puedes cambiar: suavizado del cursor, sensibilidad de la pinza, velocidad de scroll y el atajo de Orbe.

## Consejos

- Buena luz de frente funciona mucho mejor que luz detrás.
- Mantén la mano a unos 40–70 cm de la cámara.
- Si el cursor tiembla, baja `SUAVIZADO`; si se siente lento, súbelo.
