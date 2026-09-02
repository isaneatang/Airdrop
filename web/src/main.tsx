import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { WalletProvider } from "./wallet/WalletContext";
import { ReownProvider } from "./wallet/ReownProvider";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ReownProvider>
      <WalletProvider>
        <App />
      </WalletProvider>
    </ReownProvider>
  </StrictMode>,
);
