"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import type { TelegramChat } from "@/lib/integrations/telegram";
import styles from "./integrations.module.css";

interface Props { credentialRef: string; chatId: string; onChange: (value: string) => void; disabled: boolean }
export default function TelegramChatId({ credentialRef, chatId, onChange, disabled }: Props) {
  const [chats, setChats] = useState<TelegramChat[] | null>(null);
  const [busy, setBusy] = useState(false); const pending = useRef(false);
  const [failure, setFailure] = useState("");
  async function discover() {
    if (pending.current) return;
    pending.current = true; setBusy(true); setFailure(""); setChats(null);
    try {
      const response = await fetch("/api/integrations/telegram/chats", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ credentialRef }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not find Telegram chats. Enter the chat ID manually.");
      setChats(result.chats);
    } catch (error) { setFailure(error instanceof Error ? error.message : "Could not find Telegram chats. Enter the chat ID manually."); }
    finally { pending.current = false; setBusy(false); }
  }
  return <div className={styles.writeFields}>
    <p className={styles.meta}><Link className={styles.helpLink} href="/docs/guides/integrations#telegram-setup">How to set up Telegram</Link> · Create a bot with @BotFather, store its token on the server, then start it in the chosen chat.</p>
    <label>Telegram chat ID<input className="input" name="chatId" value={chatId} onChange={(event) => onChange(event.target.value)} disabled={disabled} required pattern="-?[1-9][0-9]*" placeholder="-1001234567890" maxLength={20} /><span className={styles.meta}>Start the bot or add it to the chosen chat first. Telegram bots do not use secret chats.</span></label>
    <div><button type="button" className="btn btn-ghost" disabled={disabled || busy || !/^[A-Z][A-Z0-9_]{1,127}$/.test(credentialRef)} onClick={() => void discover()}>{busy ? "Finding chat IDs…" : "Find my chat ID"}</button></div>
    <p className={styles.meta}>Reads up to 100 pending updates on the server, without acknowledging them. Only chat type and numeric IDs reach this page. Unavailable while a webhook is active; it is never removed.</p>
    {failure && <p role="alert" className="tone-panel tone-panel--danger">{failure}</p>}
    {chats && (chats.length ? <label>Chats found<select className="input" value={chats.some((chat) => chat.chatId === chatId) ? chatId : ""} disabled={disabled} onChange={(event) => onChange(event.target.value)}><option value="" disabled>Choose the intended recipient</option>{chats.map((chat) => <option key={chat.chatId} value={chat.chatId}>{chat.type} · {chat.chatId}{chat.userId ? " · sender " + chat.userId : ""}</option>)}</select></label> : <p role="status">No chats found. Send /start to the bot (or a command in the group), then try again.</p>)}
  </div>;
}
