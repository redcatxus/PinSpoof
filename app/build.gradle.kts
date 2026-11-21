plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
}

base {
    archivesName.set("PinSpoof-v1.5.0")
}

android {
    namespace = "us.redcatx.pinspoof"
    compileSdk {
        version = release(37) {
            minorApiLevel = 1
        }
    }

    defaultConfig {
        applicationId = "us.redcatx.pinspoof"
        minSdk = 24
        targetSdk = 36
        versionCode = 8
        versionName = "1.5.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            signingConfig = signingConfigs.getByName("debug")
        }
        debug {
            isMinifyEnabled = false
        }
    }

    buildFeatures {
        compose = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    // Must be compileOnly — LSPosed provides the Xposed runtime classes at injection time
    compileOnly("de.robv.android.xposed:api:82")
    implementation(platform("androidx.compose:compose-bom:2026.11.01"))
    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material:material-icons-extended")
    // Stable Material 3 Expressive 1.5.0 resolved via Compose BOM 2026.11.01
    implementation("androidx.compose.material3:material3")
}
