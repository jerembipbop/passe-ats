// Rend chaque plan en MP4 directement dans les médias du montage HyperFrames
import { execFileSync } from "node:child_process";

const ids = process.argv.slice(2).length ? process.argv.slice(2) : ["robots", "drop", "score", "offer", "adapt", "docs"];
for (const id of ids) {
  execFileSync("npx", ["remotion", "render", "src/index.jsx", id, `../montage/assets/${id}.mp4`, "--codec=h264", "--crf=16"], { stdio: "inherit", shell: true });
}
