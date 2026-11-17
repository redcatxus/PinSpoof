import org.jetbrains.kotlin.gradle.dsl.JvmTarget

group = "us.redcatx.pinspoof"

patches {
    about {
        name = "PinSpoof Patches"
        description = "Disable app pinning, spoof LockTask pinned state, and hide focus/Recents loss via Morphe patching options."
        source = "https://github.com/redcatxus/PinSpoof.git"
        author = "redcatx"
        contact = "na"
        website = "https://github.com/redcatxus/PinSpoof"
        license = "GPLv3"
    }
}

val patchListGeneratorClasspath = configurations.create("patchListGeneratorClasspath")

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_11)
    }
}

dependencies {
    compileOnly(libs.gson)
    patchListGeneratorClasspath(libs.gson)
}

tasks {
    register<JavaExec>("generatePatchesList") {
        description = "Build patch list JSON manifest from compiled .mpp bundle"
        dependsOn("buildAndroid")
        classpath = sourceSets["main"].runtimeClasspath + patchListGeneratorClasspath
        mainClass.set("util.PatchListGeneratorKt")
    }

    publish {
        dependsOn("generatePatchesList")
    }
}
