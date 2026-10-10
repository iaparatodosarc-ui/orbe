plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Firma: si existen las variables ORBE_KEYSTORE (ruta), ORBE_KEYSTORE_PASSWORD, ORBE_KEY_ALIAS y ORBE_KEY_PASSWORD
// se firma la versión release con tu llave. Si no, se usa la llave de depuración.
val ks = System.getenv("ORBE_KEYSTORE")

android {
    namespace = "app.orbe.mobile"
    compileSdk = 34

    defaultConfig {
        applicationId = "app.orbe.mobile"
        minSdk = 26
        targetSdk = 34
        versionCode = (System.getenv("ORBE_VERSION_CODE") ?: "1").toInt()
        versionName = System.getenv("ORBE_VERSION_NAME") ?: "1.0.0"
    }

    signingConfigs {
        if (ks != null && file(ks).exists()) {
            create("orbe") {
                storeFile = file(ks)
                storePassword = System.getenv("ORBE_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ORBE_KEY_ALIAS")
                keyPassword = System.getenv("ORBE_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = if (ks != null && file(ks).exists()) signingConfigs.getByName("orbe") else signingConfigs.getByName("debug")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}
