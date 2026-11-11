// Runs the whole test off the page's main thread, so the page stays responsive
// while the phone proves. It reports to the page with postMessage and sends
// nothing anywhere else.
importScripts('snarkjs/snarkjs.min.js');

const post = (type, data = {}) => postMessage({ type, ...data });
const stage = (name, text) => post('stage', { stage: name, text });
const json = (response) => checked(response).json();
const bytes = async (response) => new Uint8Array(await checked(response).arrayBuffer());
function checked(response) {
  if (!response.ok) throw new Error(`${response.url}: HTTP ${response.status}`);
  return response;
}

// Proving takes minutes; report its steps, at most twice a second.
let lastStep = 0;
const step = (text) => {
  const now = Date.now();
  if (now - lastStep < 500) return;
  lastStep = now;
  post('step', { text: String(text) });
};
const logger = { debug: step, info: step, warn: step, error: step };

onmessage = async ({ data }) => {
  try {
    post('result', await run(data.singleThread));
  } catch (err) {
    post('error', { message: String((err && err.message) || err) });
  }
};

async function run(singleThread) {
  stage('loading', 'Loading the test files');
  const [manifest, input, vkey, wasm] = await Promise.all([
    fetch('zkey/manifest.json', { cache: 'no-cache' }).then(json),
    fetch('circuit/input.json').then(json),
    fetch('circuit/vkey.json').then(json),
    fetch('circuit/pan-verifier.wasm').then(bytes),
  ]);

  stage('download', 'Downloading the proving key (536 MB, only the first time)');
  const started = performance.now();
  let zkey;
  try {
    zkey = new Uint8Array(manifest.totalBytes);
  } catch {
    throw new Error('not enough memory to hold the 1.1 GB proving key');
  }
  let { cache, cacheNote } = await openCache(manifest.version);
  const gzTotal = manifest.parts.reduce((sum, part) => sum + part.gzBytes, 0);
  let gzDone = 0;
  let offset = 0;
  let fromCache = 0;
  for (const part of manifest.parts) {
    const url = new URL(`zkey/${part.file}`, self.location.href).href;
    let response = cache && (await cache.match(url));
    let caching = null;
    if (response) fromCache++;
    else {
      response = checked(await fetch(url));
      caching = cache && cache.put(url, response.clone()).catch(() => {
        cacheNote = 'could not keep the key in the browser cache (storage full?): it downloads again next time';
      });
    }
    const length = await unpackInto(response.body, zkey, offset, part.bytes);
    await caching;
    if (length !== part.bytes) throw new Error(`${part.file} has ${length} bytes, not ${part.bytes}: clear this site's data and try again`);
    offset += length;
    gzDone += part.gzBytes;
    post('progress', { done: gzDone, total: gzTotal });
  }
  const download = (performance.now() - started) / 1000;

  stage('witness', 'Computing the witness');
  let t = performance.now();
  const wtns = { type: 'mem' };
  await snarkjs.wtns.calculate(input, { type: 'mem', data: wasm }, wtns);
  const witness = (performance.now() - t) / 1000;

  stage('proving', `Proving, on ${singleThread ? 'one thread' : 'all cores'}: about 2 to 4 minutes`);
  t = performance.now();
  const { proof, publicSignals } = await snarkjs.groth16.prove({ type: 'mem', data: zkey }, wtns, logger, { singleThread });
  const prove = (performance.now() - t) / 1000;
  zkey = null;

  stage('verifying', 'Checking the proof');
  const valid = await snarkjs.groth16.verify(vkey, publicSignals, proof);
  return { valid, download, fromCache, parts: manifest.parts.length, witness, prove, cacheNote };
}

// The key's parts stay in this phone's browser cache, so a second run does not
// download them again. Without a cache the test still runs.
async function openCache(version) {
  try {
    const name = `zkid-pan-bench-${version}`;
    for (const old of await caches.keys()) if (old.startsWith('zkid-pan-bench-') && old !== name) await caches.delete(old);
    return { cache: await caches.open(name), cacheNote: null };
  } catch {
    return { cache: null, cacheNote: 'no browser cache: the key downloads again on every run' };
  }
}

// Unpacks a part straight into the key, a few kilobytes at a time, so the
// phone never holds a second copy of it. Parts are gzip files; if the server
// already unpacked one, it is copied as it is. Returns the bytes written.
async function unpackInto(body, target, offset, expected) {
  const reader = body.getReader();
  const first = await reader.read();
  const head = first.done ? new Uint8Array(0) : first.value;
  const whole = new ReadableStream({
    start(controller) {
      if (head.length) controller.enqueue(head);
      if (first.done) controller.close();
    },
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) controller.close();
      else controller.enqueue(value);
    },
  });
  const gzip = head[0] === 0x1f && head[1] === 0x8b;
  const out = (gzip ? whole.pipeThrough(new DecompressionStream('gzip')) : whole).getReader();
  let at = offset;
  for (;;) {
    const { done, value } = await out.read();
    if (done) return at - offset;
    if (at + value.length > offset + expected) throw new Error('a key part is larger than the manifest says: clear this site\'s data and try again');
    target.set(value, at);
    at += value.length;
  }
}
