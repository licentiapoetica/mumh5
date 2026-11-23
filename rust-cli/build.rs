fn main() {
    println!("cargo:rerun-if-changed=../proto/Mumble.proto");
    println!("cargo:rerun-if-changed=../proto/MumbleUDP.proto");
    prost_build::compile_protos(
        &["../proto/Mumble.proto", "../proto/MumbleUDP.proto"],
        &["../proto"],
    )
    .unwrap();
    if std::env::var_os("CARGO_FEATURE_VIDEO").is_some() {
        println!("cargo:rerun-if-changed=native/video.c");
        let library = pkg_config::Config::new()
            .probe("vpx")
            .expect("Install libvpx development headers or build --no-default-features");
        let mut build = cc::Build::new();
        build.file("native/video.c");
        for directory in library.include_paths {
            build.include(directory);
        }
        build.compile("mumh5_video");
    }
}
