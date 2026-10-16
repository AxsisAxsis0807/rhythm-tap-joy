// SPDX-License-Identifier: MPL-2.0
// Small packet ABI over Symphonia's AAC-LC decoder. An instance owns one stream.
use std::cell::RefCell;
use symphonia_codec_aac::AacDecoder;
use symphonia_core::{audio::SampleBuffer, codecs::{CodecParameters, Decoder, DecoderOptions, CODEC_TYPE_AAC}, formats::Packet};
#[derive(Default)]
struct State { decoder:Option<AacDecoder>, output:Vec<f32>, rate:u32, channels:u32 }
thread_local! {static STATE:RefCell<State>=RefCell::new(State::default());}
#[no_mangle]
pub extern "C" fn allocate(len: usize) -> *mut u8 {
    if len > 1_048_576 { return std::ptr::null_mut(); }
    Box::into_raw(vec![0u8; len].into_boxed_slice()) as *mut u8
}
#[no_mangle]
pub unsafe extern "C" fn deallocate(ptr: *mut u8, len: usize) {
    if !ptr.is_null() { drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr, len))); }
}
#[no_mangle]
pub unsafe extern "C" fn configure(ptr: *const u8, len: usize) -> i32 {
    if ptr.is_null() || len == 0 || len > 64 { return -1; }
    let mut parameters=CodecParameters::new();
    parameters.for_codec(CODEC_TYPE_AAC).with_extra_data(std::slice::from_raw_parts(ptr,len).to_vec().into_boxed_slice());
    match AacDecoder::try_new(&parameters,&DecoderOptions::default()) {
        Ok(decoder)=>{STATE.with(|state|state.borrow_mut().decoder=Some(decoder));0},Err(_)=>-1
    }
}
#[no_mangle]
pub unsafe extern "C" fn decode_packet(ptr: *const u8, len: usize) -> i32 {
    if ptr.is_null() || len == 0 || len > 1_048_576 { return -1; }
    STATE.with(|cell|{
        let mut state=cell.borrow_mut();
        let Some(decoder)=state.decoder.as_mut() else {return -1};
        let packet=Packet::new_from_slice(0,0,0,std::slice::from_raw_parts(ptr,len));
        let Ok(decoded)=decoder.decode(&packet) else {return -1};
        let rate=decoded.spec().rate;
        let channels=decoded.spec().channels.count() as u32;
        if channels==0 || channels>8 || decoded.frames()>8192 {return -1;}
        let mut samples=SampleBuffer::<f32>::new(decoded.capacity() as u64,*decoded.spec());
        samples.copy_interleaved_ref(decoded);
        state.output.clear();state.output.extend_from_slice(samples.samples());
        state.rate=rate;state.channels=channels;
        (state.output.len() as u32/channels) as i32
    })
}
#[no_mangle]
pub extern "C" fn output_ptr() -> *const f32 {STATE.with(|state|state.borrow().output.as_ptr())}
#[no_mangle]
pub extern "C" fn sample_rate() -> u32 {STATE.with(|state|state.borrow().rate)}
#[no_mangle]
pub extern "C" fn channels() -> u32 {STATE.with(|state|state.borrow().channels)}
#[no_mangle]
pub extern "C" fn release() {STATE.with(|state|*state.borrow_mut()=State::default());}
