/**
 * Loads the bundled Barlow / IBM Plex faces through the FontFace API.
 *
 * The browser build used for screenshots rejects the same files when they're
 * declared with CSS @font-face, but decodes them correctly through FontFace.
 * Waiting for these before the first render also avoids a flash of fallback
 * text and makes the canvas dashboard use the real numerals from the start.
 */
const FACES = [
  { family: 'Barlow Condensed', weight: '500', url: new URL('../fonts/barlow-condensed-500.woff2', import.meta.url) },
  { family: 'Barlow Condensed', weight: '600', url: new URL('../fonts/barlow-condensed-600.woff2', import.meta.url) },
  { family: 'Barlow Condensed', weight: '700', url: new URL('../fonts/barlow-condensed-700.woff2', import.meta.url) },
  { family: 'IBM Plex Mono', weight: '400', url: new URL('../fonts/ibm-plex-mono-400.woff2', import.meta.url) },
  { family: 'IBM Plex Mono', weight: '500', url: new URL('../fonts/ibm-plex-mono-500.woff2', import.meta.url) },
  { family: 'IBM Plex Mono', weight: '600', url: new URL('../fonts/ibm-plex-mono-600.woff2', import.meta.url) },
  { family: 'IBM Plex Sans', weight: '400', url: new URL('../fonts/ibm-plex-sans-400.woff2', import.meta.url) },
  { family: 'IBM Plex Sans', weight: '500', url: new URL('../fonts/ibm-plex-sans-500.woff2', import.meta.url) },
  { family: 'IBM Plex Sans', weight: '600', url: new URL('../fonts/ibm-plex-sans-600.woff2', import.meta.url) },
] as const;

let loading: Promise<void> | null = null;

async function addFace(spec: (typeof FACES)[number]): Promise<void> {
  try {
    const face = new FontFace(spec.family, `url("${spec.url.href}") format("woff2")`, {
      style: 'normal',
      weight: spec.weight,
    });
    await face.load();
    document.fonts.add(face);
  } catch (error) {
    // A missing font must never stop the game from booting.
    console.warn(`Could not load ${spec.family} ${spec.weight}`, error);
  }
}

export function loadLocalFonts(): Promise<void> {
  if (!loading) {
    loading = Promise.all(FACES.map(addFace))
      .then(() => document.fonts.ready)
      .then(() => undefined)
      .catch(() => undefined);
  }
  return loading;
}
