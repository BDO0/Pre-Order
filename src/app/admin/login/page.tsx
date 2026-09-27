"use client";

import { useState, FormEvent } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { SITE_NAME } from "@/lib/site";
import { BrandLogo } from "@/components/BrandLogo";
import styles from "./login.module.css";

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    setLoading(false);

    if (result?.error) {
      setError("Invalid email or password. Please try again.");
    } else {
      router.push("/butigadmin/dashboard");
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.logo} style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: "var(--space-4)" }}>
          <BrandLogo
            variant="stacked"
            height={56}
            color="var(--color-brand-600)"
            textColor="var(--color-brand-900)"
            subtextColor="var(--color-neutral-600)"
          />
          <span className={styles.logoSub} style={{ marginTop: "6px" }}>Admin Portal</span>
        </div>

        <h1 className={styles.title}>Welcome back</h1>
        <p className={styles.subtitle}>Sign in to your admin dashboard</p>

        <form onSubmit={handleSubmit} className={styles.form} id="admin-login-form">
          <div className="form-group">
            <label htmlFor="email" className="form-label form-label-required">Email</label>
            <input
              id="email"
              type="email"
              className={`form-input ${error ? "error" : ""}`}
              placeholder="admin@tudungpeople.ph"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>

          <div className="form-group">
            <label htmlFor="password" className="form-label form-label-required">Password</label>
            <input
              id="password"
              type="password"
              className={`form-input ${error ? "error" : ""}`}
              placeholder="••••••••"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>

          {error && (
            <p className="form-error" role="alert">{error}</p>
          )}

          <button
            id="login-submit"
            type="submit"
            className="btn btn-primary btn-full btn-lg"
            disabled={loading}
          >
            {loading ? "Signing in…" : "Sign In"}
          </button>
        </form>
      </div>
    </div>
  );
}
