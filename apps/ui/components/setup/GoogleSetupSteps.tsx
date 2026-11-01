"use client";

import { ExternalLink } from "lucide-react";
import { CopyButton } from "@/components/ui/CopyButton";
import { useClientMounted } from "@/lib/hooks/use-client-mounted";

/**
 * The Google Cloud steps, as steps.
 *
 * The information here isn't new - all of it was already on the Calendar setup
 * screen. It was delivered as a single 200-word paragraph containing five
 * links, two code blocks and six distinct actions, which is unfollowable even
 * if you know what a redirect URI is.
 *
 * The substantive fix is the redirect URI. It used to be printed as a
 * hardcoded example - `http://localhost:1337/...` - followed by "(match
 * scheme, host, and port to where you open the app)". But the app knows its own
 * origin, so it can print the exact string and let you copy it.
 * `redirect_uri_mismatch` is the single most common way this flow fails, and it
 * fails *after* you've done all the other work.
 */
export function GoogleSetupSteps() {
  // Read from the real origin so opening DevHub from a phone on the LAN shows
  // that host rather than localhost. Mount-gated because there is no origin on
  // the server, and a guessed one is precisely how you get a mismatch.
  const mounted = useClientMounted();
  const redirectUri = mounted ? `${window.location.origin}/api/calendar/auth/callback` : "";

  return (
    <ol className="flex flex-col gap-3 text-[13px]" style={{ color: "var(--text-muted)" }}>
      <Step n={1} title="Create or pick a Google Cloud project">
        Any project works, including a brand new one.{" "}
        <Ext href="https://console.cloud.google.com/projectcreate">New project</Ext>
      </Step>

      <Step n={2} title="Turn on the Calendar API">
        Search for <strong>Google Calendar API</strong> and press Enable.{" "}
        <Ext href="https://console.cloud.google.com/apis/library/calendar-json.googleapis.com">
          Calendar API
        </Ext>
      </Step>

      <Step n={3} title="Set up the consent screen">
        Choose <strong>External</strong>, fill in the app name and your email, and save. DevHub
        asks for one read-only permission:{" "}
        <code className="break-all text-[11px]">calendar.readonly</code>.{" "}
        <Ext href="https://console.cloud.google.com/apis/credentials/consent">Consent screen</Ext>
      </Step>

      <Step n={4} title="Add yourself as a test user">
        While the app is in <strong>Testing</strong>, Google blocks every account except the ones
        listed here. Skipping this is what produces &ldquo;Access blocked&rdquo; at the very last
        step.{" "}
        <Ext href="https://console.cloud.google.com/apis/credentials/consent">Audience → Test users</Ext>
      </Step>

      <Step n={5} title="Create a Web application credential">
        Credentials → Create credentials → OAuth client ID → <strong>Web application</strong>.{" "}
        <Ext href="https://console.cloud.google.com/apis/credentials">Credentials</Ext>
      </Step>

      <Step n={6} title="Paste this exact redirect URI">
        Under <strong>Authorised redirect URIs</strong>, add this. It has to match character for
        character - a different port or <code className="text-[11px]">127.0.0.1</code> instead of{" "}
        <code className="text-[11px]">localhost</code> will fail with{" "}
        <code className="text-[11px]">redirect_uri_mismatch</code>.
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <code
            className="rounded px-2 py-1 font-mono text-[11px] break-all"
            style={{ background: "var(--bg-elevated)", color: "var(--text)" }}
          >
            {redirectUri || "loading…"}
          </code>
          {redirectUri && <CopyButton text={redirectUri} label="Copy" />}
        </div>
      </Step>

      <Step n={7} title="Copy the client ID and secret below">
        Then press <strong>Sign in with Google</strong>. DevHub stores the refresh token in{" "}
        <code className="text-[11px]">.env.local</code> - your credentials never leave this
        machine.
      </Step>
    </ol>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span
        aria-hidden
        className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
        style={{ background: "var(--bg-elevated)", color: "var(--text-muted)" }}
      >
        {n}
      </span>
      <div className="min-w-0 flex-1 leading-relaxed">
        <div style={{ color: "var(--text)" }}>{title}</div>
        <div>{children}</div>
      </div>
    </li>
  );
}

function Ext({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 whitespace-nowrap text-accent underline underline-offset-2"
    >
      {children}
      <ExternalLink size={10} aria-hidden />
    </a>
  );
}
