let input = "";
for await (const chunk of process.stdin) {
  input += chunk;
  if (Buffer.byteLength(input) > 65536) throw new Error("Request too large");
}
const request = JSON.parse(input);
let result;
if (request.kind === "page" && request.path === "/") {
  result = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Sample tools</title>
<style>body{font:16px system-ui;padding:32px;background:#f7f8fa;color:#17202a}button{padding:10px 16px;border:1px solid #677481;border-radius:6px;background:white;cursor:pointer}p{line-height:1.6}</style>
<h1>Sample tools</h1><p>This page runs from an installed plugin bundle.</p><button id="refresh">Check status</button><p id="status" role="status">Ready.</p>
<script>document.getElementById('refresh').onclick=()=>{document.getElementById('status').textContent='Checking…';parent.postMessage({type:'devhub:api',id:'status',path:'/status',method:'GET'},'*')};window.addEventListener('message',event=>{if(event.source===parent&&event.data?.type==='devhub:result'&&event.data.id==='status')document.getElementById('status').textContent=event.data.error||event.data.result.message});</script></html>`;
} else if (request.kind === "api" && request.path === "/status" && request.method === "GET") {
  result = { message: "The plugin API is working." };
} else if (request.kind === "mcp" && request.path === "sample") {
  const rpc = request.body;
  let payload;
  if (rpc.method === "initialize") payload = { protocolVersion: rpc.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "sample-tools", version: "1.0.0" } };
  else if (rpc.method === "tools/list") payload = { tools: [{ name: "status", description: "Read the sample status", inputSchema: { type: "object", properties: {}, additionalProperties: false } }] };
  else if (rpc.method === "tools/call" && rpc.params?.name === "status") payload = { content: [{ type: "text", text: "The plugin MCP server is working." }] };
  else if (rpc.method === "ping") payload = {};
  result = rpc.id === undefined ? null : payload ? { jsonrpc: "2.0", id: rpc.id, result: payload } : { jsonrpc: "2.0", id: rpc.id, error: { code: -32601, message: "Method not found" } };
} else throw new Error("Unknown route");
process.stdout.write(JSON.stringify(result));
