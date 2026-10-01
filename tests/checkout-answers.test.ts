import { describe, expect, it } from "vitest";
import { orderSubmissionSchema } from "@/lib/validation";
import { MAX_ANSWER_LENGTH, buildSnapshotAnswers, type PublicFormField } from "@/lib/order-answers";


const submission = (answers: unknown) => ({
  idempotencyKey: crypto.randomUUID(),
  batchId: "batch-1",
  items: [{ variantId: "variant-1", quantity: 1 }],
  customerInfo: { fullName: "Juan dela Cruz", instagramHandle: "juandc" },
  answers,
});

const field = (overrides: Partial<PublicFormField> = {}): PublicFormField => ({
  key: "size",
  label: "Size",
  type: "SELECT",
  placeholder: null,
  helpText: null,
  required: true,
  options: ["Small", "Large"],
  ...overrides,
});

describe("orderSubmissionSchema.answers", () => {
  it("defaults to an empty list, so a page cached before this existed still checks out", () => {
    const parsed = orderSubmissionSchema.parse({
      idempotencyKey: crypto.randomUUID(),
      batchId: "batch-1",
      items: [{ variantId: "variant-1", quantity: 1 }],
      customerInfo: { fullName: "Juan dela Cruz", instagramHandle: "juandc" },
    });

    expect(parsed.answers).toEqual([]);
  });

  it("accepts the payload the checkout form builds", () => {
    const parsed = orderSubmissionSchema.parse(
      submission([
        { fieldId: "size", value: "Small" },
        { fieldId: "note", value: "" },
      ])
    );

    expect(parsed.answers).toEqual([
      { fieldId: "size", value: "Small" },
      { fieldId: "note", value: "" },
    ]);
  });

  it("rejects a value longer than the ceiling the answer builder enforces", () => {
    const tooLong = "a".repeat(MAX_ANSWER_LENGTH + 1);
    const result = orderSubmissionSchema.safeParse(
      submission([{ fieldId: "size", value: tooLong }])
    );

    if (result.success) throw new Error("expected the schema to reject an over-long answer");

    expect(result.error.issues[0]?.message).toBe("That answer is too long");
  });

  it("rejects an answer with no question attached", () => {
    for (const value of [{ value: "Small" }, { fieldId: "", value: "Small" }, { fieldId: 42, value: "Small" }]) {
      expect(orderSubmissionSchema.safeParse(submission([value])).success).toBe(false);
    }
  });

  it("caps how many questions one order may answer", () => {
    const many = Array.from({ length: 51 }, () => ({ fieldId: "size", value: "Small" }));
    expect(orderSubmissionSchema.safeParse(submission(many)).success).toBe(false);
  });

  it("turns a parsed payload into the answers the confirmation modal promised", () => {
    const questions = [
      field({ key: "note", label: "Anything we should know?", type: "TEXTAREA", required: false, options: [] }),
      field(),
    ];
    const shown = [
      { label: "Anything we should know?", value: "Gift wrap please" },
      { label: "Size", value: "Large" },
    ];

    const parsed = orderSubmissionSchema.parse(
      submission([
        { fieldId: "note", value: "Gift wrap please" },
        { fieldId: "size", value: "Large" },
      ])
    );

    const stored = buildSnapshotAnswers(
      questions.map((question) => ({ ...question, sensitive: false })),
      parsed.answers
    );

    expect(stored.map((answer) => ({ label: answer.label, value: answer.value }))).toEqual(shown);
  });

  it("drops an optional question the customer left blank, but keeps a required one unsatisfiable", () => {
    const optional = field({ key: "note", required: false, type: "TEXT" });
    const required = field();

    const blankOptional = orderSubmissionSchema.parse(
      submission([{ fieldId: "note", value: "   " }])
    );
    expect(
      buildSnapshotAnswers([{ ...optional, sensitive: false }], blankOptional.answers)
    ).toEqual([]);

    const blankRequired = orderSubmissionSchema.parse(
      submission([{ fieldId: "size", value: "" }])
    );
    expect(() =>
      buildSnapshotAnswers([{ ...required, sensitive: false }], blankRequired.answers)
    ).toThrowError(/"Size" is required\./);
  });
});
