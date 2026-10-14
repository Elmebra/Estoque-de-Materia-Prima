/* Estoque de Matéria-Prima — PWA (mesmas telas do app Android) */
(function () {
  'use strict';

  var CFG = window.CONFIG || {};
  var CACHE_KEY = 'estoque_inicial_v1';

  // ------------------------------------------------------------
  // Utilidades
  // ------------------------------------------------------------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function hojeIso() {
    var d = new Date();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var dd = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + dd;
  }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }
  function somaDosLotes(qtds) {
    var t = 0;
    qtds.forEach(function (q) {
      var n = parseFloat(String(q).replace('kg', '').trim().replace(/\./g, '').replace(',', '.'));
      if (!isNaN(n)) t += n;
    });
    return t.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' kg';
  }
  function cores(label) {
    var l = String(label).toLowerCase();
    if (l.indexOf('aço sae') >= 0) return { head: '#3E535E', acc: '#56707D' };
    if (l.indexOf('latão') >= 0) return { head: '#7A5225', acc: '#A9743B' };
    if (l.indexOf('inox') >= 0) return { head: '#48505A', acc: '#7C8791' };
    return { head: '#132743', acc: '#1565C0' };
  }

  var ICON = {
    back: '<svg viewBox="0 0 24 24"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>',
    refresh: '<svg viewBox="0 0 24 24"><path d="M17.65 6.35A7.958 7.958 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A5.99 5.99 0 0 1 12 18a6 6 0 1 1 0-12c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>',
    history: '<svg viewBox="0 0 24 24"><path d="M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.954 8.954 0 0 0 13 21a9 9 0 0 0 0-18zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z"/></svg>',
    inventory: '<svg viewBox="0 0 24 24"><path d="M20 2H4c-1 0-2 .9-2 2v3.01c0 .72.43 1.34 1 1.69V20c0 1.1 1.1 2 2 2h14c.9 0 2-.9 2-2V8.7c.57-.35 1-.97 1-1.69V4c0-1.1-1-2-2-2zm-5 12H9v-2h6v2zm5-7H4V4h16v3z"/></svg>',
    science: '<svg viewBox="0 0 24 24" style="fill:#FF8A80"><path d="M19.8 18.4L14 10.67V6.5l1.35-1.69c.26-.33.03-.81-.39-.81H9.04c-.42 0-.65.48-.39.81L10 6.5v4.17L4.2 18.4c-.49.66-.02 1.6.8 1.6h14c.82 0 1.29-.94.8-1.6z"/></svg>',
    expand: '<svg viewBox="0 0 24 24"><path d="M16.59 8.59 12 13.17 7.41 8.59 6 10l6 6 6-6z"/></svg>'
  };

  // ------------------------------------------------------------
  // Rede (Apps Script) — cache, retry e IDs idempotentes
  // ------------------------------------------------------------
  var D = {
    catalogo: null, estoque: [], amostras: [],
    atualizando: false, erroConexao: null, saidasCache: {}
  };

  try {
    var salvo = localStorage.getItem(CACHE_KEY);
    if (salvo) aplicar(JSON.parse(salvo));
  } catch (e) {}

  function aplicar(json) {
    D.catalogo = json.catalogo || null;
    D.estoque = (json.estoque && json.estoque.materiais) || [];
    D.amostras = (json.amostras && json.amostras.materiais) || [];
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  async function comRetry(n, fn) {
    var ultimo;
    for (var i = 0; i < n; i++) {
      try { return await fn(); } catch (e) {
        ultimo = e;
        if (i < n - 1) await sleep(700 * (i + 1));
      }
    }
    throw ultimo || new Error('falha de rede');
  }

  async function chamar(url, opts) {
    var ctrl = new AbortController();
    var t = setTimeout(function () { ctrl.abort(); }, 30000);
    try {
      var r = await fetch(url, Object.assign({ signal: ctrl.signal, redirect: 'follow' }, opts || {}));
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } finally { clearTimeout(t); }
  }

  function apiGet(action, params) {
    var url = CFG.BASE_URL + '?action=' + encodeURIComponent(action) + '&key=' + encodeURIComponent(CFG.API_KEY);
    Object.keys(params || {}).forEach(function (k) { url += '&' + k + '=' + encodeURIComponent(params[k]); });
    return chamar(url);
  }
  function apiPost(body) {
    body.key = CFG.API_KEY;
    // text/plain evita o "preflight" CORS, que o Apps Script não aceita
    return chamar(CFG.BASE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    });
  }

  function configurado() { return CFG.BASE_URL && CFG.BASE_URL.indexOf('SEU_ID_AQUI') < 0; }

  async function atualizar() {
    if (D.atualizando) return;
    if (!configurado()) {
      D.erroConexao = 'Configure a URL do Apps Script no arquivo config.js.';
      renderSeguro();
      return;
    }
    D.atualizando = true; renderSeguro();
    try {
      var json = await comRetry(3, function () { return apiGet('inicial'); });
      if (json.status !== 'ok') throw new Error(json.message || 'erro');
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(json)); } catch (e) {}
      aplicar(json);
      D.erroConexao = null;
    } catch (e) {
      D.erroConexao = D.catalogo == null
        ? 'Não foi possível carregar os dados. Verifique a internet e a URL do Apps Script (config.js).'
        : 'Sem conexão com a planilha — mostrando os últimos dados salvos.';
    } finally {
      D.atualizando = false; renderSeguro();
    }
  }

  async function buscarSaidas(diametroId) {
    var json = await comRetry(2, function () { return apiGet('saidas', { diametro: diametroId }); });
    if (json.status !== 'ok') throw new Error(json.message || 'erro');
    D.saidasCache[diametroId] = json.lancamentos || [];
    return D.saidasCache[diametroId];
  }

  async function enviar(body) {
    try {
      var resp = await comRetry(2, function () { return apiPost(body); });
      if (resp.status === 'ok') return { ok: true };
      return { ok: false, mensagem: resp.message || 'Erro ao salvar.' };
    } catch (e) {
      return { ok: false, mensagem: 'Sem conexão com a planilha. Tente novamente.' };
    }
  }

  // ------------------------------------------------------------
  // Estado de cada tela (mantido enquanto o app está aberto)
  // ------------------------------------------------------------
  function novoReg() {
    return {
      operacao: '', material: '', diametro: '', data: hojeIso(), lote: '', quantidade: '',
      maquina: '', fornecedor: '', responsavel: '', salvando: false, salvo: false, erro: null,
      idPendente: null, novoFornAberto: false, novoFornTexto: '', fornExtras: {}
    };
  }
  var R = novoReg();
  var S = { material: '', diametro: '', lanc: [], carregando: false, erro: false };
  var A = {
    formAberto: true, tipo: '', material: '', diametro: '', fornecedor: '', data: hojeIso(), maquina: '',
    lote: '', quantidade: '', finalidade: '', responsavel: '', salvando: false, salvo: false, erro: null,
    idPendente: null, novoFornAberto: false, novoFornTexto: '', fornExtras: {}
  };
  var instalarFechado = false;
  try { instalarFechado = localStorage.getItem('instalar_fechado') === '1'; } catch (e) {}

  // ------------------------------------------------------------
  // Componentes
  // ------------------------------------------------------------
  function select(id, label, valor, opcoes, placeholder, desabilitado) {
    var h = '<div class="field"><label for="' + id + '">' + esc(label) + '</label>';
    h += '<select id="' + id + '" data-f="' + id + '"' + (desabilitado ? ' disabled' : '') +
      (valor ? '' : ' class="empty"') + '>';
    h += '<option value=""' + (valor ? '' : ' selected') + ' disabled>' + esc(placeholder) + '</option>';
    opcoes.forEach(function (o) {
      h += '<option value="' + esc(o[0]) + '"' + (o[0] === valor ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
    });
    return h + '</select></div>';
  }
  function campo(id, label, valor, extra) {
    extra = extra || {};
    return '<div class="field"><label for="' + id + '">' + esc(label) + '</label>' +
      '<input id="' + id + '" data-f="' + id + '" type="' + (extra.type || 'text') + '" value="' + esc(valor) + '"' +
      (extra.placeholder ? ' placeholder="' + esc(extra.placeholder) + '"' : '') +
      (extra.inputmode ? ' inputmode="' + extra.inputmode + '"' : '') +
      ' autocomplete="off"></div>';
  }
  function header(titulo, sub, o) {
    o = o || {};
    var h = '<div class="header' + (o.am ? ' am' : '') + '"><div class="wrap' + (o.wide ? ' wide' : '') + '">' +
      '<div class="header-row">';
    if (o.back) h += '<button class="icon-btn" data-act="voltar" aria-label="Voltar">' + ICON.back + '</button>';
    h += '<h1 class="title">' + esc(titulo) + '</h1>';
    (o.acoes || []).forEach(function (a) {
      h += '<button class="icon-btn" data-act="' + a[0] + '" aria-label="' + esc(a[2]) + '">' + a[1] + '</button>';
    });
    h += '</div><div class="sub' + (o.back ? ' indent' : '') + '">' + esc(sub) + '</div></div></div>';
    return h;
  }
  function barras(am) {
    var h = '';
    if (!navigator.onLine) h += '<div class="offline">Sem internet — mostrando os últimos dados salvos</div>';
    h += D.atualizando ? '<div class="progress' + (am ? ' am' : '') + '"></div>' : '<div class="progress-space"></div>';
    return h;
  }
  function erroConexao(am) {
    if (!D.erroConexao) return '';
    return '<div class="conn-error"><div class="wrap" style="display:flex;align-items:center;gap:8px"><span>' + esc(D.erroConexao) +
      '</span><button class="link-btn' + (am ? ' am' : '') + '" data-act="atualizar">Tentar de novo</button></div></div>';
  }
  function marca() {
    return '<div class="brand"><img src="icons/logo-azul.png" alt="Elmebra"><span>Elmebra · desde 1954</span></div>';
  }
  function novoFornecedorUI(st, am) {
    if (!st.material) return '';
    if (!st.novoFornAberto) {
      return '<div><button class="link-btn' + (am ? ' am' : '') + '" data-act="novoForn">+ Adicionar novo fornecedor</button></div>';
    }
    return '<div class="row-add"><input id="novoFornTexto" data-f="novoFornTexto" placeholder="Nome do novo fornecedor" value="' +
      esc(st.novoFornTexto) + '" autocomplete="off"><button class="btn small' + (am ? ' am' : '') + '" data-act="addForn">Adicionar</button></div>';
  }
  function fornecedoresDe(st) {
    var base = (D.catalogo && D.catalogo.fornecedoresPorMaterial && D.catalogo.fornecedoresPorMaterial[st.material]) || [];
    var todos = base.concat(st.fornExtras[st.material] || []);
    return todos.filter(function (v, i) { return todos.indexOf(v) === i; }).map(function (v) { return [v, v]; });
  }
  function materiaisOpts() { return D.catalogo ? D.catalogo.materiais.map(function (m) { return [m.key, m.label]; }) : []; }
  function diametrosOpts(key) {
    var m = D.catalogo && D.catalogo.materiais.filter(function (x) { return x.key === key; })[0];
    return m ? m.diametros.map(function (d) { return [d.id, d.label]; }) : [];
  }
  function maquinasOpts() { return D.catalogo ? D.catalogo.maquinas.map(function (m) { return [m, 'Máquina ' + m]; }) : []; }
  function responsaveisOpts() {
    return D.catalogo ? D.catalogo.responsaveis.map(function (r) { return [r.nome, r.nome + ' (' + r.funcao + ')']; }) : [];
  }

  // ------------------------------------------------------------
  // Tela: Registro
  // ------------------------------------------------------------
  function lotesEstoque() {
    var achou = null;
    D.estoque.forEach(function (m) { m.diametros.forEach(function (d) { if (d.id === R.diametro) achou = d; }); });
    return achou ? achou.lotes : [];
  }
  function registroValido() {
    var base = R.operacao && R.material && R.diametro && R.data && R.lote.trim() && R.quantidade.trim() && R.responsavel;
    var extra = R.operacao === 'entrada' ? !!R.fornecedor : R.operacao === 'saida' ? !!R.maquina : true;
    return !!(base && extra);
  }
  function acaoRegistro() {
    var ok = registroValido();
    var h = '';
    if (R.erro) h += '<div class="msg-err">' + esc(R.erro) + '</div>';
    if (!ok) h += '<div class="msg-hint">Preencha todos os campos obrigatórios para habilitar o registro.</div>';
    h += '<button class="btn main" data-act="salvarReg"' + (ok && !R.salvando ? '' : ' disabled') + '>' +
      (R.salvando ? '<span class="spinner"></span>' : 'Salvar registro') + '</button>';
    return h;
  }
  function telaRegistro() {
    var pre = R.operacao === 'saida' || R.operacao === 'devolucao';
    var lotes = pre && R.diametro ? lotesEstoque() : [];
    var loteOpts = lotes.map(function (l) { return [l.lote, l.lote + ' — ' + l.quantidade + ' em estoque']; });
    var h = '<div class="screen">' +
      header('Registro de matéria-prima', 'Entradas, saídas e devoluções de barras', {
        acoes: [['hist', ICON.history, 'Ver histórico de saídas'], ['estoque', ICON.inventory, 'Ver estoque geral'],
          ['amostras', ICON.science, 'Ver estoque de amostras']]
      }) + barras(false);
    if (R.salvo) h += '<div class="success"><div class="wrap">Registro salvo na planilha de controle.</div></div>';
    h += erroConexao(false);
    h += '<div class="scroll"><div class="wrap stack">';
    if (mostrarDicaInstalar()) {
      h += '<div class="install"><p>Para instalar no iPhone: toque em <b>Compartilhar</b> (quadrado com seta) e depois em <b>Adicionar à Tela de Início</b>.</p>' +
        '<button data-act="fecharInstalar" aria-label="Fechar">×</button></div>';
    }
    h += select('r_operacao', 'Tipo de operação', R.operacao,
      [['entrada', 'Entrada'], ['saida', 'Saída'], ['devolucao', 'Devolução']], 'Selecione a operação');
    h += select('r_material', 'Material', R.material, materiaisOpts(), 'Selecione o material');
    h += select('r_diametro', 'Diâmetro da barra', R.diametro, diametrosOpts(R.material),
      R.material ? 'Selecione o diâmetro' : 'Selecione o material primeiro', !R.material);
    if (R.operacao === 'entrada') {
      h += '<div class="stack" style="gap:8px">' +
        select('r_fornecedor', 'Fornecedor', R.fornecedor, fornecedoresDe(R), 'Selecione o fornecedor', !R.material) +
        novoFornecedorUI(R, false) + '</div>';
    }
    h += campo('r_data', 'Data', R.data, { type: 'date' });
    if (pre) {
      h += select('r_lote', 'Lote', R.lote, loteOpts,
        !R.diametro ? 'Selecione o diâmetro primeiro' : loteOpts.length ? 'Selecione o lote em estoque' : 'Nenhum lote em estoque',
        !R.diametro || !loteOpts.length);
    } else {
      h += campo('r_lote', 'Lote', R.lote, { placeholder: 'Ex.: 438/26' });
    }
    var dica = { entrada: 'Novo lote criado para identificar o material no estoque.',
      saida: 'Lote em estoque disponibilizado para a máquina.', devolucao: 'Lote em estoque devolvido ao fornecedor.' }[R.operacao];
    if (dica) h += '<div class="hint">' + dica + '</div>';
    h += campo('r_quantidade', 'Quantidade (kg)', R.quantidade, { placeholder: '0,00', inputmode: 'decimal' });
    if (R.operacao === 'saida') h += select('r_maquina', 'Máquina de destino', R.maquina, maquinasOpts(), 'Selecione a máquina');
    h += select('r_responsavel', 'Responsável pela operação', R.responsavel, responsaveisOpts(), 'Selecione quem realizou');
    h += marca() + '</div></div>';
    h += '<div class="footer"><div class="wrap" id="acao">' + acaoRegistro() + '</div></div></div>';
    return h;
  }
  function mostrarDicaInstalar() {
    var ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    var standalone = window.navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
    return ios && !standalone && !instalarFechado;
  }

  // ------------------------------------------------------------
  // Tela: Estoque
  // ------------------------------------------------------------
  function telaEstoque() {
    var h = '<div class="screen">' +
      header('Estoque de matéria-prima', 'Visão geral por material, diâmetro e lote', {
        back: true, wide: true, acoes: [['atualizar', ICON.refresh, 'Atualizar']]
      }) + barras(false) + erroConexao(false);
    h += '<div class="scroll"><div class="wrap wide"><div class="estoque-grid">';
    D.estoque.forEach(function (mat) {
      var c = cores(mat.label);
      h += '<div class="card"><div class="mat-head" style="background:' + c.head + '">' + esc(mat.label) + '</div>';
      mat.diametros.forEach(function (d) {
        h += '<div class="dia"><div class="dia-top"><span class="dia-label">' + esc(d.label) + '</span>';
        if (d.lotes.length) h += '<span class="dia-total" style="color:' + c.head + '">Total: ' +
          somaDosLotes(d.lotes.map(function (l) { return l.quantidade; })) + '</span>';
        h += '</div>';
        if (!d.lotes.length) h += '<div class="empty-lote">Sem lote em estoque</div>';
        d.lotes.forEach(function (l) {
          h += '<div class="lote"><div class="lote-l"><span class="chip" style="background:' + c.acc + '29;color:' + c.head + '">' +
            esc(l.lote) + '</span><span class="forn">' + esc(l.fornecedor) + '</span></div><span class="qtd">' + esc(l.quantidade) + '</span></div>';
        });
        h += '</div>';
      });
      h += '</div>';
    });
    if (!D.estoque.length && !D.atualizando) h += '<div class="info" style="margin:0 20px">Nenhum dado carregado ainda.</div>';
    h += '</div>' + marca() + '</div></div></div>';
    return h;
  }

  // ------------------------------------------------------------
  // Tela: Saídas
  // ------------------------------------------------------------
  function telaSaidas() {
    var h = '<div class="screen">' +
      header('Lançamentos de saída', 'Filtre por material e diâmetro para ver o histórico', { back: true }) +
      (S.carregando || D.atualizando ? '<div class="progress"></div>' : '<div class="progress-space"></div>') + erroConexao(false);
    h += '<div class="scroll"><div class="wrap stack">';
    h += select('s_material', 'Material', S.material, materiaisOpts(), 'Selecione o material');
    h += select('s_diametro', 'Diâmetro da barra', S.diametro, diametrosOpts(S.material),
      S.material ? 'Selecione o diâmetro' : 'Selecione o material primeiro', !S.material);
    if (!S.diametro) {
      h += '<div class="info">Selecione o material e o diâmetro para ver os lançamentos de saída.</div>';
    } else if (S.erro) {
      h += '<div class="msg-err" style="text-align:left">Não foi possível carregar os lançamentos. Verifique a conexão e escolha o diâmetro de novo.</div>';
    } else if (S.carregando) {
      // barra de progresso já aparece no topo
    } else if (!S.lanc.length) {
      h += '<div class="info italic">Nenhuma saída registrada para este diâmetro.</div>';
    } else {
      h += '<div class="list-head"><span>Saídas registradas</span><span>' + S.lanc.length + (S.lanc.length === 1 ? ' lançamento' : ' lançamentos') + '</span></div>';
      S.lanc.forEach(function (it) {
        h += '<div class="item"><div class="r"><b>Lote ' + esc(it.lote) + '</b><b>' + esc(it.quantidade) + '</b></div>' +
          '<div class="r"><small>' + esc(it.data) + ' · Máquina ' + esc(it.maquina) + '</small><small>' + esc(it.responsavel) + '</small></div></div>';
      });
    }
    h += marca() + '</div></div></div>';
    return h;
  }
  async function carregarSaidas() {
    S.erro = false;
    var id = S.diametro;
    if (!id) { S.lanc = []; S.carregando = false; renderSeguro(); return; }
    var cache = D.saidasCache[id];
    if (cache) { S.lanc = cache; S.carregando = false; } else { S.lanc = []; S.carregando = true; }
    renderSeguro();
    try {
      var lista = await buscarSaidas(id);
      if (S.diametro === id) S.lanc = lista;
    } catch (e) {
      if (!cache && S.diametro === id) S.erro = true;
    }
    if (S.diametro === id) { S.carregando = false; renderSeguro(); }
  }

  // ------------------------------------------------------------
  // Tela: Amostras
  // ------------------------------------------------------------
  function amostraValida() {
    var consumo = A.tipo === 'consumo';
    return !!(A.tipo && A.material && A.diametro && A.data && A.lote.trim() && A.quantidade.trim() &&
      A.finalidade.trim() && A.responsavel && (consumo ? A.maquina : A.fornecedor));
  }
  function acaoAmostra() {
    var ok = amostraValida();
    var h = '';
    if (A.erro) h += '<div class="msg-err">' + esc(A.erro) + '</div>';
    if (!ok) h += '<div class="msg-hint">Preencha todos os campos para habilitar o registro.</div>';
    h += '<button class="btn main am" data-act="salvarAm"' + (ok && !A.salvando ? '' : ' disabled') + '>' +
      (A.salvando ? '<span class="spinner"></span>' : 'Registrar amostra') + '</button>';
    return h;
  }
  function telaAmostras() {
    var consumo = A.tipo === 'consumo';
    var loteOpts = [];
    if (consumo && A.diametro) {
      D.amostras.forEach(function (m) {
        m.itens.forEach(function (it) {
          if (it.diametroId === A.diametro) loteOpts.push([it.lote, it.lote + ' — ' + it.quantidade + ' em estoque']);
        });
      });
    }
    var total = D.amostras.reduce(function (s, m) { return s + m.itens.length; }, 0);
    var h = '<div class="screen">' +
      header('Controle de amostras', 'Entradas e consumo de material de amostra', { back: true, am: true }) +
      '<div class="banner-am"><div class="wrap">AMOSTRAS — SEPARADO DO ESTOQUE DE PRODUÇÃO</div></div>' + barras(true);
    if (A.salvo) h += '<div class="success"><div class="wrap">Amostra registrada na planilha de controle.</div></div>';
    h += erroConexao(true);
    h += '<div class="scroll"><div class="wrap stack">';
    h += '<div class="am-box"><button class="am-box-head' + (A.formAberto ? ' open' : '') + '" data-act="toggleForm">' +
      '<span>+ Registrar amostra</span>' + ICON.expand + '</button>';
    if (A.formAberto) {
      h += '<div class="am-box-body">';
      h += select('a_tipo', 'Tipo', A.tipo, [['entrada', 'Entrada de amostra'], ['consumo', 'Consumo / uso de amostra']], 'Selecione o tipo');
      h += select('a_material', 'Material', A.material, materiaisOpts(), 'Selecione o material');
      h += select('a_diametro', 'Diâmetro da barra', A.diametro, diametrosOpts(A.material),
        A.material ? 'Selecione o diâmetro' : 'Selecione o material primeiro', !A.material);
      if (!consumo) {
        h += '<div class="stack" style="gap:8px">' +
          select('a_fornecedor', 'Fornecedor', A.fornecedor, fornecedoresDe(A), 'Selecione o fornecedor', !A.material) +
          novoFornecedorUI(A, true) + '</div>';
        h += campo('a_data', 'Data', A.data, { type: 'date' });
        h += campo('a_lote', 'Lote', A.lote, { placeholder: 'Ex.: 44726' });
      } else {
        h += campo('a_data', 'Data', A.data, { type: 'date' });
        h += select('a_lote', 'Lote', A.lote, loteOpts,
          !A.diametro ? 'Selecione o diâmetro primeiro' : loteOpts.length ? 'Selecione o lote' : 'Nenhuma amostra deste diâmetro em estoque',
          !A.diametro || !loteOpts.length);
      }
      h += campo('a_quantidade', 'Quantidade (kg)', A.quantidade, { placeholder: '0,00', inputmode: 'decimal' });
      if (consumo) h += select('a_maquina', 'Máquina de destino', A.maquina, maquinasOpts(), 'Selecione a máquina');
      h += campo('a_finalidade', consumo ? 'Finalidade do uso' : 'Finalidade da amostra', A.finalidade,
        { placeholder: 'Ex.: Amostra para cliente, ensaio, análise...' });
      h += select('a_responsavel', 'Responsável', A.responsavel, responsaveisOpts(), 'Selecione quem realizou');
      h += '<div class="stack" style="gap:8px" id="acao">' + acaoAmostra() + '</div></div>';
    }
    h += '</div>';
    h += '<div class="list-head"><span>Amostras em estoque</span><span>' + total + (total === 1 ? ' amostra' : ' amostras') + '</span></div>';
    if (!D.amostras.length) h += '<div class="info am">Nenhuma amostra em estoque no momento.</div>';
    D.amostras.forEach(function (m) {
      h += '<div class="card bordered"><div class="am-head">' + esc(m.label) + '</div>';
      m.itens.forEach(function (it) {
        h += '<div class="item-in"><div class="lote"><div class="lote-l"><span class="chip am">' + esc(it.lote) +
          '</span><b style="font-size:12.5px">' + esc(it.diametroLabel) + '</b></div><span class="qtd">' + esc(it.quantidade) + '</span></div>' +
          '<span class="forn">' + esc(it.fornecedor) + ' · ' + esc(it.finalidade) + '</span></div>';
      });
      h += '</div>';
    });
    h += marca() + '</div></div></div>';
    return h;
  }

  // ------------------------------------------------------------
  // Render + eventos
  // ------------------------------------------------------------
  var app = document.getElementById('app');
  var rotaAtual = null;
  var renderPendente = false;

  function rota() {
    var h = (location.hash || '#/').replace('#/', '');
    return ['estoque', 'saidas', 'amostras'].indexOf(h) >= 0 ? h : 'registro';
  }

  function render() {
    var r = rota();
    var mudou = r !== rotaAtual;
    var a = document.activeElement;
    var foco = a && a.id ? { id: a.id, ini: a.selectionStart, fim: a.selectionEnd } : null;
    var sc = app.querySelector('.scroll');
    var topo = sc && !mudou ? sc.scrollTop : 0;
    app.innerHTML = r === 'estoque' ? telaEstoque() : r === 'saidas' ? telaSaidas() : r === 'amostras' ? telaAmostras() : telaRegistro();
    var novoSc = app.querySelector('.scroll');
    if (novoSc) novoSc.scrollTop = topo;
    if (foco && !mudou) {
      var el = document.getElementById(foco.id);
      if (el && el.tagName === 'INPUT') {
        try { el.focus({ preventScroll: true }); if (foco.ini != null && el.type === 'text') el.setSelectionRange(foco.ini, foco.fim); } catch (e) {}
      }
    }
    rotaAtual = r;
  }
  // Não derruba o teclado: se o usuário está digitando, adia a atualização visual
  function renderSeguro() {
    var a = document.activeElement;
    if (a && a.tagName === 'INPUT' && a.type !== 'date') { renderPendente = true; return; }
    renderPendente = false;
    render();
  }
  document.addEventListener('focusout', function () {
    if (renderPendente) setTimeout(function () { if (renderPendente) renderSeguro(); }, 150);
  });

  function estadoDe(id) { return id.charAt(0) === 'r' ? R : id.charAt(0) === 'a' ? A : S; }
  function chave(id) { return id.replace(/^[ras]_/, ''); }

  function atualizarAcao() {
    var el = document.getElementById('acao');
    if (!el) return;
    el.innerHTML = rota() === 'amostras' ? acaoAmostra() : acaoRegistro();
  }

  app.addEventListener('input', function (e) {
    var id = e.target.id;
    if (!id) return;
    if (id === 'novoFornTexto') { (rota() === 'amostras' ? A : R).novoFornTexto = e.target.value; return; }
    if (e.target.tagName === 'SELECT') return;
    var st = estadoDe(id);
    st[chave(id)] = e.target.value;
    if (e.target.type === 'date') { atualizarAcao(); return; }
    atualizarAcao();
  });

  app.addEventListener('change', function (e) {
    var id = e.target.id;
    if (!id || e.target.tagName !== 'SELECT') return;
    var st = estadoDe(id), k = chave(id), v = e.target.value;
    st[k] = v;
    if (st === R) {
      if (k === 'operacao') { R.lote = ''; R.maquina = ''; R.fornecedor = ''; R.novoFornAberto = false; }
      if (k === 'material') { R.diametro = ''; R.lote = ''; R.fornecedor = ''; R.novoFornAberto = false; }
      if (k === 'diametro') { R.lote = ''; }
    } else if (st === A) {
      if (k === 'tipo') { A.lote = ''; A.fornecedor = ''; A.maquina = ''; A.novoFornAberto = false; }
      if (k === 'material') { A.diametro = ''; A.lote = ''; A.fornecedor = ''; A.novoFornAberto = false; }
      if (k === 'diametro') { A.lote = ''; }
    } else {
      if (k === 'material') S.diametro = '';
      render();
      if (k === 'diametro' || k === 'material') carregarSaidas();
      return;
    }
    render();
  });

  function adicionarFornecedor(st, am) {
    var nome = (st.novoFornTexto || '').trim();
    if (!nome) return;
    var atual = st.fornExtras[st.material] || [];
    st.fornExtras[st.material] = atual.concat(nome);
    st.fornecedor = nome; st.novoFornAberto = false; st.novoFornTexto = '';
    var mat = st.material;
    comRetry(2, function () { return apiPost({ acao: 'novoFornecedor', material: mat, nome: nome }); })
      .then(function () { setTimeout(atualizar, 300); }).catch(function () {});
    render();
  }

  app.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]');
    if (!b) return;
    var act = b.getAttribute('data-act');
    if (act === 'voltar') { location.hash = '#/'; }
    else if (act === 'hist') location.hash = '#/saidas';
    else if (act === 'estoque') location.hash = '#/estoque';
    else if (act === 'amostras') location.hash = '#/amostras';
    else if (act === 'atualizar') atualizar();
    else if (act === 'fecharInstalar') { instalarFechado = true; try { localStorage.setItem('instalar_fechado', '1'); } catch (x) {} render(); }
    else if (act === 'novoForn') { (rota() === 'amostras' ? A : R).novoFornAberto = true; render(); var i = document.getElementById('novoFornTexto'); if (i) i.focus(); }
    else if (act === 'addForn') adicionarFornecedor(rota() === 'amostras' ? A : R);
    else if (act === 'toggleForm') { A.formAberto = !A.formAberto; render(); }
    else if (act === 'salvarReg') salvarRegistro();
    else if (act === 'salvarAm') salvarAmostra();
  });

  async function salvarRegistro() {
    if (!registroValido() || R.salvando) return;
    R.salvando = true; R.erro = null; R.salvo = false; atualizarAcao();
    var id = R.idPendente || (R.idPendente = uuid());
    var r = await enviar({
      id: id, operacao: R.operacao, material: R.material, diametro: R.diametro, fornecedor: R.fornecedor || '',
      lote: R.lote.trim(), quantidade: R.quantidade.trim(), maquina: R.maquina || '', responsavel: R.responsavel, data: R.data
    });
    R.salvando = false;
    if (r.ok) {
      R.salvo = true; R.idPendente = null; D.saidasCache = {};
      R.lote = ''; R.quantidade = ''; R.fornecedor = ''; R.maquina = '';
      render(); window.scrollTo(0, 0);
      var sc = app.querySelector('.scroll'); if (sc) sc.scrollTop = 0;
      atualizar();
    } else { R.erro = r.mensagem; render(); }
  }

  async function salvarAmostra() {
    if (!amostraValida() || A.salvando) return;
    A.salvando = true; A.erro = null; A.salvo = false; atualizarAcao();
    var id = A.idPendente || (A.idPendente = uuid());
    var r = await enviar({
      acao: 'amostra', id: id, tipo: A.tipo, material: A.material, diametro: A.diametro, fornecedor: A.fornecedor || '',
      lote: A.lote.trim(), quantidade: A.quantidade.trim(), finalidade: A.finalidade.trim(), maquina: A.maquina || '',
      responsavel: A.responsavel, data: A.data
    });
    A.salvando = false;
    if (r.ok) {
      A.salvo = true; A.idPendente = null;
      A.lote = ''; A.quantidade = ''; A.fornecedor = ''; A.finalidade = ''; A.maquina = '';
      render();
      var sc = app.querySelector('.scroll'); if (sc) sc.scrollTop = 0;
      atualizar();
    } else { A.erro = r.mensagem; render(); }
  }

  window.addEventListener('hashchange', function () {
    render();
    if (rota() === 'saidas' && S.diametro) carregarSaidas();
    atualizar();
  });
  window.addEventListener('online', function () { render(); atualizar(); });
  window.addEventListener('offline', render);
  // Ao voltar para o app (ex.: abrir de novo no iPhone), busca dados novos
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') atualizar(); });

  render();
  atualizar();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
  }
})();
