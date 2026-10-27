//! DeepFilterNet noise suppression for webviews (Windows and macOS). The audio worklet creates one
//! `Denoiser`, feeds it 480-sample blocks of 48 kHz mono audio and gets the cleaned block back.

use deep_filter_net::tract::{DfParams, DfTract, RuntimeParams};
use ndarray::{Array2, ArrayView2};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct Denoiser {
    inner: DfTract,
    out: Array2<f32>,
}

#[wasm_bindgen]
impl Denoiser {
    /// `attenuation_db` caps how much noise is removed (100 = no cap).
    #[wasm_bindgen(constructor)]
    pub fn new(attenuation_db: f32) -> Result<Denoiser, JsError> {
        let runtime = RuntimeParams::default_with_ch(1).with_atten_lim(attenuation_db);
        let inner = DfTract::new(DfParams::default(), &runtime).map_err(|e| JsError::new(&e.to_string()))?;
        let out = Array2::zeros((1, inner.hop_size));
        Ok(Denoiser { inner, out })
    }

    /// Samples per block the model works on.
    pub fn frame_length(&self) -> usize {
        self.inner.hop_size
    }

    /// Cleans one block in place.
    pub fn process(&mut self, block: &mut [f32]) -> Result<(), JsError> {
        let hop = self.inner.hop_size;
        if block.len() != hop {
            return Err(JsError::new("block must be frame_length() samples"));
        }
        let input = ArrayView2::from_shape((1, hop), &*block).map_err(|e| JsError::new(&e.to_string()))?;
        self.inner.process(input, self.out.view_mut()).map_err(|e| JsError::new(&e.to_string()))?;
        block.copy_from_slice(self.out.as_slice().ok_or_else(|| JsError::new("bad output"))?);
        Ok(())
    }
}

fn fill_random(buf: &mut [u8]) -> Result<(), getrandom::Error> {
    let mut x: u64 = 0x9E37_79B9_7F4A_7C15;
    for b in buf.iter_mut() {
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        *b = x as u8;
    }
    Ok(())
}
getrandom::register_custom_getrandom!(fill_random);
