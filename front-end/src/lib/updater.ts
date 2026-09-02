import { invoke } from "@/lib/api/transport";

export type UpdateChannel = "stable" | "beta";

export interface UpdateInfo {
  currentVersion: string;
  availableVersion: string;
  notes?: string;
  pubDate?: string;
}

export interface CheckOptions {
  timeout?: number;
  channel?: UpdateChannel;
}

export async function getCurrentVersion(): Promise<string> {
  try {
    return await invoke<string>("get_app_version");
  } catch {
    return "";
  }
}

export async function checkForUpdate(
  opts: CheckOptions = {},
): Promise<
  { status: "up-to-date" } | { status: "available"; info: UpdateInfo }
> {
  try {
    const result = await invoke<{
      status: "up-to-date" | "available";
      currentVersion?: string;
      availableVersion?: string;
      notes?: string;
      pubDate?: string;
    }>("check_for_updates", { channel: opts.channel, timeout: opts.timeout });

    if (result.status !== "available") {
      return { status: "up-to-date" };
    }

    return {
      status: "available",
      info: {
        currentVersion: result.currentVersion ?? "",
        availableVersion: result.availableVersion ?? "",
        notes: result.notes,
        pubDate: result.pubDate,
      },
    };
  } catch {
    return { status: "up-to-date" };
  }
}

export async function installUpdateAndRestart(): Promise<boolean> {
  try {
    return await invoke<boolean>("install_update_and_restart");
  } catch {
    return false;
  }
}
