# zkID PAN phone test

A web page that times how long a phone takes to prove claims from a DigiLocker
PAN Verification Record with zkID's PAN prototype (`spike/pan` in
bhargava-sarma/zkID). Open https://bhargava-sarma.github.io/zkID-pan-bench/ on
a phone, tap Start, and copy the results it shows.

**Test only.**

- The record it proves is **synthetic**: "SYNTHETIC TEST PERSON", PAN
  TESTP0000T, signed by an ephemeral TEST key under a self-signed TEST
  certificate. No real record or person is involved.
- The proving key in `zkey/` is a **development key made without a setup
  ceremony**: anyone could forge proofs with it. It exists to measure time and
  memory, and must never be used to accept real proofs.
- The page sends nothing anywhere. It keeps the downloaded key in the
  browser's cache so a second run need not download it again; clearing the
  site's data removes it.

## Files

- `index.html`, `worker.js`: the test. The proof runs in a worker on one thread
  (`?threads=all` uses every core, which needs about twice the memory).
- `circuit/`: the circuit's witness generator (`pan-verifier.wasm`), its
  verification key, and the synthetic input.
- `zkey/`: the 1.1 GB proving key as 17 gzipped parts of 64 MiB, listed in
  `manifest.json`.
- `snarkjs/`: the browser build of snarkjs 0.7.6, unmodified, under GPL-3.0
  (`snarkjs/COPYING`); its source is at https://github.com/iden3/snarkjs.

Built from `spike/pan` in bhargava-sarma/zkID (main, 8deeced) with
`node build.mjs`; the key was then split with `split -b 64M` and each part
gzipped.
