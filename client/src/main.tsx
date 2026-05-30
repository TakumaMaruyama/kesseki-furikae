import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

async function refreshServiceWorkers() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return;
  }

  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.update()));
  } catch {
    // Ignore update failures and let the app continue booting.
  }
}

void refreshServiceWorkers();

createRoot(document.getElementById("root")!).render(<App />);
