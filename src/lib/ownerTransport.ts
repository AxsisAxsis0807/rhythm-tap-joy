import { supabase } from "@/integrations/supabase/client";
/** Pin credentials after the global auth middleware has run, including during account switches. */
export async function ownerTransport(ownerId: string): Promise<typeof fetch> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error(error.message);
  if (!data.session || data.session.user.id !== ownerId)
    throw new Error("プレイ時のアカウントでログインしてください");
  const token = data.session.access_token;
  return (input, init) => {
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
    headers.set("Authorization", `Bearer ${token}`);
    return fetch(input, { ...init, headers });
  };
}
