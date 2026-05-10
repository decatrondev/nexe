"use client";

import { useActionState } from "react";
import { loginAction } from "../actions";

export default function AdminLoginPage() {
  const [state, formAction, isPending] = useActionState(loginAction, null);

  return (
    <div className="flex min-h-screen items-center justify-center bg-dark-950">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-nexe-600 text-lg font-bold text-white">
            N
          </div>
          <h1 className="text-xl font-semibold text-white">Nexe Admin</h1>
          <p className="mt-1 text-sm text-slate-500">
            Sign in to access the admin panel
          </p>
        </div>

        <form
          action={formAction}
          className="rounded-xl border border-slate-800 bg-dark-900 p-6"
        >
          {state?.error && (
            <div className="mb-4 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
              {state.error}
            </div>
          )}

          <div className="mb-4">
            <label
              htmlFor="email"
              className="mb-1.5 block text-sm font-medium text-slate-400"
            >
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              className="w-full rounded-lg border border-slate-800 bg-dark-800 px-3 py-2.5 text-sm text-white placeholder-slate-600 outline-none transition-colors focus:border-nexe-500 focus:ring-1 focus:ring-nexe-500"
              placeholder="you@example.com"
            />
          </div>

          <div className="mb-6">
            <label
              htmlFor="password"
              className="mb-1.5 block text-sm font-medium text-slate-400"
            >
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="w-full rounded-lg border border-slate-800 bg-dark-800 px-3 py-2.5 text-sm text-white placeholder-slate-600 outline-none transition-colors focus:border-nexe-500 focus:ring-1 focus:ring-nexe-500"
              placeholder="Enter your password"
            />
          </div>

          <button
            type="submit"
            disabled={isPending}
            className="w-full rounded-lg bg-nexe-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-nexe-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
