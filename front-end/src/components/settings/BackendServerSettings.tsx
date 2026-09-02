import { useState } from "react";
import { Check, Loader2, Plus, Server, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { serverConfig, type BackendServer } from "@/lib/api/server";

export function BackendServerSettings() {
  const { t } = useTranslation();
  const [servers, setServers] = useState<BackendServer[]>(() =>
    serverConfig.list(),
  );
  const [activeId, setActiveId] = useState(() =>
    serverConfig.getActive().id,
  );
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [isAdding, setIsAdding] = useState(false);

  const refresh = () => {
    const nextServers = serverConfig.list();
    setServers(nextServers);
    setActiveId(serverConfig.getActive().id);
    return nextServers;
  };

  const handleSelect = (id: string) => {
    try {
      const active = serverConfig.setActive(id);
      setActiveId(active.id);
      toast.success(t("settings.backendServer.switched", { name: active.name }));
      window.location.reload();
    } catch (error) {
      console.error("[BackendServerSettings] Failed to switch server", error);
    }
  };

  const handleAdd = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!url.trim()) return;
    setIsAdding(true);
    try {
      const active = serverConfig.add(name, url);
      const response = await fetch(`${active.baseUrl}/api/health`, {
        method: "GET",
        mode: "cors",
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setName("");
      setUrl("");
      refresh();
      toast.success(t("settings.backendServer.added", { name: active.name }));
      window.location.reload();
    } catch (error) {
      console.error("[BackendServerSettings] Failed to add server", error);
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
      const nextActive = serverConfig.remove(id);
      refresh();
      if (nextActive) {
        window.location.reload();
      }
      toast.success(t("settings.backendServer.removed"));
    } catch (error) {
      console.error("[BackendServerSettings] Failed to remove server", error);
    }
  };

  return (
    <section className="rounded-xl border border-border bg-card/60 p-6 space-y-4">
      <div className="space-y-1">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <Server className="h-4 w-4" />
          {t("settings.backendServer.title")}
        </h3>
        <p className="text-xs text-muted-foreground">
          {t("settings.backendServer.description")}
        </p>
      </div>

      <div className="space-y-2">
        {servers.map((server) => (
          <div
            key={server.id}
            className="flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-background/70 px-3 py-2"
          >
            <button
              type="button"
              onClick={() => handleSelect(server.id)}
              className="min-w-0 flex-1 text-left"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{server.name}</span>
                {activeId === server.id && (
                  <Check className="h-3.5 w-3.5 text-emerald-500" />
                )}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {server.baseUrl}
              </div>
            </button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => handleRemove(server.id)}
              disabled={servers.length <= 1}
              aria-label={t("settings.backendServer.delete")}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>

      <form onSubmit={handleAdd} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t("settings.backendServer.namePlaceholder")}
          />
          <Input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="http://192.168.1.100:37800"
            required
          />
        </div>
        <Button type="submit" size="sm" disabled={isAdding}>
          {isAdding ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          {t("settings.backendServer.add")}
        </Button>
      </form>
    </section>
  );
}
