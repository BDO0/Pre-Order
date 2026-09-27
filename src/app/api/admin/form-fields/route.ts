import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/api-guard";
import { normaliseFieldOptions } from "@/lib/form-field-admin";
import { formFieldCreateSchema } from "@/lib/validation";
import type { FormFieldType } from "@prisma/client";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const guard = await requirePermission("settings.write", request);
    if (!guard.ok) return guard.response;

    const fields = await prisma.orderFormField.findMany({
      where: { deletedAt: null },
      orderBy: { sortOrder: "asc" },
    });

    return NextResponse.json({ success: true, data: fields });
  } catch (error) {
    console.error("[GET /api/admin/form-fields]", error);
    return NextResponse.json(
      { success: false, error: { code: "SERVER_ERROR", message: "Failed to load form fields." } },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const guard = await requirePermission("settings.write", request);
    if (!guard.ok) return guard.response;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: { code: "VALIDATION_ERROR", message: "Invalid request body." } },
        { status: 400 }
      );
    }

    const parsed = formFieldCreateSchema.safeParse(body);
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

    const { key, label, type, placeholder, helpText, required, sensitive, options, active } =
      parsed.data;
    const fieldKey = key.toLowerCase().replace(/[^a-z0-9_]+/g, "_");

    const existing = await prisma.orderFormField.findUnique({
      where: { key: fieldKey },
    });

    if (existing && !existing.deletedAt) {
      return NextResponse.json(
        { success: false, error: { code: "CONFLICT", message: `A field with key "${fieldKey}" already exists.` } },
        { status: 409 }
      );
    }

    const maxSort = await prisma.orderFormField.aggregate({
      _max: { sortOrder: true },
    });
    const nextSort = (maxSort._max.sortOrder ?? 0) + 1;

    const cleanedOptions = normaliseFieldOptions(type as FormFieldType, options ?? []);

    const created = await prisma.$transaction(async (tx) => {
      const field = await tx.orderFormField.upsert({
        where: { key: fieldKey },
        update: {
          label,
          type,
          placeholder: placeholder ?? null,
          helpText: helpText ?? null,
          required,
          sensitive,
          options: cleanedOptions,
          active: active ?? true,
          sortOrder: nextSort,
          deletedAt: null,
        },
        create: {
          key: fieldKey,
          label,
          type,
          placeholder: placeholder ?? null,
          helpText: helpText ?? null,
          required,
          sensitive,
          options: cleanedOptions,
          sortOrder: nextSort,
          active: active ?? true,
        },
      });

      await tx.auditLog.create({
        data: {
          actor: guard.actor,
          action: "form_field.created",
          newValue: { fieldId: field.id, key: fieldKey, label },
        },
      });

      return field;
    });

    return NextResponse.json({ success: true, data: created });
  } catch (error) {
    console.error("[POST /api/admin/form-fields]", error);
    return NextResponse.json(
      { success: false, error: { code: "SERVER_ERROR", message: "Failed to create form field." } },
      { status: 500 }
    );
  }
}
