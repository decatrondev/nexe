"use server";

import { query } from "@/lib/db";
import { isAdminAuthenticated } from "@/lib/admin-auth";

async function requireAdmin() {
  const authenticated = await isAdminAuthenticated();
  if (!authenticated) {
    throw new Error("Unauthorized");
  }
}

export async function banUser(userId: string) {
  await requireAdmin();
  await query("UPDATE users SET disabled = true, updated_at = NOW() WHERE id = $1", [userId]);
}

export async function unbanUser(userId: string) {
  await requireAdmin();
  await query("UPDATE users SET disabled = false, updated_at = NOW() WHERE id = $1", [userId]);
}

export async function updateUser(userId: string, data: { username?: string }) {
  await requireAdmin();

  if (data.username) {
    const [existing] = await query<{ id: string }>(
      "SELECT id FROM users WHERE LOWER(username) = LOWER($1) AND id != $2",
      [data.username, userId]
    );
    if (existing) {
      throw new Error("Username already taken");
    }
    await query(
      "UPDATE users SET username = $1, updated_at = NOW() WHERE id = $2",
      [data.username, userId]
    );
  }
}
