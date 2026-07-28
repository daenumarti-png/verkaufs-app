import { describe, it, expect } from "vitest";
import { repairTruncatedJson } from "./json-repair.js";

describe("repairTruncatedJson", () => {
  it("lässt bereits valides JSON unverändert korrekt parsbar", () => {
    const input = '{"a":1,"b":[1,2,3]}';
    expect(JSON.parse(repairTruncatedJson(input))).toEqual({ a: 1, b: [1, 2, 3] });
  });

  it("schliesst ein abgeschnittenes Objekt", () => {
    const input = '{"items":[{"name":"Foo","price":10';
    const repaired = repairTruncatedJson(input);
    expect(JSON.parse(repaired)).toEqual({ items: [{ name: "Foo", price: 10 }] });
  });

  it("schliesst einen offenen String am Ende", () => {
    const input = '{"name":"abgeschnittener Tex';
    const repaired = repairTruncatedJson(input);
    expect(JSON.parse(repaired)).toEqual({ name: "abgeschnittener Tex" });
  });

  it("ignoriert Klammern innerhalb von Strings", () => {
    const input = '{"note":"Enthält { und [ als Text", "value":42}';
    expect(JSON.parse(repairTruncatedJson(input))).toEqual({
      note: "Enthält { und [ als Text",
      value: 42,
    });
  });

  it("behandelt verschachtelte, mehrfach abgeschnittene Strukturen", () => {
    const input = '{"a":{"b":[1,2,{"c":"tex';
    const repaired = repairTruncatedJson(input);
    expect(JSON.parse(repaired)).toEqual({ a: { b: [1, 2, { c: "tex" }] } });
  });
});
