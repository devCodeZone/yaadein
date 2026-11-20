/**
 * categories.ts — turns raw AI labels into friendly groups.
 *
 * The object model (MobileNet, trained on "ImageNet") knows 1,000 very specific
 * things: 118 dog breeds, "seashore", "pizza", "sports car", "web site"…
 * Searching for "golden retriever" is great, but in the Things page you want
 * "Dogs". This file maps the 1,000 specific labels to ~16 friendly categories.
 *
 * Two techniques:
 *   1. INDEX RANGES — ImageNet classes are grouped by number (151–268 are all
 *      dogs), so a range check is the cleanest way.
 *   2. NAME LISTS — for objects scattered across the list (cars, buildings…).
 */
import { IMAGENET_CLASSES } from '@tensorflow-models/mobilenet/dist/imagenet_classes';

/** class name → class index, e.g. "Chihuahua" → 151 */
const INDEX_OF = new Map<string, number>(
  Object.entries(IMAGENET_CLASSES as Record<string, string>).map(([i, name]) => [name, Number(i)])
);

/** Every category the app knows, with an emoji for the UI. Order = display order. */
export const CATEGORIES: Record<string, string> = {
  People: '🧑‍🤝‍🧑',
  Dogs: '🐶',
  Cats: '🐱',
  Birds: '🐦',
  Animals: '🦋',
  Food: '🍛',
  'Beaches & Water': '🏖️',
  Mountains: '🏔️',
  'Flowers & Plants': '🌸',
  Vehicles: '🚗',
  'Buildings & Places': '🏛️',
  Celebrations: '🎉',
  Sports: '⚽',
  Fashion: '👗',
  Electronics: '💻',
  Home: '🛋️',
  'Documents & Screens': '📄',
  Screenshots: '📱',
};

const RANGES: Array<[number, number, string]> = [
  [0, 6, 'Animals'], // fish
  [7, 24, 'Birds'],
  [25, 79, 'Animals'], // amphibians, reptiles, spiders…
  [80, 100, 'Birds'],
  [101, 126, 'Animals'],
  [127, 146, 'Birds'],
  [147, 150, 'Animals'],
  [151, 268, 'Dogs'],
  [269, 280, 'Animals'], // wolves, foxes
  [281, 285, 'Cats'],
  [286, 397, 'Animals'], // big cats, bears, insects, horses, monkeys, fish…
  [923, 969, 'Food'],
  [970, 970, 'Mountains'], // alp
  [972, 972, 'Mountains'], // cliff
  [973, 973, 'Beaches & Water'], // coral reef
  [975, 975, 'Beaches & Water'], // lakeside
  [976, 976, 'Mountains'], // promontory
  [977, 978, 'Beaches & Water'], // sandbar, seashore
  [979, 980, 'Mountains'], // valley, volcano
  [981, 981, 'Sports'], // ballplayer
  [982, 982, 'Celebrations'], // groom
  [983, 983, 'Beaches & Water'], // scuba diver
  [984, 998, 'Flowers & Plants'], // daisy, corn, acorn, mushrooms…
];

/** First synonym of each ImageNet class name we want to catch by name. */
const NAMES: Record<string, string[]> = {
  Vehicles: [
    'ambulance', 'beach wagon', 'cab', 'convertible', 'jeep', 'limousine', 'minivan', 'Model T', 'racer', 'sports car',
    'pickup', 'police van', 'moving van', 'trailer truck', 'tow truck', 'garbage truck', 'fire engine', 'minibus',
    'school bus', 'trolleybus', 'moped', 'motor scooter', 'bicycle-built-for-two', 'mountain bike', 'tricycle',
    'unicycle', 'electric locomotive', 'steam locomotive', 'passenger car', 'freight car', 'streetcar', 'bullet train',
    'airliner', 'warplane', 'airship', 'speedboat', 'canoe', 'gondola', 'liner', 'yawl', 'catamaran', 'trimaran',
    'schooner', 'container ship', 'fireboat', 'lifeboat', 'tractor', 'go-kart', 'golfcart', 'snowmobile', 'tank',
    'car wheel', 'grille', 'jinrikisha', 'oxcart', 'horse cart', 'forklift', 'half track', 'amphibian', 'recreational vehicle',
  ],
  'Buildings & Places': [
    'palace', 'monastery', 'mosque', 'church', 'stupa', 'castle', 'library', 'cinema', 'dome', 'triumphal arch',
    'bell cote', 'planetarium', 'boathouse', 'barn', 'suspension bridge', 'steel arch bridge', 'viaduct', 'pier',
    'fountain', 'obelisk', 'megalith', 'totem pole', 'restaurant', 'bakery', 'grocery store', 'shoe shop', 'toyshop',
    'bookshop', 'butcher shop', 'confectionery', 'prison', 'water tower', 'beacon', 'patio', 'thatch', 'yurt',
    'mobile home', 'greenhouse', 'tobacco shop', 'barbershop', 'cliff dwelling', 'altar', 'brass', 'gas pump',
  ],
  'Beaches & Water': ['breakwater', 'dock', 'paddle', 'swimming trunks', 'bikini', 'snorkel', 'sandbar', 'wreck'],
  'Documents & Screens': ['web site', 'menu', 'envelope', 'book jacket', 'comic book', 'crossword puzzle', 'binder', 'packet', 'slide rule', 'scoreboard', 'street sign'],
  Celebrations: ['groom', 'gown', 'veil', 'balloon', 'candle', 'pinata', 'wig', 'stage', 'theater curtain', 'cake'],
  Sports: [
    'basketball', 'volleyball', 'soccer ball', 'football helmet', 'tennis ball', 'racket', 'rugby ball', 'golf ball',
    'baseball', 'ping-pong ball', 'croquet ball', 'parallel bars', 'balance beam', 'horizontal bar', 'dumbbell',
    'barbell', 'puck', 'ski', 'punching bag', 'swimming trunks', 'scuba diver',
  ],
  Fashion: [
    'jersey', 'sweatshirt', 'suit', 'abaya', 'kimono', 'sarong', 'miniskirt', 'jean', 'cardigan', 'trench coat',
    'fur coat', 'cowboy hat', 'sombrero', 'sunglasses', 'sunglass', 'necklace', 'lipstick', 'bow tie', 'Windsor tie',
    'running shoe', 'sandal', 'Loafer', 'cowboy boot', 'purse', 'backpack', 'wallet', 'maillot', 'poncho', 'stole',
  ],
  Electronics: [
    'laptop', 'notebook', 'desktop computer', 'cellular telephone', 'iPod', 'modem', 'monitor', 'mouse',
    'computer keyboard', 'remote control', 'television', 'screen', 'reflex camera', 'Polaroid camera', 'joystick',
    'printer', 'projector', 'hand-held computer', 'loudspeaker', 'microphone', 'tape player', 'radio',
  ],
  Home: [
    'studio couch', 'four-poster', 'quilt', 'desk', 'dining table', 'rocking chair', 'folding chair', 'wardrobe',
    'bookcase', 'china cabinet', 'refrigerator', 'microwave', 'dishwasher', 'washer', 'stove', 'toaster',
    'espresso maker', 'lampshade', 'table lamp', 'pillow', 'shower curtain', 'bathtub', 'tub', 'window shade',
    'crib', 'entertainment center', 'home theater', 'chiffonier', 'medicine chest', 'wall clock',
  ],
  'Flowers & Plants': ['pot', 'vase', 'daisy', 'greenhouse'],
};

const NAME_TO_CATEGORY = new Map<string, string>();
for (const [cat, names] of Object.entries(NAMES)) for (const n of names) if (!NAME_TO_CATEGORY.has(n)) NAME_TO_CATEGORY.set(n, cat);

/** "cab, hack, taxi, taxicab" → "cab" */
export const primaryName = (className: string) => className.split(',')[0].trim();

/** Category for one ImageNet class name, or null. */
export function categoryOf(className: string): string | null {
  const idx = INDEX_OF.get(className);
  if (idx !== undefined) {
    for (const [from, to, cat] of RANGES) if (idx >= from && idx <= to) return cat;
  }
  return NAME_TO_CATEGORY.get(primaryName(className)) || null;
}

/**
 * Decide the photo's categories from its labels + faces + file info.
 * The first category is the "main" one (used by "Organize by things").
 */
export function categorize(
  labels: Array<{ className: string; probability: number }>,
  opts: { faceArea: number; faceCount: number; name: string; ext: string; camera: string | null }
): string[] {
  const score = new Map<string, number>();
  for (const l of labels) {
    const cat = categoryOf(l.className);
    if (cat) score.set(cat, (score.get(cat) || 0) + l.probability);
  }
  let cats = [...score.entries()]
    .filter(([, s]) => s >= 0.2) // ignore weak guesses
    .sort((a, b) => b[1] - a[1])
    .map(([c]) => c);

  // People: if faces fill a decent part of the photo it's a people photo first.
  if (opts.faceCount > 0) {
    cats = cats.filter((c) => c !== 'People');
    if (opts.faceArea > 0.04 || cats.length === 0) cats.unshift('People');
    else cats.push('People');
  }

  // Screenshots: file name says so, or a PNG with no camera info.
  const looksLikeScreenshot = /screenshot|screen shot|scr_|screencap/i.test(opts.name) || (opts.ext === '.png' && !opts.camera);
  if (looksLikeScreenshot) cats = ['Screenshots', ...cats.filter((c) => c !== 'Screenshots')];

  return cats.slice(0, 4);
}
