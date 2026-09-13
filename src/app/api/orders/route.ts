import { NextRequest, NextResponse } from "next/server";
import { orderSubmissionSchema } from "@/lib/validation";
import { createOrder, OrderError } from "@/lib/order-service";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { isSameOrigin } from "@/lib/api-guard";

export async function POST(request: NextRequest) {
  try {
    // Public, unauthenticated, and each call can consume real stock: throttle it
    // before any database work happens.
    const limited = enforceRateLimit(request, RATE_LIMITS.checkout);
    if (limited) return limited;

    // Checkout is a form POST from our own storefront; a cross-origin one has no
    // business placing an order.
    if (!isSameOrigin(request)) {
      return NextResponse.json(
        { success: false, error: { code: "CROSS_ORIGIN_BLOCKED", message: "This request did not come from this site." } },
        { status: 403 }
      );
    }

    const body = await request.json();
    const parsed = orderSubmissionSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Please check your information and try again.",
            fields: parsed.error.flatten().fieldErrors,
          },
        },
        { status: 400 }
      );
    }

    const result = await createOrder(parsed.data);

    return NextResponse.json(
      { success: true, data: result.order },
      { status: result.idempotent ? 200 : 201 }
    );
  } catch (error) {
    if (error instanceof OrderError) {
      return NextResponse.json(
        { success: false, error: { code: error.code, message: error.message } },
        { status: 422 }
      );
    }

    console.error("[POST /api/orders]", error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "SERVER_ERROR",
          message: "Something went wrong. Please try again.",
        },
      },
      { status: 500 }
    );
  }
}
