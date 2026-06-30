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
});
