import { createContext, useContext } from "react";
import { NAUTICAL_LOOK, type Look } from "./look";

export const LookContext = createContext<Look>(NAUTICAL_LOOK);

export const useLook = (): Look => useContext(LookContext);
