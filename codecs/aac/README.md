# Packet AAC decoder

This small MPL-2.0 adapter builds Symphonia 0.5.4's AAC-LC decoder for both the
browser waveform Worker and the static-module server runtime. It does not use
WebCodecs, FAAD2, an external service or a CDN. Unsupported AAC profiles fail
validation. The MP4/WebM demuxer supplies codec configuration and packet times.

Build with Rust 1.90.0 and its `wasm32-unknown-unknown` standard library:

```sh
RUSTFLAGS='-C link-arg=--max-memory=33554432' cargo build --manifest-path codecs/aac/Cargo.toml --target wasm32-unknown-unknown --release --locked
cp codecs/aac/target/wasm32-unknown-unknown/release/pulse_aac_decoder.wasm src/lib/codecs/aac.wasm
```

The WASM maximum linear memory is 32 MiB. Packet input is limited to 1 MiB,
configuration to 64 bytes and decoded packets to 8192 frames / 8 channels.
Only one packet's PCM is retained. Each stream uses a separate WASM instance.
Source and Cargo.lock are distributed with the artifact; upstream source is
https://github.com/pdeljanov/Symphonia/tree/v0.5.4 and crate archives are pinned
by Cargo.lock checksums. Retain upstream MPL-2.0 notices when distributing.
