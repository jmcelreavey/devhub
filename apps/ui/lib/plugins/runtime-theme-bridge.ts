import { z } from "zod";
import type { PublicRuntimeTheme } from "../../../../packages/shared/ui-lib/plugins/runtime-theme-contract";

const surfaceMessage = z.discriminatedUnion("type", [z.object({
  type: z.literal("devhub:theme-audio"), nonce: z.string().uuid(),
  id: z.string().regex(/^[a-z][a-z0-9-]{0,62}$/), action: z.enum(["play", "stop"]),
}).strict(), z.object({ type: z.literal("devhub:theme-error"), nonce: z.string().uuid() }).strict()]);

export function themeSurfaceMessage(event: Pick<MessageEvent, "source" | "origin" | "data">, source: MessageEventSource | null, nonce: string, theme: PublicRuntimeTheme) {
  if (!source || event.source !== source || event.origin !== "null") return null;
  const message = surfaceMessage.safeParse(event.data);
  if (!message.success || message.data.nonce !== nonce) return null;
  const value = message.data;
  if (value.type === "devhub:theme-audio" && !theme.audio?.some(sound => sound.id === value.id)) return null;
  return value;
}

export function themeSurfaceDocument(html: string, nonce: string, staticMode = false): string {
  const policy = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; media-src 'none'; font-src 'none'; frame-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'";
  const token = JSON.stringify(nonce);
  const bridge = `(function(){
    var nonce=${token};var assets={};
    function failed(){parent.postMessage({type:"devhub:theme-error",nonce:nonce},"*");}
    window.addEventListener("error",failed);window.addEventListener("unhandledrejection",failed);
    window.devhubTheme=Object.freeze({
      play:function(id){parent.postMessage({type:"devhub:theme-audio",nonce:nonce,id:id,action:"play"},"*");},
      stop:function(id){parent.postMessage({type:"devhub:theme-audio",nonce:nonce,id:id,action:"stop"},"*");}
    });
    window.addEventListener("message",function(e){
      if(e.source!==parent||!e.data||e.data.nonce!==nonce)return;
      if(e.data.type==="devhub:theme-state"){
        if(e.data.state.assets)assets=e.data.state.assets;
        e.data.state.assets=assets;
        window.dispatchEvent(new CustomEvent("devhub:theme-state",{detail:e.data.state}));
      }
      if(e.data.type==="devhub:theme-event")window.dispatchEvent(new CustomEvent("devhub:theme-event",{detail:e.data.event}));
    });
  })();`;
  const still = staticMode ? '<style>*,*::before,*::after{animation:none!important;transition:none!important}</style>' : "";
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><style>html,body{margin:0;background:transparent;overflow:hidden}</style><script>${bridge}</script></head><body>${html}${still}</body></html>`;
}
