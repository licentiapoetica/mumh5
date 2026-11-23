#![doc = include_str!("../BOTS.md")]

pub mod proto {
    pub mod control {
        include!(concat!(env!("OUT_DIR"), "/mumble_proto.rs"));
    }
    pub mod udp {
        include!(concat!(env!("OUT_DIR"), "/mumble_udp.rs"));
    }
}
pub mod audio;
pub mod client;
pub mod crypt;
pub mod identity;
pub mod signal;
pub mod video;
pub mod voice;
pub use client::{Client, Connection, Options, State, Target};
pub mod bot;
