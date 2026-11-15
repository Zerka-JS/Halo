import {
  AppWindow, BookOpen, Calculator, Camera, Cloud, Code, FileText, Folder, FolderOpen, Gamepad2, Globe, Headphones,
  Heart, Image as ImageIcon, Layers, Mail, Map as MapIcon, MessageCircle, Music, Palette, Radio, Rocket, Settings,
  ShoppingCart, SquareTerminal, Star, StickyNote, Video, Wrench, type LucideIcon,
} from "lucide-react";

// Icônes disponibles pour les applications épinglées dans le dock
export const PIN_ICONS: Record<string, LucideIcon> = {
  files: FolderOpen, edge: Globe, term: SquareTerminal, calc: Calculator, settings: Settings,
  app: AppWindow, folder: Folder, music: Music, mail: Mail, camera: Camera, code: Code, game: Gamepad2,
  image: ImageIcon, video: Video, doc: FileText, chat: MessageCircle, cart: ShoppingCart, book: BookOpen,
  map: MapIcon, star: Star, heart: Heart, cloud: Cloud, audio: Headphones, palette: Palette, tool: Wrench,
  layers: Layers, rocket: Rocket, note: StickyNote, radio: Radio,
};

export const PICKABLE_ICONS = Object.keys(PIN_ICONS).filter((k) => !["files", "edge", "term", "calc", "settings"].includes(k));
