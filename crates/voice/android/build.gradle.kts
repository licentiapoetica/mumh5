plugins { id("com.android.library"); id("org.jetbrains.kotlin.android") }
android {
 namespace = "org.mumh5.voice"
 compileSdk = 36
 defaultConfig { minSdk = 26 }
 compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
 kotlinOptions { jvmTarget = "17" }
}
dependencies {
    implementation(project(":tauri-android"))
    implementation("androidx.appcompat:appcompat:1.6.0")
}
