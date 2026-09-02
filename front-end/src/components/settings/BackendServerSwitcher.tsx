import { useState } from "react";
import { Check, Loader2, Plus, Server, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { serverConfig, type BackendServer } from "@/lib/api/server";

export function BackendServerSwitcher() {
  const { t } = useTranslation();
  const [servers, setServers] = useState<BackendServer[]>(() =>
    serverConfig.list(),
  );
  const [activeId, setActiveId] = useState(() => serverConfig.getActive().id);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [isAdding, setIsAdding] = useState(false);

  const active = servers.find((item) => item.id === activeId) ?? servers[0];

  const refresh = () => {
    const nextServers = serverConfig.list();
    setServers(nextServers);
    setActiveId(serverConfig.getActive().id);
  };

  const handleSelect = (id: string) => {
    try {
      const target = serverConfig.setActive(id);
      toast.success(t("settings.backendServer.switched", { name: target.name }));
      window.location.reload();
    } catch (error) {
      console.error("[BackendServerSwitcher] Failed to switch server", error);
    }
  };

  const handleAdd = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!url.trim()) return;
    setIsAdding(true);
    try {
      const candidate = serverConfig.add(name, url);
      const response = await fetch(`${candidate.baseUrl}/api/health`, {
        method: "GET",
        mode: "cors",
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      serverConfig.setActive(candidate.id);
      setName("");
      setUrl("");
      refresh();
      toast.success(t("settings.backendServer.added", { name: candidate.name }));
      window.location.reload();
    } catch (error) {
      console.error("[BackendServerSwitcher] Failed to add server", error);
      try {
        const current = serverConfig.getActive();
        const candidates = serverConfig.list().filter((item) => item.baseUrl === url.trim().replace(/\/+$/, ""));
        if (candidates.length > 0 && candidates[0].id !== current.id) {
          serverConfig.remove(candidates[0].id);
        }
      } catch (cleanupError) {
        console.warn("[BackendServerSwitcher] Failed to clean up unreachable server", cleanupError);
      }
      toast.error(
        t("settings.backendServer.unreachable", {
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      setIsAdding(false);
    }
  };

  const handleRemove = (id: string) => {
    try {
      const wasActive = serverConfig.getActive().id === id;
      serverConfig.remove(id);
      refresh();
      toast.success(t("settings.backendServer.removed"));
      if (wasActive) window.location.reload();
    } catch (error) {
      console.error("[BackendServerSwitcher] Failed to remove server", error);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="max-w-[180px] gap-2 px-2 font-normal text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5"
          title={active?.baseUrl}
        >
          <Server className="h-4 w-4" />
          <span className="truncate">{active?.name ?? t("settings.backendServer.title")}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>{t("settings.backendServer.title")}</DropdownMenuLabel>
        {servers.map((server) => (
          <DropdownMenuItem
            key={server.id}
            onSelect={() => server.id !== activeId && handleSelect(server.id)}
            className="gap-2"
          >
            <Check
              className={`h-4 w-4 ${server.id === activeId ? "text-emerald-500" : "opacity-0"}`}
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{server.name}</div>
              <div className="truncate text-xs text-muted-foreground">{server.baseUrl}</div>
            </div>
            <button
              type="button"
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              disabled={servers.length <= 1}
              onClick={(event) => {
                event.stopPropagation();
                handleRemove(server.id);
              }}
              aria-label={t("settings.backendServer.delete")}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <form
          onSubmit={(event) => void handleAdd(event)}
          className="space-y-2 p-2"
          onClick={(event) => event.stopPropagation()}
        >
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t("settings.backendServer.namePlaceholder")}
            className="h-8 text-sm"
          />
          <Input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="http://192.168.1.100:37800"
            required
            className="h-8 text-sm"
          />
          <Button type="submit" size="sm" className="w-full" disabled={isAdding}>
            {isAdding ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            {t("settings.backendServer.add")}
          </Button>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
