// Conector "SejaPay Assinafy" para o Claude (servidor MCP, transporte HTTP, sem estado).
// Endereço para adicionar no Claude: https://<seu-projeto>.pages.dev/mcp/<MCP_TOKEN>
// O token no endereço funciona como senha: só quem tem o endereço completo consegue usar o conector.
// Variáveis do projeto na Cloudflare: MCP_TOKEN (secreta) + as do Assinafy (ver lib/assinafy.js).

import { resumoConfig, enviarContrato } from "../../lib/assinafy.js";

const VERSOES = ["2025-06-18", "2025-03-26", "2024-11-05"];

const FERRAMENTAS = [
  {
    name: "configuracao_assinatura",
    title: "Ver signatários fixos",
    description: "Mostra se o envio ao Assinafy está configurado e quem assina pela SejaPay e como testemunha.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "enviar_contrato_assinatura",
    title: "Enviar contrato para assinatura",
    description: "Envia o PDF do contrato White Label ao Assinafy e cria o pedido de assinatura para o cliente, quem assina pela SejaPay e as testemunhas.",
    inputSchema: {
      type: "object",
      properties: {
        arquivo: { type: "string", description: "Nome do arquivo PDF." },
        pdf_base64: { type: "string", description: "Conteúdo do PDF em base64." },
        cliente: {
          type: "object",
          properties: {
            nome: { type: "string", description: "Nome completo do representante." },
            cpf: { type: "string" },
            email: { type: "string" },
            whatsapp: { type: "string", description: "Celular com DDD." },
            canal: { type: "string", enum: ["Email", "Whatsapp"], description: "Canal do aviso e do código de verificação." },
          },
          required: ["nome"],
        },
      },
      required: ["arquivo", "pdf_base64", "cliente"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
];

function json(corpo, status) {
  return new Response(corpo === null ? null : JSON.stringify(corpo), {
    status: status || 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
function ok(id, result) { return { jsonrpc: "2.0", id, result }; }
function erro(id, code, message) { return { jsonrpc: "2.0", id, error: { code, message } }; }
function resultado(dados, falhou) {
  return { content: [{ type: "text", text: JSON.stringify(dados) }], structuredContent: dados, isError: !!falhou };
}
function iguais(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
function deBase64(b64) {
  const s = atob(String(b64).replace(/^data:[^,]*,/, "").replace(/\s/g, ""));
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u;
}

async function tratar(msg, env) {
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return erro(msg && msg.id !== undefined ? msg.id : null, -32600, "Requisição inválida.");
  const id = msg.id;
  const notificacao = id === undefined || id === null;
  const p = msg.params || {};
  switch (msg.method) {
    case "initialize": {
      const v = VERSOES.includes(p.protocolVersion) ? p.protocolVersion : VERSOES[0];
      return ok(id, { protocolVersion: v, capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "sejapay-assinafy", title: "SejaPay Assinafy", version: "1.0.0" },
        instructions: "Envia contratos White Label da SejaPay ao Assinafy para assinatura eletrônica." });
    }
    case "ping": return ok(id, {});
    case "tools/list": return ok(id, { tools: FERRAMENTAS });
    case "tools/call": {
      const nome = p.name, args = p.arguments || {};
      if (nome === "configuracao_assinatura") return ok(id, resultado(resumoConfig(env)));
      if (nome === "enviar_contrato_assinatura") {
        try {
          if (!args.pdf_base64) throw new Error("PDF do contrato não recebido.");
          let bytes;
          try { bytes = deBase64(args.pdf_base64); } catch { throw new Error("PDF em base64 inválido."); }
          const r = await enviarContrato(env, bytes, args.arquivo, args.cliente);
          return ok(id, resultado({ ok: true, documento: r.documento, pedido: r.pedido, signatarios: r.signatarios, nomes: r.nomes }));
        } catch (e) {
          return ok(id, resultado({ ok: false, erro: e.message }, true));
        }
      }
      return erro(id, -32602, "Ferramenta desconhecida: " + nome);
    }
    default:
      if (notificacao) return null;
      return erro(id, -32601, "Método não suportado: " + msg.method);
  }
}

export async function onRequest({ request, env, params }) {
  if (!env.MCP_TOKEN || !iguais(String(params.token || ""), env.MCP_TOKEN)) return new Response("Not found", { status: 404 });
  if (request.method === "GET" || request.method === "DELETE") return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
  let corpo;
  try { corpo = await request.json(); } catch { return json(erro(null, -32700, "JSON inválido."), 400); }
  if (Array.isArray(corpo)) {
    const respostas = (await Promise.all(corpo.map((m) => tratar(m, env)))).filter(Boolean);
    return respostas.length ? json(respostas) : new Response(null, { status: 202 });
  }
  const r = await tratar(corpo, env);
  return r ? json(r) : new Response(null, { status: 202 });
}
