import { cookies } from "next/headers";

const COOKIE_NAME = "nexe_admin_session";

export async function isAdminAuthenticated(): Promise<boolean> {
  const cookieStore = await cookies();
  const session = cookieStore.get(COOKIE_NAME);
  return !!session?.value;
}
