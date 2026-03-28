/**
 * shared/antiSlop.ts — Comprehensive Anti-Slop Detection Data
 *
 * Curated from: NousResearch ANTI-SLOP, EQ-Bench slop-forensics,
 * sam-paech/antislop-sampler, adenaufal/anti-slop-writing, ContentBeta.
 *
 * All word/phrase entries are lowercase. Scanner matches case-insensitively.
 *
 * TIER SEMANTICS:
 *   Tier 1 — Kill on sight. Any occurrence is flagged. Almost never natural in fiction.
 *   Tier 2 — Cluster alarm. Fine alone; flag when 3+ unique Tier 2 words appear per scene.
 *   Tier 3 — Overuse detection. Normal fiction words that LLMs overrepresent. Flag above threshold.
 *   Tier 4 — Multi-word phrases. Verbatim matches always flagged.
 *   Tier 5 — Regex patterns. Structural tells detected by pattern matching.
 */

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface SlopHit {
  /** The matched word, phrase, or pattern name */
  term: string;
  /** Which tier triggered */
  tier: 1 | 2 | 3 | 4 | 5;
  /** How many times it appeared */
  count: number;
  /** Character offsets in the input text */
  positions: number[];
  /** Severity level */
  severity: "high" | "medium" | "low";
  /** Short surrounding text snippet for context */
  context: string[];
}

export interface ScanReport {
  /** Composite score 0–100 (higher = more sloppy) */
  score: number;
  /** Total number of distinct flagged terms */
  totalHits: number;
  /** Total flagged word/phrase occurrences across all tiers */
  totalOccurrences: number;
  /** Word count of the scanned text */
  wordCount: number;
  /** Tier-level breakdowns */
  tier1: SlopHit[];
  tier2: { hits: SlopHit[]; uniqueCount: number; clusterThreshold: number };
  tier3: SlopHit[];
  tier4: SlopHit[];
  tier5: SlopHit[];
  /** Whether the scene passes (score below threshold) */
  pass: boolean;
  /** Human-readable summary */
  summary: string;
}

export interface Tier3Group {
  /** Display name for the word group */
  root: string;
  /** All inflected forms to match */
  variants: readonly string[];
  /** Max combined count per scene before flagging */
  max: number;
}

export interface Tier5Pattern {
  /** Human-readable pattern name */
  name: string;
  /** The regex to match */
  pattern: RegExp;
  /** What this detects */
  description: string;
  /** Max occurrences per scene before flagging */
  maxPerScene: number;
}

// ═══════════════════════════════════════════════════════════════
// TIER 1: KILL ON SIGHT
// Any occurrence in fiction narration/dialogue is flagged.
// Sources: NousResearch T1, adenaufal T1, antislop-sampler hardcoded
// ═══════════════════════════════════════════════════════════════

export const TIER1_WORDS: readonly string[] = [
  // -- Academic/corporate jargon (never belongs in fiction) --
  "delve", "delved", "delving",
  "utilize", "utilized", "utilizing", "utilization",
  "facilitate", "facilitated", "facilitating",
  "elucidate", "elucidated", "elucidating",
  "endeavor", "endeavors", "endeavoured",
  "encompass", "encompassed", "encompassing",
  "multifaceted",
  "synergy", "synergize", "synergistic",
  "holistic", "holistically",
  "paradigm", "paradigms", "paradigm-shifting",
  "optimize", "optimized", "optimizing",
  "streamline", "streamlined", "streamlining",
  "spearhead", "spearheaded", "spearheading",
  "catalyze", "catalyzed", "catalyzing",
  "galvanize", "galvanized", "galvanizing",
  "juxtapose", "juxtaposed", "juxtaposing", "juxtaposition",
  "underscore", "underscored", "underscoring",
  "bolster", "bolstered", "bolstering",
  "garner", "garnered", "garnering",
  "leverage", "leveraged", "leveraging",
  "harness", "harnessed", "harnessing",
  "foster", "fostered", "fostering",
  "cultivate", "cultivated", "cultivating",
  "mitigate", "mitigated", "mitigating",
  "augment", "augmented", "augmenting",
  "exacerbate", "exacerbated", "exacerbating",
  "delineate", "delineated", "delineating",
  "operationalize", "operationalized",
  "incentivize", "incentivized",

  // -- Filler transitions (not fiction prose) --
  "furthermore",
  "moreover",
  "additionally",
  "nonetheless",
  "nevertheless",
  "henceforth",
  "thereby",
  "wherein",
  "consequently",
  "accordingly",
  "conversely",
  "hitherto",

  // -- Purple prose markers (LLMs reach for these instead of concrete description) --
  "tapestry",    // almost always metaphorical in LLM output
  "kaleidoscope", "kaleidoscopic",
  "gossamer",
  "tenebrous",
  "labyrinthine",
  "ineffable",
  "resplendent",
  "incandescent", // emotional, not literal
  "luminescent",
  "bioluminescent",
  "iridescent",
  "gossamer",
  "diaphanous",
  "effervescent", // emotional
  "ephemeral",
  "transcendent", "transcended", "transcending",

  // -- Puffery words (no place in scene narration) --
  "pivotal",
  "paramount",
  "quintessential",
  "indelible",
  "transformative",
  "groundbreaking",
  "commendable",
  "unparalleled",
  "indispensable",
  "indomitable",
  "avant-garde",

  // -- Overused abstract nouns --
  "nexus",
  "crucible",
  "linchpin",
  "bedrock",
  "cornerstone",  // metaphorical
  "odyssey",      // metaphorical
  "trajectory",   // metaphorical
  "interplay",
  "confluence",
  "dichotomy",
  "undercurrent",
  "underpinning", "underpinnings",

  // -- Quantity words LLMs overuse --
  "myriad",
  "plethora",
  "litany",
  "cornucopia",
  "panoply",
  "compendium",

  // -- Adverbs that are always AI tells --
  "meticulously",
  "intrinsically",
  "fundamentally",
  "inherently",
  "undeniably",
  "unequivocally",
  "irrevocably",
  "inextricably",
  "judiciously",
] as const;

// ═══════════════════════════════════════════════════════════════
// TIER 2: CLUSTER ALARM
// Individual use is fine. Flag scene when 3+ unique Tier 2 words appear.
// Sources: NousResearch T2, adenaufal T2-T3, EQ-Bench essay list,
// antislop-sampler curated (517 list)
// ═══════════════════════════════════════════════════════════════

export const TIER2_WORDS: readonly string[] = [
  // -- Overused adjectives --
  "robust",
  "comprehensive",
  "seamless", "seamlessly",
  "cutting-edge",
  "innovative",
  "intricate", "intricacies",
  "profound", "profoundly",
  "nuanced", "nuances",
  "vibrant",
  "bustling",
  "meticulous",
  "enigmatic",
  "ethereal",
  "visceral",
  "tangible",
  "palpable",
  "pervasive",
  "ubiquitous",
  "insidious", "insidiously",
  "poignant", "poignantly",
  "harrowing",
  "unassuming",
  "nondescript",
  "weathered",
  "grizzled",
  "wizened",
  "tousled",
  "disheveled",
  "threadbare",
  "sinewy",
  "lithe",
  "wiry",
  "angular",
  "swarthy",
  "gaunt",
  "statuesque",
  "imperious",
  "sardonic",
  "laconic",
  "mercurial",
  "stoic",
  "cryptic",
  "ominous", "ominously",
  "foreboding",
  "eerie", "eerily",
  "uncanny",
  "surreal",
  "primal",
  "feral",
  "guttural",
  "gravelly",
  "raspy",
  "husky",
  "dulcet",
  "mellifluous",
  "sonorous",
  "cacophonous",
  "discordant",
  "staccato",
  "rhythmic",
  "relentless", "relentlessly",
  "unyielding",
  "unwavering",
  "unflinching",
  "resolute",
  "steadfast",
  "indomitable",
  "formidable",
  "daunting",
  "imposing",
  "towering",
  "monolithic",
  "cavernous",
  "sprawling",
  "labyrinthian",
  "serpentine",
  "verdant",
  "obsidian",
  "crimson",
  "azure",
  "scarlet",
  "ebony",
  "alabaster",
  "ashen",
  "sallow",

  // -- Overused fiction adverbs --
  "instinctively",
  "involuntarily",
  "imperceptibly",
  "perceptibly",
  "conspicuously",
  "conspiratorially",
  "absently",
  "numbly",
  "mechanically",
  "deftly",
  "nimbly",
  "gingerly",
  "tentatively",
  "hesitantly",
  "warily",
  "languidly",
  "lazily",
  "dryly",
  "curtly",
  "tersely",
  "pointedly",
  "ruefully",
  "sardonically",
  "wryly",
  "mirthlessly",

  // -- Abstract nouns LLMs overuse --
  "testament",
  "beacon",       // metaphorical
  "pillar",       // metaphorical
  "bastion",
  "bulwark",
  "veneer",
  "facade",       // overused for "hiding emotions"
  "precipice",    // overused for "on the edge of"
  "abyss",
  "void",         // emotional
  "chasm",        // emotional
  "maelstrom",
  "tempest",      // emotional
  "crucible",
  "catalyst",
  "harbinger",
  "specter",
  "vestige",
  "remnant",
  "semblance",
  "modicum",
  "iota",
  "sliver",
  "glimmer",
  "flicker",      // emotional: "flicker of hope"
  "ember", "embers", // emotional: "embers of"
  "echo", "echoes",  // emotional: "echoes of"
  "shadow", "shadows", // emotional: "shadow of"
  "ghost",        // metaphorical: "ghost of a smile"
  "weight",       // emotional: "weight of"
  "gravity",      // emotional
  "magnitude",
  "enormity",
  "ramifications",
  "implications",
  "repercussions",
  "reverberations",
  "resonance",
  "dissonance",
  "cacophony",
  "symphony",     // metaphorical: "symphony of"

  // -- Overused verbs in fiction narration --
  "embark", "embarked", "embarking",
  "navigate", "navigated", "navigating",
  "resonate", "resonated", "resonating",
  "permeate", "permeated", "permeating",
  "reverberate", "reverberated", "reverberating",
  "coalesce", "coalesced", "coalescing",
  "unfurl", "unfurled", "unfurling",
  "manifest", "manifested", "manifesting",
  "materialize", "materialized", "materializing",
  "crystallize", "crystallized", "crystallizing",
  "dissipate", "dissipated", "dissipating",
  "engulf", "engulfed", "engulfing",
  "envelop", "enveloped", "enveloping",
  "percolate", "percolated", "percolating",
  "cascade", "cascaded", "cascading",

  // -- Emotion-telling words (showing via these is still telling) --
  "newfound",
  "unbidden",
  "inexplicable", "inexplicably",
  "unfathomable",
  "unmistakable", "unmistakably",
  "undeniable", "undeniably",
  "palpable",
  "visceral",
  "primal",
  "raw",          // as in "raw emotion"
  "electric",     // as in "electric tension"
  "magnetic",     // as in "magnetic pull"
  "charged",      // as in "charged silence"

  // -- Overused "sophisticated" words --
  "myriad",
  "tableau",
  "specter",
  "visage",
  "countenance",
  "ministrations",
  "machinations",
  "permutations",
  "vicissitudes",
  "perturbation",
  "consternation",
  "trepidation",
  "perturbation",
  "acquiescence",
  "nonchalance",
  "insouciance",
  "magnanimity",
  "equanimity",

  // -- Promotional/corporate that leaks into narration --
  "elevate", "elevated",
  "empower", "empowered", "empowering",
  "enhance", "enhanced", "enhancing",
  "revolutionize", "revolutionized",
  "unprecedented",
  "game-changer",
  "trailblazer",
] as const;

// ═══════════════════════════════════════════════════════════════
// TIER 3: OVERUSE DETECTION
// Normal fiction words that LLMs statistically overrepresent.
// Each group has a root word + variants, counted together.
// Flag when combined count exceeds max per scene.
// Sources: EQ-Bench fiction slop list, antislop-sampler word rankings
// ═══════════════════════════════════════════════════════════════

export const TIER3_OVERUSE: readonly Tier3Group[] = [
  // -- Speech/dialogue verbs (heaviest overuse) --
  { root: "whisper",  variants: ["whisper", "whispered", "whispering", "whispers"],  max: 2 },
  { root: "murmur",   variants: ["murmur", "murmured", "murmuring", "murmurs"],     max: 2 },
  { root: "mutter",   variants: ["mutter", "muttered", "muttering", "mutters"],      max: 2 },
  { root: "growl",    variants: ["growl", "growled", "growling", "growls"],           max: 2 },
  { root: "hiss",     variants: ["hiss", "hissed", "hissing"],                       max: 2 },
  { root: "rasp",     variants: ["rasp", "rasped", "rasping"],                       max: 2 },
  { root: "croak",    variants: ["croak", "croaked", "croaking"],                    max: 2 },
  { root: "bark",     variants: ["barked", "barking"],                               max: 2 },
  { root: "snap",     variants: ["snapped", "snapping"],                             max: 2 },
  { root: "drawl",    variants: ["drawl", "drawled", "drawling"],                    max: 2 },
  { root: "purr",     variants: ["purr", "purred", "purring"],                       max: 2 },
  { root: "snarl",    variants: ["snarl", "snarled", "snarling"],                    max: 2 },
  { root: "sneer",    variants: ["sneer", "sneered", "sneering"],                    max: 2 },
  { root: "boom",     variants: ["boom", "boomed", "booming"],                       max: 2 },
  { root: "intone",   variants: ["intone", "intoned", "intoning"],                   max: 1 },
  { root: "exclaim",  variants: ["exclaim", "exclaimed", "exclaiming"],              max: 1 },
  { root: "stammer",  variants: ["stammer", "stammered", "stammering"],              max: 2 },
  { root: "stutter",  variants: ["stutter", "stuttered", "stuttering"],              max: 2 },
  { root: "chime",    variants: ["chime", "chimed", "chiming"],                      max: 1 },
  { root: "interject", variants: ["interject", "interjected", "interjecting"],       max: 1 },

  // -- Body language (extremely overused by LLMs) --
  { root: "nod",      variants: ["nod", "nodded", "nodding", "nods"],                max: 2 },
  { root: "sigh",     variants: ["sigh", "sighed", "sighing", "sighs"],              max: 2 },
  { root: "shrug",    variants: ["shrug", "shrugged", "shrugging", "shrugs"],        max: 2 },
  { root: "frown",    variants: ["frown", "frowned", "frowning", "frowns"],          max: 2 },
  { root: "wince",    variants: ["wince", "winced", "wincing"],                      max: 2 },
  { root: "flinch",   variants: ["flinch", "flinched", "flinching"],                 max: 2 },
  { root: "tense",    variants: ["tensed", "tensing"],                               max: 2 },
  { root: "stiffen",  variants: ["stiffen", "stiffened", "stiffening"],              max: 2 },
  { root: "bristle",  variants: ["bristle", "bristled", "bristling"],                max: 2 },
  { root: "fidget",   variants: ["fidget", "fidgeted", "fidgeting"],                 max: 2 },
  { root: "shift",    variants: ["shifted", "shifting"],                             max: 3 },
  { root: "clench",   variants: ["clench", "clenched", "clenching"],                 max: 2 },
  { root: "grit",     variants: ["grit", "gritted", "gritting"],                     max: 2 },
  { root: "swallow",  variants: ["swallow", "swallowed", "swallowing"],              max: 2 },
  { root: "shudder",  variants: ["shudder", "shuddered", "shuddering"],              max: 2 },
  { root: "tremble",  variants: ["tremble", "trembled", "trembling"],                max: 2 },
  { root: "shiver",   variants: ["shiver", "shivered", "shivering", "shivers"],      max: 2 },
  { root: "quiver",   variants: ["quiver", "quivered", "quivering"],                 max: 1 },
  { root: "twitch",   variants: ["twitch", "twitched", "twitching"],                 max: 2 },
  { root: "jolt",     variants: ["jolt", "jolted", "jolting"],                       max: 2 },
  { root: "furrowed", variants: ["furrow", "furrowed", "furrowing"],                 max: 1 },
  { root: "arch (brow)", variants: ["arched", "arching"],                            max: 2 },
  { root: "purse (lips)", variants: ["pursed", "pursing"],                           max: 1 },
  { root: "clamp",    variants: ["clamp", "clamped", "clamping"],                    max: 2 },
  { root: "hunch",    variants: ["hunch", "hunched", "hunching"],                    max: 2 },
  { root: "slump",    variants: ["slump", "slumped", "slumping"],                    max: 2 },
  { root: "straighten", variants: ["straighten", "straightened", "straightening"],   max: 2 },
  { root: "stiffen",  variants: ["stiffen", "stiffened", "stiffening"],              max: 2 },

  // -- Eye/gaze verbs (top overrepresented in LLM fiction) --
  { root: "gaze",     variants: ["gaze", "gazed", "gazing", "gazes"],                max: 2 },
  { root: "stare",    variants: ["stare", "stared", "staring", "stares"],            max: 2 },
  { root: "glance",   variants: ["glance", "glanced", "glancing", "glances"],        max: 3 },
  { root: "peer",     variants: ["peer", "peered", "peering", "peers"],              max: 2 },
  { root: "squint",   variants: ["squint", "squinted", "squinting"],                 max: 2 },
  { root: "narrow",   variants: ["narrowed", "narrowing"],                           max: 2 },
  { root: "widen",    variants: ["widened", "widening"],                              max: 2 },
  { root: "blink",    variants: ["blink", "blinked", "blinking", "blinks"],          max: 2 },
  { root: "scan",     variants: ["scanned", "scanning"],                             max: 2 },
  { root: "dart (eyes)", variants: ["darted", "darting"],                            max: 2 },
  { root: "flick (eyes)", variants: ["flicked", "flicking"],                         max: 2 },
  { root: "lock (eyes)", variants: ["locked", "locking"],                            max: 2 },

  // -- Movement verbs (overrepresented in action scenes) --
  { root: "lunge",    variants: ["lunge", "lunged", "lunging"],                      max: 2 },
  { root: "stride",   variants: ["stride", "strode", "striding"],                    max: 2 },
  { root: "creep",    variants: ["crept", "creeping"],                               max: 2 },
  { root: "stumble",  variants: ["stumble", "stumbled", "stumbling"],                max: 2 },
  { root: "recoil",   variants: ["recoil", "recoiled", "recoiling"],                 max: 2 },
  { root: "lurch",    variants: ["lurch", "lurched", "lurching"],                    max: 2 },
  { root: "surge",    variants: ["surge", "surged", "surging"],                      max: 2 },
  { root: "bolt",     variants: ["bolt", "bolted", "bolting"],                       max: 2 },
  { root: "sprint",   variants: ["sprint", "sprinted", "sprinting"],                 max: 2 },
  { root: "dart",     variants: ["dart", "darted", "darting"],                       max: 2 },
  { root: "skitter",  variants: ["skitter", "skittered", "skittering"],              max: 1 },
  { root: "scurry",   variants: ["scurry", "scurried", "scurrying"],                 max: 1 },
  { root: "sidle",    variants: ["sidle", "sidled", "sidling"],                      max: 1 },
  { root: "slither",  variants: ["slither", "slithered", "slithering"],              max: 1 },
  { root: "prowl",    variants: ["prowl", "prowled", "prowling"],                    max: 2 },
  { root: "hover",    variants: ["hover", "hovered", "hovering"],                    max: 2 },
  { root: "loom",     variants: ["loom", "loomed", "looming"],                       max: 2 },
  { root: "crouch",   variants: ["crouch", "crouched", "crouching"],                 max: 2 },
  { root: "huddle",   variants: ["huddle", "huddled", "huddling"],                   max: 2 },

  // -- Emotional reaction verbs --
  { root: "gasp",     variants: ["gasp", "gasped", "gasping"],                       max: 2 },
  { root: "pale",     variants: ["paled", "paling"],                                 max: 1 },
  { root: "freeze",   variants: ["froze", "frozen", "freezing"],                     max: 2 },
  { root: "recoil",   variants: ["recoil", "recoiled", "recoiling"],                 max: 1 },
  { root: "falter",   variants: ["falter", "faltered", "faltering"],                 max: 2 },
  { root: "waver",    variants: ["waver", "wavered", "wavering"],                    max: 2 },
  { root: "steel (oneself)", variants: ["steeled", "steeling"],                      max: 1 },
  { root: "brace",    variants: ["brace", "braced", "bracing"],                      max: 2 },

  // -- Atmospheric/sensory (LLMs lean on these heavily) --
  { root: "linger",   variants: ["linger", "lingered", "lingering"],                 max: 2 },
  { root: "echo",     variants: ["echo", "echoed", "echoing"],                       max: 2 },
  { root: "hum",      variants: ["hum", "hummed", "humming"],                        max: 2 },
  { root: "pulse",    variants: ["pulse", "pulsed", "pulsing", "pulsated", "pulsating"], max: 2 },
  { root: "thrum",    variants: ["thrum", "thrummed", "thrumming"],                  max: 1 },
  { root: "crackle",  variants: ["crackle", "crackled", "crackling"],                max: 2 },
  { root: "rustle",   variants: ["rustle", "rustled", "rustling"],                   max: 2 },
  { root: "shimmer",  variants: ["shimmer", "shimmered", "shimmering"],              max: 1 },
  { root: "gleam",    variants: ["gleam", "gleamed", "gleaming"],                    max: 2 },
  { root: "glint",    variants: ["glint", "glinted", "glinting"],                    max: 2 },
  { root: "glisten",  variants: ["glisten", "glistened", "glistening"],              max: 1 },
  { root: "glimmer",  variants: ["glimmer", "glimmered", "glimmering"],              max: 1 },
  { root: "flicker",  variants: ["flicker", "flickered", "flickering"],              max: 2 },
  { root: "ripple",   variants: ["ripple", "rippled", "rippling"],                   max: 2 },
  { root: "billow",   variants: ["billow", "billowed", "billowing"],                 max: 1 },
  { root: "waft",     variants: ["waft", "wafted", "wafting"],                       max: 1 },
  { root: "seep",     variants: ["seep", "seeped", "seeping"],                       max: 2 },
  { root: "creep (of feeling)", variants: ["crept", "creeping"],                     max: 2 },
  { root: "settle (silence)", variants: ["settled", "settling"],                     max: 2 },
  { root: "hang (in air)", variants: ["hung"],                                       max: 2 },
  { root: "drape",    variants: ["draped", "draping"],                               max: 2 },
  { root: "shroud",   variants: ["shroud", "shrouded", "shrouding"],                 max: 1 },
  { root: "bathe",    variants: ["bathed", "bathing"],                               max: 1 },
  { root: "pool (of light/shadow)", variants: ["pooled", "pooling"],                 max: 1 },
  { root: "stretch (of silence)", variants: ["stretched", "stretching"],             max: 2 },
  { root: "creak",    variants: ["creak", "creaked", "creaking"],                    max: 2 },
  { root: "groan (objects)", variants: ["groaned", "groaning"],                      max: 2 },

  // -- Emotional descriptors (LLMs use these as shortcuts) --
  { root: "dread",    variants: ["dread", "dreaded", "dreading"],                    max: 2 },
  { root: "revulsion", variants: ["revulsion"],                                      max: 1 },
  { root: "trepidation", variants: ["trepidation"],                                  max: 1 },
  { root: "exhilaration", variants: ["exhilaration"],                                max: 1 },
  { root: "disbelief", variants: ["disbelief"],                                      max: 2 },
  { root: "bewilderment", variants: ["bewilderment", "bewildered"],                  max: 1 },
  { root: "defiance", variants: ["defiance", "defiant", "defiantly"],                max: 2 },
  { root: "resignation", variants: ["resignation", "resigned"],                      max: 2 },
  { root: "resolve",  variants: ["resolve", "resolved"],                             max: 2 },
  { root: "determination", variants: ["determination", "determined"],                max: 2 },
  { root: "wariness", variants: ["wariness", "wary", "warily"],                      max: 2 },
  { root: "unease",   variants: ["unease", "uneasy", "uneasily"],                    max: 2 },
  { root: "contempt", variants: ["contempt", "contemptuous", "contemptuously"],      max: 2 },
] as const;

// ═══════════════════════════════════════════════════════════════
// TIER 4: MULTI-WORD PHRASES
// Verbatim matches — any occurrence is flagged.
// Sources: antislop-sampler slop_phrases, NousResearch T3,
// adenaufal, existing SHARED_BANNED_PHRASES, polish prompts
// ═══════════════════════════════════════════════════════════════

export const TIER4_PHRASES: readonly string[] = [
  // -- Narration clichés (top antislop-sampler phrases by count) --
  "took a deep breath",
  "taking a deep breath",
  "let out a breath",
  "released a breath",
  "breath he didn't know he'd been holding",
  "breath she didn't know she'd been holding",
  "voice barely above a whisper",
  "voice barely a whisper",
  "voice barely audible",
  "couldn't help but feel",
  "couldn't help but notice",
  "couldn't help but wonder",
  "couldn't shake the feeling",
  "couldn't help but smile",
  "heart pounding in her chest",
  "heart pounding in his chest",
  "heart hammered in his chest",
  "heart hammered in her chest",
  "heart hammered against his ribs",
  "heart hammered against her ribs",
  "heart skipped a beat",
  "blood ran cold",
  "felt a chill run down",
  "chill ran down his spine",
  "chill ran down her spine",
  "sent a shiver down",
  "sent shivers down",
  "shiver ran down his spine",
  "shiver ran down her spine",
  "casting long shadows",
  "long shadows across",
  "sun dipped below the horizon",
  "sun began to set",
  "sun hung low",
  "painting the sky",
  "painting sky hues",
  "horizon casting",
  "casting warm glow",
  "casting eerie glow",
  "bathed in moonlight",
  "bathed in light",
  "dappled light",
  "dust motes danced",
  "motes of dust",
  "a smile playing on",
  "smile playing on his lips",
  "smile playing on her lips",
  "small smile tugging",
  "smile tugging at the corner",
  "smile spread across",
  "grin spread across",
  "grin spreading across",
  "spread across her face",
  "spread across his face",
  "spreading across her face",
  "spreading across his face",
  "a flicker of",
  "flicker of something",
  "flicker of recognition",
  "flicker of emotion",
  "glimmer of hope",
  "spark of defiance",
  "hint of a smile",
  "ghost of a smile",
  "shadow of a smile",
  "eyes widened in surprise",
  "eyes widened in shock",
  "eyes widened with",
  "eyes wide with fear",
  "eyes wide with wonder",
  "eyes filled with",
  "eyes glistened with",
  "eyes locked onto",
  "eyes never leaving",
  "eyes darting around",
  "eyes scanning the room",
  "gaze sweeping across",
  "met his gaze",
  "met her gaze",
  "held his gaze",
  "held her gaze",
  "searched his eyes",
  "searched her eyes",
  "door creaked open",
  "door swung open",
  "figure emerged from",
  "stepped out of the shadows",
  "emerged from the shadows",
  "leaned back in his chair",
  "leaned back in her chair",
  "leaned forward in his chair",
  "ran a hand through his hair",
  "ran a hand through her hair",
  "ran his fingers through",
  "ran her fingers through",
  "fingers flying across",
  "mind racing",
  "mind raced",
  "thoughts racing",
  "thoughts raced",
  "words hung in the air",
  "hung in the air",
  "hung heavy in the air",
  "air thick with",
  "air hung heavy",
  "air thick with tension",
  "tension in the air",
  "silence stretched between",
  "silence hung between",
  "silence fell between",
  "silence that followed",
  "room fell silent",
  "a beat of silence",
  "took a step back",
  "took a step forward",
  "took a step closer",
  "closed the distance",
  "weight of his words",
  "weight of her words",
  "weight of the",
  "gravity of the situation",
  "gravity of what",
  "implications of what",
  "the enormity of",
  "the magnitude of",
  "a wave of",
  "wave of nausea",
  "wave of relief",
  "wave of emotion",
  "surge of adrenaline",
  "surge of anger",
  "surge of emotion",
  "knot in his stomach",
  "knot in her stomach",
  "pit of his stomach",
  "pit of her stomach",
  "lump in his throat",
  "lump in her throat",
  "bile rising in",
  "tears streaming down",
  "tears pricked",
  "tears threatening",
  "tears stung",
  "tears welled",
  "jaw clenched",
  "jaw tightened",
  "jaw set",
  "fists clenched",
  "hands clenched into fists",
  "knuckles turning white",
  "brow furrowed",
  "brow creased",
  "brow furrowed in concentration",
  "brow furrowed in confusion",
  "brow furrowed in concern",
  "let out a long breath",
  "let out a shaky breath",
  "let out a slow breath",
  "exhaled slowly",
  "drew a sharp breath",
  "sharp intake of breath",
  "something shifted",
  "something changed",
  "something broke",
  "something snapped",
  "something in him",
  "something in her",
  "something in his eyes",
  "something in her eyes",
  "something akin to",
  "tried to make sense",
  "trying to make sense",
  "tried to process",
  "unlike anything he had ever",
  "unlike anything she had ever",
  "unlike anything ever seen",
  "never seen anything like",
  "for what felt like",
  "felt like an eternity",
  "felt like hours",
  "time seemed to",
  "time stood still",
  "the world seemed to",
  "everything seemed to",
  "for the first time in",
  "for the first time since",
  "for as long as he could remember",
  "for as long as she could remember",
  "renewed sense of purpose",
  "newfound sense of",
  "sense of peace",
  "sense of dread",
  "growing sense of",
  "strange sense of",
  "sense of unease",
  "one thing was certain",
  "one thing was clear",
  "knew one thing",
  "would never be the same",
  "would never forget",
  "changed everything",
  "nothing would ever be",
  "there was no going back",
  "no turning back",
  "the point of no return",
  "steeled himself",
  "steeled herself",
  "squared his shoulders",
  "squared her shoulders",
  "set his jaw",
  "set her jaw",

  // -- Existing SHARED_BANNED_PHRASES (premise/marketing slop) --
  "in a world where",
  "nothing is what it seems",
  "web of lies",
  "tension escalates",
  "dark secrets",
  "dangerous game",
  "everything changes",
  "must navigate",
  "finds themselves",
  "finds himself",
  "finds herself",
  "uncover the truth",
  "race against time",
  "underground scene",
  "power dynamics",

  // -- From polish prompts (mechanical pass) --
  "here's the thing",
  "the truth is",
  "can we talk about",
  "let that sink in",
  "at its core",
  "in many ways",
  "it's worth noting",
  "it bears mentioning",
  "the thing about",
  "that was the thing about",
  "full stop",
  "the stakes were high",
  "the implications were clear",
  "the weight of it",
  "he realized that",
  "she realized that",
  "he understood now",
  "she understood now",
  "that was when he knew",
  "that was when she knew",
  "in that moment",
  "in that instant",

  // -- NousResearch Tier 3 filler phrases --
  "it's important to note",
  "it's worth mentioning",
  "let's dive into",
  "let's explore",
  "as we can see",
  "as mentioned earlier",
  "in conclusion",
  "to summarize",
  "when it comes to",
  "in the realm of",
  "one might argue",
  "it could be suggested",
  "this begs the question",
  "at the end of the day",
  "it goes without saying",
  "without further ado",

  // -- Metaphorical cliché phrases --
  "tapestry of",
  "kaleidoscope of",
  "symphony of",
  "mosaic of",
  "canvas of",
  "fabric of",
  "web of",
  "dance of",      // "a dance of light and shadow"
  "sea of",        // "a sea of faces"
  "ocean of",
  "river of",      // "a river of tears"
  "flood of",      // "a flood of emotions"
  "storm of",
  "fire in his eyes",
  "fire in her eyes",
  "ice in his veins",
  "ice in her veins",
  "electricity between",
  "spark between",
  "wall between them",
  "wall he'd built",
  "wall she'd built",
  "mask he wore",
  "mask she wore",
  "armor he'd built",
  "armor she'd built",

  // -- Realization/epiphany clichés --
  "it dawned on",
  "it hit him",
  "it hit her",
  "it struck him",
  "it struck her",
  "it occurred to him",
  "it occurred to her",
  "the realization hit",
  "realization dawned",
  "suddenly understood",
  "suddenly realized",
  "everything clicked",
  "everything fell into place",
  "the pieces fell into place",
  "pieces of the puzzle",

  // -- Hedge phrases --
  "seemed to",
  "appeared to",
  "almost as if",
  "sort of",
  "kind of",
  "might have been",
  "could have been",
  "he didn't know why",
  "she didn't know why",
  "he couldn't explain",
  "she couldn't explain",
  "for some reason",
  "for reasons he couldn't",
  "for reasons she couldn't",
  "something about the way",

  // -- Fake-depth phrases --
  "more than just",
  "not just any",
  "it wasn't just",
  "it was more than",
  "it was something else entirely",
  "something else entirely",
  "something deeper",
  "something more",
  "there was something about",
  "there was something in",

  // -- Dialogue cliché tags --
  "voice barely above",
  "voice thick with",
  "voice laced with",
  "voice dripping with",
  "voice tinged with",
  "voice filled with",
  "voice trembling with",
  "voice heavy with",
  "voice low and",
  "voice soft but",
  "voice firm but",
  "voice steady despite",
  "voice that brooked no",
  "said finally",
  "said quietly",
  "said softly",
  "said carefully",

  // -- Scene-ending clichés --
  "and with that",
  "and just like that",
  "with that, he turned",
  "with that, she turned",
  "turned and walked away",
  "turned on his heel",
  "turned on her heel",
  "disappeared into the crowd",
  "disappeared into the night",
  "faded into the darkness",
  "swallowed by the darkness",
  "left alone with his thoughts",
  "left alone with her thoughts",
  "the door closed behind",
  "the door clicked shut",

  // -- ContentBeta / DeviantArt phrases --
  "in today's world",
  "in today's fast-paced world",
  "in a world",
  "embrace the",
  "unleash the",
  "unlock the",
  "supercharge your",
  "turbocharge your",
  "the secret sauce",
  "secret weapon",
  "perfect storm",
  "tip of the iceberg",
] as const;

// ═══════════════════════════════════════════════════════════════
// TIER 5: REGEX PATTERNS
// Structural tells detected by pattern matching.
// Sources: antislop-sampler, NousResearch structural slop,
// adenaufal structural patterns
// ═══════════════════════════════════════════════════════════════

export const TIER5_PATTERNS: readonly Tier5Pattern[] = [
  {
    name: "not-x-but-y",
    pattern: /\bnot\b[^.!?]{3,60}\bbut\b/gi,
    description: "The #1 LLM rhetorical crutch: 'not X, but Y' construction",
    maxPerScene: 1,
  },
  {
    name: "its-not-just",
    pattern: /\bit(?:'s|s)\s+not\s+just\b/gi,
    description: "'It's not just X, it's Y' — balanced binary construction",
    maxPerScene: 0,
  },
  {
    name: "em-dash-overuse",
    pattern: /[—–]/g,
    description: "Em/en dash usage — LLMs overuse these ~30% more than human writers",
    maxPerScene: 4,
  },
  {
    name: "hedge-chain",
    pattern: /\b(?:seemed?\s+to|appeared?\s+to|almost\s+as\s+if|might\s+have|could\s+have)\b/gi,
    description: "Hedge phrases that soften statements instead of committing",
    maxPerScene: 3,
  },
  {
    name: "realization-announcement",
    pattern: /\b(?:he|she|they|i)\s+(?:realized|understood|knew\s+(?:then|now|in\s+that)|finally\s+(?:understood|saw|grasped))\b/gi,
    description: "Telling the reader a character realized something instead of showing",
    maxPerScene: 1,
  },
  {
    name: "triadic-list",
    pattern: /(?:[A-Z][^.!?]*[,;]\s+[^.!?]*[,;]\s+(?:and|or)\s+[^.!?]*\.)/g,
    description: "Rule of three: 'X, Y, and Z' — LLMs overuse triadic groupings",
    maxPerScene: 3,
  },
  {
    name: "participial-tack-on",
    pattern: /,\s+(?:\w+ing)\s+(?:his|her|their|the)\b/gi,
    description: "Comma + -ing phrase appended to sentence ends (participial tack-on)",
    maxPerScene: 3,
  },
  {
    name: "negative-assertion",
    pattern: /\b(?:he|she|they|i)\s+did(?:n't|\s+not)\s+(?:look\s+back|think\s+about|say\s+what|want\s+to\s+think|let\s+(?:himself|herself))\b/gi,
    description: "Negative assertions: 'He did not look back' — fine once, tic in clusters",
    maxPerScene: 1,
  },
  {
    name: "the-way-simile",
    pattern: /\bthe\s+way\s+(?:a|the|his|her|their)\b/gi,
    description: "'The way X did Y' — simile crutch, LLMs use this 4-8× per scene",
    maxPerScene: 2,
  },
  {
    name: "sentence-length-uniformity",
    // This one is detected algorithmically, not by regex.
    // The pattern is a placeholder — the scanner implements custom logic.
    pattern: /(?:PLACEHOLDER_SENTENCE_UNIFORMITY)/,
    description: "Consecutive sentences of similar length (±20%) — monotonous rhythm",
    maxPerScene: 3, // max runs of 4+ similar-length sentences
  },
  {
    name: "each-every-a",
    pattern: /\b(?:each|every)(?:\s+\w+){1,2}\s+a\b/gi,
    description: "'Each X a Y' / 'Every X a Y' — overrepresented AI pattern",
    maxPerScene: 1,
  },
  {
    name: "staccato-triplet",
    pattern: /(?:No|Not|Never)\s+\w+\.\s+(?:No|Not|Never)\s+\w+\.\s+(?:Just|Only|Simply)\s+/gi,
    description: "'No X. No Y. Just Z.' — staccato triplet pattern",
    maxPerScene: 0,
  },
  {
    name: "sycophantic-opening",
    pattern: /^(?:great\s+question|that's\s+(?:an?\s+)?(?:excellent|great|good|wonderful)\s+(?:point|question|observation)|absolutely!|certainly!)/gim,
    description: "Sycophantic/assistant openings that leak into character dialogue",
    maxPerScene: 0,
  },
  {
    name: "false-depth",
    pattern: /\b(?:it\s+wasn't\s+(?:just|simply)\s+(?:about|that)|there\s+was\s+(?:something\s+)?(?:more|deeper)\s+(?:to|about|here|than))\b/gi,
    description: "False-depth signaling: 'It wasn't just about X' / 'There was something deeper'",
    maxPerScene: 1,
  },

  // ── "TOO LITERARY" PATTERNS (register detection) ──────────

  {
    name: "parallel-construction",
    pattern: /(?:The\s+\w+\.)\s+(?:The\s+\w+\.)\s+(?:The\s+\w+[\.\,])/g,
    description: "Parallel construction poetry: 'The X. The Y. The Z.' — literary device, not VN narration",
    maxPerScene: 1,
  },
  {
    name: "symbolic-narration",
    pattern: /\ba\s+reminder\s+that\b|\bas\s+(?:if|though)\s+the\s+(?:room|world|universe|space|air|silence|darkness|city|building)\s+(?:itself\s+)?(?:knew|understood|remembered|held|wanted|refused|waited|mourned|watched|judged|breathed)/gi,
    description: "Narrator giving objects/spaces symbolic agency: 'as if the room itself knew' — literary, not VN",
    maxPerScene: 1,
  },
  {
    name: "poetic-stage-direction",
    pattern: /\[(?:[^\]]*(?:metaphor|mirror|echo|symbol|reminder|resonat|reflect|embod|represent|parallel|irony|ironic|finality|weight\s+of|gravity\s+of)[^\]]*)\]/gi,
    description: "Stage directions containing interpretive/symbolic language instead of practical visual direction",
    maxPerScene: 0,
  },
  {
    name: "narrator-editorializing",
    pattern: /(?:NARRATION|INTERNAL)[^\n]*(?:a\s+reminder\s+(?:that|of)|as\s+(?:if|though)\s+(?:to\s+say|confirming|acknowledging)|(?:the\s+)?(?:irony|paradox|weight|gravity|enormity)\s+(?:of\s+(?:it|the|that|this))\s+(?:was|wasn't|hung|settled|pressed))/gi,
    description: "Narration lines that interpret or editorialize instead of describing",
    maxPerScene: 1,
  },
  {
    name: "dramatic-fragment-cluster",
    // Detected algorithmically, not by regex
    pattern: /(?:PLACEHOLDER_FRAGMENT_CLUSTER)/,
    description: "Clusters of 3+ consecutive sentence fragments used for dramatic effect — literary, not VN",
    maxPerScene: 2,
  },
  {
    name: "narration-dialogue-ratio",
    // Detected algorithmically, not by regex
    pattern: /(?:PLACEHOLDER_NARRATION_RATIO)/,
    description: "Narration lines significantly outnumber dialogue lines — VN should be dialogue-heavy",
    maxPerScene: 0, // flags if narration > 60% of lines
  },
] as const;

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════

export const SCAN_CONFIG = {
  /** Score threshold — scenes above this score fail */
  failThreshold: 40,

  /** How much each tier contributes to the composite score */
  weights: {
    tier1: 10,   // per occurrence
    tier2: 2,    // per unique word (only counted when cluster threshold hit)
    tier3: 3,    // per word group exceeding its max
    tier4: 5,    // per phrase occurrence
    tier5: 8,    // per pattern exceeding its max
  },

  /** Tier 2 cluster threshold — flag when this many unique Tier 2 words appear */
  tier2ClusterThreshold: 3,
} as const;

// ═══════════════════════════════════════════════════════════════
// WRITER PROMPT HELPERS
// ═══════════════════════════════════════════════════════════════

/** Top Tier 1 words for injection into writer prompts (kept short to avoid attention dilution) */
export function getWriterBanList(): string {
  const topBans = [
    "delve", "utilize", "tapestry", "kaleidoscope", "myriad", "plethora",
    "furthermore", "moreover", "nonetheless", "paradigm", "synergy",
    "multifaceted", "nuanced", "pivotal", "paramount", "quintessential",
    "holistic", "leverage", "foster", "underscore", "facilitate",
    "gossamer", "tenebrous", "ineffable", "labyrinthine", "resplendent",
    "meticulous", "testament", "beacon", "cornerstone", "odyssey",
  ];
  return topBans.join(", ");
}

/** Top phrases for injection into writer prompts */
export function getWriterBannedPhrases(): string {
  const topPhrases = [
    "took a deep breath",
    "couldn't help but",
    "voice barely a whisper",
    "heart pounding in chest",
    "a testament to",
    "it's worth noting",
    "in that moment",
    "something shifted",
    "he realized that",
    "she realized that",
    "eyes widened in",
    "casting long shadows",
    "felt like an eternity",
    "for some reason",
    "not X, but Y",
  ];
  return topPhrases.map(p => `"${p}"`).join(", ");
}

/** Positive writing instruction to pair with the ban list */
export const POSITIVE_WRITING_INSTRUCTION = `ANTI-SLOP — WRITE LIKE A HUMAN:
- Name the actual object, not a metaphor for it. "The cracked linoleum" not "a tapestry of decay."
- One physical detail is worth three adjectives. Pick the telling detail.
- If the action shows the emotion, the narration doesn't need to name it.
- Characters speak imperfectly — false starts, interruptions, trailing off, wrong words.
- Commit to statements. No "seemed to" / "appeared to" / "almost as if" hedging.
- Vary sentence lengths. A short sentence after three long ones has punch.
- Not every moment needs to be weighty. Let small beats be small.`;
