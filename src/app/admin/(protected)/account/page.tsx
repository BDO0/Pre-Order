import { auth } from "@/lib/auth";
import AccountClient from "./AccountClient";

/**
 * The signed-in admin's own account.
 *
 * A server component wrapper so the page can show *which* account it is about
 * without pulling the session through a client provider — and so a signed-in
 * screen never renders a blank "your account" heading.
 */
export const dynamic = "force-dynamic";

export default async function AdminAccountPage() {
  const session = await auth();
  const user = session?.user as
    | { email?: string | null; name?: string | null; role?: string | null }
    | undefined;

  return (
    <div>
      <h1 className="admin-page-title">Account</h1>
      <AccountClient
        email={user?.email ?? null}
        name={user?.name ?? null}
        role={user?.role ?? null}
      />
    </div>
  );
}
