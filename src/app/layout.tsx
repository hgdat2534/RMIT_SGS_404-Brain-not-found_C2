import "./globals.css";
import { Providers } from "./providers";
import { TopBar } from "@/components/Shell";

export const metadata = {
  title: "Errand — a guardrailed AI agent",
  description: "A life-admin agent that can only open what you grant it, enforced by the Tide network.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <TopBar />
          {children}
        </Providers>
      </body>
    </html>
  );
}
