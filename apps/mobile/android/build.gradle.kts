allprojects {
    repositories {
        google()
        mavenCentral()
    }
}

val newBuildDir: Directory =
    rootProject.layout.buildDirectory
        .dir("../../build")
        .get()
rootProject.layout.buildDirectory.value(newBuildDir)

subprojects {
    val newSubprojectBuildDir: Directory = newBuildDir.dir(project.name)
    project.layout.buildDirectory.value(newSubprojectBuildDir)
}

subprojects {
    project.evaluationDependsOn(":app")
}

subprojects {
    val configurePlugin = {
        val androidExt = project.extensions.findByName("android") as? com.android.build.gradle.BaseExtension
        if (androidExt != null) {
            if (androidExt.namespace == null) {
                androidExt.namespace = "dev.isar.${project.name.replace("-", "_")}"
            }
            androidExt.compileSdkVersion(36)
        }
    }
    if (project.state.executed) {
        configurePlugin()
    } else {
        project.afterEvaluate {
            configurePlugin()
        }
    }
}

tasks.register<Delete>("clean") {
    delete(rootProject.layout.buildDirectory)
}
