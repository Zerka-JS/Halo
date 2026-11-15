import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface SystemStatus { network: boolean; battery: number | null; charging: boolean }

export function useSystemStatus(intervalMs = 15000) {
  const [status, setStatus] = useState<SystemStatus>({ network: true, battery: null, charging: false });
  useEffect(() => {
    let alive = true, timer: number;
    const loop = async () => {
      try { const s = await invoke<SystemStatus>("get_system_status"); if (alive) setStatus(s); } catch {}
      if (alive) timer = window.setTimeout(loop, intervalMs);
    };
    loop();
    return () => { alive = false; clearTimeout(timer); };
  }, [intervalMs]);
  return status;
}
