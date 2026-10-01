import { describe, expect, it } from "vitest";
import {
  buildSnapshotAnswers,
  readSnapshotAnswers,
  snapshotFullName,
  snapshotInstagramHandle,
  type PublicFormField,
} from "@/lib/order-answers";
import { redactCustomerSnapshot, REDACTED_FIELD } from "@/lib/redaction";
import { normaliseFieldOptions } from "@/lib/form-field-admin";

const withSensitivity = (
  field: PublicFormField,
  sensitive = false
): PublicFormField & { sensitive: boolean } => ({ ...field, sensitive });

const PHONE = withSensitivity(
  {
    key: "mobile_number",
    label: "Mobile Number",
    type: "PHONE",
    placeholder: null,
    helpText: null,
    required: true,
    options: [],
  },
  true
);

const SIZE = withSensitivity({
  key: "size",
  label: "Size",
  type: "SELECT",
  placeholder: null,
  helpText: null,
  required: false,
  options: ["Small", "Medium", "Large"],
});

function expectCode(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (error) {
    expect((error as { code?: string }).code).toBe(code);
    return;
  }
  throw new Error(`expected a ${code} error`);
}

describe("buildSnapshotAnswers", () => {
  it("trims the answer and snapshots the label that was on screen", () => {
    const answers = buildSnapshotAnswers([PHONE], [
      { fieldId: "mobile_number", value: "  0917 123 4567  " },
    ]);

    expect(answers).toEqual([
      {
        key: "mobile_number",
        label: "Mobile Number",
        type: "PHONE",
        value: "0917 123 4567",
        sensitive: true,
      },
    ]);
  });

  it("records sensitivity at the time of writing", () => {
    const answers = buildSnapshotAnswers([PHONE], [
      { fieldId: "mobile_number", value: "0917 123 4567" },
    ]);
    expect(answers[0].sensitive).toBe(true);
  });

  it("leaves unanswered optional fields out entirely", () => {
    expect(buildSnapshotAnswers([SIZE], [{ fieldId: "size", value: "   " }])).toEqual([]);
    expect(buildSnapshotAnswers([SIZE], [])).toEqual([]);
  });

  it("demands an answer to a required field", () => {
    expectCode(
      () => buildSnapshotAnswers([PHONE], [{ fieldId: "mobile_number", value: "  " }]),
      "FORM_FIELD_REQUIRED"
    );
    expectCode(() => buildSnapshotAnswers([PHONE], []), "FORM_FIELD_REQUIRED");
  });

  it("refuses a field that is not on the form", () => {
    expectCode(
      () => buildSnapshotAnswers([SIZE], [{ fieldId: "is_admin", value: "yes" }]),
      "INVALID_FORM_FIELD"
    );
  });

  it("refuses the same field twice", () => {
    expectCode(
      () =>
        buildSnapshotAnswers([SIZE], [
          { fieldId: "size", value: "Small" },
          { fieldId: "size", value: "Large" },
        ]),
      "DUPLICATE_FORM_ANSWER"
    );
  });

  it("validates by type, because a bad phone number hides in DM otherwise", () => {
    expectCode(
      () => buildSnapshotAnswers([PHONE], [{ fieldId: "mobile_number", value: "not a number" }]),
      "FORM_ANSWER_INVALID"
    );

    const email = withSensitivity({ ...PHONE, key: "email", label: "Email", type: "EMAIL" });
    expectCode(
      () => buildSnapshotAnswers([email], [{ fieldId: "email", value: "juan@" }]),
      "FORM_ANSWER_INVALID"
    );

    const age = withSensitivity({ ...PHONE, key: "age", label: "Age", type: "NUMBER" });
    expectCode(
      () => buildSnapshotAnswers([age], [{ fieldId: "age", value: "twelve" }]),
      "FORM_ANSWER_INVALID"
    );
  });

  it("accepts a dropdown choice regardless of capitalisation, storing the offered spelling", () => {
    const answers = buildSnapshotAnswers([SIZE], [{ fieldId: "size", value: "medium" }]);
    expect(answers[0].value).toBe("Medium");

    const phone = buildSnapshotAnswers([PHONE], [{ fieldId: "mobile_number", value: "0917 123 4567" }]);
    expect(phone[0].value).toBe("0917 123 4567");

    expectCode(
      () => buildSnapshotAnswers([SIZE], [{ fieldId: "size", value: "Extra Large" }]),
      "FORM_ANSWER_INVALID"
    );
  });

  it("caps an answer at the length the schema allows", () => {
    expectCode(
      () => buildSnapshotAnswers([SIZE], [{ fieldId: "size", value: "a".repeat(2001) }]),
      "FORM_ANSWER_TOO_LONG"
    );
  });
});

describe("readSnapshotAnswers", () => {
  it("reads what buildSnapshotAnswers wrote", () => {
    const written = buildSnapshotAnswers([PHONE, SIZE], [
      { fieldId: "mobile_number", value: "0917 123 4567" },
    ]);
    const read = readSnapshotAnswers({ answers: written });

    expect(read).toHaveLength(1);
    expect(read[0]).toMatchObject({ key: "mobile_number", label: "Mobile Number" });
  });

  it("survives every shape a JSON column can hold", () => {
    for (const value of [null, undefined, {}, [], "answers", 42, { answers: "nope" }]) {
      expect(readSnapshotAnswers(value)).toEqual([]);
    }

    expect(
      readSnapshotAnswers({
        answers: [
          null,
          "string",
          { key: "a" }, 
          { label: "b" }, 
          { key: "ok", label: "Ok", value: "v" },
        ],
      })
    ).toEqual([{ key: "ok", label: "Ok", type: "TEXT", value: "v", sensitive: false }]);
  });
});

describe("snapshot identity readers", () => {
  it("returns the name and handle, or null instead of throwing", () => {
    const snapshot = { fullName: "Juan", instagramHandle: "juandc", answers: [] };
    expect(snapshotFullName(snapshot)).toBe("Juan");
    expect(snapshotInstagramHandle(snapshot)).toBe("juandc");

    for (const value of [null, undefined, {}, { fullName: 42 }, { fullName: "  " }]) {
      expect(snapshotFullName(value)).toBeNull();
      expect(snapshotInstagramHandle(value)).toBeNull();
    }
  });
});

describe("redactCustomerSnapshot", () => {
  const snapshot = {
    fullName: "Juan",
    instagramHandle: "juandc",
    answers: buildSnapshotAnswers([PHONE], [
      { fieldId: "mobile_number", value: "0917 123 4567" },
    ]),
  };

  it("withholds the handle and a sensitive answer, keeping the label", () => {
    const redacted = redactCustomerSnapshot(snapshot, new Set());

    expect(redacted.instagramHandle).toBe(REDACTED_FIELD);
    expect(redacted.fullName).toBe("Juan");

    const answers = readSnapshotAnswers(redacted);
    expect(answers[0].label).toBe("Mobile Number");
    expect(answers[0].value).toBe(REDACTED_FIELD);
  });

  it("also hides a field marked sensitive after the answer was written", () => {
    const written = buildSnapshotAnswers([SIZE], [{ fieldId: "size", value: "Small" }]);

    const redacted = redactCustomerSnapshot(
      { fullName: "Juan", instagramHandle: "juandc", answers: written },
      new Set(["size"])
    );

    expect(readSnapshotAnswers(redacted)[0].value).toBe(REDACTED_FIELD);
  });
});

describe("normaliseFieldOptions", () => {
  it("keeps options only for a dropdown, de-duplicated case-insensitively", () => {
    expect(normaliseFieldOptions("SELECT", ["Small", "small", " Large ", "Large", ""])).toEqual([
      "Small",
      "Large",
    ]);
  });

  it("drops options for every other type, so a stale list cannot linger", () => {
    expect(normaliseFieldOptions("TEXT", ["Small", "Large"])).toEqual([]);
    expect(normaliseFieldOptions("PHONE", ["Small"])).toEqual([]);
  });
});

