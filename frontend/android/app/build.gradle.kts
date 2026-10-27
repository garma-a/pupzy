import java.io.FileInputStream
import java.util.Properties

plugins {
    id("com.android.application")
    // START: FlutterFire Configuration
    id("com.google.gms.google-services")
    // END: FlutterFire Configuration
    id("kotlin-android")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

// Release signing. Google Play rejects bundles signed with the debug key, so a
// store build needs the upload keystore described in android/key.properties
// (see android/key.properties.example). Neither file is committed.
val keystorePropertiesFile = rootProject.file("key.properties")
val keystoreProperties = Properties().apply {
    if (keystorePropertiesFile.exists()) {
        FileInputStream(keystorePropertiesFile).use { load(it) }
    }
}
val hasReleaseKeystore = keystorePropertiesFile.exists()
if (hasReleaseKeystore) {
    val missing = listOf("storeFile", "storePassword", "keyAlias", "keyPassword")
        .filter { keystoreProperties.getProperty(it).isNullOrBlank() }
    if (missing.isNotEmpty()) {
        throw GradleException("android/key.properties is missing: ${missing.joinToString()}")
    }
}

android {
    namespace = "com.pupzy.app"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        // flutter_local_notifications needs java.time on older Android versions.
        isCoreLibraryDesugaringEnabled = true
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = JavaVersion.VERSION_17.toString()
    }

    defaultConfig {
        // The app's identity on Google Play; it can never change once published.
        // com.pupzy.app is taken on Play by another developer, so Android uses
        // net.pupzy.app (from pupzy.net). The Kotlin namespace and the iOS bundle
        // ID stay com.pupzy.app.
        applicationId = "net.pupzy.app"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        if (hasReleaseKeystore) {
            create("release") {
                // A relative storeFile is resolved from the android/ folder.
                storeFile = rootProject.file(keystoreProperties.getProperty("storeFile"))
                storePassword = keystoreProperties.getProperty("storePassword")
                keyAlias = keystoreProperties.getProperty("keyAlias")
                keyPassword = keystoreProperties.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            signingConfig = if (hasReleaseKeystore) {
                signingConfigs.getByName("release")
            } else {
                // Lets `flutter run --release` work without the upload key.
                // Such a build cannot be uploaded to Google Play.
                if (gradle.startParameter.taskNames.any { it.contains("Release", ignoreCase = true) }) {
                    logger.warn("android/key.properties not found: signing the release build with the DEBUG key. Do not upload it to Google Play.")
                }
                signingConfigs.getByName("debug")
            }
        }
    }
}

flutter {
    source = "../.."
}

dependencies {
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.4")
}
