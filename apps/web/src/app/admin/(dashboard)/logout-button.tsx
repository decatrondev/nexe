"use client";

import { logoutAction } from "../actions";

export function LogoutButton() {
  return (
    <form action={logoutAction}>
      <button
        type="submit"
        className="w-full rounded-lg px-3 py-2 text-center text-sm text-red-400/70 transition-colors hover:bg-dark-800 hover:text-red-400"
      >
        Logout
      </button>
    </form>
  );
}
