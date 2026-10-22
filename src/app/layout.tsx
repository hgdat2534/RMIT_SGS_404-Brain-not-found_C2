import "./globals.css";
import { AppHeader } from "@/components/AppHeader";
import { TIDE_SIMULATED } from "@/lib/mode";
import { Providers } from "./providers";

export const metadata = {
  title: "Errand",
  description: "A personal AI agent for life admin that can only open the folders you grant it, protected by TideCloak",
};

export const viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          {TIDE_SIMULATED && (
            <div className="sim-banner">
              <div>
                <b>Simulation mode.</b> TideCloak and the Tide network are simulated in this app, with the same checks.{" "}
                <a href="/how-it-works#simulated">What is simulated?</a>
              </div>
            </div>
          )}
          <AppHeader />
          <main className="page">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
