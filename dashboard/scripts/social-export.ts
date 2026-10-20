import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { execExternal } from "../lib/exec-external";
import type { Frame } from "./demo-kit";

export interface Camera { x: number; y: number; width: number }
export interface SocialShot {
  name: string;
  caption: string;
  seconds: number;
  frames: Frame[];
  stoppedAt: number;
  from: Camera;
  to: Camera;
}
const FPS = 25;
const SIZES = [{ name: "square", width: 1080 }, { name: "16x9", width: 1920 }] as const;

async function ffmpeg(args: string[]) {
  await execExternal("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], {
    timeoutMs: 300_000, maxBuffer: 4 * 1024 * 1024, label: "social-video-export",
  });
}
const escapeXml = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
const ease = "min(on/20,1)*min(on/20,1)*(3-2*min(on/20,1))";
function tween(a: number, b: number) { return `(${a}+(${b - a})*(${ease}))`; }

/** One edit decision list feeds both aspect ratios. Captions stay outside the camera. */
export async function exportSocial(shots: SocialShot[], outDir: string, workDir: string) {
  fs.mkdirSync(outDir, { recursive: true });
  for (const shot of shots) {
    const dir = path.join(workDir, shot.name);
    fs.mkdirSync(dir, { recursive: true });
    if (!shot.frames.length) throw new Error("Empty shot: " + shot.name);
    const first = shot.frames[0].at;
    const duration = shot.stoppedAt - first;
    const manifest: string[] = ["ffconcat version 1.0"];
    for (let i = 0; i < shot.frames.length; i++) {
      const file = path.join(dir, `${i}.png`);
      fs.writeFileSync(file, shot.frames[i].png);
      const next = shot.frames[i + 1]?.at ?? shot.stoppedAt;
      manifest.push(`file '${file}'`, `duration ${Math.max(0.001, next - shot.frames[i].at)}`);
    }
    manifest.push(`file '${path.join(dir, `${shot.frames.length - 1}.png`)}'`);
    const list = path.join(dir, "frames.txt");
    fs.writeFileSync(list, manifest.join("\n") + "\n");
    await ffmpeg(["-safe", "0", "-i", list, "-vf", `setpts=PTS*${shot.seconds / duration},fps=${FPS}`,
      "-t", String(shot.seconds), "-c:v", "libx264", "-crf", "16", "-pix_fmt", "yuv420p",
      path.join(dir, "source.mp4")]);
    // Free the lossless capture once it is on disk.
    shot.frames = [];
  }
  for (const size of SIZES) {
    const width = size.width;
    const height = 1080;
    const top = 156;
    const videoHeight = 820;
    const outputs: string[] = [];
    let elapsed = 0;
    for (const shot of shots) {
      const dir = path.join(workDir, shot.name);
      const overlay = path.join(dir, size.name + "-caption.png");
      const fontSize = width === 1080 ? 52 : 76;
      await sharp(Buffer.from(`<svg width="${width}" height="1080" xmlns="http://www.w3.org/2000/svg">
        <rect width="${width}" height="156" fill="#111416"/>
        <rect y="976" width="${width}" height="104" fill="#111416"/>
        <text x="48" y="103" fill="#ebeff3" font-family="Helvetica,Arial,sans-serif" font-size="${fontSize}" font-weight="700">${escapeXml(shot.caption)}</text>
        ${process.env.DEMO_SOCIAL_EXPORT === "1" ? "" : `<text x="${width - 48}" y="1041" text-anchor="end" fill="#ebeff3" font-family="Arial" font-size="24">FIXTURE DATA / SIMULATED PROVIDERS</text>`}
        <text x="48" y="1041" fill="#a5b0ba" font-family="Helvetica,Arial,sans-serif" font-size="${width === 1080 ? 28 : 36}">DevHub</text>
        <rect x="48" y="1066" width="${width - 96}" height="3" fill="#37414b"/>
        <rect x="48" y="1066" width="${Math.round((width - 96) * (elapsed + shot.seconds) / 28)}" height="3" fill="#9ed84a"/>
      </svg>`)).png().toFile(overlay);
      // Camera coordinates are centres in the 1280 × 900 source. The aspect ratio changes
      // the visible height, never the UI proportions. Clamp the crop to the source bounds.
      const zoom = `iw/${tween(shot.from.width, shot.to.width)}`;
      const padWidth = Math.ceil(Math.max(1280, 900 * width / videoHeight) / 2) * 2;
      const padHeight = Math.ceil(Math.max(900, 1280 * videoHeight / width) / 2) * 2;
      const x = `max(0,min(1280-iw/zoom,${tween(shot.from.x, shot.to.x)}-iw/zoom/2))`;
      const y = `max(0,min(900-ih/zoom,${tween(shot.from.y, shot.to.y)}-iw/zoom*${videoHeight / width}/2))`;
      const output = path.join(dir, size.name + ".mp4");
      await ffmpeg(["-i", path.join(dir, "source.mp4"), "-loop", "1", "-i", overlay,
        "-filter_complex",
        `[0:v]pad=${padWidth}:${padHeight}:0:0:color=0x111416,zoompan=z='${zoom}':x='${x}':y='${y}':d=1:s=${width}x${videoHeight}:fps=${FPS},pad=${width}:${height}:0:${top}:color=0x111416[video];[video][1:v]overlay=0:0,format=yuv420p[out]`,
        "-map", "[out]", "-t", String(shot.seconds), "-c:v", "libx264", "-preset", "slow",
        "-crf", "21", "-maxrate", "3500k", "-bufsize", "7000k", "-an", output]);
      outputs.push(output);
      elapsed += shot.seconds;
    }
    const list = path.join(workDir, size.name + ".txt");
    fs.writeFileSync(list, outputs.map(file => `file '${file}'`).join("\n") + "\n");
    const out = path.join(outDir, `devhub-linkedin-${size.name}.mp4`);
    await ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", out]);
    if (fs.statSync(out).size >= 15_000_000) throw new Error("MP4 exceeds 15 MB: " + out);
    const probe = await execExternal("ffprobe", ["-v", "error", "-show_entries",
      "stream=width,height,codec_name,pix_fmt:format=duration", "-of", "json", out]);
    const media = JSON.parse(probe.stdout) as {
      streams: { width: number; height: number; codec_name: string; pix_fmt: string }[];
      format: { duration: string };
    };
    const stream = media.streams[0];
    if (stream?.width !== width || stream.height !== 1080 || stream.codec_name !== "h264" ||
        stream.pix_fmt !== "yuv420p" || Math.abs(Number(media.format.duration) - 28) > 0.1) {
      throw new Error("Unexpected social video format: " + probe.stdout);
    }
    console.log(`${path.basename(out)}: ${media.format.duration}s, ${fs.statSync(out).size} bytes`);
  }
  await ffmpeg(["-i", path.join(outDir, "devhub-linkedin-square.mp4"),
    "-filter_complex", "[0:v]fps=5,scale=480:480:flags=lanczos,split[a][b];[a]palettegen=max_colors=48:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle",
    "-loop", "0", path.join(outDir, "devhub-linkedin.gif")]);
}
