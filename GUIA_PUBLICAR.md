# Guía para publicar Orbe (paso a paso, sin programar)

Tiempo total: unos 20 minutos la primera vez. Después, publicar una versión nueva toma 2 minutos.

---

## 1. Crear tu cuenta de GitHub

1. Entra a <https://github.com/signup> y crea tu cuenta (es gratis).
2. Confirma tu correo.

## 2. Crear el repositorio y subir Orbe

1. Entra a <https://github.com/new>.
2. En **Repository name** escribe: `orbe`
3. Marca **Public**. No marques nada más.
4. Toca **Create repository**.
5. En la página que aparece, toca el enlace **"uploading an existing file"**.
6. Descomprime `Orbe-repo.zip` en tu PC, abre la carpeta `orbe` y **arrastra todo su contenido** (no la carpeta, sino lo que hay dentro) a la página de GitHub.
   - Importante: la carpeta `.github` a veces no se ve en Windows. Activa en el Explorador **Vista → Mostrar → Elementos ocultos** antes de arrastrar.
   - Si GitHub no acepta la carpeta `.github` al arrastrar, créala a mano: botón **Add file → Create new file**, escribe como nombre `.github/workflows/release.yml` y pega el contenido de ese archivo.
7. Abajo toca **Commit changes**.

## 3. Configurar la firma de Android (una sola vez)

Esto permite que las actualizaciones del APK se instalen encima de la versión anterior.

1. En tu repositorio: **Settings → Secrets and variables → Actions → New repository secret**.
2. Abre el archivo `Orbe_firma_android_PRIVADO.txt` que te entregué y crea los **4 secretos** que indica, uno por uno (nombre y valor).
3. Guarda ese archivo en un lugar seguro y **nunca lo subas al repositorio**.

## 4. Publicar la primera versión

1. En tu repositorio, a la derecha, toca **Releases → Create a new release**.
2. En **Choose a tag** escribe `v1.0.0` y toca **Create new tag: v1.0.0 on publish**.
3. Título: `Orbe 1.0.0`. Toca **Publish release**.
4. Ve a la pestaña **Actions**: verás "Publicar versión" trabajando (unos 10 minutos).
5. Cuando termine con ✅, vuelve a **Releases**: estarán el `.exe` de Windows, el `.apk` de Android y el `.AppImage` de Linux listos para descargar.

> Los archivos se agregan solos al mismo release que creaste.

## 5. Activar la página de descarga

1. **Settings → Pages**.
2. En **Source** elige **Deploy from a branch**, rama **main**, carpeta **/docs**. Guarda.
3. En 1 o 2 minutos tu página estará en `https://TU_USUARIO.github.io/orbe/`. Esa es la que compartes con todos.

## 6. Probar en tu celular

1. Desde tu celular Android abre la página de descarga (o Releases) y descarga el `.apk`.
2. Ábrelo. Android pedirá permitir instalar apps de este origen: acepta.
3. Abre Orbe y sigue los 3 pasos de la pantalla.

## Publicar una versión nueva (cuando cambies algo)

1. Edita `package.json` y cambia `"version": "1.0.0"` por `"1.0.1"` (Windows/Linux necesitan que coincida).
2. Crea un release nuevo con la etiqueta `v1.0.1`.
3. Listo: los instaladores se arman solos y las apps de PC se actualizan automáticamente.

## Si algo falla

- En **Actions**, entra a la ejecución con ❌, abre el paso en rojo y copia el error. Pásaselo a Claude y lo corregimos.
