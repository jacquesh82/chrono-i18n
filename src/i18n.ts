/**
 * Unified, language-agnostic entry point ("i18n").
 *
 * chrono ships a fully-tuned pipeline *per language* (`chrono.fr`, `chrono.de`, …),
 * but the caller must know the language up front. This module runs several locales
 * at once and merges their results, so a single call handles mixed- or
 * unknown-language input:
 *
 * ```ts
 * import * as chrono from "chrono-node";
 *
 * chrono.i18n.parse("réunion mardi prochain à 14h"); // → fr wins
 * chrono.i18n.parse("Treffen am Dienstag");          // → de wins
 * chrono.i18n.parse("riunione martedì");             // → it wins
 *
 * // Restrict the candidate set (also sets tie-break priority):
 * chrono.i18n.parse(text, ref, { locales: ["fr", "en", "de"] });
 *
 * // Each result carries the locale that produced it:
 * chrono.i18n.parse("demain")[0].locale; // "fr"
 * ```
 *
 * Each locale's own parsers/refiners run unchanged; this layer only arbitrates
 * between the per-locale outputs, keeping the richest, longest, non-overlapping
 * matches.
 *
 * @module
 */

import { Chrono } from "./chrono";
import { Component, ParsedResult, ParsingOption, ParsingReference } from "./types";

import * as en from "./locales/en";
import * as fr from "./locales/fr";
import * as de from "./locales/de";
import * as es from "./locales/es";
import * as it from "./locales/it";
import * as pt from "./locales/pt";
import * as nl from "./locales/nl";
import * as sv from "./locales/sv";
import * as fi from "./locales/fi";
import * as uk from "./locales/uk";
import * as ru from "./locales/ru";
import * as vi from "./locales/vi";
import * as ja from "./locales/ja";
import * as zh from "./locales/zh";

/** The locales the i18n parser knows about. */
export type LocaleCode =
    | "en"
    | "fr"
    | "de"
    | "es"
    | "it"
    | "pt"
    | "nl"
    | "sv"
    | "fi"
    | "uk"
    | "ru"
    | "vi"
    | "ja"
    | "zh";

interface LocaleEntry {
    casual: Chrono;
    strict: Chrono;
}

const LOCALES: Record<LocaleCode, LocaleEntry> = {
    en: { casual: en.casual, strict: en.strict },
    fr: { casual: fr.casual, strict: fr.strict },
    de: { casual: de.casual, strict: de.strict },
    es: { casual: es.casual, strict: es.strict },
    it: { casual: it.casual, strict: it.strict },
    pt: { casual: pt.casual, strict: pt.strict },
    nl: { casual: nl.casual, strict: nl.strict },
    sv: { casual: sv.casual, strict: sv.strict },
    fi: { casual: fi.casual, strict: fi.strict },
    uk: { casual: uk.casual, strict: uk.strict },
    ru: { casual: ru.casual, strict: ru.strict },
    vi: { casual: vi.casual, strict: vi.strict },
    ja: { casual: ja.casual, strict: ja.strict },
    zh: { casual: zh.casual, strict: zh.strict },
};

/**
 * Default candidate set *and* tie-break priority (earlier wins ties). Latin-script
 * European languages lead since they share the most ambiguous spellings; CJK trail
 * because their distinctive scripts rarely tie with the others anyway.
 */
const DEFAULT_ORDER: LocaleCode[] = [
    "en",
    "fr",
    "de",
    "es",
    "it",
    "pt",
    "nl",
    "sv",
    "fi",
    "uk",
    "ru",
    "vi",
    "ja",
    "zh",
];

/** Every locale the i18n parser supports, in default priority order. */
export const supportedLocales: ReadonlyArray<LocaleCode> = DEFAULT_ORDER;

export interface I18nParsingOption extends ParsingOption {
    /**
     * Restrict parsing to these locales. The order also sets the tie-break
     * priority when two languages produce equally-strong, overlapping matches
     * (e.g. "01/02/2024" as middle- vs little-endian). Default: all locales.
     */
    locales?: LocaleCode[];
}

/** A {@link ParsedResult} annotated with the locale that produced it. */
export interface I18nParsedResult extends ParsedResult {
    readonly locale: LocaleCode;
}

const SCORE_COMPONENTS: Component[] = [
    "year",
    "month",
    "day",
    "weekday",
    "hour",
    "minute",
    "second",
    "meridiem",
    "timezoneOffset",
];

/** Number of *certain* (directly-mentioned) components — a proxy for match strength. */
function richness(result: ParsedResult): number {
    let n = 0;
    for (const component of SCORE_COMPONENTS) {
        if (result.start.isCertain(component)) n++;
        if (result.end && result.end.isCertain(component)) n++;
    }
    return n;
}

/**
 * A single per-match strength metric, shared by {@link ChronoI18n.parse} (to
 * arbitrate overlaps) and {@link ChronoI18n.detect} (to rank locales), so the
 * two never disagree about which match is stronger. Richness dominates; the
 * matched span length only breaks ties between equally-rich matches.
 *
 * `richness` maxes out at `2 × SCORE_COMPONENTS.length` (18), so any realistic
 * span length (< `LENGTH_WEIGHT`) stays strictly below one richness step —
 * making this exactly the old "richness, then length" lexicographic order.
 */
const LENGTH_WEIGHT = 10_000;
function strength(result: ParsedResult): number {
    return richness(result) * LENGTH_WEIGHT + Math.min(result.text.length, LENGTH_WEIGHT - 1);
}

function overlaps(a: ParsedResult, b: ParsedResult): boolean {
    const aEnd = a.index + a.text.length;
    const bEnd = b.index + b.text.length;
    return a.index < bEnd && b.index < aEnd;
}

function resolveOrder(option: I18nParsingOption): LocaleCode[] {
    const requested = option.locales && option.locales.length ? option.locales : DEFAULT_ORDER;
    return requested.filter((code): code is LocaleCode => code in LOCALES);
}

// Script gates — a locale whose script is entirely absent from the input cannot
// produce a match, so we skip its (expensive) pipeline. Latin-script locales are
// always candidates because they share spellings and numeric date formats.
const HAS_CJK = /[぀-ヿ㐀-䶿一-鿿豈-﫿ｦ-ﾟ]/;
const HAS_CYRILLIC = /[Ѐ-ӿ]/;
const CJK_LOCALES = new Set<LocaleCode>(["ja", "zh"]);
const CYRILLIC_LOCALES = new Set<LocaleCode>(["uk", "ru"]);

/**
 * Narrow the candidate locales to those whose script actually appears in the
 * text. Result-preserving: a dropped locale could not have matched anyway — it
 * only saves the cost of running its pipeline.
 */
function candidateLocales(order: LocaleCode[], text: string): LocaleCode[] {
    const hasCjk = HAS_CJK.test(text);
    const hasCyrillic = HAS_CYRILLIC.test(text);
    return order.filter((code) => {
        if (CJK_LOCALES.has(code)) return hasCjk;
        if (CYRILLIC_LOCALES.has(code)) return hasCyrillic;
        return true;
    });
}

/**
 * Attach `locale` to a parsed result without mutating it. `Object.create` keeps
 * the original on the prototype chain, so every property and method (`start`,
 * `date()`, …) still resolves, while the original object stays untouched and the
 * `readonly locale` contract holds.
 */
function tagResult(result: ParsedResult, locale: LocaleCode): I18nParsedResult {
    const tagged = Object.create(result) as ParsedResult & { locale: LocaleCode };
    tagged.locale = locale;
    return tagged as I18nParsedResult;
}

/**
 * A locale-agnostic Chrono that fans a single input out to every candidate
 * locale and merges the results. Mirrors the per-locale API (`parse`, `parseDate`).
 */
export class ChronoI18n {
    /** @param pick selects which configured Chrono (casual/strict) to use per locale. */
    constructor(private readonly pick: (entry: LocaleEntry) => Chrono) {}

    /**
     * Run every candidate locale's pipeline **once** and tag each result with its
     * source locale. Both `parse` and `detect` build on this, so they share the
     * exact same raw matches (and the cost is paid only once per call).
     */
    private gather(
        text: string,
        ref: ParsingReference | Date | undefined,
        option: I18nParsingOption
    ): I18nParsedResult[] {
        const order = resolveOrder(option);
        const candidates = candidateLocales(order, text);

        const all: I18nParsedResult[] = [];
        for (const code of candidates) {
            let results: ParsedResult[];
            try {
                results = this.pick(LOCALES[code]).parse(text, ref, option);
            } catch {
                // A single locale's pipeline throwing must not sink the whole call.
                continue;
            }
            for (const result of results) {
                all.push(tagResult(result, code));
            }
        }
        return all;
    }

    parse(text: string, ref?: ParsingReference | Date, option: I18nParsingOption = {}): I18nParsedResult[] {
        const priority = new Map<LocaleCode, number>(resolveOrder(option).map((code, i) => [code, i]));
        const all = this.gather(text, ref, option);

        // Arbitrate cross-language overlaps: prefer the strongest match (richness,
        // then span length), then the highest-priority locale. Greedily keep winners.
        all.sort((a, b) => strength(b) - strength(a) || priority.get(a.locale)! - priority.get(b.locale)!);

        const kept: I18nParsedResult[] = [];
        for (const result of all) {
            if (!kept.some((k) => overlaps(k, result))) kept.push(result);
        }

        kept.sort((a, b) => a.index - b.index || priority.get(a.locale)! - priority.get(b.locale)!);
        return kept;
    }

    parseDate(text: string, ref?: ParsingReference | Date, option: I18nParsingOption = {}): Date | null {
        const results = this.parse(text, ref, option);
        return results.length > 0 ? results[0].start.date() : null;
    }

    /**
     * Rank the candidate locales by how much of the text each one confidently
     * covers — a lightweight language hint. Uses the same {@link strength} metric
     * as {@link parse}, summed across a locale's matches, so the two never
     * contradict each other. Locales that match nothing are omitted.
     */
    detect(
        text: string,
        ref?: ParsingReference | Date,
        option: I18nParsingOption = {}
    ): { locale: LocaleCode; score: number }[] {
        const priority = new Map<LocaleCode, number>(resolveOrder(option).map((code, i) => [code, i]));

        const scores = new Map<LocaleCode, number>();
        for (const result of this.gather(text, ref, option)) {
            scores.set(result.locale, (scores.get(result.locale) ?? 0) + strength(result));
        }

        return [...scores.entries()]
            .map(([locale, score]) => ({ locale, score }))
            .sort((a, b) => b.score - a.score || priority.get(a.locale)! - priority.get(b.locale)!);
    }
}

/** i18n Chrono using each locale's *casual* configuration. */
export const casual = new ChronoI18n((entry) => entry.casual);

/** i18n Chrono using each locale's *strict* configuration. */
export const strict = new ChronoI18n((entry) => entry.strict);

/** A shortcut for {@link casual | i18n.casual.parse()}. */
export function parse(text: string, ref?: ParsingReference | Date, option?: I18nParsingOption): I18nParsedResult[] {
    return casual.parse(text, ref, option);
}

/** A shortcut for {@link casual | i18n.casual.parseDate()}. */
export function parseDate(text: string, ref?: ParsingReference | Date, option?: I18nParsingOption): Date | null {
    return casual.parseDate(text, ref, option);
}

/** A shortcut for {@link casual | i18n.casual.detect()}. */
export function detect(
    text: string,
    ref?: ParsingReference | Date,
    option?: I18nParsingOption
): { locale: LocaleCode; score: number }[] {
    return casual.detect(text, ref, option);
}
