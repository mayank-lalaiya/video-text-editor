import { FONT_FACES } from '../../shared/fonts.ts';

const loadedFonts = new Map<string, FontFace>();

export async function loadBundledFonts(): Promise<void> {
  await Promise.all(
    FONT_FACES.map(async (face) => {
      const font = await new FontFace(
        face.family,
        `url("app-font://bundle/${face.id}")`,
        { style: face.style, weight: face.weight },
      ).load();
      const previous = loadedFonts.get(face.id);
      if (previous) document.fonts.delete(previous);
      document.fonts.add(font);
      loadedFonts.set(face.id, font);
    }),
  );
}
