/**
 * Per-locale date *vocabulary* for the **Latin-script** locales, used by
 * {@link module:i18n} to skip locales whose words are entirely absent from the
 * input (a date-aware language gate). CJK (`ja`, `zh`) and Cyrillic (`ru`, `uk`)
 * locales are gated by script instead — their scripts are disjoint from Latin —
 * so they need no vocabulary here.
 *
 * The vocabulary is harvested from each locale's own dictionaries (month, weekday,
 * full-month, time-unit names) plus a small hand-curated list of the casual
 * relative words (today/tomorrow/yesterday/…) that live as regex patterns in the
 * casual parsers rather than in a dictionary.
 *
 * Gating is intentionally *conservative*: when in doubt we keep a locale (a stray
 * extra pipeline only costs time; a missing one would drop a real match). Inputs
 * containing digits bypass the word gate entirely — numeric/ISO/time formats are
 * language-neutral and handled by every locale.
 *
 * @module
 */

import * as en from "./locales/en/constants";
import * as fr from "./locales/fr/constants";
import * as de from "./locales/de/constants";
import * as es from "./locales/es/constants";
import * as it from "./locales/it/constants";
import * as pt from "./locales/pt/constants";
import * as nl from "./locales/nl/constants";
import * as sv from "./locales/sv/constants";
import * as fi from "./locales/fi/constants";
import * as vi from "./locales/vi/constants";

/** Tokenize into lowercased letter-runs — the unit the gate matches on. */
export function tokenize(text: string): Set<string> {
    const tokens = text.toLowerCase().match(/[\p{L}\p{M}]+/gu);
    return new Set(tokens ?? []);
}

type Dictionary = { [word: string]: unknown } | undefined;

/** Collect tokenized keys from every provided dictionary into `target`. */
function harvest(target: Set<string>, ...dictionaries: Dictionary[]): void {
    for (const dictionary of dictionaries) {
        if (!dictionary) continue;
        for (const word of Object.keys(dictionary)) {
            for (const token of tokenize(word)) target.add(token);
        }
    }
}

/**
 * Casual relative words per locale (today/tomorrow/yesterday/now and time-of-day
 * markers), taken from each `*CasualDate`/`*CasualTime` parser. These don't live
 * in the dictionaries, so they're listed explicitly. Multi-word entries are
 * tokenized like any other input, so individual words suffice.
 */
const CASUAL_WORDS: Record<string, string[]> = {
    en: [
        "now",
        "today",
        "tonight",
        "tomorrow",
        "overmorrow",
        "tmr",
        "tmrw",
        "yesterday",
        "last",
        "night",
        "morning",
        "afternoon",
        "evening",
        "noon",
        "midnight",
        "midday",
        "weekend",
        "weekday",
        "lastmonth",
        "nextmonth",
        "lastweek",
        "nextweek",
        "lastyear",
        "nextyear",
    ],
    fr: [
        "maintenant",
        "aujourd",
        "hui",
        "demain",
        "hier",
        "cette",
        "nuit",
        "veille",
        "matin",
        "midi",
        "après",
        "aprem",
        "soir",
        "minuit",
    ],
    de: [
        "jetzt",
        "heute",
        "morgen",
        "übermorgen",
        "uebermorgen",
        "gestern",
        "vorgestern",
        "letzte",
        "nacht",
        "vormittag",
        "mittag",
        "mittags",
        "nachmittag",
        "abend",
        "mitternacht",
    ],
    es: ["ahora", "hoy", "mañana", "manana", "ayer", "mediodía", "medianoche", "tarde", "noche"],
    it: [
        "ora",
        "oggi",
        "stasera",
        "questa",
        "sera",
        "domani",
        "dmn",
        "ieri",
        "mattina",
        "mezzogiorno",
        "mezzanotte",
        "pomeriggio",
        "notte",
    ],
    pt: ["agora", "hoje", "amanha", "amanhã", "ontem", "manhã", "tarde", "noite", "meia", "meio", "dia"],
    nl: [
        "nu",
        "vandaag",
        "morgen",
        "morgend",
        "gisteren",
        "ochtend",
        "middag",
        "namiddag",
        "avond",
        "nacht",
        "van",
        "middernacht",
        "vanochtend",
        "vanmiddag",
        "vannamiddag",
        "vanavond",
        "vannacht",
        "gisterenochtend",
        "gisterenmiddag",
        "gisterennamiddag",
        "gisterenavond",
        "gisterennacht",
        "morgenochtend",
        "morgenmiddag",
        "morgennamiddag",
        "morgenavond",
        "morgennacht",
    ],
    sv: [
        "nu",
        "idag",
        "imorgon",
        "övermorgon",
        "igår",
        "förrgår",
        "morgon",
        "förmiddag",
        "eftermiddag",
        "kväll",
        "natt",
    ],
    fi: [
        "nyt",
        "tänään",
        "huomenna",
        "ylihuomenna",
        "eilen",
        "toissapäivänä",
        "viime",
        "yönä",
        "aamulla",
        "aamuna",
        "aamupäivällä",
        "päivällä",
        "iltapäivällä",
        "illalla",
        "yöllä",
        "keskiyöllä",
    ],
    vi: [
        "hôm",
        "nay",
        "qua",
        "kia",
        "ngày",
        "mai",
        "bây",
        "giờ",
        "lúc",
        "này",
        "sáng",
        "trưa",
        "chiều",
        "tối",
        "đêm",
        "bình",
        "minh",
    ],
};

type ConstantsModule = Record<string, unknown>;
const CONSTANTS: Record<string, ConstantsModule> = { en, fr, de, es, it, pt, nl, sv, fi, vi };

/**
 * The Latin-script locales gated by vocabulary. CJK (`ja`, `zh`) and Cyrillic
 * (`ru`, `uk`) locales are gated by script in {@link module:i18n} instead.
 */
export const WORD_GATED_LOCALES: ReadonlySet<string> = new Set(Object.keys(CONSTANTS));

/** locale → set of every keyword token that should make that locale a candidate. */
export const LOCALE_KEYWORDS: Record<string, ReadonlySet<string>> = (() => {
    const result: Record<string, Set<string>> = {};
    for (const [code, c] of Object.entries(CONSTANTS)) {
        const keywords = new Set<string>();
        harvest(
            keywords,
            c.WEEKDAY_DICTIONARY as Dictionary,
            c.MONTH_DICTIONARY as Dictionary,
            c.FULL_MONTH_NAME_DICTIONARY as Dictionary,
            c.TIME_UNIT_DICTIONARY as Dictionary
        );
        // Every word-gated locale has a CASUAL_WORDS entry (asserted by tests).
        for (const word of CASUAL_WORDS[code]) {
            for (const token of tokenize(word)) keywords.add(token);
        }
        result[code] = keywords;
    }
    return result;
})();
