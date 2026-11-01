# Narration engine (bundled)

These files run the Town's narrator, Kokoro, inside the app. They are copied unchanged from npm:

- `kokoro.web.js` from [kokoro-js](https://www.npmjs.com/package/kokoro-js) 1.2.1 (Apache-2.0, see `LICENSE-kokoro-js`). It bundles Transformers.js and the phonemizer.
- `ort-wasm-simd-threaded.jsep.mjs` and `.wasm` from [@huggingface/transformers](https://www.npmjs.com/package/@huggingface/transformers) 3.5.1 (Apache-2.0): the ONNX Runtime WebAssembly engine (MIT).

- `mp4-muxer.mjs` from [mp4-muxer](https://www.npmjs.com/package/mp4-muxer) 5.2.2 (MIT, see `LICENSE-mp4-muxer`): writes the MP4 file the recorder builds frame by frame.

The model weights (Kokoro-82M, Apache-2.0) are not bundled: they download from Hugging Face the first time the voice is used and are cached by the app.
