"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const COOKIE_NAME = "nexe_admin_session";
const ALLOWED_EMAIL = "decagraff@gmail.com";

interface LoginResult {
  error?: string;
}

export async function loginAction(
  _prevState: LoginResult | null,
  formData: FormData
): Promise<LoginResult> {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

  if (!email || !password) {
    return { error: "Email and password are required." };
  }

  if (email !== ALLOWED_EMAIL) {
    return { error: "Invalid credentials." };
  }

  try {
    const res = await fetch("http://localhost:8090/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      return {
        error: body?.error || body?.message || "Invalid credentials.",
      };
    }

    const body = await res.json();
    const accessToken = body?.data?.accessToken;

    if (!accessToken) {
      return { error: "Login failed. No token received." };
    }

    const cookieStore = await cookies();
    cookieStore.set(COOKIE_NAME, accessToken, {
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      maxAge: 60 * 60 * 24, // 24 hours
    });
  } catch {
    return { error: "Could not connect to the authentication server." };
  }

  redirect("/admin");
}

export async function logoutAction(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
  redirect("/admin/login");
}
