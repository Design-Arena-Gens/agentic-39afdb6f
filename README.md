## Agentic Instagram Video Editor

Agentic is a professional-grade, browser-based video editor tailored for Instagram creators. Trim your footage, grade the colors, script captions, and mix audio without leaving the web. The final export renders fully client-side via WebAssembly-powered FFmpeg.

### ✨ Core Features

- Vertical-first canvas with presets for Reels (9:16), square (1:1), and landscape (16:9)
- Dual-handle trimming with live timecodes
- Caption overlays with positioning sliders, brand colors, font sizing, and translucent backdrops
- Color grading controls: brightness, contrast, and saturation
- Soundtrack mixer that balances original audio with uploaded background music
- In-browser H.264 export using FFmpeg WASM, delivering Instagram-ready MP4 files

### 🚀 Quick Start

```bash
npm install
npm run dev
```

Open `http://localhost:3000` and drop in an MP4, MOV, or WebM file to begin editing. Exports process locally — no media ever leaves the browser.

### 📂 Project Structure Highlights

- `src/components/video-editor.tsx` – main editing surface, FFmpeg pipeline, and UI logic
- `src/app/page.tsx` – mounts the editor experience
- `src/app/layout.tsx` – global metadata configuration

### 🛠️ Tech Stack

- Next.js App Router + TypeScript
- Tailwind CSS for rapid, responsive styling
- `@ffmpeg/ffmpeg` & `@ffmpeg/util` for WASM-based rendering

### 🧪 Recommended Workflow

1. `npm run lint` to ensure code quality
2. `npm run build` to validate the production bundle
3. Deploy to Vercel: `vercel deploy --prod --yes --token $VERCEL_TOKEN --name agentic-39afdb6f`
4. Verify: `curl https://agentic-39afdb6f.vercel.app`

### 📄 License

MIT — freely use, remix, and ship.
