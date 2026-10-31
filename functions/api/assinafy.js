// Envia o contrato gerado para assinatura no Assinafy (Cloudflare Pages Function).
//   GET  /api/assinafy?acao=config -> nomes dos signatários fixos (sem dados sensíveis)
//   POST /api/assinafy             -> pdf (arquivo) + dados (JSON) -> cria o pedido de assinatura
// Variáveis do projeto na Cloudflare:
//   ASSINAFY_API_KEY    (secreta)  chave da API
//   ASSINAFY_ACCOUNT_ID            ID da conta (workspace)
//   ASSINAFY_AMBIENTE              "producao" (padrão) ou "sandbox"
//   ASSINAFY_BASE_URL              opcional, só para testes

import cfg from "../../config/assinatura.js";

const PRONTOS = ["metadata_ready", "pending_signature", "pending_identity_review", "certificated"];
const FALHAS = ["failed", "rejected_by_signer", "rejected_by_user", "expired"];

function responder(codigo, dados) {
  return new Response(JSON.stringify(dados), {
    status: codigo,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

function ambiente(env) {
  const configurado = Boolean(env.ASSINAFY_API_KEY && env.ASSINAFY_ACCOUNT_ID);
  const base = (env.ASSINAFY_BASE_URL ||
    (env.ASSINAFY_AMBIENTE === "sandbox" ? "https://sandbox.assinafy.com.br/v1" : "https://api.assinafy.com.br/v1")).replace(/\/$/, "");
  return { configurado, base };
}

const soDigitos = (s) => String(s || "").replace(/\D/g, "");
function whatsE164(s) {
  let d = soDigitos(s);
  if (!d) return null;
  if (d.length <= 11) d = "55" + d;
  return "+" + d;
}
function canal(p) {
  let c = p.canal === "Whatsapp" ? "Whatsapp" : "Email";
  if (c === "Whatsapp" && !whatsE164(p.whatsapp)) c = "Email";
  return c;
}
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

export async function onRequestGet({ env }) {
  const { configurado } = ambiente(env);
  const nomes = (p) => ({ nome: (p && p.nome) || "", canal: (p && p.canal) || "Email" });
  return responder(200, {
    ok: true,
    configurado,
    sejapay: nomes(cfg.sejapay),
    testemunhas: (cfg.testemunhas || []).map(nomes),
  });
}

export async function onRequestPost({ request, env }) {
  const { configurado, base } = ambiente(env);
  if (!configurado) return responder(500, { ok: false, erro: "Cadastre ASSINAFY_API_KEY e ASSINAFY_ACCOUNT_ID nas variáveis do projeto na Cloudflare." });

  // Só aceita envio vindo do próprio site
  const origem = request.headers.get("Origin");
  if (origem && new URL(origem).host !== new URL(request.url).host) return responder(403, { ok: false, erro: "Origem não autorizada." });

  let form;
  try { form = await request.formData(); } catch { return responder(400, { ok: false, erro: "Envio inválido." }); }
  const pdf = form.get("pdf");
  if (!pdf || typeof pdf === "string") return responder(400, { ok: false, erro: "PDF do contrato não recebido." });
  if (pdf.size > 25 * 1024 * 1024) return responder(400, { ok: false, erro: "PDF acima de 25 MB." });
  let dados;
  try { dados = JSON.parse(form.get("dados") || ""); } catch { return responder(400, { ok: false, erro: "Dados do contrato inválidos." }); }

  const acc = encodeURIComponent(env.ASSINAFY_ACCOUNT_ID);

  async function api(metodo, caminho, corpo, multipart) {
    const headers = { "X-Api-Key": env.ASSINAFY_API_KEY, Accept: "application/json" };
    const init = { method: metodo, headers };
    if (corpo !== undefined) {
      if (multipart) init.body = corpo;
      else { headers["Content-Type"] = "application/json"; init.body = JSON.stringify(corpo); }
    }
    let resp;
    try { resp = await fetch(base + caminho, init); }
    catch (e) { throw new Error("Sem conexão com o Assinafy."); }
    const texto = await resp.text();
    let json = null; try { json = JSON.parse(texto); } catch {}
    const status = json && typeof json.status === "number" ? json.status : resp.status;
    if (!resp.ok || status >= 400) {
      const msg = (json && json.message) || "";
      throw new Error(`Assinafy recusou (${resp.status})${msg ? ": " + msg : ""} [${metodo} ${caminho.split("?")[0]}]`);
    }
    return json && Object.prototype.hasOwnProperty.call(json, "data") ? json.data : json;
  }

  async function signatario(p) {
    const email = String(p.email || "").trim().toLowerCase();
    if (email) {
      const lista = await api("GET", `/accounts/${acc}/signers?search=${encodeURIComponent(email)}&per-page=50`);
      const itens = Array.isArray(lista) ? lista : (lista && Array.isArray(lista.data) ? lista.data : []);
      const achou = itens.find((s) => String(s.email || "").toLowerCase() === email);
      if (achou) return achou.id;
    }
    const corpo = { full_name: String(p.nome).trim() };
    if (email) corpo.email = email;
    const w = whatsE164(p.whatsapp);
    if (w) corpo.whatsapp_phone_number = w;
    const cpf = soDigitos(p.cpf);
    if (cpf.length === 11) corpo.government_id = cpf;
    const novo = await api("POST", `/accounts/${acc}/signers`, corpo);
    if (!novo || !novo.id) throw new Error(`Assinafy não devolveu o ID do signatário ${corpo.full_name}.`);
    return novo.id;
  }

  try {
    const cliente = dados.cliente || {};
    if (!cliente.nome) throw new Error("Nome do representante do cliente não informado.");
    if (!cliente.email && !cliente.whatsapp) throw new Error("Informe o e-mail ou o WhatsApp do cliente.");
    const pessoas = [cliente, cfg.sejapay, ...(cfg.testemunhas || []).filter((t) => t && t.nome)];
    for (const p of pessoas) {
      if (!p.email && !p.whatsapp) throw new Error(`Falta e-mail ou WhatsApp de ${p.nome || "um signatário"} em config/assinatura.js.`);
    }

    // 1. Envia o PDF
    let nomeArq = String(dados.arquivo || "Contrato White Label.pdf").replace(/[^\p{L}\p{N} \-_.]/gu, "");
    if (!/\.pdf$/i.test(nomeArq)) nomeArq += ".pdf";
    const fd = new FormData();
    fd.append("file", new File([await pdf.arrayBuffer()], nomeArq, { type: "application/pdf" }));
    const doc = await api("POST", `/accounts/${acc}/documents`, fd, true);
    const docId = doc && doc.id;
    if (!docId) throw new Error("Assinafy não devolveu o ID do documento.");

    // 2. Aguarda o documento ficar pronto
    let status = doc.status || "uploaded";
    for (let i = 0; !PRONTOS.includes(status); i++) {
      if (FALHAS.includes(status)) throw new Error(`O Assinafy não conseguiu processar o PDF (status ${status}).`);
      if (i >= 30) throw new Error("O Assinafy demorou para processar o PDF. O documento ficou salvo lá; envie o pedido pelo painel.");
      await espera(2000);
      const info = await api("GET", `/documents/${encodeURIComponent(docId)}`);
      status = (info && info.status) || status;
    }

    // 3. Signatários
    const refs = [];
    for (const p of pessoas) {
      const c = canal(p);
      refs.push({ id: await signatario(p), verification_method: c, notification_methods: [c] });
    }

    // 4. Pedido de assinatura
    const corpo = { method: "virtual", signers: refs };
    if (cfg.mensagem) corpo.message = cfg.mensagem;
    const dias = Number(cfg.prazoDias || 0);
    if (dias > 0) corpo.expires_at = new Date(Date.now() + dias * 86400000).toISOString().replace(/\.\d{3}Z$/, "Z");
    const pedido = await api("POST", `/documents/${encodeURIComponent(docId)}/assignments`, corpo);

    return responder(200, { ok: true, documento: docId, signatarios: refs.length, pedido: (pedido && pedido.id) || null });
  } catch (e) {
    return responder(502, { ok: false, erro: e.message });
  }
}
