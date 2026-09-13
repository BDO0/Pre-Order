import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@/lib/db";
import bcrypt from "bcryptjs";
import { z } from "zod";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  // ── Host trust (required in a production build) ──────────────
  // Auth.js v5 decides whether to trust the request's Host header from
  // `AUTH_URL`, `AUTH_TRUST_HOST`, `VERCEL`, `CF_PAGES` — or from
  // NODE_ENV !== "production". It does NOT read the v4 `NEXTAUTH_URL` name for
  // this decision, which is a trap: a production build on any host other than
  // Vercel/Cloudflare answers every /api/auth/* request with
  // "UntrustedHost" (HTTP 500), and because the proxy turns auth errors into a
  // redirect to the login page, it presents to staff as "the password is always
  // wrong" rather than as a configuration error. Verified by calling
  // /api/auth/csrf against `next start`.
  //
  // Opting in explicitly makes login work behind any correctly configured
  // reverse proxy. Set AUTH_URL to the canonical origin as well (see
  // .env.example): that both pins the redirect target and removes any reliance
  // on the Host header.
  trustHost: true,

  providers: [
    Credentials({
      name: "Admin Login",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const { email, password } = parsed.data;

        const admin = await prisma.admin.findUnique({
          where: { email, active: true },
        });

        if (!admin) return null;

        const valid = await bcrypt.compare(password, admin.passwordHash);
        if (!valid) return null;

        return {
          id: admin.id,
          email: admin.email,
          name: admin.name,
          role: admin.role,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as { role?: string }).role;
      }
      return token;
    },
    async session({ session, token }) {
      if (token) {
        session.user.id = token.id as string;
        (session.user as { role?: string }).role = token.role as string;
      }
      return session;
    },
  },
  pages: {
    signIn: "/admin/login",
    error: "/admin/login",
  },
  session: {
    strategy: "jwt",
    maxAge: 8 * 60 * 60, // 8 hours
  },
});
