import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/api-guard";
import { normaliseFieldOptions } from "@/lib/form-field-admin";
import { formFieldUpdateSchema } from "@/lib/validation";
import type { FormFieldType } from "@prisma/client";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requirePermission("settings.write", request);
    if (!guard.ok) return guard.response;

    const { id } = await params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: { code: "VALIDATION_ERROR", message: "Invalid request body." } },
        { status: 400 }
      );
    }

    const parsed = formFieldUpdateSchema.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: issue ? issue.message : "Invalid field.",
            fields: parsed.error.flatten().fieldErrors,
          },
        },
        { status: 400 }
      );
    }

    const existing = await prisma.orderFormField.findUnique({
      where: { id },
    });

    if (!existing) {
      return NextResponse.json(
        { success: false, error: { code: "NOT_FOUND", message: "Form field not found." } },
        { status: 404 }
      );
    }

    const { type, options, ...columns } = parsed.data;

    // Choices belong to the type, so they are re-derived only when one of the two
    // was actually sent - and when only the type was sent, they are re-derived
    // from the choices this question already had rather than from nothing. This
    // is the same "absent is not the same as cleared" rule the rest of the admin
    // API follows: a request that toggles `required` must not empty a dropdown.
    const cleanedOptions =
      options !== undefined
        ? normaliseFieldOptions((type ?? existing.type) as FormFieldType, options)
        : type !== undefined
          ? normaliseFieldOptions(type as FormFieldType, existing.options)
          : undefined;

    const updated = await prisma.$transaction(async (tx) => {
      const field = await tx.orderFormField.update({
        where: { id },
        data: {
          ...columns,
          ...(type !== undefined ? { type } : {}),
          ...(cleanedOptions !== undefined ? { options: cleanedOptions } : {}),
        },
      });

      await tx.auditLog.create({
        data: {
          actor: guard.actor,
          action: "form_field.updated",
          newValue: { fieldId: id, label: field.label },
        },
      });

      return field;
    });

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    console.error("[PATCH /api/admin/form-fields/[id]]", error);
    return NextResponse.json(
      { success: false, error: { code: "SERVER_ERROR", message: "Failed to update form field." } },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requirePermission("settings.write", request);
    if (!guard.ok) return guard.response;

    const { id } = await params;
    const existing = await prisma.orderFormField.findUnique({
      where: { id },
    });

    if (!existing) {
      return NextResponse.json(
        { success: false, error: { code: "NOT_FOUND", message: "Form field not found." } },
        { status: 404 }
      );
    }

    // The soft delete and its audit entry land together, so a question cannot
    // vanish from the checkout form with nothing recording who removed it.
    await prisma.$transaction(async (tx) => {
      await tx.orderFormField.update({
        where: { id },
        data: { deletedAt: new Date(), active: false },
      });

      await tx.auditLog.create({
        data: {
          actor: guard.actor,
          action: "form_field.deleted",
          newValue: { fieldId: id, key: existing.key },
        },
      });
    });

    return NextResponse.json({ success: true, message: "Field deleted." });
  } catch (error) {
    console.error("[DELETE /api/admin/form-fields/[id]]", error);
    return NextResponse.json(
      { success: false, error: { code: "SERVER_ERROR", message: "Failed to delete form field." } },
      { status: 500 }
    );
  }
}
