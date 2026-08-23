import { Image } from "jsr:@cross/image@0.4.3";
import { optimiseSource } from "../supabase/functions/embellir-photo-produit/index.ts";

const inputPath = Deno.args[0] || "/home/ubuntu/upload/pasted_file_dtof7N_image.png";
const outputPath = Deno.args[1] || "/tmp/prime-service-photo-optimisee.jpg";
const input = await Deno.readFile(inputPath);
const decoded = await Image.decode(input, { tolerantDecoding: true });
const output = await optimiseSource(input);
await Deno.writeFile(outputPath, output);
const optimized = await Image.decode(output, { tolerantDecoding: true });
if (optimized.width > 1200 || optimized.height > 1200) {
  throw new Error(`Sortie trop grande : ${optimized.width}x${optimized.height}`);
}
const expectedRatio = decoded.width / decoded.height;
const actualRatio = optimized.width / optimized.height;
if (Math.abs(expectedRatio - actualRatio) > 0.01) {
  throw new Error(`Proportions modifiées : entrée ${expectedRatio}, sortie ${actualRatio}`);
}
if (output.byteLength === 0) throw new Error("Sortie image vide");

let inputCorners = 0;
let outputCorners = 0;
for (const [image, target] of [[decoded, "input"], [optimized, "output"]] as const) {
  const points = [
    [0, 0], [image.width - 1, 0], [0, image.height - 1], [image.width - 1, image.height - 1],
  ];
  for (const [x, y] of points) {
    const i = (y * image.width + x) * 4;
    const luma = 0.299 * image.data[i] + 0.587 * image.data[i + 1] + 0.114 * image.data[i + 2];
    if (target === "input" && luma < 245) inputCorners++;
    if (target === "output" && luma < 245) outputCorners++;
  }
}
if (inputCorners !== outputCorners) {
  throw new Error(`Le fond d’origine n’est pas conservé aux coins : ${inputCorners} -> ${outputCorners}`);
}

console.log(JSON.stringify({
  inputPath,
  outputPath,
  input: `${decoded.width}x${decoded.height}`,
  output: `${optimized.width}x${optimized.height}`,
  bytes: output.byteLength,
  inputCorners,
  outputCorners,
}));
