import { Image } from "jsr:@cross/image@0.4.3";
import { optimiseSource } from "../supabase/functions/embellir-photo-produit/index.ts";

const source = Image.create(400, 200, 190, 55, 45, 255);
source.fillRect(120, 50, 160, 100, 50, 160, 220, 255);
const input = await source.encode("png");
const output = await optimiseSource(input);
const result = await Image.decode(output, { tolerantDecoding: true });

if (result.width !== 400 || result.height !== 200) {
  throw new Error(`Les proportions ont changé : ${result.width}x${result.height}`);
}

function pixel(image: Image, x: number, y: number): number[] {
  const i = (y * image.width + x) * 4;
  return [image.data[i], image.data[i + 1], image.data[i + 2], image.data[i + 3]];
}

const corner = pixel(result, 0, 0);
const subject = pixel(result, 200, 100);
if (corner[0] !== 190 || corner[1] !== 55 || corner[2] !== 45 || corner[3] !== 255) {
  throw new Error(`Le fond coloré a été modifié : ${corner.join(",")}`);
}
if (subject[0] !== 50 || subject[1] !== 160 || subject[2] !== 220 || subject[3] !== 255) {
  throw new Error(`Le sujet a été modifié : ${subject.join(",")}`);
}

console.log("OK: fond coloré, proportions et sujet conservés exactement");
