// =========================================
// CONFIGURAÇÃO DO BACK-END (SUPABASE AUTH + REST)
// =========================================
const SUPABASE_URL = 'https://sufszeczfwfryceobuck.supabase.co';
// Confirme em Project Settings > API se esta é a sua chave "anon public"
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN1ZnN6ZWN6ZndmcnljZW9idWNrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ4NDEwOTcsImV4cCI6MjExMDQxNzA5N30.ggpQI1-Zx0T2Rfr5lVtJvHUQbPpUE0Gv_2j5dQTtfL4';

let usuarioLogado = JSON.parse(localStorage.getItem('verde_usuario_logado')) || null;

function obterHeadersAuth() {
    const token = usuarioLogado?.access_token || SUPABASE_KEY;
    return {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
    };
}

const formTransacao = document.getElementById('form-transacao');
const listaTransacoes = document.getElementById('lista-transacoes');
const filtroMes = document.getElementById('filtro-mes');
const mesLancamento = document.getElementById('mes-lancamento');
const selectCategoria = document.getElementById('categoria');
const selectTipo = document.getElementById('tipo');

const CORES_CATEGORIAS = {
    'Fatura': '#ef4444',
    'Essencial': '#3b82f6',
    'Alimentacao': '#f59e0b',
    'Transporte': '#8b5cf6',
    'Superfluo': '#ec4899',
    'Outro': '#64748b',
    'Salario': '#10b981'
};

const hoje = new Date();
const mesAtualFormatado = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
filtroMes.value = mesAtualFormatado;
mesLancamento.value = mesAtualFormatado;

let areasTorresClicaveis = [];
let acaoPendente = null;
let transacoes = [];

let pilhaDesfazer = [];
let pilhaRefazer = [];

function formatarMoeda(valor) {
    return Number(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function persistirDadosLocais() {
    if (usuarioLogado) {
        localStorage.setItem(`verde_dados_${usuarioLogado.email}`, JSON.stringify(transacoes));
    } else {
        localStorage.setItem('verde_dados_visitante', JSON.stringify(transacoes));
    }
}

// =========================================
// COMUNICAÇÃO COM O BANCO NA NUVEM (SUPABASE)
// =========================================
async function carregarTransacoes() {
    if (!usuarioLogado) {
        transacoes = JSON.parse(localStorage.getItem('verde_dados_visitante')) || [];
        atualizarInterface(true);
        return;
    }

    try {
        const resposta = await fetch(
            `${SUPABASE_URL}/rest/v1/transacoes?user_id=eq.${usuarioLogado.id}&order=id.asc`,
            { method: 'GET', headers: obterHeadersAuth() }
        );

        if (resposta.ok) {
            transacoes = await resposta.json();
            persistirDadosLocais();
        } else {
            console.warn('Aviso ao ler nuvem:', await resposta.text());
            transacoes = JSON.parse(localStorage.getItem(`verde_dados_${usuarioLogado.email}`)) || [];
        }
    } catch (erro) {
        transacoes = JSON.parse(localStorage.getItem(`verde_dados_${usuarioLogado.email}`)) || [];
    }

    atualizarInterface(true);
}

async function salvarTransacaoNuvem(item) {
    persistirDadosLocais();
    if (!usuarioLogado) return;

    try {
        const payload = {
            user_id: usuarioLogado.id,
            usuario_email: usuarioLogado.email,
            descricao: item.descricao,
            valor: item.valor,
            mes: item.mes,
            tipo: item.tipo,
            categoria: item.categoria
        };

        const resposta = await fetch(`${SUPABASE_URL}/rest/v1/transacoes`, {
            method: 'POST',
            headers: obterHeadersAuth(),
            body: JSON.stringify(payload)
        });

        if (resposta.ok) {
            const criados = await resposta.json();
            if (criados && criados.length > 0) {
                item.id = criados[0].id;
                persistirDadosLocais();
                atualizarInterface(false);
            }
        } else {
            console.warn('Aviso ao salvar na nuvem:', await resposta.text());
        }
    } catch (erro) {
        console.warn('Sem conexão com a nuvem no momento:', erro);
    }
}

async function excluirTransacaoNuvem(id) {
    persistirDadosLocais();
    if (!usuarioLogado) return;

    try {
        await fetch(`${SUPABASE_URL}/rest/v1/transacoes?id=eq.${id}`, {
            method: 'DELETE',
            headers: obterHeadersAuth()
        });
    } catch (erro) {
        console.warn('Erro ao excluir na nuvem:', erro);
    }
}

async function sincronizarListaCompletaNuvem() {
    persistirDadosLocais();
    if (!usuarioLogado) return;

    try {
        await fetch(`${SUPABASE_URL}/rest/v1/transacoes?user_id=eq.${usuarioLogado.id}`, {
            method: 'DELETE',
            headers: obterHeadersAuth()
        });

        if (transacoes.length > 0) {
            const lote = transacoes.map(t => ({
                user_id: usuarioLogado.id,
                usuario_email: usuarioLogado.email,
                descricao: t.descricao,
                valor: t.valor,
                mes: t.mes,
                tipo: t.tipo,
                categoria: t.categoria
            }));

            const resposta = await fetch(`${SUPABASE_URL}/rest/v1/transacoes`, {
                method: 'POST',
                headers: obterHeadersAuth(),
                body: JSON.stringify(lote)
            });

            if (resposta.ok) {
                transacoes = await resposta.json();
                persistirDadosLocais();
                atualizarInterface(false);
            }
        }
    } catch (erro) {
        console.warn('Erro ao sincronizar lista:', erro);
    }
}

// =========================================
// CONTROLE DE HISTÓRICO (DESFAZER / REFAZER)
// =========================================
function registrarEstadoAnterior() {
    pilhaDesfazer.push(JSON.stringify(transacoes));
    if (pilhaDesfazer.length > 30) pilhaDesfazer.shift();
    pilhaRefazer = [];
    atualizarBotoesHistorico();
}

function atualizarBotoesHistorico() {
    const btnDesfazer = document.getElementById('btn-desfazer');
    const btnRefazer = document.getElementById('btn-refazer');

    if (pilhaDesfazer.length > 0) btnDesfazer.classList.remove('oculto');
    else btnDesfazer.classList.add('oculto');

    if (pilhaRefazer.length > 0) btnRefazer.classList.remove('oculto');
    else btnRefazer.classList.add('oculto');
}

async function executarDesfazer() {
    if (pilhaDesfazer.length === 0) return;
    pilhaRefazer.push(JSON.stringify(transacoes));
    transacoes = JSON.parse(pilhaDesfazer.pop());
    atualizarBotoesHistorico();
    atualizarInterface(true);
    await sincronizarListaCompletaNuvem();
}

async function executarRefazer() {
    if (pilhaRefazer.length === 0) return;
    pilhaDesfazer.push(JSON.stringify(transacoes));
    transacoes = JSON.parse(pilhaRefazer.pop());
    atualizarBotoesHistorico();
    atualizarInterface(true);
    await sincronizarListaCompletaNuvem();
}

document.getElementById('btn-desfazer').addEventListener('click', executarDesfazer);
document.getElementById('btn-refazer').addEventListener('click', executarRefazer);

document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        if (document.activeElement.tagName !== 'INPUT') {
            e.preventDefault();
            executarDesfazer();
        }
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        if (document.activeElement.tagName !== 'INPUT') {
            e.preventDefault();
            executarRefazer();
        }
    }
});

// =========================================
// AUTOMAÇÃO: CATEGORIA -> TIPO
// =========================================
selectCategoria.addEventListener('change', () => {
    selectTipo.value = selectCategoria.value === 'Salario' ? 'entrada' : 'saida';
});

// =========================================
// ATUALIZAÇÃO DA INTERFACE E CÁLCULOS
// =========================================
function atualizarBarraUsuario() {
    const statusEl = document.getElementById('status-usuario');
    const btnEntrar = document.getElementById('btn-abrir-auth');
    const btnSair = document.getElementById('btn-sair');

    if (usuarioLogado) {
        statusEl.innerText = `☁️ ${usuarioLogado.nome}`;
        btnEntrar.classList.add('oculto');
        btnSair.classList.remove('oculto');
    } else {
        statusEl.innerText = 'Modo Visitante';
        btnEntrar.classList.remove('oculto');
        btnSair.classList.add('oculto');
    }
}

function atualizarInterface(animar = true) {
    listaTransacoes.innerHTML = '';
    const mesSelecionado = filtroMes.value;
    document.querySelectorAll('.label-mes-atual').forEach(el => el.innerText = mesSelecionado);

    let totalReceitas = 0;
    let totalDespesas = 0;

    const transacoesDoMes = transacoes.filter(item => item.mes === mesSelecionado);
    document.getElementById('contagem-itens').innerText = `${transacoesDoMes.length} ${transacoesDoMes.length === 1 ? 'item' : 'itens'}`;

    transacoesDoMes.forEach((item) => {
        const valorNum = Number(item.valor);
        if (item.tipo === 'entrada') totalReceitas += valorNum;
        else totalDespesas += valorNum;

        const corCat = CORES_CATEGORIAS[item.categoria] || '#64748b';
        const tr = document.createElement('tr');
        tr.classList.add(item.tipo === 'entrada' ? 'linha-entrada' : 'linha-saida');

        tr.innerHTML = `
            <td>${item.descricao}</td>
            <td><span class="tag-categoria" style="background-color: ${corCat};">${item.categoria}</span></td>
            <td>${item.tipo === 'entrada' ? 'Entrada' : 'Saída'}</td>
            <td>${formatarMoeda(valorNum)}</td>
            <td data-html2canvas-ignore="true">
                <button class="btn-excluir" onclick="removerTransacao(${item.id})">Excluir</button>
            </td>
        `;
        listaTransacoes.appendChild(tr);
    });

    document.getElementById('total-receitas').innerText = formatarMoeda(totalReceitas);
    document.getElementById('total-despesas').innerText = formatarMoeda(totalDespesas);
    document.getElementById('saldo-atual').innerText = formatarMoeda(totalReceitas - totalDespesas);

    verificarSaudeFinanceira(totalReceitas, totalDespesas);
    renderizarGraficosResponsivos(mesSelecionado, animar);
}

function verificarSaudeFinanceira(receitas, despesas) {
    const elAlerta = document.getElementById('alerta-ods');
    const elMsg = document.getElementById('mensagem-alerta');

    if (receitas === 0 && despesas > 0) {
        elAlerta.classList.remove('oculto');
        elMsg.innerText = 'Você possui gastos previstos neste mês sem entradas registradas!';
        return;
    }

    if (receitas > 0) {
        const percentual = (despesas / receitas) * 100;
        if (percentual >= 100) {
            elAlerta.classList.remove('oculto');
            elMsg.innerText = `Perigo! Os gastos deste mês atingiram ${percentual.toFixed(1)}% da renda.`;
        } else if (percentual >= 70) {
            elAlerta.classList.remove('oculto');
            elMsg.innerText = `Atenção! Você comprometeu ${percentual.toFixed(1)}% da renda neste mês.`;
        } else {
            elAlerta.classList.add('oculto');
        }
    } else {
        elAlerta.classList.add('oculto');
    }
}

// =========================================
// GRÁFICOS COM PONTILHADO SOBREPOSTO À TORRE
// =========================================
function renderizarGraficosResponsivos(mesSelecionado, animar) {
    const wrapperTorres = document.getElementById('wrapper-torres');
    const canvasTorres = document.getElementById('grafico-torres');
    const wrapperPizza = document.getElementById('wrapper-pizza');
    const canvasPizza = document.getElementById('grafico-pizza');

    if (!canvasTorres || !canvasPizza) return;

    canvasTorres.width = Math.max(280, wrapperTorres.clientWidth);
    canvasTorres.height = 250;

    canvasPizza.width = Math.max(280, wrapperPizza.clientWidth);
    canvasPizza.height = canvasPizza.width < 380 ? 300 : 250;

    if (animar) {
        animarGraficos(mesSelecionado, canvasTorres, canvasPizza);
    } else {
        desenharFrameTorres(mesSelecionado, canvasTorres, 1);
        desenharFramePizza(mesSelecionado, canvasPizza, 1);
    }
}

function animarGraficos(mesSelecionado, canvasTorres, canvasPizza) {
    const duracao = 550;
    const inicio = performance.now();

    function passo(agora) {
        const tempoPassado = agora - inicio;
        const progressoBruto = Math.min(tempoPassado / duracao, 1);
        const progresso = 1 - Math.pow(1 - progressoBruto, 3);

        desenharFrameTorres(mesSelecionado, canvasTorres, progresso);
        desenharFramePizza(mesSelecionado, canvasPizza, progresso);

        if (progressoBruto < 1) {
            requestAnimationFrame(passo);
        }
    }
    requestAnimationFrame(passo);
}

function desenharFrameTorres(mesSelecionado, canvas, progresso) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    areasTorresClicaveis = [];

    const dadosPorMes = {};
    transacoes.forEach(item => {
        if (!dadosPorMes[item.mes]) {
            dadosPorMes[item.mes] = { gastos: 0, renda: 0 };
        }
        if (item.tipo === 'saida') {
            dadosPorMes[item.mes].gastos += Number(item.valor);
        } else {
            dadosPorMes[item.mes].renda += Number(item.valor);
        }
    });

    let meses = Object.keys(dadosPorMes).sort();

    if (meses.length > 6) {
        let idx = meses.indexOf(mesSelecionado);
        if (idx === -1) idx = meses.length - 1;
        let inicio = Math.max(0, idx - 2);
        let fim = inicio + 6;
        if (fim > meses.length) {
            fim = meses.length;
            inicio = Math.max(0, fim - 6);
        }
        meses = meses.slice(inicio, fim);
    }

    if (meses.length === 0) {
        ctx.fillStyle = '#64748b';
        ctx.font = '14px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Lance um salário ou gasto para ver o gráfico', canvas.width / 2, canvas.height / 2);
        return;
    }

    const todosValores = meses.flatMap(m => [dadosPorMes[m].gastos, dadosPorMes[m].renda]);
    const maxValor = Math.max(...todosValores, 1);

    const areaAltura = canvas.height - 72;
    const larguraMaxima = Math.min(54, (canvas.width - 30) / meses.length - 16);
    const larguraBarra = Math.max(26, larguraMaxima);
    const espacamento = (canvas.width - (larguraBarra * meses.length)) / (meses.length + 1);
    const baseY = canvas.height - 32;

    meses.forEach((mes, i) => {
        const { gastos, renda } = dadosPorMes[mes];
        const x = espacamento + i * (larguraBarra + espacamento);
        const ultrapassouRenda = renda > 0 && gastos > renda;

        areasTorresClicaveis.push({
            mes: mes,
            x: x - 5,
            y: 10,
            largura: larguraBarra + 10,
            altura: canvas.height - 20
        });

        if (renda > 0) {
            const alturaRenda = (renda / maxValor) * areaAltura;
            const yRenda = baseY - alturaRenda;

            ctx.fillStyle = 'rgba(148, 163, 184, 0.22)';
            ctx.beginPath();
            ctx.roundRect(x - 4, yRenda, larguraBarra + 8, alturaRenda, [6, 6, 0, 0]);
            ctx.fill();
        }

        if (gastos > 0) {
            const alturaFinal = (gastos / maxValor) * areaAltura;
            const alturaAtual = alturaFinal * progresso;
            const yGasto = baseY - alturaAtual;

            if (renda > 0) {
                ctx.fillStyle = ultrapassouRenda ? '#ef4444' : '#10b981';
            } else {
                ctx.fillStyle = mes === mesSelecionado ? '#0f766e' : '#64748b';
            }

            ctx.beginPath();
            ctx.roundRect(x, yGasto, larguraBarra, alturaAtual, [6, 6, 0, 0]);
            ctx.fill();

            if (mes === mesSelecionado) {
                ctx.lineWidth = 2;
                ctx.strokeStyle = '#1e293b';
                ctx.stroke();
            }

            if (progresso > 0.6) {
                ctx.fillStyle = ultrapassouRenda ? '#dc2626' : '#1e293b';
                ctx.font = 'bold 11px sans-serif';
                ctx.textAlign = 'center';
                const textoValor = gastos >= 1000 ? `R$${(gastos / 1000).toFixed(1)}k` : `R$${gastos.toFixed(0)}`;
                const posTextoY = (renda > 0 && Math.abs(gastos - renda) < maxValor * 0.1)
                    ? Math.min(yGasto, baseY - (renda / maxValor) * areaAltura) - 8
                    : yGasto - 6;
                ctx.fillText(textoValor, x + larguraBarra / 2, posTextoY);
            }
        } else if (renda > 0 && progresso > 0.6) {
            const yRenda = baseY - (renda / maxValor) * areaAltura;
            ctx.fillStyle = '#059669';
            ctx.font = 'bold 10px sans-serif';
            ctx.textAlign = 'center';
            const textoRenda = renda >= 1000 ? `R$${(renda / 1000).toFixed(1)}k` : `R$${renda.toFixed(0)}`;
            ctx.fillText(textoRenda, x + larguraBarra / 2, yRenda - 6);
        }

        if (renda > 0) {
            const yRenda = baseY - (renda / maxValor) * areaAltura;

            ctx.save();
            if (ultrapassouRenda) {
                ctx.beginPath();
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 4;
                ctx.moveTo(x - 6, yRenda);
                ctx.lineTo(x + larguraBarra + 6, yRenda);
                ctx.stroke();
            }

            ctx.beginPath();
            ctx.setLineDash([4, 3]);
            ctx.strokeStyle = ultrapassouRenda ? '#991b1b' : '#059669';
            ctx.lineWidth = 2.5;
            ctx.moveTo(x - 6, yRenda);
            ctx.lineTo(x + larguraBarra + 6, yRenda);
            ctx.stroke();
            ctx.restore();
        }

        const partesMes = mes.split('-');
        const labelCurto = partesMes.length === 2 ? `${partesMes[1]}/${partesMes[0].slice(2)}` : mes;
        ctx.fillStyle = mes === mesSelecionado ? '#0f766e' : '#475569';
        ctx.font = mes === mesSelecionado ? 'bold 11px sans-serif' : '11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(labelCurto, x + larguraBarra / 2, canvas.height - 12);
    });
}

const canvasTorresEl = document.getElementById('grafico-torres');
canvasTorresEl.addEventListener('mousemove', (e) => {
    const rect = canvasTorresEl.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const sobreTorre = areasTorresClicaveis.some(area =>
        mouseX >= area.x && mouseX <= area.x + area.largura &&
        mouseY >= area.y && mouseY <= area.y + area.altura
    );
    canvasTorresEl.style.cursor = sobreTorre ? 'pointer' : 'default';
});

canvasTorresEl.addEventListener('click', (e) => {
    const rect = canvasTorresEl.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    const torreClicada = areasTorresClicaveis.find(area =>
        clickX >= area.x && clickX <= area.x + area.largura &&
        clickY >= area.y && clickY <= area.y + area.altura
    );

    if (torreClicada) {
        filtroMes.value = torreClicada.mes;
        mesLancamento.value = torreClicada.mes;
        atualizarInterface(true);
        document.getElementById('secao-extrato').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
});

// =========================================
// GRÁFICO DE PIZZA ANIMADO (COM SALDO LIVRE)
// =========================================
function desenharFramePizza(mesSelecionado, canvas, progresso) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const gastosPorCat = {};
    let totalSaidas = 0;
    let totalEntradas = 0;

    transacoes.forEach(item => {
        if (item.mes === mesSelecionado) {
            const val = Number(item.valor);
            if (item.tipo === 'saida') {
                gastosPorCat[item.categoria] = (gastosPorCat[item.categoria] || 0) + val;
                totalSaidas += val;
            } else if (item.tipo === 'entrada') {
                totalEntradas += val;
            }
        }
    });

    if (totalSaidas === 0 && totalEntradas === 0) {
        ctx.fillStyle = '#64748b';
        ctx.font = '14px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Sem lançamentos registrados neste mês', canvas.width / 2, canvas.height / 2);
        return;
    }

    const fatias = [];
    Object.keys(gastosPorCat).forEach(cat => {
        fatias.push({
            label: cat,
            valor: gastosPorCat[cat],
            cor: CORES_CATEGORIAS[cat] || '#64748b'
        });
    });

    const saldoLivre = totalEntradas - totalSaidas;
    if (saldoLivre > 0) {
        fatias.push({
            label: 'Saldo Livre',
            valor: saldoLivre,
            cor: '#10b981'
        });
    }

    const baseTotal = Math.max(totalEntradas, totalSaidas);
    const modoRetratoPequeno = canvas.width < 380;
    const centroX = modoRetratoPequeno ? canvas.width / 2 : 105;
    const centroY = modoRetratoPequeno ? 95 : canvas.height / 2;
    const raio = modoRetratoPequeno ? 72 : 82;

    let anguloInicial = -Math.PI / 2;
    const anguloTotalAnimado = 2 * Math.PI * progresso;

    fatias.forEach((item, i) => {
        const anguloFatia = (item.valor / baseTotal) * anguloTotalAnimado;

        ctx.beginPath();
        ctx.moveTo(centroX, centroY);
        ctx.arc(centroX, centroY, raio, anguloInicial, anguloInicial + anguloFatia);
        ctx.closePath();
        ctx.fillStyle = item.cor;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();

        anguloInicial += anguloFatia;

        const percentual = ((item.valor / baseTotal) * 100).toFixed(0);
        if (modoRetratoPequeno) {
            const col = i % 2;
            const row = Math.floor(i / 2);
            const legX = 20 + col * (canvas.width / 2);
            const legY = 195 + row * 22;

            ctx.fillStyle = item.cor;
            ctx.fillRect(legX, legY - 9, 12, 12);
            ctx.fillStyle = '#1e293b';
            ctx.font = '11px sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText(`${item.label} (${percentual}%)`, legX + 18, legY + 1);
        } else {
            const legendaY = 30 + i * 26;
            ctx.fillStyle = item.cor;
            ctx.fillRect(210, legendaY - 10, 14, 14);

            ctx.fillStyle = '#1e293b';
            ctx.font = '12px sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText(`${item.label} (${percentual}%)`, 232, legendaY + 2);
        }
    });
}

window.addEventListener('resize', () => {
    renderizarGraficosResponsivos(filtroMes.value, false);
});

// =========================================
// ADICIONAR E EXCLUIR LANÇAMENTOS (COM HISTÓRICO)
// =========================================
formTransacao.addEventListener('submit', async (e) => {
    e.preventDefault();
    registrarEstadoAnterior();

    const mesEscolhido = mesLancamento.value;
    const novaTransacao = {
        id: Date.now(),
        descricao: document.getElementById('descricao').value,
        valor: parseFloat(document.getElementById('valor').value),
        mes: mesEscolhido,
        tipo: selectTipo.value,
        categoria: selectCategoria.value
    };

    transacoes.push(novaTransacao);
    filtroMes.value = mesEscolhido;

    document.getElementById('descricao').value = '';
    document.getElementById('valor').value = '';
    selectCategoria.value = 'Fatura';
    selectTipo.value = 'saida';
    mesLancamento.value = mesEscolhido;

    atualizarInterface(true);
    await salvarTransacaoNuvem(novaTransacao);
});

async function removerTransacao(id) {
    registrarEstadoAnterior();
    transacoes = transacoes.filter(item => item.id !== id);
    atualizarInterface(false);
    await excluirTransacaoNuvem(id);
}

filtroMes.addEventListener('change', () => {
    mesLancamento.value = filtroMes.value;
    atualizarInterface(true);
});

// =========================================
// CONTROLE DE LOGIN / CADASTRO REAL NO SUPABASE
// =========================================
const modalAuth = document.getElementById('modal-auth');
const formLogin = document.getElementById('form-login');
const formCadastro = document.getElementById('form-cadastro');
const abaLogin = document.getElementById('aba-login');
const abaCadastro = document.getElementById('aba-cadastro');

function abrirModalAuth(motivoTexto, acao) {
    acaoPendente = acao;
    document.getElementById('aviso-motivo-auth').innerText = motivoTexto;
    modalAuth.classList.remove('oculto');
}

document.getElementById('btn-abrir-auth').addEventListener('click', () => {
    abrirModalAuth('Entre ou cadastre-se para sincronizar seus lançamentos na nuvem.', null);
});

document.getElementById('btn-fechar-modal').addEventListener('click', () => {
    modalAuth.classList.add('oculto');
});

abaLogin.addEventListener('click', () => {
    abaLogin.classList.add('ativa');
    abaCadastro.classList.remove('ativa');
    formLogin.classList.remove('oculto');
    formCadastro.classList.add('oculto');
});

abaCadastro.addEventListener('click', () => {
    abaCadastro.classList.add('ativa');
    abaLogin.classList.remove('ativa');
    formCadastro.classList.remove('oculto');
    formLogin.classList.add('oculto');
});

formCadastro.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nome = document.getElementById('cad-nome').value;
    const email = document.getElementById('cad-email').value;
    const senha = document.getElementById('cad-senha').value;

    try {
        const resposta = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
            method: 'POST',
            headers: { 'apikey': SUPABASE_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email,
                password: senha,
                data: { nome }
            })
        });

        const dados = await resposta.json();
        if (!resposta.ok) {
            alert('Erro ao cadastrar: ' + (dados.msg || dados.error_description || 'Verifique os dados.'));
            return;
        }

        usuarioLogado = {
            id: dados.user.id,
            email: dados.user.email,
            nome: nome,
            access_token: dados.access_token
        };
        localStorage.setItem('verde_usuario_logado', JSON.stringify(usuarioLogado));

        for (const item of transacoes) {
            await salvarTransacaoNuvem(item);
        }
        localStorage.removeItem('verde_dados_visitante');

        finalizarAutenticacao();
    } catch (err) {
        alert('Erro de conexão ao tentar cadastrar.');
    }
});

formLogin.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const senha = document.getElementById('login-senha').value;

    try {
        const resposta = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
            method: 'POST',
            headers: { 'apikey': SUPABASE_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password: senha })
        });

        const dados = await resposta.json();
        if (!resposta.ok) {
            alert('E-mail ou senha incorretos.');
            return;
        }

        usuarioLogado = {
            id: dados.user.id,
            email: dados.user.email,
            nome: dados.user.user_metadata?.nome || email.split('@'),
            access_token: dados.access_token
        };
        localStorage.setItem('verde_usuario_logado', JSON.stringify(usuarioLogado));

        const dadosVisitante = JSON.parse(localStorage.getItem('verde_dados_visitante')) || [];
        for (const item of dadosVisitante) {
            await salvarTransacaoNuvem(item);
        }
        localStorage.removeItem('verde_dados_visitante');

        await carregarTransacoes();
        finalizarAutenticacao();
    } catch (err) {
        alert('Erro de conexão ao fazer login.');
    }
});

function finalizarAutenticacao() {
    modalAuth.classList.add('oculto');
    atualizarBarraUsuario();
    atualizarInterface(true);

    if (acaoPendente === 'salvar') {
        alert(`Dados sincronizados na nuvem para ${usuarioLogado.nome}!`);
    } else if (acaoPendente === 'pdf') {
        gerarPDF();
    }
    acaoPendente = null;
}

document.getElementById('btn-sair').addEventListener('click', async () => {
    localStorage.removeItem('verde_usuario_logado');
    usuarioLogado = null;
    pilhaDesfazer = [];
    pilhaRefazer = [];
    atualizarBotoesHistorico();
    atualizarBarraUsuario();
    await carregarTransacoes();
});

// =========================================
// BOTÕES DE SALVAR, PDF, JSON E ABRIR
// =========================================
document.getElementById('btn-salvar-conta').addEventListener('click', async () => {
    if (!usuarioLogado) {
        abrirModalAuth('Entre ou crie sua conta para salvar seus lançamentos na nuvem:', 'salvar');
    } else {
        await sincronizarListaCompletaNuvem();
        alert(`Lançamentos sincronizados na nuvem de ${usuarioLogado.nome}!`);
    }
});

document.getElementById('btn-gerar-pdf').addEventListener('click', () => {
    if (!usuarioLogado) {
        abrirModalAuth('Entre ou crie uma conta rápida para exportar o relatório em PDF:', 'pdf');
    } else {
        gerarPDF();
    }
});

function gerarPDF() {
    renderizarGraficosResponsivos(filtroMes.value, false);

    if (typeof html2pdf === 'undefined') {
        window.print();
        return;
    }

    const elemento = document.getElementById('area-impressao-pdf');
    const opcoes = {
        margin: 8,
        filename: `Relatorio_Financeiro_${filtroMes.value}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2 },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' }
    };
    html2pdf().set(opcoes).from(elemento).save();
}

document.getElementById('btn-exportar-json').addEventListener('click', () => {
    const dadosStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(transacoes, null, 2));
    const link = document.createElement('a');
    link.setAttribute("href", dadosStr);
    link.setAttribute("download", `planilha_financeira_${filtroMes.value}.json`);
    document.body.appendChild(link);
    link.click();
    link.remove();
});

document.getElementById('input-importar-json').addEventListener('change', async (e) => {
    const arquivo = e.target.files[0];
    if (!arquivo) return;
    const leitor = new FileReader();
    leitor.onload = async (evento) => {
        try {
            const dadosImportados = JSON.parse(evento.target.result);
            if (Array.isArray(dadosImportados)) {
                registrarEstadoAnterior();
                transacoes = dadosImportados;
                atualizarInterface(true);
                await sincronizarListaCompletaNuvem();
                alert('Planilha JSON carregada com sucesso!');
            }
        } catch (err) {
            alert('Arquivo JSON inválido.');
        }
    };
    leitor.readAsText(arquivo);
});

// Inicialização
atualizarBarraUsuario();
atualizarBotoesHistorico();
carregarTransacoes();
