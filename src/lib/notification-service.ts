/**
 * NotificationService — pluggable abstraction.
 *
 * V1: on-screen confirmation only.
 * Future: swap/add email, SMS, Messenger, WhatsApp by adding providers.
 */

export interface NotificationPayload {
  type: "ORDER_CREATED" | "ORDER_CONFIRMED" | "ORDER_CANCELLED" | "PAYMENT_VERIFIED";
  orderId: string;
  reference: string;
  customerName: string;
  customerEmail?: string;
  customerPhone: string;
  total: number;
  metadata?: Record<string, unknown>;
}

export interface NotificationProvider {
  send(payload: NotificationPayload): Promise<void>;
}

// ─── V1: Console/no-op provider ───────────────────────────────
class ConsoleNotificationProvider implements NotificationProvider {
  async send(payload: NotificationPayload): Promise<void> {
    console.log(
      `[Notification] ${payload.type} for order ${payload.reference} — customer: ${payload.customerName}`
    );
    // TODO: Replace with real email/SMS/Messenger provider
  }
}

// ─── Service (aggregates multiple providers) ───────────────────
class NotificationService {
  private providers: NotificationProvider[];

  constructor(providers: NotificationProvider[]) {
    this.providers = providers;
  }

  async send(payload: NotificationPayload): Promise<void> {
    await Promise.allSettled(
      this.providers.map((p) => p.send(payload))
    );
    // allSettled — one provider failure won't block others
  }
}

// ─── Singleton export ──────────────────────────────────────────
export const notificationService = new NotificationService([
  new ConsoleNotificationProvider(),
  // Add: new EmailNotificationProvider()
  // Add: new SMSNotificationProvider()
]);
