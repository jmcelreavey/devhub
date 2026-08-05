import crypto from "node:crypto";

/**
 * Passphrase generation for one-time shares.
 *
 * DevHub generates the password rather than asking for one. A human-chosen
 * password for a link they will paste into Slack in the next ten seconds is
 * reliably terrible, and the recipient has to be able to retype it, so words
 * beat symbols: they survive being read aloud on a call, which is the realistic
 * second channel for getting the password to someone.
 */

/**
 * Deliberately short, unambiguous, hard-to-mishear words. No homophones
 * (`their`/`there`), no words that differ only by a letter that sounds the same
 * over a bad connection.
 */
export const WORDS = [
  "acorn", "amber", "anchor", "apple", "arrow", "atlas", "autumn", "bacon",
  "badge", "bamboo", "banjo", "barrel", "basil", "beacon", "beetle", "bishop",
  "bison", "blanket", "blossom", "bobcat", "bonsai", "boulder", "bramble", "branch",
  "bridge", "bronze", "bucket", "buffalo", "bundle", "burrow", "cabin", "cactus",
  "camel", "candle", "canvas", "canyon", "cargo", "carrot", "castle", "cedar",
  "cello", "cement", "chalk", "cherry", "chimney", "cinder", "circus", "clover",
  "cobalt", "cobra", "cocoa", "comet", "compass", "copper", "coral", "cotton",
  "cougar", "crater", "crayon", "cricket", "crimson", "crystal", "cymbal", "dagger",
  "dahlia", "daisy", "dolphin", "domino", "donkey", "dragon", "dust", "eagle",
  "ember", "emerald", "engine", "fabric", "falcon", "fennel", "fiddle", "flint",
  "florist", "forest", "fossil", "fountain", "foxglove", "freckle", "frost", "galaxy",
  "garlic", "gecko", "geyser", "ginger", "glacier", "granite", "gravel", "grotto",
  "guitar", "gully", "gumbo", "hammer", "hamster", "harbor", "harvest", "hazel",
  "heron", "hickory", "hollow", "hornet", "hurdle", "iceberg", "igloo", "indigo",
  "ivory", "jackal", "jasmine", "jigsaw", "jungle", "juniper", "kayak", "kelp",
  "kettle", "kitten", "koala", "lagoon", "lantern", "lattice", "lavender", "ledger",
  "lemon", "lentil", "lichen", "lilac", "linen", "lizard", "lobster", "locket",
  "lotus", "lumber", "magnet", "magnolia", "mammoth", "mango", "maple", "marble",
  "marigold", "marsh", "meadow", "medley", "melon", "mercury", "meteor", "mimosa",
  "mineral", "minnow", "mitten", "monsoon", "mosaic", "moss", "muffin", "mulberry",
  "mushroom", "mustard", "nectar", "needle", "nickel", "nutmeg", "oasis", "obsidian",
  "octopus", "olive", "onyx", "opal", "orbit", "orchard", "orchid", "osprey",
  "otter", "oyster", "paddle", "palace", "pancake", "panda", "papaya", "paprika",
  "parcel", "parsley", "pasture", "pebble", "pelican", "pepper", "petal", "pewter",
  "pigment", "pillow", "pinecone", "pistachio", "pivot", "plateau", "platinum", "plum",
  "pocket", "pollen", "pomelo", "poppy", "porcelain", "possum", "prairie", "pretzel",
  "prism", "pudding", "puffin", "pumpkin", "quartz", "quiver", "rabbit", "raccoon",
  "radish", "rafter", "ragtime", "rainbow", "ranch", "raven", "ribbon", "rocket",
  "rosemary", "rubble", "ruby", "rudder", "saffron", "sage", "salmon", "sandal",
  "sapphire", "sardine", "satchel", "scallop", "scarlet", "seagull", "sequoia", "shamrock",
  "sherbet", "shovel", "shrimp", "silver", "sizzle", "slate", "sloth", "smoke",
  "snapper", "socket", "sonnet", "sparrow", "spinach", "spiral", "sprout", "spruce",
  "squash", "squid", "stallion", "starfish", "stencil", "sterling", "stucco", "sugar",
  "sulfur", "summit", "sunset", "swallow", "sycamore", "syrup", "tabby", "tadpole",
  "talon", "tangerine", "tapestry", "tavern", "teapot", "tempo", "terrace", "thicket",
  "thimble", "thistle", "thunder", "tiger", "timber", "tinsel", "toffee", "tomato",
  "topaz", "tornado", "tortoise", "toucan", "trellis", "trombone", "trophy", "trout",
  "truffle", "trumpet", "tulip", "tundra", "tunnel", "turnip", "turquoise", "turtle",
  "ukulele", "umbrella", "unicorn", "vanilla", "velvet", "vessel", "village", "vinegar",
  "violet", "volcano", "walnut", "walrus", "wagon", "wander", "wasabi", "waterfall",
  "weasel", "welcome", "whisker", "willow", "window", "winter", "wisteria", "wombat",
  "yarrow", "yellow", "yogurt", "zebra", "zenith", "zephyr", "zigzag", "zucchini",
] as const;

/**
 * How many words a generated passphrase has.
 *
 * Six words from this list is ~50 bits. That is short of what you would want
 * for a password guarded only by a rate limit, and it is deliberate: the
 * passphrase is a *second* factor. An attacker also needs the paste URL, whose
 * id is 16 hex characters, and fetching the paste to obtain ciphertext for an
 * offline attack burns it — so they get one shot at grabbing the data, then
 * face 2^50 candidates through PBKDF2 at 100k iterations. Six words is also
 * about the limit of what someone will retype from a phone call without
 * mistakes, which is the constraint that actually binds.
 */
export const PASSPHRASE_WORDS = 6;

export const WORDLIST_SIZE = WORDS.length;

/**
 * Bits of entropy in a generated passphrase. Reported so a future change to the
 * word count or list size has to face the number rather than a vibe.
 */
export function passphraseEntropyBits(
  words: number = PASSPHRASE_WORDS,
  // Widened to `number` on purpose: `WORDS` is `as const`, so `WORDS.length` is
  // the literal 336 and an inferred default would reject every other argument.
  listSize: number = WORDLIST_SIZE,
): number {
  return words * Math.log2(listSize);
}

/**
 * Uniform random index in `[0, max)` via rejection sampling.
 *
 * `randomInt % max` would bias toward low indices whenever `max` does not
 * divide the range evenly, which it does not here.
 */
function randomIndex(max: number): number {
  return crypto.randomInt(0, max);
}

/** A space-separated passphrase, e.g. `harbor thistle cobalt ...`. */
export function generatePassphrase(words = PASSPHRASE_WORDS): string {
  return Array.from({ length: words }, () => WORDS[randomIndex(WORDS.length)]).join(" ");
}
