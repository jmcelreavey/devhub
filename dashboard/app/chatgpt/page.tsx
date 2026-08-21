/**
 * The /chatgpt route exists so the URL and sidebar link work, but the actual
 * terminal is rendered by <PersistentChatGPT> in the root layout so the CLI
 * session survives client-side navigation to other pages.
 */
export const metadata = { title: "ChatGPT" };

export default function ChatGPTPage() {
  return null;
}
