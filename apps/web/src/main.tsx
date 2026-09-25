import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/globals.css";
import "./styles/auth.css";
import "./styles/mail.css";
import "./styles/product.css";
import "./styles/calendar.css";
import "./styles/skeletons.css";
import { AuthGate } from "./AuthGate";
import { App } from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthGate><App /></AuthGate>
  </React.StrictMode>,
);
