import useSWR from "swr";

import { studioRequest } from "./api.mjs";

// Saved widgets and saved looks kept beyond this dashboard's board
// (server/library.mjs): Just me, This dashboard and Everyone. Saved looks for
// This dashboard live in the board itself (board.looks).
export const SCOPE_LABEL = Object.freeze({ me: "Just me", dashboard: "This dashboard", everyone: "Everyone" });

export function useLibrary(enabled = true) {
  const { data, error, mutate } = useSWR(enabled ? "/studio/api/library" : null, (path) => studioRequest(path), {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });
  const change = async (body) => {
    const result = await studioRequest("/studio/api/library", body);
    await mutate();
    return result;
  };
  return {
    loaded: Boolean(data),
    error,
    scopes: data?.scopes || [],
    looks: data?.looks || [],
    widgets: data?.widgets || [],
    change,
    refresh: mutate,
  };
}
