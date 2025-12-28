"use client";

import { MutableRefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";

type AspectRatioKey = "9:16" | "1:1" | "16:9";

type OverlayBlock = {
  id: string;
  text: string;
  start: number;
  end: number;
  color: string;
  fontSize: number;
  weight: "regular" | "bold";
  x: number; // percentage 0-100
  y: number; // percentage 0-100
  backgroundOpacity: number;
};

type ExportStatus = "idle" | "loading" | "ready" | "error";

const aspectPresets: Record<AspectRatioKey, { width: number; height: number; label: string }> = {
  "9:16": { width: 1080, height: 1920, label: "Vertical Reel (9:16)" },
  "1:1": { width: 1080, height: 1080, label: "Square (1:1)" },
  "16:9": { width: 1920, height: 1080, label: "Landscape (16:9)" },
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const formatSeconds = (value: number) => {
  if (!Number.isFinite(value)) return "0:00";
  const total = Math.max(0, Math.floor(value));
  const minutes = Math.floor(total / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (total % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
};

async function canvasToUint8Array(canvas: HTMLCanvasElement) {
  return new Promise<Uint8Array>((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) {
        reject(new Error("Failed to create overlay asset"));
        return;
      }
      const arrayBuffer = await blob.arrayBuffer();
      resolve(new Uint8Array(arrayBuffer));
    }, "image/png");
  });
}

const ensureFFmpeg = async (ffmpegRef: MutableRefObject<FFmpeg | null>) => {
  if (ffmpegRef.current) {
    return ffmpegRef.current;
  }

  const ffmpeg = new FFmpeg();
  await ffmpeg.load();
  ffmpegRef.current = ffmpeg;
  return ffmpeg;
};

export default function VideoEditor() {
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState<number>(0);
  const [trimStart, setTrimStart] = useState<number>(0);
  const [trimEnd, setTrimEnd] = useState<number>(0);
  const [aspectRatio, setAspectRatio] = useState<AspectRatioKey>("9:16");
  const [brightness, setBrightness] = useState<number>(0);
  const [contrast, setContrast] = useState<number>(1);
  const [saturation, setSaturation] = useState<number>(1.2);
  const [overlays, setOverlays] = useState<OverlayBlock[]>([]);
  const [musicFile, setMusicFile] = useState<File | null>(null);
  const [videoVolume, setVideoVolume] = useState<number>(0.8);
  const [musicVolume, setMusicVolume] = useState<number>(0.6);
  const [useOriginalAudio, setUseOriginalAudio] = useState<boolean>(true);
  const [exportStatus, setExportStatus] = useState<ExportStatus>("idle");
  const [exportUrl, setExportUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoadingFFmpeg, setIsLoadingFFmpeg] = useState<boolean>(false);
  const [previewTime, setPreviewTime] = useState<number>(0);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const ffmpegRef = useRef<FFmpeg | null>(null);

  useEffect(() => {
    return () => {
      if (videoUrl) {
        URL.revokeObjectURL(videoUrl);
      }
      if (exportUrl) {
        URL.revokeObjectURL(exportUrl);
      }
    };
  }, [videoUrl, exportUrl]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleLoadedMetadata = () => {
      if (video.duration && Number.isFinite(video.duration)) {
        setDuration(video.duration);
        setTrimStart(0);
        setTrimEnd(video.duration);
      }
    };

    const handleTimeUpdate = () => {
      setPreviewTime(video.currentTime);
    };

    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    video.addEventListener("timeupdate", handleTimeUpdate);
    video.addEventListener("seeked", handleTimeUpdate);

    return () => {
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      video.removeEventListener("timeupdate", handleTimeUpdate);
      video.removeEventListener("seeked", handleTimeUpdate);
    };
  }, [videoUrl]);

  const handleVideoUpload = useCallback((file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith("video")) {
      setErrorMessage("Please select a valid video file.");
      return;
    }
    setErrorMessage(null);
    if (videoUrl) {
      URL.revokeObjectURL(videoUrl);
    }
    const url = URL.createObjectURL(file);
    setVideoFile(file);
    setVideoUrl(url);
    setDuration(0);
    setOverlays([]);
    setExportUrl(null);
    setExportStatus("idle");
  }, [videoUrl]);

  const handleMusicUpload = useCallback((file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith("audio")) {
      setErrorMessage("Please select an audio file (MP3, WAV, AAC).");
      return;
    }
    setErrorMessage(null);
    setMusicFile(file);
  }, []);

  const addOverlay = useCallback(() => {
    const baseStart = clamp(previewTime, trimStart, trimEnd - 1);
    const newOverlay: OverlayBlock = {
      id: crypto.randomUUID(),
      text: "New caption",
      start: baseStart,
      end: clamp(baseStart + 3, trimStart, trimEnd),
      color: "#ffffff",
      fontSize: 64,
      weight: "bold",
      x: 50,
      y: 80,
      backgroundOpacity: 0.35,
    };
    setOverlays((current) => [...current, newOverlay]);
  }, [previewTime, trimStart, trimEnd]);

  const updateOverlay = useCallback((id: string, patch: Partial<OverlayBlock>) => {
    setOverlays((current) =>
      current.map((overlay) =>
        overlay.id === id
          ? {
              ...overlay,
              ...patch,
            }
          : overlay,
      ),
    );
  }, []);

  const removeOverlay = useCallback((id: string) => {
    setOverlays((current) => current.filter((overlay) => overlay.id !== id));
  }, []);

  const activeOverlays = useMemo(() => {
    return overlays.filter((overlay) => previewTime >= overlay.start && previewTime <= overlay.end);
  }, [overlays, previewTime]);

  const disableExport = useMemo(() => {
    if (!videoFile) return true;
    if (!Number.isFinite(duration) || duration <= 0) return true;
    if (trimEnd - trimStart <= 0.5) return true;
    return false;
  }, [videoFile, duration, trimStart, trimEnd]);

  const handleExport = useCallback(async () => {
    if (!videoFile) return;

    setExportStatus("loading");
    setErrorMessage(null);

    try {
      const ffmpeg = await (async () => {
        if (ffmpegRef.current) {
          return ffmpegRef.current;
        }
        setIsLoadingFFmpeg(true);
        const instance = await ensureFFmpeg(ffmpegRef);
        setIsLoadingFFmpeg(false);
        return instance;
      })();

      const target = aspectPresets[aspectRatio];
      const clipDuration = Number((trimEnd - trimStart).toFixed(2));

      await ffmpeg.writeFile("input.mp4", await fetchFile(videoFile));

      const overlayEntries = [] as { fileName: string; overlay: OverlayBlock }[];

      for (let index = 0; index < overlays.length; index += 1) {
        const overlay = overlays[index];
        const startRelative = Math.max(0, overlay.start - trimStart);
        const endRelative = Math.max(startRelative, Math.min(overlay.end - trimStart, clipDuration));
        if (endRelative <= startRelative) {
          continue;
        }

        const canvas = document.createElement("canvas");
        canvas.width = target.width;
        canvas.height = target.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) continue;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const padding = Math.round(canvas.width * 0.02);
        const fontSizePx = Math.round((overlay.fontSize / 1080) * canvas.width);
        ctx.font = `${overlay.weight === "bold" ? "700" : "500"} ${fontSizePx}px "Inter", "Helvetica", sans-serif`;
        ctx.fillStyle = `rgba(0,0,0,${overlay.backgroundOpacity})`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        const anchorX = (overlay.x / 100) * canvas.width;
        const anchorY = (overlay.y / 100) * canvas.height;

        const metrics = ctx.measureText(overlay.text);
        const textWidth = metrics.width + padding * 2;
        const textHeight = fontSizePx + padding * 2;
        const rectX = anchorX - textWidth / 2;
        const rectY = anchorY - textHeight / 2;

        ctx.fillRect(rectX, rectY, textWidth, textHeight);
        ctx.fillStyle = overlay.color;
        ctx.fillText(overlay.text, anchorX, anchorY + fontSizePx * 0.08);

        const bytes = await canvasToUint8Array(canvas);
        const fileName = `overlay-${index}.png`;
        await ffmpeg.writeFile(fileName, bytes);
        overlayEntries.push({ fileName, overlay });
      }

      let musicFileName: string | null = null;
      if (musicFile) {
        const extension = musicFile.name.split(".").pop()?.toLowerCase() ?? "mp3";
        musicFileName = `bgm.${extension}`;
        await ffmpeg.writeFile(musicFileName, await fetchFile(musicFile));
      }

      const args: string[] = ["-i", "input.mp4"];

      overlayEntries.forEach(({ fileName }) => {
        args.push("-i", fileName);
      });

      if (musicFile && musicFileName) {
        args.push("-i", musicFileName);
      }

      const commands: string[] = [];

      const isVertical = target.height > target.width;
      const scaleFilter = isVertical
        ? `scale=-2:${target.height}`
        : `scale=${target.width}:-2`;
      const cropFilter = `crop=${target.width}:${target.height}`;
      const eqFilter = `eq=brightness=${brightness.toFixed(2)}:contrast=${contrast.toFixed(2)}:saturation=${saturation.toFixed(2)}`;

      commands.push(`[0:v]trim=start=${trimStart.toFixed(2)}:end=${trimEnd.toFixed(2)},setpts=PTS-STARTPTS,${scaleFilter},${cropFilter},${eqFilter}[v0]`);

      let lastVideoLabel = "v0";

      overlayEntries.forEach(({ overlay }, index) => {
        const inputLabel = `${index + 1}:v`;
        const targetLabel = index === overlayEntries.length - 1 ? "vout" : `v${index + 1}`;
        const enableStart = Math.max(0, overlay.start - trimStart).toFixed(2);
        const enableEnd = Math.min(clipDuration, overlay.end - trimStart).toFixed(2);
        commands.push(
          `[${lastVideoLabel}][${inputLabel}]overlay=0:0:enable='between(t,${enableStart},${enableEnd})'[${targetLabel}]`,
        );
        lastVideoLabel = targetLabel;
      });

      const hasOverlay = overlayEntries.length > 0;
      if (!hasOverlay) {
        commands.push(`[v0]null[vout]`);
        lastVideoLabel = "vout";
      }

      const audioSteps: string[] = [];
      const clipDurationString = clipDuration.toFixed(2);

      const musicInputIndex = musicFile ? overlayEntries.length + 1 : -1;
      const audioLabels: string[] = [];

      if (useOriginalAudio) {
        audioSteps.push(
          `[0:a]atrim=start=${trimStart.toFixed(2)}:end=${trimEnd.toFixed(2)},asetpts=PTS-STARTPTS,volume=${videoVolume.toFixed(
            2,
          )}[a0]`,
        );
        audioLabels.push("a0");
      }

      if (musicFile) {
        audioSteps.push(
          `[${musicInputIndex}:a]aloop=loop=-1:size=2147483647,atrim=0:${clipDurationString},asetpts=PTS-STARTPTS,volume=${musicVolume.toFixed(
            2,
          )}[amusic]`,
        );
        audioLabels.push("amusic");
      }

      if (audioLabels.length === 2) {
        audioSteps.push(`[${audioLabels[0]}][${audioLabels[1]}]amix=inputs=2:duration=shortest:dropout_transition=2[aout]`);
      } else if (audioLabels.length === 1) {
        audioSteps.push(`[${audioLabels[0]}]anull[aout]`);
      }

      const filterComplex = [...commands, ...audioSteps].join(";");

      args.push("-filter_complex", filterComplex);

      args.push("-map", "[vout]");
      if (audioLabels.length > 0) {
        args.push("-map", "[aout]");
      } else {
        args.push("-an");
      }

      args.push(
        "-c:v",
        "libx264",
        "-profile:v",
        "high",
        "-preset",
        "medium",
        "-crf",
        "18",
        "-movflags",
        "+faststart",
        "-pix_fmt",
        "yuv420p",
        "output.mp4",
      );

      await ffmpeg.exec(args);

      const outputData = (await ffmpeg.readFile("output.mp4")) as Uint8Array;
      const blob = new Blob([outputData.buffer as ArrayBuffer], { type: "video/mp4" });
      if (exportUrl) {
        URL.revokeObjectURL(exportUrl);
      }
      const finalUrl = URL.createObjectURL(blob);
      setExportUrl(finalUrl);
      setExportStatus("ready");
    } catch (error) {
      console.error(error);
      setExportStatus("error");
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unexpected error occurred while exporting the video.",
      );
    }
  }, [
    aspectRatio,
    brightness,
    contrast,
    exportUrl,
    musicFile,
    musicVolume,
    overlays,
    saturation,
    trimEnd,
    trimStart,
    useOriginalAudio,
    videoFile,
    videoVolume,
  ]);

  const onTrimStartChange = (next: number) => {
    const clamped = clamp(next, 0, trimEnd - 0.5);
    setTrimStart(Number(clamped.toFixed(2)));
    if (videoRef.current) {
      videoRef.current.currentTime = clamped;
    }
  };

  const onTrimEndChange = (next: number) => {
    const clamped = clamp(next, trimStart + 0.5, duration);
    setTrimEnd(Number(clamped.toFixed(2)));
  };

  const renderUploadArea = () => (
    <label
      htmlFor="video-upload"
      className="flex w-full max-w-xl cursor-pointer flex-col items-center justify-center gap-4 rounded-3xl border border-dashed border-white/40 bg-white/10 p-12 text-center backdrop-blur transition hover:border-white/70 hover:bg-white/20"
    >
      <span className="text-lg font-semibold text-white">Drop your footage here</span>
      <span className="text-sm text-white/70">
        Upload MP4, MOV, or WebM files up to a few hundred megabytes.
      </span>
      <div className="rounded-full bg-white px-6 py-2 text-sm font-medium text-black">Choose File</div>
      <input
        id="video-upload"
        name="video-upload"
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(event) => handleVideoUpload(event.target.files?.[0] ?? null)}
      />
    </label>
  );

  const renderOverlayControls = (overlay: OverlayBlock) => (
    <div key={overlay.id} className="rounded-2xl bg-white/5 p-4 shadow-sm shadow-black/10">
      <div className="flex items-start gap-2">
        <textarea
          value={overlay.text}
          onChange={(event) => updateOverlay(overlay.id, { text: event.target.value })}
          className="h-20 w-full resize-none rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white placeholder:text-white/50 focus:border-white/40 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => removeOverlay(overlay.id)}
          className="rounded-xl border border-white/10 px-3 py-2 text-xs font-medium text-white/80 transition hover:bg-white/10"
        >
          Remove
        </button>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-xs text-white/70">
        <label className="flex flex-col gap-1">
          <span>Start</span>
          <input
            type="number"
            step="0.1"
            min={trimStart}
            max={trimEnd}
            value={overlay.start.toFixed(2)}
            onChange={(event) =>
              updateOverlay(overlay.id, {
                start: clamp(Number(event.target.value), trimStart, overlay.end - 0.1),
              })
            }
            className="rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-white focus:border-white/40 focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span>End</span>
          <input
            type="number"
            step="0.1"
            min={trimStart}
            max={trimEnd}
            value={overlay.end.toFixed(2)}
            onChange={(event) =>
              updateOverlay(overlay.id, {
                end: clamp(Number(event.target.value), overlay.start + 0.1, trimEnd),
              })
            }
            className="rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-white focus:border-white/40 focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span>Horizontal</span>
          <input
            type="range"
            min={0}
            max={100}
            value={overlay.x}
            onChange={(event) => updateOverlay(overlay.id, { x: Number(event.target.value) })}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span>Vertical</span>
          <input
            type="range"
            min={0}
            max={100}
            value={overlay.y}
            onChange={(event) => updateOverlay(overlay.id, { y: Number(event.target.value) })}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span>Font size</span>
          <input
            type="number"
            min={24}
            max={180}
            value={overlay.fontSize}
            onChange={(event) =>
              updateOverlay(overlay.id, { fontSize: clamp(Number(event.target.value), 24, 180) })
            }
            className="rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-white focus:border-white/40 focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span>Weight</span>
          <select
            value={overlay.weight}
            onChange={(event) => updateOverlay(overlay.id, { weight: event.target.value as "regular" | "bold" })}
            className="rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-white focus:border-white/40 focus:outline-none"
          >
            <option value="regular">Regular</option>
            <option value="bold">Bold</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span>Text color</span>
          <input
            type="color"
            value={overlay.color}
            onChange={(event) => updateOverlay(overlay.id, { color: event.target.value })}
            className="h-10 w-full rounded-lg border border-white/20 bg-transparent"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span>Backdrop</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={overlay.backgroundOpacity}
            onChange={(event) =>
              updateOverlay(overlay.id, { backgroundOpacity: Number(event.target.value) })
            }
          />
        </label>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 px-4 py-10 text-white">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-10">
        <header className="flex flex-col gap-3">
          <p className="text-sm uppercase tracking-[0.35em] text-white/40">Creator Studio</p>
          <h1 className="text-4xl font-semibold text-white sm:text-5xl">Instagram Pro Video Editor</h1>
          <p className="max-w-2xl text-sm text-white/60 sm:text-base">
            Craft scroll-stopping reels with trimming, color control, captions, and soundtrack mixing — optimised
            for Instagram formats.
          </p>
        </header>

        {!videoFile && (
          <section className="flex flex-1 justify-center">
            {renderUploadArea()}
          </section>
        )}

        {videoFile && (
          <section className="grid gap-6 rounded-3xl border border-white/10 bg-white/5 p-6 shadow-xl shadow-black/20 backdrop-blur-xl lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <div className="flex flex-col gap-4">
              <div className="relative aspect-[9/16] w-full overflow-hidden rounded-3xl bg-black/50">
                <video
                  ref={videoRef}
                  src={videoUrl ?? undefined}
                  controls
                  className="h-full w-full object-contain"
                />
                {duration > 0 && (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    {activeOverlays.map((overlay) => (
                      <div
                        key={overlay.id}
                        style={{
                          left: `${overlay.x}%`,
                          top: `${overlay.y}%`,
                          transform: "translate(-50%, -50%)",
                          fontSize: `${overlay.fontSize / 16}rem`,
                          fontWeight: overlay.weight === "bold" ? 700 : 500,
                          backgroundColor: `rgba(0,0,0,${overlay.backgroundOpacity})`,
                          color: overlay.color,
                        }}
                        className="pointer-events-none absolute whitespace-pre-line rounded-2xl px-4 py-2 text-center"
                      >
                        {overlay.text}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-2xl bg-black/40 p-4">
                <div className="flex items-center justify-between text-xs uppercase tracking-[0.3em] text-white/40">
                  <span>{formatSeconds(trimStart)}</span>
                  <span>{formatSeconds(trimEnd)}</span>
                </div>
                <div className="mt-3 flex items-center gap-4">
                  <input
                    type="range"
                    min={0}
                    max={duration}
                    step={0.1}
                    value={trimStart}
                    onChange={(event) => onTrimStartChange(Number(event.target.value))}
                    className="flex-1"
                  />
                  <input
                    type="range"
                    min={0}
                    max={duration}
                    step={0.1}
                    value={trimEnd}
                    onChange={(event) => onTrimEndChange(Number(event.target.value))}
                    className="flex-1"
                  />
                </div>
                <div className="mt-3 flex items-center justify-between text-sm text-white/60">
                  <span>Clip length</span>
                  <span>{formatSeconds(trimEnd - trimStart)}</span>
                </div>
              </div>

              <div className="rounded-2xl bg-black/40 p-4">
                <h2 className="text-sm font-semibold text-white">Aspect &amp; Color</h2>
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  {(Object.keys(aspectPresets) as AspectRatioKey[]).map((key) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setAspectRatio(key)}
                      className={`rounded-xl border px-4 py-3 text-sm transition ${
                        aspectRatio === key
                          ? "border-white bg-white/20 text-white"
                          : "border-white/10 bg-white/5 text-white/70 hover:border-white/30"
                      }`}
                    >
                      {aspectPresets[key].label}
                    </button>
                  ))}
                </div>
                <div className="mt-6 grid gap-4 sm:grid-cols-3">
                  <label className="flex flex-col gap-2 text-xs text-white/60">
                    <span>Brightness</span>
                    <input
                      type="range"
                      min={-0.5}
                      max={0.5}
                      step={0.05}
                      value={brightness}
                      onChange={(event) => setBrightness(Number(event.target.value))}
                    />
                  </label>
                  <label className="flex flex-col gap-2 text-xs text-white/60">
                    <span>Contrast</span>
                    <input
                      type="range"
                      min={0.5}
                      max={1.8}
                      step={0.05}
                      value={contrast}
                      onChange={(event) => setContrast(Number(event.target.value))}
                    />
                  </label>
                  <label className="flex flex-col gap-2 text-xs text-white/60">
                    <span>Saturation</span>
                    <input
                      type="range"
                      min={0.2}
                      max={2}
                      step={0.05}
                      value={saturation}
                      onChange={(event) => setSaturation(Number(event.target.value))}
                    />
                  </label>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-4">
              <div className="rounded-2xl bg-black/40 p-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-white">Captions &amp; Stickers</h2>
                  <button
                    type="button"
                    onClick={addOverlay}
                    className="rounded-xl bg-white px-3 py-1 text-xs font-semibold text-black transition hover:bg-white/90"
                  >
                    Add overlay
                  </button>
                </div>
                <div className="mt-4 flex flex-col gap-4">
                  {overlays.length === 0 && (
                    <p className="rounded-xl border border-white/10 bg-black/30 p-4 text-sm text-white/60">
                      Add captions, CTAs, or sticker text timed perfectly to your clip.
                    </p>
                  )}
                  {overlays.map((overlay) => renderOverlayControls(overlay))}
                </div>
              </div>

              <div className="rounded-2xl bg-black/40 p-4">
                <h2 className="text-sm font-semibold text-white">Soundtrack Mixing</h2>
                <div className="mt-4 flex flex-col gap-4 text-sm text-white/70">
                  <label className="flex flex-col gap-2">
                    <span>Background music</span>
                    <input
                      type="file"
                      accept="audio/*"
                      onChange={(event) => handleMusicUpload(event.target.files?.[0] ?? null)}
                      className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 focus:border-white/40 focus:outline-none"
                    />
                    {musicFile && <span className="text-xs text-white/50">{musicFile.name}</span>}
                  </label>
                  <label className="flex items-center justify-between">
                    <span>Use original audio</span>
                    <input
                      type="checkbox"
                      checked={useOriginalAudio}
                      onChange={(event) => setUseOriginalAudio(event.target.checked)}
                      className="h-5 w-5 rounded border border-white/40 bg-black/30"
                    />
                  </label>
                  {useOriginalAudio && (
                    <label className="flex flex-col gap-2 text-xs text-white/60">
                      <span>Video volume</span>
                      <input
                        type="range"
                        min={0}
                        max={1.5}
                        step={0.05}
                        value={videoVolume}
                        onChange={(event) => setVideoVolume(Number(event.target.value))}
                      />
                    </label>
                  )}
                  {musicFile && (
                    <label className="flex flex-col gap-2 text-xs text-white/60">
                      <span>Music volume</span>
                      <input
                        type="range"
                        min={0}
                        max={1.5}
                        step={0.05}
                        value={musicVolume}
                        onChange={(event) => setMusicVolume(Number(event.target.value))}
                      />
                    </label>
                  )}
                </div>
              </div>

              <div className="rounded-2xl bg-black/40 p-4">
                <h2 className="text-sm font-semibold text-white">Export</h2>
                <p className="mt-2 text-xs text-white/60">
                  Final render uses cinematic H.264 export optimised for Instagram. Expect processing to take several
                  seconds in the browser.
                </p>
                <button
                  type="button"
                  disabled={disableExport || exportStatus === "loading"}
                  onClick={handleExport}
                  className="mt-4 w-full rounded-2xl bg-gradient-to-r from-purple-500 via-pink-500 to-orange-500 py-3 text-sm font-semibold text-white shadow-lg shadow-purple-500/30 transition hover:shadow-purple-500/50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {exportStatus === "loading"
                    ? isLoadingFFmpeg
                      ? "Preparing engine..."
                      : "Rendering..."
                    : "Render master video"}
                </button>

                {errorMessage && (
                  <p className="mt-3 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                    {errorMessage}
                  </p>
                )}

                {exportStatus === "ready" && exportUrl && (
                  <div className="mt-4 flex flex-col gap-2 rounded-2xl border border-white/10 bg-black/30 p-4 text-sm text-white/80">
                    <span>Export complete!</span>
                    <a
                      href={exportUrl}
                      download="instagram-master.mp4"
                      className="rounded-xl bg-white px-3 py-2 text-center text-xs font-semibold text-black transition hover:bg-white/90"
                    >
                      Download video
                    </a>
                    <span className="text-xs text-white/50">
                      Tip: share straight to Instagram Reels or schedule with your favourite social media tool.
                    </span>
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {errorMessage && !videoFile && (
          <p className="mx-auto max-w-xl rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-center text-sm text-red-200">
            {errorMessage}
          </p>
        )}
      </div>
    </div>
  );
}
