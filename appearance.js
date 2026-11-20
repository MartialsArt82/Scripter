'use strict';

const appearance = (() => {
  const categories = {
    general: { label: 'Allgemein', icon: 'book-open' },
    science: { label: 'Science-Fiction', icon: 'ufo' },
    romance: { label: 'Liebesroman', icon: 'heart' },
    fantasy: { label: 'Fantasy', icon: 'wand-sparkles' },
    crime: { label: 'Krimi / Thriller', icon: 'fingerprint' },
    history: { label: 'Historischer Roman', icon: 'scroll' },
    adventure: { label: 'Abenteuer', icon: 'compass' },
    drama: { label: 'Drama', icon: 'drama' },
    other: { label: 'Andere Kategorie', icon: 'sparkles' }
  };
  const colors = {
    forest: { label: 'Waldgrün', light: ['#36583d','#28452e','#e4ecdd','#f1f1e9','#f7f6f1'], dark: ['#a4c4a0','#bdd5b9','#364a37','#1e251f','#242b25'] },
    ocean: { label: 'Ozeanblau', light: ['#244e78','#1b3b5c','#e1edf8','#eaf1f8','#f2f6fa'], dark: ['#a5cef7','#bbdcfc','#304961','#1c2531','#222c3b'] },
    berry: { label: 'Beerenrot', light: ['#822f50','#66203c','#f5e5ec','#f6edf1','#faf4f6'], dark: ['#f5b0cb','#ffd0e1','#573649','#2c2129','#362730'] },
    clay: { label: 'Terrakotta', light: ['#813b24','#662a18','#f6e8df','#f5eee9','#faf5f0'], dark: ['#f3bb9c','#ffd5b8','#573e32','#2b231f','#362b25'] },
    violet: { label: 'Pflaume', light: ['#634078','#4f2e63','#efe7f7','#f1edf6','#f7f4fa'], dark: ['#d6bdf1','#e9d6fa','#4b3f60','#272231','#30293b'] },
    slate: { label: 'Schiefer', light: ['#405568','#304355','#e6edf2','#eef1f4','#f6f7f8'], dark: ['#bccdde','#d0dce9','#3c4a58','#20252b','#282f36'] }
  };
  const fonts = {
    Georgia: 'Georgia, Lora, serif',
    Palatino: 'Palatino, "Palatino Linotype", "Book Antiqua", serif',
    'Times New Roman': '"Times New Roman", "Liberation Serif", serif',
    Garamond: 'Garamond, "EB Garamond", serif',
    Arial: 'Arial, "Liberation Sans", sans-serif',
    Verdana: 'Verdana, "DejaVu Sans", sans-serif',
    'Courier Prime': '"Courier Prime", monospace'
  };
  const zoomLevels = [75,85,95,100,110,125,150,175,200];
  const textSizes = [16,18,20,22,24,28,32,36];
  const lineHeights = [1.4,1.6,1.8,2,2.2,2.4];
  const normalizeProjectStyle = input => ({
    category: Object.hasOwn(categories, input?.category) ? input.category : 'general',
    accent: Object.hasOwn(colors, input?.accent) ? input.accent : 'forest'
  });
  const normalizeAccess = input => ({
    zoom: zoomLevels.includes(input?.zoom) ? input.zoom : null,
    textSize: textSizes.includes(input?.textSize) ? input.textSize : 18,
    lineHeight: lineHeights.includes(input?.lineHeight) ? input.lineHeight : 1.8,
    highContrast: input?.highContrast === true,
    strongFocus: input?.strongFocus === true,
    reduceMotion: input?.reduceMotion === true
  });
  const fontStack = name => Object.hasOwn(fonts, name) ? fonts[name] : fonts.Georgia;
  return { categories, colors, fonts, zoomLevels, textSizes, lineHeights, normalizeProjectStyle, normalizeAccess, fontStack };
})();
if (typeof module !== 'undefined') module.exports = appearance;
