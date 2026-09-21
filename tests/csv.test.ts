import { describe, expect, it } from "vitest";
import { csvCell, escapeCsvFormula, toCsv } from "@/lib/csv";

// A spreadsheet is an interpreter, not a text file. These tests cover the two
// ways a customer-supplied value can break the operator's export: shifting the
// columns, and being executed as a formula.
describe("escapeCsvFormula", () => {
  it("neutralises values a spreadsheet would evaluate", () => {
    // An Instagram handle starts with "@", which Excel reads as a function.
    expect(escapeCsvFormula("@juandc")).toBe("'@juandc");
    expect(escapeCsvFormula("=1+1")).toBe("'=1+1");
    expect(escapeCsvFormula("+63 917")).toBe("'+63 917");
    expect(escapeCsvFormula("-5")).toBe("'-5");
    expect(escapeCsvFormula("\tleading tab")).toBe("'\tleading tab");
  });

  it("leaves ordinary text alone", () => {
    expect(escapeCsvFormula("Juan dela Cruz")).toBe("Juan dela Cruz");
    expect(escapeCsvFormula("PO-20260913-0001")).toBe("PO-20260913-0001");
    expect(escapeCsvFormula("")).toBe("");
  });
});

describe("csvCell", () => {
  it("quotes the fields that would otherwise break the row apart", () => {
    expect(csvCell("Cruz, Juan")).toBe('"Cruz, Juan"');
    expect(csvCell('He said "hi"')).toBe('"He said ""hi"""');
    expect(csvCell("line one\nline two")).toBe('"line one\nline two"');
    expect(csvCell("carriage\rreturn")).toBe('"carriage\rreturn"');
  });

  it("leaves simple values unquoted, so the file stays readable", () => {
    expect(csvCell("Simple")).toBe("Simple");
    expect(csvCell(150)).toBe("150");
    expect(csvCell(0)).toBe("0");
  });

  it("writes null and undefined as empty, never as the word null", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });

  it("applies formula-escaping and quoting together", () => {
    // A free-text answer that is both dangerous and has a comma.
    expect(csvCell("=SUM(A1,B1)")).toBe('"\'=SUM(A1,B1)"');
  });
});

describe("toCsv", () => {
  it("uses CRLF, which is what a spreadsheet expects", () => {
    expect(toCsv([["a", "b"]])).toBe("a,b\r\n");
  });

  it("renders a header plus rows", () => {
    expect(toCsv([["Batch", "Reference"], ["Batch 1", "PO-20260913-0001"]])).toBe(
      "Batch,Reference\r\nBatch 1,PO-20260913-0001\r\n"
    );
  });

  it("keeps a row the same width even when a value needs quoting", () => {
    // The failure this guards against is silent: an unquoted comma shifts every
    // later column left, and the operator reads the wrong address.
    const csv = toCsv([["Name", "Address"], ["Cruz, Juan", "12 Mabini St"]]);
    const lines = csv.trim().split("\r\n");
    expect(lines[1]).toBe('"Cruz, Juan",12 Mabini St');
  });
});
