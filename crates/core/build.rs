fn main() {
    println!("cargo:rerun-if-changed=../../proto/Mumble.proto");
    println!("cargo:rerun-if-changed=../../proto/MumbleUDP.proto");
    prost_build::compile_protos(
        &["../../proto/Mumble.proto", "../../proto/MumbleUDP.proto"],
        &["../../proto"],
    )
    .unwrap();
    if std::env::var_os("CARGO_FEATURE_VIDEO").is_some() {
        println!("cargo:rerun-if-changed=native/video.c");
        let mut build = cc::Build::new();
        build.file("native/video.c");
        let includes = if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
            vcpkg::Config::new()
                .find_package("libvpx")
                .expect("Install libvpx:x64-windows-static-md using vcpkg")
                .include_paths
        } else {
            pkg_config::Config::new()
                .probe("vpx")
                .expect("Install libvpx development headers or build --no-default-features")
                .include_paths
        };
        for directory in includes {
            build.include(directory);
        }
        build.compile("mumh5_video");
    }
}
