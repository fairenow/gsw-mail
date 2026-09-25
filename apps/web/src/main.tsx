import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/globals.css";
import "./styles/auth.css";
import "./styles/mail.css";
import "./styles/mail-row-fix.css";
import "./styles/product.css";
import "./styles/calendar.css";
import "./styles/skeletons.css";
import "./styles/legal.css";
import { AuthGate } from "./AuthGate";
import { App } from "./App";

const publicPath = ["/privacy", "/terms", "/account-deleted"].includes(window.location.pathname);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {publicPath ? <App /> : <AuthGate><App /></AuthGate>}
  </React.StrictMode>,
);
