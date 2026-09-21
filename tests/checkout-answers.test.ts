import { describe, expect, it } from "vitest";
import { orderSubmissionSchema } from "@/lib/validation";
import { MAX_ANSWER_LENGTH, buildSnapshotAnswers, type PublicFormField } from "@/lib/order-answers";

/**
 * The seam between the checkout form and `createOrder`.
 *
 * The form builds `answers` from whatever the operator has defined, and
 * `createOrder` judges them against the definitions it loads itself. Those two
 * halves are written in different files and neither can see the other at test
 * time, so this file pins the contract they meet on: the shape the client sends,
 * and what the server is expected to make of it.
 */

/** A base submission with the two fixed questions already answered. */
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

    // Not `undefined`: `createOrder` hands this straight to
    // `buildSnapshotAnswers`, and an undefined array there would skip the
    // required-question check instead of failing it.
    expect(parsed.answers).toEqual([]);
  });

  it("accepts the payload the checkout form builds", () => {
    const parsed = orderSubmissionSchema.parse(
      submission([
        { fieldId: "size", value: "Small" },
        // The form sends every question, answered or not.
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

    // The same ceiling as `MAX_ANSWER_LENGTH`, so an oversized body is refused
    // with a 400 here rather than by a database constraint later.
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
    // What the customer saw before pressing "Confirm": the questions they filled
    // in, in the order the form showed them.
    const questions = [
      field({ key: "note", label: "Anything we should know?", type: "TEXTAREA", required: false, options: [] }),
      field(),
    ];
    const shown = [
      { label: "Anything we should know?", value: "Gift wrap please" },
      { label: "Size", value: "Large" },
    ];

    // The form sends its questions in the order it rendered them, which is not
    // the order the customer happened to type in.
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

    // Blank optional: accepted, and absent from the snapshot.
    const blankOptional = orderSubmissionSchema.parse(
      submission([{ fieldId: "note", value: "   " }])
    );
    expect(
      buildSnapshotAnswers([{ ...optional, sensitive: false }], blankOptional.answers)
    ).toEqual([]);

    // Blank required: the payload is valid but the order is refused, with the
    // label that was on screen, because that is the sentence the customer has
    // to act on.
    const blankRequired = orderSubmissionSchema.parse(
      submission([{ fieldId: "size", value: "" }])
    );
    expect(() =>
      buildSnapshotAnswers([{ ...required, sensitive: false }], blankRequired.answers)
    ).toThrowError(/"Size" is required\./);
  });
});
