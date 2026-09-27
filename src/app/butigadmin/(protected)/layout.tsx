import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import AdminLayoutClient from "./AdminLayoutClient";
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/butigadmin/login");
  const role = (session.user as { role?: string }).role ?? null;
  return (
    <AdminLayoutClient
      user={{ name: session.user.name, email: session.user.email, role }}
    >
      {children}
    </AdminLayoutClient>
  );
}
