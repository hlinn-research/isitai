# Is It AI?

A no-login, no-backend quiz that trains people to spot AI-generated photos — built as an awareness tool against romance scams, fake KYC/ID-verification photos, and other social-engineering attacks that rely on a convincing face.

Each quiz is 5 questions. Each question shows 3 images (1 AI-generated, 2 real) in random order and asks the user to pick the AI one. After the 5th question, it shows a score and a short guide to real detection tools and techniques. Progress is tracked per-browser-tab via `sessionStorage` — refreshing resumes the quiz, and "Start a new quiz" clears it and resamples a fresh set of images.

`check.html` lets visitors check their own image for AI labels: C2PA Content Credentials (via [`@contentauth/c2pa-web`](https://www.npmjs.com/package/@contentauth/c2pa-web)), IPTC/XMP "digital source type" and other metadata (via [`exifr`](https://www.npmjs.com/package/exifr)), and Stable Diffusion/ComfyUI settings in PNG text chunks. Both libraries load from jsDelivr, and the image itself never leaves the browser.

## Adding images

Drop image files into `images/ai/` and `images/real/`, then list them in `images/manifest.json`:

```json
{
  "ai":   [{ "file": "images/ai/your-file.jpg", "credit": "optional" }],
  "real": [{ "file": "images/real/your-file.jpg", "credit": "optional" }]
}
```

`credit` is optional attribution text shown under the image (useful if a license requires it).

**Minimum to run:** 1 AI image + 2 real images. **Recommended:** at least 8–10 of each so the 5 questions don't repeat the same images every time, and ideally 15-20 of each so returning users don't quickly memorize the pool.

### Where to get real (non-AI) photos

Use openly-licensed stock photo sites — no attribution legally required, though it's good practice to keep the `credit` field filled in:

- [Unsplash](https://unsplash.com)
- [Pexels](https://pexels.com)
- [Pixabay](https://pixabay.com)
- [Wikimedia Commons](https://commons.wikimedia.org) — check the license per file, most are CC0 or CC-BY

### Where to get AI-generated photos

Cleanest option: **generate your own**, so you fully own the rights and there's no licensing ambiguity. Free tools with a no-signup-hassle free tier:

- [Bing Image Creator / Copilot](https://www.bing.com/images/create)
- [Leonardo.ai](https://leonardo.ai) (free daily credits)
- [Playground AI](https://playground.com) (free tier)

If you want pre-made samples instead, [Lexica](https://lexica.art) is a searchable gallery of Stable Diffusion outputs — check the license noted per image before reuse, since not all of them are cleared for redistribution.

Mix subjects (faces work best for this demo since that's what scammers actually use) and vary style/quality so the quiz isn't trivially easy.

## Running locally

No build step. Just serve the folder over HTTP (opening `index.html` directly via `file://` will block the `fetch("images/manifest.json")` call in some browsers):

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## Deploying to GitHub Pages (free)

1. Push this repo to GitHub (already done if you're reading this from the repo).
2. On GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch**.
3. Branch: `main`, folder: `/ (root)`. Save.
4. Your site will be live at `https://<org>.github.io/<repo>/` within a minute or two.

No server, no database, no login — it's a fully static site.
