import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import AdminLayoutClient from "./AdminLayoutClient";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/admin/login");

  // `role` is attached to the session by the NextAuth callbacks but is not part
  // of the library's Session type, so it is read explicitly and passed down. The
  // sidebar uses it to hide destinations this role cannot use; the APIs check it
  // again server-side, which is what actually enforces anything.
  const role = (session.user as { role?: string }).role ?? null;

  return (
    <AdminLayoutClient
      user={{ name: session.user.name, email: session.user.email, role }}
    >
      {children}
    </AdminLayoutClient>
  );
}
