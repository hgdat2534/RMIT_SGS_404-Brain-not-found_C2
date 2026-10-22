// SIMULATED TideCloak sign-in page. In the real realm this is TideCloak's login, which hands off to
// the Tide enclave where the user proves they own their Tide account. Here it is an account picker.

import { notFound } from "next/navigation";
import { Explain, PageHead } from "@/components/ui";
import { TIDE_SIMULATED } from "@/lib/mode";
import { SignInForm } from "./SignInForm";

export const dynamic = "force-dynamic";

export default function SimLoginPage() {
  if (!TIDE_SIMULATED) notFound();
  return (
    <>
      <PageHead title="Sign in to Errand" lead="Choose who you want to be. Each browser tab keeps its own session." />
      <Explain label="Simulated sign-in">
        <p>
          With real TideCloak you would type your own Tide username and password into the Tide window, and nobody else, not even
          Errand&apos;s staff, could sign in as you. Here you simply pick an account. Everything after this point (the signed token,
          the roles in it, the access checks) works the same way.
        </p>
      </Explain>
      <SignInForm />
    </>
  );
}
