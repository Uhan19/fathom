import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/saira/500.css";
import "@fontsource/saira/600.css";
import "@fontsource/saira/700.css";
import "@fontsource/michroma/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/700.css";
import "./layers.css";
import App from "./App";
import { api } from "./api";
import { isMac } from "./bosun";
import { installKeyCapture } from "./keyCapture";
import { applyLook } from "./themes/apply";
import { NAUTICAL_ID } from "./themes/contract";
import { lookOf, NAUTICAL_LOOK } from "./themes/look";
import { installThemeReset, RESET_EVENT } from "./themes/reset";

installThemeReset(window, isMac(navigator.platform), () => {
  void applyLook(NAUTICAL_LOOK);
  void api.changeWindow({ themeId: NAUTICAL_ID }).then((settings) => window.dispatchEvent(new CustomEvent(RESET_EVENT, { detail: settings })));
});
installKeyCapture(window);

const look = await api
  .activeTheme()
  .then(lookOf)
  .catch(() => NAUTICAL_LOOK);
await applyLook(look);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App initialLook={look} />
  </React.StrictMode>,
);
