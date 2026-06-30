import * as chrono from "../src";
import { I18nParsedResult, LocaleCode } from "../src/i18n";

// A fixed reference point: Monday 1 January 2024, 12:00 local time.
const REF = new Date(2024, 0, 1, 12, 0, 0);

function parse(text: string, option?: { locales?: LocaleCode[] }): I18nParsedResult[] {
    return chrono.i18n.parse(text, REF, option);
}

describe("i18n unified parser — picks the right language automatically", () => {
    test("French", () => {
        const r = parse("réunion demain à 14h");
        expect(r).toHaveLength(1);
        expect(r[0].locale).toBe("fr");
        expect(r[0].start.get("day")).toBe(2);
        expect(r[0].start.get("hour")).toBe(14);
    });

    test("English", () => {
        const r = parse("meeting tomorrow at 2pm");
        expect(r).toHaveLength(1);
        expect(r[0].locale).toBe("en");
        expect(r[0].start.get("day")).toBe(2);
        expect(r[0].start.get("hour")).toBe(14);
    });

    test("German", () => {
        const r = parse("Treffen übermorgen");
        expect(r).toHaveLength(1);
        expect(r[0].locale).toBe("de");
        expect(r[0].start.get("day")).toBe(3); // Mon Jan 1 → day after tomorrow
    });

    test("Spanish", () => {
        const r = parse("reunión mañana");
        expect(r).toHaveLength(1);
        expect(r[0].locale).toBe("es");
        expect(r[0].start.get("day")).toBe(2);
    });

    test("Italian", () => {
        const r = parse("riunione domani");
        expect(r).toHaveLength(1);
        expect(r[0].locale).toBe("it");
        expect(r[0].start.get("day")).toBe(2);
    });
});

describe("i18n — locale restriction & tie-breaks", () => {
    test("the `locales` option restricts the candidate set", () => {
        const r = parse("rendez-vous lundi prochain", { locales: ["fr"] });
        expect(r).toHaveLength(1);
        expect(r[0].locale).toBe("fr");
    });

    test("ambiguous numeric date resolves per the requested locale order", () => {
        // 01/02/2024 — English reads month-first, French reads day-first.
        const en = parse("01/02/2024", { locales: ["en"] })[0];
        expect(en.start.get("month")).toBe(1);
        expect(en.start.get("day")).toBe(2);

        const fr = parse("01/02/2024", { locales: ["fr"] })[0];
        expect(fr.start.get("month")).toBe(2);
        expect(fr.start.get("day")).toBe(1);
    });

    test("every result is tagged with its source locale", () => {
        const r = parse("meeting tomorrow");
        expect(r[0].locale).toBe("en");
        expect(chrono.i18n.supportedLocales).toContain(r[0].locale);
    });
});

describe("i18n — helpers", () => {
    test("parseDate returns a JS Date for the first match", () => {
        const d = chrono.i18n.parseDate("réunion demain à 14h", REF);
        expect(d).toBeInstanceOf(Date);
        expect(d!.getDate()).toBe(2);
        expect(d!.getHours()).toBe(14);
    });

    test("parseDate returns null when nothing matches", () => {
        expect(chrono.i18n.parseDate("xyzzy plover", REF)).toBeNull();
        expect(parse("xyzzy plover")).toHaveLength(0);
    });

    test("detect ranks the most likely language first", () => {
        const ranked = chrono.i18n.detect("Treffen am Dienstag um 15 Uhr", REF);
        expect(ranked.length).toBeGreaterThan(0);
        expect(ranked[0].locale).toBe("de");
    });

    test("detect omits locales that match nothing", () => {
        expect(chrono.i18n.detect("xyzzy plover", REF)).toHaveLength(0);
    });

    test("detect's top locale agrees with parse's chosen locale", () => {
        // The headline consistency property: detect and parse share one strength
        // metric, so detect's #1 is the locale parse actually picked.
        const text = "meeting tomorrow at 2pm";
        const ranked = chrono.i18n.detect(text, REF);
        const parsed = parse(text);
        expect(ranked[0].locale).toBe(parsed[0].locale);
        expect(ranked[0].locale).toBe("en");
    });
});

describe("i18n — mixed-language input (the headline feature)", () => {
    test("a sentence mixing two languages yields one match per language", () => {
        // "tomorrow" is only English; "mardi prochain" is only French.
        const r = parse("meeting tomorrow and réunion mardi prochain");
        const locales = r.map((x) => x.locale);
        expect(locales).toContain("en");
        expect(locales).toContain("fr");
        // Distinct, non-overlapping spans → both survive arbitration.
        expect(r).toHaveLength(2);
    });

    test("non-overlapping matches stay sorted by their position in the text", () => {
        const r = parse("meeting tomorrow and réunion mardi prochain");
        for (let i = 1; i < r.length; i++) {
            expect(r[i].index).toBeGreaterThanOrEqual(r[i - 1].index);
        }
    });
});

describe("i18n — CJK locales are reachable (script pre-filter must not drop them)", () => {
    test("Japanese input is matched by a CJK locale", () => {
        const r = parse("明日の会議");
        expect(r.length).toBeGreaterThan(0);
        expect(["ja", "zh"]).toContain(r[0].locale);
    });

    test("Chinese input is matched by a CJK locale", () => {
        const r = parse("下周一开会");
        expect(r.length).toBeGreaterThan(0);
        expect(["ja", "zh"]).toContain(r[0].locale);
    });

    test("detect surfaces a CJK locale for CJK text", () => {
        const ranked = chrono.i18n.detect("明日の会議", REF);
        expect(ranked.length).toBeGreaterThan(0);
        expect(["ja", "zh"]).toContain(ranked[0].locale);
    });
});

describe("i18n — script pre-filter preserves Latin/numeric results", () => {
    test("a pure-numeric date still parses (Latin locales never get filtered out)", () => {
        const r = parse("01/02/2024");
        expect(r.length).toBeGreaterThan(0);
        // en leads the default priority order, so it wins the ambiguous numeric tie.
        expect(r[0].locale).toBe("en");
    });

    test("Cyrillic input reaches the Cyrillic locales", () => {
        const ranked = chrono.i18n.detect("встреча завтра", REF);
        expect(ranked.length).toBeGreaterThan(0);
        expect(["ru", "uk"]).toContain(ranked[0].locale);
    });
});

describe("i18n — robustness", () => {
    test("does not mutate the underlying parsed result", () => {
        // The result object the per-locale Chrono produced must not gain a `locale`
        // own-property; the tag lives on a non-mutating wrapper.
        const r = parse("meeting tomorrow");
        expect(r[0].locale).toBe("en");
        expect(Object.prototype.hasOwnProperty.call(r[0], "locale")).toBe(true);
        const proto = Object.getPrototypeOf(r[0]);
        expect(Object.prototype.hasOwnProperty.call(proto, "locale")).toBe(false);
    });

    test("empty and garbage input return [] without throwing", () => {
        expect(() => parse("")).not.toThrow();
        expect(parse("")).toHaveLength(0);
        expect(parse("!!! ??? ...")).toHaveLength(0);
    });

    test("tagged results keep working ParsedResult methods", () => {
        const r = parse("meeting tomorrow at 2pm");
        expect(r[0].date()).toBeInstanceOf(Date);
        expect(r[0].text.length).toBeGreaterThan(0);
    });
});

describe("i18n — language gate keeps each locale's casual vocabulary reachable", () => {
    // These digit-free phrases exercise the keyword gate: only the right locale's
    // pipeline should need to run, and it must still win. Locks the harvested
    // vocabulary so a broken/missing keyword (or a new locale) is caught here.
    const cases: [string, LocaleCode][] = [
        ["let's meet this weekend", "en"],
        ["réunion demain", "fr"],
        ["Termin übermorgen", "de"],
        ["reunión mañana", "es"],
        ["ci vediamo domani", "it"],
        ["até amanhã", "pt"],
        ["tot vanavond", "nl"],
        ["vi ses imorgon", "sv"],
        ["nähdään huomenna", "fi"],
        ["hẹn ngày mai", "vi"],
        ["встретимся послезавтра", "ru"],
        ["побачимось післязавтра", "uk"],
    ];

    test.each(cases)("%s → %s", (text, expected) => {
        const r = parse(text);
        expect(r.length).toBeGreaterThan(0);
        expect(r[0].locale).toBe(expected);
    });
});
