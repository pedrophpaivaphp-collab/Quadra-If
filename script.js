// ===================================================
// CONFIGURAÇÃO
// ===================================================
const SUPABASE_URL = "https://rkeulwnhuqqmouvftfkl.supabase.co";
const SUPABASE_KEY = "sb_publishable_potQdb_55HrXyeXA7F1wkw_34E4PzZl";

const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const $ = (id) => document.getElementById(id);

const state = {
    day: null,          // rodada mais recente
    teams: {},        // equipes da rodada, por id
    matches: [],      // histórico
    isAdmin: false,
    busy: false,
    tie: false,       // painel "quem ganhou no par ou ímpar" aberto
    editingId: null   // equipe sendo editada
};

// ===================================================
// FUNÇÕES AUXILIARES
// ===================================================
function esc(text) {
    const d = document.createElement("div");
    d.textContent = text == null ? "" : String(text);
    return d.innerHTML;
}

function joinNames(list) {
    if (list.length <= 1) return list[0] || "";
    return list.slice(0, -1).join(", ") + " e " + list[list.length - 1];
}

function teamTitle(players) {
    return players && players.length ? players[0] : "?";
}

function teamSub(players) {
    const rest = (players || []).slice(1);
    return rest.length ? joinNames(rest) : "Equipe incompleta";
}

function norm(s) {
    return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function pad(n) {
    return String(n).padStart(2, "0");
}

let toastTimer;
function toast(msg, isError) {
    const t = $("toast");
    t.textContent = msg;
    t.className = "toast" + (isError ? " error" : "");
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 4500);
}

async function rpc(name, args) {
    const { error } = await db.rpc(name, args || {});
    if (error) throw error;
}

// Executa uma ação de admin, bloqueando cliques duplos
async function run(fn, okMsg) {
    if (state.busy) return;
    state.busy = true;
    document.body.classList.add("busy");
    try {
        await fn();
        if (okMsg) toast(okMsg);
    } catch (e) {
        toast(e.message || "Erro inesperado", true);
    } finally {
        state.busy = false;
        document.body.classList.remove("busy");
        await loadAll();
    }
}

// ===================================================
// CARREGAR DADOS
// ===================================================
async function loadAll() {
    const { data: days, error } = await db
        .from("game_days")
        .select("*")
        .order("game_date", { ascending: false })
        .limit(1);

    if (error) {
        toast("Erro ao carregar: " + error.message, true);
        return;
    }

    state.day = days && days[0] ? days[0] : null;
    state.teams = {};

    if (state.day) {
        const { data: teams } = await db
            .from("teams")
            .select("*")
            .eq("game_day_id", state.day.id)
            .order("created_at", { ascending: true });
        (teams || []).forEach((t) => { state.teams[t.id] = t; });
    }

    const { data: matches } = await db
        .from("matches")
        .select("*, game_days(game_date)")
        .order("played_at", { ascending: false })
        .limit(100);
    state.matches = matches || [];

    if (!state.day || state.day.status !== "playing") state.tie = false;

    render();
}

// ===================================================
// RENDERIZAÇÃO
// ===================================================
function render() {
    renderHeading();
    renderMatch();
    renderQueue();
    renderHistory();
    renderAdmin();
}

function renderHeading() {
    const d = state.day;
    $("adminButtonText").textContent = state.isAdmin ? "Sair" : "Administrador";

    if (!d) {
        $("eyebrow").textContent = "SEM RODADA";
        $("statusText").textContent = "AGUARDANDO";
        $("statusBox").classList.add("off");
        return;
    }

    const [y, m, dd] = d.game_date.split("-").map(Number);
    const date = new Date(y, m - 1, dd);
    const weekday = date.toLocaleDateString("pt-BR", { weekday: "long" }).toUpperCase();
    $("eyebrow").textContent = weekday + " • " + pad(dd) + "/" + pad(m);

    const labels = { registration: "CADASTRO ABERTO", playing: "AO VIVO", finished: "ENCERRADA" };
    $("statusText").textContent = labels[d.status];
    $("statusBox").classList.toggle("off", d.status !== "playing");
}

function renderMatch() {
    const d = state.day;
    const area = $("matchArea");
    $("gameNumber").textContent =
        d && d.status === "playing" ? "JOGO #" + pad(d.match_number) : "";

    if (!d) {
        area.innerHTML = '<div class="empty">Nenhuma rodada aberta. A rodada é criada quando um administrador entra na quinta-feira.</div>';
        return;
    }
    if (d.status === "finished") {
        area.innerHTML = '<div class="empty">Esta rodada foi encerrada. A próxima começa na quinta-feira.</div>';
        return;
    }
    if (d.status === "registration") {
        area.innerHTML = '<div class="empty">Equipes sendo cadastradas. A partida começa em breve.</div>';
        return;
    }

    const a = state.teams[d.current_a];
    const b = state.teams[d.current_b];
    if (!a || !b) {
        area.innerHTML = '<div class="empty">Carregando partida...</div>';
        return;
    }

    area.innerHTML = `
        <div class="match-card">
            <div class="team">
                <span class="team-label">EQUIPE A</span>
                <h2>${esc(teamTitle(a.players))}</h2>
                <p>${esc(teamSub(a.players))}</p>
            </div>
            <span class="versus">VS</span>
            <div class="team team-right">
                <span class="team-label">EQUIPE B</span>
                <h2>${esc(teamTitle(b.players))}</h2>
                <p>${esc(teamSub(b.players))}</p>
            </div>
        </div>`;
}

function renderQueue() {
    const d = state.day;
    const area = $("queueArea");
    const list = d ? d.queue.map((id) => state.teams[id]).filter(Boolean) : [];

    $("queueCount").textContent = pad(list.length) + (list.length === 1 ? " EQUIPE" : " EQUIPES");

    if (!list.length) {
        area.innerHTML = '<div class="empty">Nenhuma equipe na fila.</div>';
        return;
    }

    area.innerHTML = list.map((t, i) => `
        <div class="queue-item">
            <span class="position">${pad(i + 1)}</span>
            <div class="queue-team">
                <h4>${esc(teamTitle(t.players))}</h4>
                <p>${esc(teamSub(t.players))}</p>
            </div>
            ${i === 0 ? '<span class="next-label">PRÓXIMO</span>' : ""}
        </div>`).join("");
}

function renderHistory() {
    const area = $("historyArea");
    if (!state.matches.length) {
        area.innerHTML = '<div class="empty">Nenhuma partida registrada ainda.</div>';
        return;
    }

    area.innerHTML = state.matches.map((m) => {
        const winnerPlayers = m.winner_side === "a" ? m.team_a_players : m.team_b_players;
        const when = new Date(m.played_at).toLocaleString("pt-BR", {
            timeZone: "America/Sao_Paulo",
            day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit"
        });
        const tie = m.result_type === "tie";
        return `
        <div class="queue-item history-item">
            <span class="position">${pad(m.match_number)}</span>
            <div class="queue-team">
                <h4>${esc(teamTitle(m.team_a_players))} × ${esc(teamTitle(m.team_b_players))}</h4>
                <p>${tie ? "Empate, par ou ímpar: " : "Vitória: "}<strong>${esc(teamTitle(winnerPlayers))}</strong> • ${esc(when)}</p>
            </div>
            <span class="tag ${tie ? "tag-tie" : ""}">${tie ? "PAR/ÍMPAR" : "VITÓRIA"}</span>
        </div>`;
    }).join("");
}

function renderAdmin() {
    const panel = $("adminPanel");
    panel.hidden = !state.isAdmin;
    if (!state.isAdmin) return;

    const d = state.day;
    const controls = $("adminControls");
    let html = "";

    if (!d) {
        html += '<p class="admin-note">Nenhuma rodada aberta. Se hoje não é quinta, use o botão de teste abaixo.</p>';
    } else if (d.status === "registration") {
        html += `<button class="btn btn-primary" data-action="start" ${d.queue.length < 2 ? "disabled" : ""}>Iniciar rodada</button>`;
        if (d.queue.length < 2) html += '<p class="admin-note">Cadastre pelo menos 2 equipes para iniciar.</p>';
    } else if (d.status === "playing") {
        const a = state.teams[d.current_a];
        const b = state.teams[d.current_b];
        if (a && b) {
            if (!state.tie) {
                html += `
                    <button class="btn btn-primary" data-action="win-a">Vitória: ${esc(teamTitle(a.players))}</button>
                    <button class="btn btn-primary" data-action="win-b">Vitória: ${esc(teamTitle(b.players))}</button>
                    <button class="btn" data-action="tie">Empate</button>`;
            } else {
                html += `
                    <p class="admin-note">Empate. Quem ganhou o par ou ímpar?</p>
                    <button class="btn btn-primary" data-action="tie-a">${esc(teamTitle(a.players))}</button>
                    <button class="btn btn-primary" data-action="tie-b">${esc(teamTitle(b.players))}</button>
                    <button class="btn" data-action="tie-cancel">Voltar</button>`;
            }
        }
        const hasMatches = state.matches.some((m) => m.game_day_id === d.id);
        html += `<button class="btn btn-danger" data-action="undo" ${hasMatches ? "" : "disabled"}>Desfazer último resultado</button>`;
    }

    html += '<button class="btn btn-small" data-action="force">Abrir rodada de hoje (teste)</button>';
    controls.innerHTML = html;

    // Lista de equipes
    const list = $("teamList");
    const teams = Object.values(state.teams);
    if (!teams.length) {
        list.innerHTML = '<div class="empty">Nenhuma equipe cadastrada nesta rodada.</div>';
        return;
    }
    list.innerHTML = teams.map((t) => {
        const inCourt = d && (t.id === d.current_a || t.id === d.current_b) && d.status === "playing";
        return `
        <div class="queue-item">
            <div class="queue-team">
                <h4>${esc(teamTitle(t.players))}${inCourt ? " <span class='next-label'>EM QUADRA</span>" : ""}</h4>
                <p>${esc(teamSub(t.players))}</p>
            </div>
            <div class="row-actions">
                <button class="btn btn-small" data-action="edit" data-id="${t.id}">Editar</button>
                <button class="btn btn-small btn-danger" data-action="delete" data-id="${t.id}" ${inCourt ? "disabled" : ""}>Excluir</button>
            </div>
        </div>`;
    }).join("");
}

// ===================================================
// AÇÕES DO ADMINISTRADOR
// ===================================================
function record(winnerId, isTie) {
    const d = state.day;
    return run(
        () => rpc("record_result", {
            p_match_number: d.match_number,
            p_winner: winnerId,
            p_tie: isTie
        }).then(() => { state.tie = false; }),
        "Resultado registrado"
    );
}

document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn || btn.disabled) return;
    const action = btn.dataset.action;
    const d = state.day;

    switch (action) {
        case "start":
            run(() => rpc("start_round"), "Rodada iniciada");
            break;
        case "win-a": record(d.current_a, false); break;
        case "win-b": record(d.current_b, false); break;
        case "tie": state.tie = true; renderAdmin(); break;
        case "tie-cancel": state.tie = false; renderAdmin(); break;
        case "tie-a": record(d.current_a, true); break;
        case "tie-b": record(d.current_b, true); break;
        case "undo":
            if (confirm("Desfazer o último resultado?")) {
                run(() => rpc("undo_last_result"), "Resultado desfeito");
            }
            break;
        case "force":
            run(() => rpc("admin_init", { p_force: true }), "Rodada de hoje aberta");
            break;
        case "edit":
            startEdit(btn.dataset.id);
            break;
        case "delete": {
            const t = state.teams[btn.dataset.id];
            if (t && confirm("Excluir a equipe de " + teamTitle(t.players) + "?")) {
                run(() => rpc("delete_team", { p_team_id: t.id }), "Equipe excluída");
            }
            break;
        }
    }
});

// ---------- Formulário de equipes ----------
const teamForm = $("teamForm");
const teamInputs = () => Array.from(teamForm.querySelectorAll("input"));

function startEdit(id) {
    const t = state.teams[id];
    if (!t) return;
    state.editingId = id;
    teamInputs().forEach((inp, i) => { inp.value = t.players[i] || ""; });
    $("formTitle").textContent = "Editar equipe";
    $("teamSubmit").textContent = "Salvar alterações";
    $("teamCancel").hidden = false;
    teamForm.scrollIntoView({ behavior: "smooth", block: "center" });
}

function resetForm() {
    state.editingId = null;
    teamForm.reset();
    $("formTitle").textContent = "Cadastrar equipe";
    $("teamSubmit").textContent = "Cadastrar equipe";
    $("teamCancel").hidden = true;
}

$("teamCancel").addEventListener("click", resetForm);

teamForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const players = teamInputs().map((i) => i.value.trim()).filter(Boolean);
    if (!players.length) return;

    const others = Object.values(state.teams).filter((t) => t.id !== state.editingId);
    const existing = new Set(others.flatMap((t) => t.players.map(norm)));
    const repeated = players.filter((p) => existing.has(norm(p)));
    if (repeated.length &&
        !confirm("Atenção: " + joinNames(repeated) + " já está em outra equipe. Salvar mesmo assim?")) {
        return;
    }

    if (state.editingId) {
        const id = state.editingId;
        run(() => rpc("update_team", { p_team_id: id, p_players: players }).then(resetForm),
            "Equipe atualizada");
    } else {
        run(() => rpc("register_team", { p_players: players }).then(resetForm),
            "Equipe cadastrada");
    }
});

// ===================================================
// LOGIN / LOGOUT (Com nome de usuário)
// ===================================================
$("adminButton").addEventListener("click", async () => {
    if (state.isAdmin) {
        if (confirm("Sair do modo administrador?")) {
            await db.auth.signOut();
            state.isAdmin = false;
            resetForm();
            render();
        }
    } else {
        $("loginError").textContent = "";
        $("loginDialog").showModal();
    }
});

$("loginCancel").addEventListener("click", () => $("loginDialog").close());

$("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("loginError").textContent = "";

    const rawUser = norm($("loginUser").value).replace(/\s+/g, "");
    if (!rawUser) return;
    const fakeEmail = `${rawUser}@quadra.local`;

    const { error } = await db.auth.signInWithPassword({
        email: fakeEmail,
        password: $("loginPassword").value
    });

    if (error) {
        $("loginError").textContent = "Usuário ou senha incorretos.";
        return;
    }

    const ok = await afterLogin();
    if (ok) {
        $("loginDialog").close();
        $("loginUser").value = "";
        $("loginPassword").value = "";
    } else {
        $("loginError").textContent = "Este usuário não tem permissão de administrador.";
    }
});

async function afterLogin() {
    const { data, error } = await db.rpc("is_admin");
    if (error || data !== true) {
        await db.auth.signOut();
        state.isAdmin = false;
        render();
        return false;
    }
    state.isAdmin = true;
    try {
        await rpc("admin_init", { p_force: false });
    } catch (e) {
        toast(e.message, true);
    }
    await loadAll();
    return true;
}

// ===================================================
// TEMPO REAL + INICIALIZAÇÃO
// ===================================================
let refreshTimer;
function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
        if (!state.busy) loadAll();
    }, 300);
}

db.channel("quadra")
    .on("postgres_changes", { event: "*", schema: "public", table: "game_days" }, scheduleRefresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "teams" }, scheduleRefresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "matches" }, scheduleRefresh)
    .subscribe();

setInterval(() => { if (!state.busy) loadAll(); }, 30000);

(async function init() {
    const { data } = await db.auth.getSession();
    if (data.session) {
        await afterLogin();
    } else {
        await loadAll();
    }
})();