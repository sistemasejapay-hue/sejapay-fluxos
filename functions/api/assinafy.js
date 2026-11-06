// Envia o contrato gerado para assinatura no Assinafy (versão do site, usada pela página publicada na Cloudflare).
//   GET  /api/assinafy?acao=config    -> nomes dos signatários fixos (sem dados sensíveis)
//   GET  /api/assinafy?acao=assinados  -> contratos em que todos já assinaram (com data de assinatura)
//   GET  /api/assinafy?acao=status     -> todos os contratos recentes com o status de assinatura
//   POST /api/assinafy                 -> pdf (arquivo) + dados (JSON) -> cria o pedido de assinatura
// A lógica fica em lib/assinafy.js.

import { resumoConfig, enviarContrato, statusContratos, baixarArtefato, salvarDocumento } from "../../lib/assinafy.js";

function responder(codigo, dados) {
  return new Response(JSON.stringify(dados), {
    status: codigo,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

export async function onRequestGet({ request, env }) {
  const u = new URL(request.url);
  const acao = u.searchParams.get("acao") || "config";
  if (acao === "pdf") {
    try {
      const r = await baixarArtefato(env, u.searchParams.get("id"), u.searchParams.get("tipo") || "certificated");
      const nome = (u.searchParams.get("nome") || "Contrato assinado").replace(/[^\p{L}\p{N} \-_.]/gu, "").slice(0, 80) || "Contrato assinado";
      return new Response(r.bytes, {
        status: 200,
        headers: {
          "Content-Type": r.contentType.includes("pdf") ? r.contentType : "application/pdf",
          "Content-Disposition": `attachment; filename="${nome}.pdf"`,
          "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
        },
      });
    } catch (e) {
      return responder(502, { ok: false, erro: e.message });
    }
  }
  if (acao === "assinados" || acao === "status") {
    try {
      const tipo = (u.searchParams.get("tipo") || "").toLowerCase();
      const r = await statusContratos(env, { quantidade: 100 });
      let contratos = r.contratos || [];
      if (acao === "assinados") contratos = contratos.filter((c) => c.concluido);
      if (tipo === "white-label") contratos = contratos.filter((c) => /white\s*label/i.test(c.nome || ""));
      else if (tipo === "licenciado") contratos = contratos.filter((c) => /licenciado/i.test(c.nome || ""));
      return responder(200, { ok: true, total: contratos.length, contratos });
    } catch (e) {
      return responder(502, { ok: false, erro: e.message });
    }
  }
  return responder(200, Object.assign({ ok: true }, resumoConfig(env)));
}

export async function onRequestPost({ request, env }) {
  // Só aceita envio vindo do próprio site
  const origem = request.headers.get("Origin");
  if (origem && new URL(origem).host !== new URL(request.url).host) return responder(403, { ok: false, erro: "Origem não autorizada." });
  const acao = new URL(request.url).searchParams.get("acao") || "";

  let form;
  try { form = await request.formData(); } catch { return responder(400, { ok: false, erro: "Envio inválido." }); }
  const pdf = form.get("pdf");
  if (!pdf || typeof pdf === "string") return responder(400, { ok: false, erro: "PDF do contrato não recebido." });
  let dados;
  try { dados = JSON.parse(form.get("dados") || "{}"); } catch { return responder(400, { ok: false, erro: "Dados do contrato inválidos." }); }

  // Salvar no histórico: arquiva o PDF no Assinafy, sem pedir assinatura.
  if (acao === "salvar") {
    try {
      const r = await salvarDocumento(env, await pdf.arrayBuffer(), dados.arquivo);
      return responder(200, { ok: true, salvo: true, documento: r.documento });
    } catch (e) {
      return responder(502, { ok: false, erro: e.message });
    }
  }

  try {
    const r = await enviarContrato(env, await pdf.arrayBuffer(), dados.arquivo, dados.cliente);
    return responder(200, { ok: true, documento: r.documento, signatarios: r.signatarios, pedido: r.pedido });
  } catch (e) {
    return responder(502, { ok: false, erro: e.message });
  }
}
