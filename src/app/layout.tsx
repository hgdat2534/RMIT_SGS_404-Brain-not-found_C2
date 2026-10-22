import { Providers } from "./providers";

export const metadata = {
  title: "Errand",
  description: "A guardrailed AI agent for life admin, powered by TideCloak",
};

const css = `
  body { font-family: system-ui, sans-serif; margin: 0; padding: 1.5rem; background: #fafafa; color: #111; }
  main { max-width: 900px; margin: 0 auto; }
  nav { display: flex; gap: 1rem; margin-bottom: 1rem; font-size: .9rem; }
  section { background: #fff; border: 1px solid #ddd; border-radius: 6px; padding: 1rem; margin-bottom: 1rem; }
  h1 { margin: 0 0 .5rem; } h2 { margin: 0 0 .5rem; font-size: 1.1rem; }
  button { padding: .35rem .8rem; margin: .15rem .3rem .15rem 0; cursor: pointer; }
  table { border-collapse: collapse; width: 100%; font-size: .85rem; }
  td, th { border-bottom: 1px solid #eee; padding: .3rem; text-align: left; vertical-align: top; }
  pre { white-space: pre-wrap; word-break: break-all; background: #f3f3f3; padding: .5rem; font-size: .8rem; margin: .3rem 0; }
  .muted { color: #666; font-size: .85rem; }
  .red { color: #b00020; font-weight: 600; } .amber { color: #a15c00; font-weight: 600; } .green { color: #1b6e20; font-weight: 600; }
  .row-red { background: #fdecee; }
  .status { padding: .5rem; background: #eef4ff; border-radius: 4px; font-size: .9rem; }
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <style>{css}</style>
      </head>
      <body>
        <Providers>
          <main>{children}</main>
        </Providers>
      </body>
    </html>
  );
}
