fn main() {
    tauri_plugin::Builder::new(&["start", "stop", "update"])
        .android_path("android")
        .build();
}
