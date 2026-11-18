plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

base {
    archivesName.set("PinSpoof-v1.3.1")
}

android {
    namespace = "us.redcatx.pinspoof"
    compileSdk = 36

    defaultConfig {
        applicationId = "us.redcatx.pinspoof"
        minSdk = 24
        targetSdk = 36
        versionCode = 5
        versionName = "1.3.1"
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

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    // Must be compileOnly — LSPosed provides the Xposed runtime classes at injection time
    compileOnly("de.robv.android.xposed:api:82")
    implementation(platform("androidx.compose:compose-bom:2026.03.01"))
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material:material-icons-extended")
    // Material 3 1.5.0-alpha15 provides MaterialExpressiveTheme while targeting minCompileSdk 35 (compatible with Android 16 / compileSdk 36)
    implementation("androidx.compose.material3:material3:1.5.0-alpha15")
}
