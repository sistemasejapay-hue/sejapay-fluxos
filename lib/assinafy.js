// Envio de contratos para assinatura no Assinafy.
// Usado pela página do site (functions/api/assinafy.js) e pelo conector do Claude (functions/mcp/[token].js).
// Variáveis do projeto na Cloudflare:
//   ASSINAFY_API_KEY    (secreta)  chave da API
//   ASSINAFY_ACCOUNT_ID            ID da conta (workspace)
//   ASSINAFY_AMBIENTE              "producao" (padrão) ou "sandbox"
//   ASSINAFY_BASE_URL              opcional, só para testes

import cfg from "../config/assinatura.js";

const PRONTOS = ["metadata_ready", "pending_signature", "pending_identity_review", "certificated"];
const FALHAS = ["failed", "rejected_by_signer", "rejected_by_user", "expired"];

export function ambiente(env) {
  const configurado = Boolean(env.ASSINAFY_API_KEY && env.ASSINAFY_ACCOUNT_ID);
  const base = (env.ASSINAFY_BASE_URL ||
    (env.ASSINAFY_AMBIENTE === "sandbox" ? "https://sandbox.assinafy.com.br/v1" : "https://api.assinafy.com.br/v1")).replace(/\/$/, "");
  return { configurado, base };
}

export function resumoConfig(env) {
  const nomes = (p) => ({ nome: (p && p.nome) || "", canal: (p && p.canal) || "Email" });
  return {
    configurado: ambiente(env).configurado,
    sejapay: nomes(cfg.sejapay),
    testemunhas: (cfg.testemunhas || []).filter((t) => t && t.nome).map(nomes),
  };
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

/**
 * Envia o PDF e cria o pedido de assinatura.
 * @param env       variáveis da Cloudflare
 * @param pdf       ArrayBuffer ou Uint8Array com o PDF
 * @param arquivo   nome do arquivo
 * @param cliente   { nome, cpf, email, whatsapp, canal }
 * @returns { documento, signatarios, pedido, nomes }
 * Lança Error com mensagem em português em caso de falha.
 */
export async function enviarContrato(env, pdf, arquivo, cliente) {
  const { configurado, base } = ambiente(env);
  if (!configurado) throw new Error("Cadastre ASSINAFY_API_KEY e ASSINAFY_ACCOUNT_ID nas variáveis do projeto na Cloudflare.");
  const bytes = pdf instanceof Uint8Array ? pdf : new Uint8Array(pdf);
  if (!bytes.length) throw new Error("PDF do contrato não recebido.");
  if (bytes.length > 25 * 1024 * 1024) throw new Error("PDF acima de 25 MB.");
  if (String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== "%PDF") throw new Error("O arquivo enviado não é um PDF.");
  cliente = cliente || {};
  if (!cliente.nome) throw new Error("Nome do representante do cliente não informado.");
  if (!cliente.email && !cliente.whatsapp) throw new Error("Informe o e-mail ou o WhatsApp do cliente.");

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

  const pessoas = [cliente, cfg.sejapay, ...(cfg.testemunhas || []).filter((t) => t && t.nome)];
  for (const p of pessoas) {
    if (!p.email && !p.whatsapp) throw new Error(`Falta e-mail ou WhatsApp de ${p.nome || "um signatário"} em config/assinatura.js.`);
  }

  // 1. Envia o PDF
  let nomeArq = String(arquivo || "Contrato White Label.pdf").replace(/[^\p{L}\p{N} \-_.]/gu, "");
  if (!/\.pdf$/i.test(nomeArq)) nomeArq += ".pdf";
  const fd = new FormData();
  fd.append("file", new File([bytes], nomeArq, { type: "application/pdf" }));
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

  return { documento: docId, signatarios: refs.length, pedido: (pedido && pedido.id) || null, nomes: pessoas.map((p) => p.nome) };
}

// ---------- Consulta de status dos contratos ----------
const STATUS_PT = {
  certificated: "Concluído — todos assinaram",
  pending_signature: "Aguardando assinatura",
  pending_identity_review: "Em análise de identidade",
  metadata_ready: "Pronto para enviar",
  uploaded: "Enviando",
  processing: "Processando",
  failed: "Falhou no processamento",
  rejected_by_signer: "Recusado por um signatário",
  rejected_by_user: "Cancelado",
  expired: "Prazo expirado",
};
function assinou(s) {
  if (!s || typeof s !== "object") return false;
  if (s.completed === true || s.signed === true || s.has_signed === true) return true;
  const st = String(s.status || s.signature_status || "").toLowerCase();
  return st === "completed" || st === "signed" || st === "certificated" || st === "done";
}
function nomeSig(s) { return (s && (s.full_name || s.name || s.email)) || "signatário"; }
function resumoDoc(d) {
  d = d || {};
  const a = d.assignment || {};
  const sum = a.summary || {};
  const signers = Array.isArray(a.signers) ? a.signers : (Array.isArray(d.signers) ? d.signers : []);
  const assinaram = signers.filter(assinou).map(nomeSig);
  const faltam = signers.filter((s) => !assinou(s)).map(nomeSig);
  const total = sum.signer_count != null ? sum.signer_count : signers.length;
  const feitos = sum.completed_count != null ? sum.completed_count : assinaram.length;
  return {
    id: d.id || "",
    nome: d.name || "(sem nome)",
    situacao: STATUS_PT[d.status] || d.status || "",
    concluido: d.status === "certificated",
    criado_em: d.created_at || "",
    atualizado_em: d.updated_at || "",
    assinado_em: (d.status === "certificated") ? (d.updated_at || d.created_at || "") : "",
    assinaturas: feitos + "/" + total,
    quem_assinou: assinaram,
    quem_falta: faltam,
  };
}

// Lista os contratos recentes (ou um documento específico) com o status de cada assinatura.
export async function statusContratos(env, opts) {
  const { configurado, base } = ambiente(env);
  if (!configurado) throw new Error("Cadastre ASSINAFY_API_KEY e ASSINAFY_ACCOUNT_ID nas variáveis do projeto na Cloudflare.");
  opts = opts || {};
  const acc = encodeURIComponent(env.ASSINAFY_ACCOUNT_ID);

  async function get(caminho) {
    let resp;
    try { resp = await fetch(base + caminho, { headers: { "X-Api-Key": env.ASSINAFY_API_KEY, Accept: "application/json" } }); }
    catch (e) { throw new Error("Sem conexão com o Assinafy."); }
    const texto = await resp.text();
    let j = null; try { j = JSON.parse(texto); } catch {}
    if (!resp.ok) { const msg = (j && j.message) || ""; throw new Error(`Assinafy recusou (${resp.status})${msg ? ": " + msg : ""} [GET ${caminho.split("?")[0]}]`); }
    return j && Object.prototype.hasOwnProperty.call(j, "data") ? j.data : j;
  }

  if (opts.documento_id) {
    const d = await get(`/documents/${encodeURIComponent(String(opts.documento_id))}`);
    return { contrato: resumoDoc(d) };
  }

  const n = Math.min(Math.max(Number(opts.quantidade) || 10, 1), 50);
  const lista = await get(`/accounts/${acc}/documents?sort=-created_at&per-page=${n}`);
  const docs = Array.isArray(lista) ? lista : (lista && Array.isArray(lista.data) ? lista.data : []);
  const out = [];
  for (const d of docs.slice(0, n)) {
    if (d && !d.assignment && d.id) {
      try { out.push(resumoDoc(await get(`/documents/${encodeURIComponent(d.id)}`))); continue; } catch (e) { /* usa o resumo simples */ }
    }
    out.push(resumoDoc(d));
  }
  return { total: out.length, contratos: out };
}

// Baixa um artefato do documento no Assinafy (ex.: "certificated" = PDF assinado final).
// Devolve os bytes para o servidor repassar ao navegador (a chave da API nunca vai ao cliente).
export async function baixarArtefato(env, id, tipo) {
  const { configurado, base } = ambiente(env);
  if (!configurado) throw new Error("Cadastre ASSINAFY_API_KEY e ASSINAFY_ACCOUNT_ID nas variáveis do projeto na Cloudflare.");
  if (!id) throw new Error("Documento não informado.");
  tipo = String(tipo || "certificated").replace(/[^a-z-]/gi, "") || "certificated";
  const url = `${base}/documents/${encodeURIComponent(String(id))}/download/${tipo}`;
  let resp;
  try { resp = await fetch(url, { headers: { "X-Api-Key": env.ASSINAFY_API_KEY, Accept: "*/*" } }); }
  catch (e) { throw new Error("Sem conexão com o Assinafy."); }
  if (!resp.ok) {
    let msg = ""; try { const j = await resp.json(); msg = (j && j.message) || ""; } catch (e) {}
    throw new Error(`Assinafy recusou o download (${resp.status})${msg ? ": " + msg : ""}.`);
  }
  const ct = resp.headers.get("Content-Type") || "application/pdf";
  const bytes = new Uint8Array(await resp.arrayBuffer());
  if (!bytes.length) throw new Error("O Assinafy devolveu um arquivo vazio.");
  return { bytes, contentType: ct };
}
