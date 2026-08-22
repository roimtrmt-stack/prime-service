import { Image } from "jsr:@cross/image@0.4.3";
import { detectContentBounds, optimiseSource } from "../supabase/functions/embellir-photo-produit/index.ts";

const inputPath = Deno.args[0] || "/home/ubuntu/upload/pasted_file_dtof7N_image.png";
const outputPath = Deno.args[1] || "/tmp/prime-service-photo-optimisee.jpg";
const input = await Deno.readFile(inputPath);
const decoded = await Image.decode(input, { tolerantDecoding: true });
const bounds = detectContentBounds(decoded);
if (!bounds.reliable) throw new Error("Le détecteur de sujet ne trouve pas de contenu fiable");

const output = await optimiseSource(input);
await Deno.writeFile(outputPath, output);
const optimized = await Image.decode(output, { tolerantDecoding: true });
if (optimized.width !== 1000 || optimized.height !== 1000) {
  throw new Error(`Sortie inattendue : ${optimized.width}x${optimized.height}`);
}
if (output.byteLength === 0) throw new Error("Sortie image vide");

let nonStudioPixels = 0;
for (let i = 0; i < optimized.data.length; i += 16) {
  const r = optimized.data[i];
  const g = optimized.data[i + 1];
  const b = optimized.data[i + 2];
  if (Math.max(r, g, b) - Math.min(r, g, b) > 18 || r < 220 || g < 220 || b < 220) nonStudioPixels++;
}
if (nonStudioPixels < 100) throw new Error("Le sujet n’est pas présent dans la sortie");

console.log(JSON.stringify({ inputPath, outputPath, input: `${decoded.width}x${decoded.height}`, bounds, output: `${optimized.width}x${optimized.height}`, bytes: output.byteLength, nonStudioPixels }));
