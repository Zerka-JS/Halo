import { createContext, useContext } from "react";

/** Faux quand la fenêtre Réglages est masquée : les aperçus animés (fonds, vidéos, sons) se mettent alors en pause */
export const ActiveContext = createContext(true);
export const useActive = () => useContext(ActiveContext);
