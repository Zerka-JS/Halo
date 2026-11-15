import { useEffect } from "react";
import TopBar from "./components/TopBar";
import Dock from "./components/Dock";
import Desktop from "./windows/Desktop";
import Settings from "./windows/Settings";
import Search from "./windows/Search";
import { useApplyTheme } from "./lib/theme";

// Un seul frontend, cinq fenêtres Tauri : ?w=desktop | topbar | dock | settings | search
export default function App() {
  const w = new URLSearchParams(location.search).get("w") ?? "desktop";
  useApplyTheme();
  useEffect(() => { document.documentElement.dataset.w = w; }, [w]);
  if (w === "topbar") return <TopBar />;
  if (w === "dock") return <Dock />;
  if (w === "settings") return <Settings />;
  if (w === "search") return <Search />;
  return <Desktop />;
}
