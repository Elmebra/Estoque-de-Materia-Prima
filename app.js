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
    return '<div class="brand"><img src="data:image/png;base64,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" alt="Elmebra"><span>Elmebra · desde 1954</span></div>';
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
