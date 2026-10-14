// Everything here runs locally: the file is read in memory and never sent anywhere.
// The only network requests are for the C2PA library itself (from jsDelivr).

const C2PA_BASE = "https://cdn.jsdelivr.net/npm/@contentauth/c2pa-web@0.15.2";

// IPTC "digital source type" terms (https://cv.iptc.org/newscodes/digitalsourcetype/)
const SOURCE_TYPES = {
  trainedAlgorithmicMedia: { ai: true, text: "Created by generative AI" },
  compositeWithTrainedAlgorithmicMedia: { ai: true, text: "Edited or combined with generative AI" },
  algorithmicMedia: { ai: false, text: "Computer-generated (not necessarily AI)" },
  compositeSynthetic: { ai: false, text: "Combined with computer-generated elements" },
  algorithmicallyEnhanced: { ai: false, text: "Enhanced by software (e.g. phone camera processing)" },
  digitalCapture: { ai: false, text: "Captured by a digital camera" },
  computationalCapture: { ai: false, text: "Captured by a camera with computational processing" },
  screenCapture: { ai: false, text: "Screenshot" },
  digitalArt: { ai: false, text: "Digital art made by a person" },
  minorHumanEdits: { ai: false, text: "Photo with minor human edits" },
  compositeCapture: { ai: false, text: "Composite of several photos" },
};

const AI_NAMES =
  /Made with Google AI|Google AI|Gemini|Imagen|OpenAI|ChatGPT|DALL[·.\- ]?E|Midjourney|Stable ?Diffusion|SDXL|ComfyUI|Automatic1111|NovelAI|Adobe Firefly|Leonardo\.?ai|Ideogram|Grok|Bing Image Creator|Meta AI|Sora/i;

const FORMAT_BY_EXT = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
  gif: "image/gif", heic: "image/heic", heif: "image/heif", avif: "image/avif",
  tif: "image/tiff", tiff: "image/tiff",
};

const els = {
  input: document.getElementById("file-input"),
  dropzone: document.getElementById("dropzone"),
  report: document.getElementById("report"),
  preview: document.getElementById("preview"),
  fileName: document.getElementById("file-name"),
  verdict: document.getElementById("verdict"),
  c2pa: document.getElementById("c2pa-out"),
  labels: document.getElementById("labels-out"),
  camera: document.getElementById("camera-out"),
};

let currentRun = 0;
let previewUrl = null;
let c2paPromise = null;

// ---------- small DOM helpers ----------

function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else node.setAttribute(k, v);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : String(child));
  }
  return node;
}

function facts(pairs) {
  const dl = h("dl", { class: "facts" });
  for (const [label, value] of pairs) {
    if (value == null || value === "") continue;
    dl.append(h("dt", {}, label), h("dd", {}, value));
  }
  return dl;
}

function finding(kind, text) {
  return h("p", { class: `finding ${kind}` }, text);
}

function truncate(str, max = 220) {
  str = String(str).replace(/\s+/g, " ").trim();
  return str.length > max ? str.slice(0, max) + "…" : str;
}

function sourceTypeName(value) {
  if (!value) return null;
  return String(value).split("/").pop().trim();
}

function describeSourceType(value) {
  const name = sourceTypeName(value);
  return SOURCE_TYPES[name] || { ai: false, text: name };
}

function formatOf(file) {
  if (file.type) return file.type;
  const ext = file.name.split(".").pop().toLowerCase();
  return FORMAT_BY_EXT[ext];
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// ---------- C2PA / Content Credentials ----------

function loadC2pa() {
  if (!c2paPromise) {
    c2paPromise = import(`${C2PA_BASE}/+esm`).then(async (lib) => {
      const c2pa = await lib.createC2pa({ wasmSrc: `${C2PA_BASE}/dist/resources/c2pa_bg.wasm` });
      return { lib, c2pa };
    });
    // Allow a retry on the next file if the library failed to load (e.g. offline).
    c2paPromise.catch(() => (c2paPromise = null));
  }
  return c2paPromise;
}

async function readC2pa(file) {
  const { lib, c2pa } = await loadC2pa();
  // We don't load a list of trusted signers, so only check that the signature is intact.
  const context = new lib.Context({ verify: { verifyTrust: false } });
  const reader = await lib.Reader.fromBlob(c2pa, formatOf(file), file, context);
  if (!reader) return null;
  try {
    return await reader.manifestStore();
  } finally {
    reader.free();
  }
}

function summarizeC2pa(store) {
  const manifests = store.manifests || {};
  const active = manifests[store.active_manifest] || Object.values(manifests)[0] || {};
  const sourceTypes = new Set();
  const agents = new Set();

  // Look through every manifest so AI generation is caught even if the image was edited afterwards.
  for (const manifest of Object.values(manifests)) {
    for (const assertion of manifest.assertions || []) {
      if (!String(assertion.label).startsWith("c2pa.actions")) continue;
      for (const action of assertion.data?.actions || []) {
        if (action.digitalSourceType) sourceTypes.add(sourceTypeName(action.digitalSourceType));
        const agent = action.softwareAgent?.name || (typeof action.softwareAgent === "string" && action.softwareAgent);
        if (agent) agents.add(agent);
      }
    }
  }

  const generator =
    active.claim_generator_info?.map((g) => [g.name, g.version].filter(Boolean).join(" ")).join(", ") ||
    active.claim_generator;
  const sig = active.signature_info || {};

  return {
    signer: sig.issuer || sig.common_name,
    signedAt: sig.time ? new Date(sig.time).toLocaleString() : null,
    generator,
    agents: [...agents],
    sourceTypes: [...sourceTypes],
    isAI: [...sourceTypes].some((t) => SOURCE_TYPES[t]?.ai),
    state: store.validation_state,
  };
}

function renderC2pa(result) {
  els.c2pa.replaceChildren();

  if (result.error) {
    els.c2pa.append(finding("muted", `Couldn't run this check: ${result.error}`));
    return;
  }
  if (!result.summary) {
    els.c2pa.append(finding("muted", "None found. Most images don't have Content Credentials yet, so this is normal."));
    return;
  }

  const s = result.summary;
  if (s.isAI) {
    els.c2pa.append(finding("ai", "Content Credentials say this image was made with AI."));
  } else {
    els.c2pa.append(finding("info", "Content Credentials found. They don't mark this image as AI-generated."));
  }

  els.c2pa.append(
    facts([
      ["Signed by", s.signer],
      ["Signed on", s.signedAt],
      ["Made with", s.agents.length ? s.agents.join(", ") : s.generator],
      ["Recorded as", s.sourceTypes.map((t) => describeSourceType(t).text).join("; ")],
      [
        "Signature",
        s.state === "Invalid"
          ? "Doesn't match — the file was changed after it was signed"
          : "Intact — the file hasn't been changed since it was signed",
      ],
    ])
  );
}

// ---------- Metadata (EXIF / XMP / IPTC / PNG text) ----------

async function readPngText(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!sig.every((b, i) => buf[i] === b)) return [];

  const view = new DataView(buf.buffer);
  const latin1 = new TextDecoder("latin1");
  const utf8 = new TextDecoder("utf-8");
  const chunks = [];
  let pos = 8;

  while (pos + 8 <= buf.length) {
    const len = view.getUint32(pos);
    const type = latin1.decode(buf.subarray(pos + 4, pos + 8));
    const data = buf.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (type === "IEND") break;
    if (!["tEXt", "zTXt", "iTXt"].includes(type)) continue;

    try {
      const nul = data.indexOf(0);
      const keyword = latin1.decode(data.subarray(0, nul));
      let text;
      if (type === "tEXt") {
        text = latin1.decode(data.subarray(nul + 1));
      } else if (type === "zTXt") {
        text = latin1.decode(await inflate(data.subarray(nul + 2)));
      } else {
        const compressed = data[nul + 1] === 1;
        let p = nul + 3;
        p = data.indexOf(0, p) + 1; // skip language tag
        p = data.indexOf(0, p) + 1; // skip translated keyword
        const body = data.subarray(p);
        text = utf8.decode(compressed ? await inflate(body) : body);
      }
      chunks.push({ keyword, text });
    } catch {
      // Ignore malformed chunks
    }
  }
  return chunks;
}

async function inflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function findLabels(meta, pngText) {
  const found = [];
  const seen = new Set();
  const add = (kind, text, where) => {
    const key = `${kind}|${text}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push({ kind, text, where });
  };

  // IPTC digital source type, the standard "how was this made" field
  const dst = meta?.DigitalSourceType || meta?.DigitalSourceFileType;
  if (dst) {
    const d = describeSourceType(dst);
    add(d.ai ? "ai" : "info", `Digital source type: ${d.text}`, "IPTC/XMP");
  }

  // Any text field that names an AI tool
  for (const [key, value] of Object.entries(meta || {})) {
    if (typeof value !== "string" || key === "DigitalSourceType") continue;
    if (AI_NAMES.test(value)) add("ai", `${key}: ${truncate(value, 160)}`, "EXIF/XMP");
  }

  for (const { keyword, text } of pngText) {
    if (keyword === "parameters" && /Steps:/.test(text)) {
      add("ai", `Stable Diffusion settings, including the prompt: "${truncate(text.split(/\n|Negative prompt:|Steps:/)[0], 160)}"`, "PNG text");
    } else if ((keyword === "prompt" || keyword === "workflow") && text.trim().startsWith("{")) {
      add("ai", "A ComfyUI image-generation workflow is embedded in the file", "PNG text");
    } else if (keyword === "XML:com.adobe.xmp") {
      const m = text.match(/digitalsourcetype\/(\w+)/i);
      if (m) {
        const d = describeSourceType(m[1]);
        add(d.ai ? "ai" : "info", `Digital source type: ${d.text}`, "XMP");
      }
      const name = text.match(AI_NAMES);
      // Skip names exifr already reported from a named field (e.g. "Credit: Made with Google AI")
      if (name && !found.some((f) => f.text.includes(name[0]))) add("ai", `Mentions "${name[0]}"`, "XMP");
    } else if (AI_NAMES.test(text) || AI_NAMES.test(keyword)) {
      add("ai", `${keyword}: ${truncate(text, 160)}`, "PNG text");
    }
  }

  return found;
}

function renderLabels(labels) {
  els.labels.replaceChildren();
  if (!labels.length) {
    els.labels.append(finding("muted", "None found."));
    return;
  }
  for (const l of labels) els.labels.append(finding(l.kind, l.text));
}

function renderCamera(file, meta) {
  els.camera.replaceChildren();
  const m = meta || {};
  const camera = [m.Make, m.Model].filter(Boolean).join(" ");
  const taken = m.DateTimeOriginal || m.CreateDate;
  const hasGps = m.latitude != null && m.longitude != null;
  const width = m.ExifImageWidth || m.ImageWidth || els.preview.naturalWidth;
  const height = m.ExifImageHeight || m.ImageHeight || els.preview.naturalHeight;

  els.camera.append(
    facts([
      ["Camera", camera],
      ["Lens", m.LensModel],
      ["Taken", taken instanceof Date ? taken.toLocaleString() : taken],
      ["Software", m.Software || m.CreatorTool],
      ["Location", hasGps ? "GPS coordinates are embedded (think twice before sharing this file)" : null],
      ["Size", width && height ? `${width} × ${height} px, ${formatBytes(file.size)}` : formatBytes(file.size)],
      ["Type", formatOf(file) || "Unknown"],
    ])
  );

  if (!camera && !taken) {
    els.camera.append(
      finding("muted", "No camera information. That's common: messaging apps, social media, and screenshots remove it.")
    );
  }
}

// ---------- Verdict ----------

function renderVerdict({ c2pa, labels, meta }) {
  const aiFromC2pa = c2pa.summary?.isAI;
  const aiFromLabels = labels.some((l) => l.kind === "ai");
  const hasCamera = meta && (meta.Make || meta.Model);

  let kind, title, body;
  if (aiFromC2pa || aiFromLabels) {
    kind = "ai";
    title = "AI markers found";
    body = "This file carries labels saying it was made or edited with AI. That's strong evidence — these labels are added by the AI tools themselves.";
  } else if (c2pa.summary) {
    kind = "info";
    title = "Content Credentials found, no AI flag";
    body = "The credentials describe how this file was made and don't mention AI. Check the details below.";
  } else {
    kind = "none";
    title = "No AI markers found";
    body = hasCamera
      ? "The file has camera details and no AI labels. But metadata can be copied or faked, so this doesn't prove the photo is real."
      : "That does NOT mean it's real. Most AI images lose these labels when they're screenshotted, re-saved, or shared on social media. Try the tools below.";
  }

  els.verdict.className = `verdict ${kind}`;
  els.verdict.replaceChildren(h("strong", {}, title), h("p", {}, body));
}

// ---------- Main flow ----------

async function checkFile(file) {
  if (!file) return;
  const run = ++currentRun;

  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(file);
  els.preview.classList.remove("hidden");
  els.preview.src = previewUrl;

  els.fileName.textContent = file.name;
  els.report.classList.remove("hidden");
  els.verdict.className = "verdict pending";
  els.verdict.replaceChildren(h("strong", {}, "Checking…"));
  for (const out of [els.c2pa, els.labels, els.camera]) {
    out.replaceChildren(finding("muted", "Checking…"));
  }
  els.c2pa.replaceChildren(finding("muted", "Checking… (the first check downloads about 9 MB)"));

  const metaPromise = exifr
    .parse(file, { tiff: true, exif: true, gps: true, xmp: true, iptc: true, icc: false, mergeOutput: true })
    .catch(() => null);
  const pngPromise = readPngText(file).catch(() => []);
  const c2paPromiseForFile = readC2pa(file)
    .then((store) => ({ summary: store ? summarizeC2pa(store) : null }))
    .catch((err) => {
      console.error(err);
      return { error: describeC2paError(err) };
    });

  const [meta, pngText] = await Promise.all([metaPromise, pngPromise]);
  if (run !== currentRun) return;
  const labels = findLabels(meta, pngText);
  renderLabels(labels);
  renderCamera(file, meta);

  const c2pa = await c2paPromiseForFile;
  if (run !== currentRun) return;
  renderC2pa(c2pa);
  renderVerdict({ c2pa, labels, meta });
}

function describeC2paError(err) {
  const msg = String(err?.message || err);
  if (/fetch|import|network|load/i.test(msg)) return "the checker couldn't be downloaded. Check your connection and try again.";
  if (/format|unsupported/i.test(msg)) return "this file type isn't supported for Content Credentials.";
  return "the file's Content Credentials couldn't be read. They may be damaged.";
}

els.preview.addEventListener("error", () => {
  // Some formats (e.g. HEIC outside Safari) can't be previewed, but can still be checked.
  els.preview.classList.add("hidden");
});

els.input.addEventListener("change", () => checkFile(els.input.files[0]));

for (const type of ["dragenter", "dragover"]) {
  els.dropzone.addEventListener(type, (e) => {
    e.preventDefault();
    els.dropzone.classList.add("dragging");
  });
}
for (const type of ["dragleave", "drop"]) {
  els.dropzone.addEventListener(type, () => els.dropzone.classList.remove("dragging"));
}
els.dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  checkFile(e.dataTransfer.files[0]);
});

document.addEventListener("paste", (e) => {
  const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith("image/"));
  if (file) checkFile(file);
});
